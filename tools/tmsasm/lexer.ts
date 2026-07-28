// TMS1000-family assembler (PRD R2), stage one: source text -> tokens.
//
// Paths in this header are relative to the repository root.
//
// The assembler exists because Jet Fighter's ROM was never dumped, so every word
// the core executes comes from `asm/jetfighter.asm` in this repo. That program is
// hand-written, close to two thousand words of it, against a 2048-word ceiling
// and 64-word pages whose execution order is not their address order
// (memory.ts). A diagnostic that cannot say *where* is close to useless at that
// size, so every token carries a file, a line, a column and a character offset,
// and every node the parser builds keeps the position of the token it came from.
// Nothing downstream ever has to re-scan text to report an error.
//
// This module knows nothing about the instruction set - it is a pure text-shape
// scanner. Mnemonics arrive here as ordinary identifiers and are checked against
// the table in isa.ts. That split is deliberate: the lexical grammar is the same
// for any assembler this project has had, and it is the only layer of the tool
// that the move from the HMCS44 to the TMS1370 leaves genuinely unchanged.
//
// It is consequently near-identical to `tools/hmasm/lexer.ts`. That duplication
// is deliberate and temporary: `tools/hmasm/` is still the live assembler for
// the v2 ROM and its tests must stay green until v3 removes it, and a shared
// lexer would couple the assembler being deleted to the one replacing it for the
// length of the rebuild.
//
// ## Lexical grammar
//
// | form                | example        | notes                                   |
// |---------------------|----------------|-----------------------------------------|
// | label               | `loop:`        | identifier immediately followed by `:`  |
// | directive           | `.ORG`         | `.` + identifier, case-insensitive      |
// | identifier          | `TCY`, `loop`  | `[A-Za-z_][A-Za-z0-9_]*`                |
// | hexadecimal         | `$1F`          | canonical; `0x1F` accepted as an alias  |
// | binary              | `%1010`        | `0b1010` accepted as an alias           |
// | decimal             | `31`           |                                         |
// | string              | `"HI"`         | `.DB` text; escapes `\\ \" \n \t \0`    |
// | separator           | `,`            |                                         |
// | expression operators| `+ - ( )`      | additive only - see parser.ts           |
// | comment             | `; anything`   | to end of line, discarded               |
// | end of line         | newline        | significant: assembly is line-oriented  |
//
// `$1F` is the canonical hexadecimal form. `0x1F` is accepted because it is what
// a TypeScript-reading contributor types by reflex, and rejecting it would buy
// nothing; the ROM source uses `$`.
//
// Case: mnemonics and directives are matched case-insensitively (parser.ts
// upper-cases them). Symbol names are *not* folded - `Loop` and `loop` are two
// symbols - so a token's `value` is the name exactly as written.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

/** Where a token, and therefore any node built from it, came from. */
export interface SourcePosition {
  /** Name of the file being assembled, for the `file:line:column` prefix. */
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column. A tab counts as one column. */
  readonly column: number;
  /** 0-based index into the source string, for listing output and slicing. */
  readonly offset: number;
}

/**
 * A diagnostic that can name its place in the source.
 *
 * One error class for the whole tool chain: the lexer, the parser and (later)
 * the assembler all raise this, so the CLI has exactly one thing to catch and
 * exactly one format to print.
 */
export class AsmError extends Error {
  /** Where in the source the diagnostic points. */
  readonly position: SourcePosition;

  constructor(message: string, position: SourcePosition) {
    super(`${position.file}:${position.line}:${position.column}: ${message}`);
    this.name = 'AsmError';
    this.position = position;
  }
}

/** Kinds of token the scanner produces. */
export enum TokenKind {
  /** `name:` - `value` is the name without the colon. */
  LABEL = 'LABEL',
  /** `.ORG` - `value` is the directive upper-cased, dot included. */
  DIRECTIVE = 'DIRECTIVE',
  /** A mnemonic or a symbol reference. `value` is the name as written. */
  IDENTIFIER = 'IDENTIFIER',
  /** A numeric literal in any of the four radix forms. */
  NUMBER = 'NUMBER',
  /** A double-quoted string. `value` is the decoded text, escapes resolved. */
  STRING = 'STRING',
  /** Operand separator. */
  COMMA = 'COMMA',
  /** Additive operator `+`. */
  PLUS = 'PLUS',
  /** Additive operator `-`, also unary negation. */
  MINUS = 'MINUS',
  /** `(` */
  LPAREN = 'LPAREN',
  /** `)` */
  RPAREN = 'RPAREN',
  /** End of a source line - a statement terminator, not whitespace. */
  NEWLINE = 'NEWLINE',
  /** End of input. Always the last token. */
  EOF = 'EOF',
}

/** One lexical token. */
export interface Token {
  readonly kind: TokenKind;
  /** The exact source text the token spans. */
  readonly text: string;
  /**
   * The token's meaning as text: an identifier or label name as written, a
   * directive upper-cased, a string's decoded contents, an operator's spelling.
   */
  readonly value: string;
  /** Present on `NUMBER` only: the literal's value. */
  readonly numericValue?: number;
  /** Position of the token's first character. */
  readonly position: SourcePosition;
}

/** Stand-in file name when the caller assembles a string rather than a file. */
export const DEFAULT_SOURCE_NAME = '<source>';

/** Radix of each numeric literal form, keyed by the prefix that introduces it. */
const RADIX = Object.freeze({
  hexadecimal: 16,
  binary: 2,
  decimal: 10,
});

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isBinaryDigit(ch: string): boolean {
  return ch === '0' || ch === '1';
}

function isIdentifierStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

/** Escape sequences a string literal understands, and what each decodes to. */
const STRING_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '\\': '\\',
  '"': '"',
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
});

/**
 * A short human description of a token, for "expected X, got Y" diagnostics.
 *
 * Quotes the source text for anything the reader can point at on the line, and
 * names the kind for the two tokens that have no visible text.
 */
export function describeToken(token: Token): string {
  switch (token.kind) {
    case TokenKind.EOF:
      return 'end of input';
    case TokenKind.NEWLINE:
      return 'end of line';
    case TokenKind.STRING:
      return `string ${JSON.stringify(token.value)}`;
    default:
      return `'${token.text}'`;
  }
}

/**
 * Scan assembly source into tokens.
 *
 * Blank lines and comment-only lines still produce their `NEWLINE`, so line
 * numbers in the token stream match line numbers in the file with no
 * bookkeeping at the parser end. The stream always ends with exactly one `EOF`.
 *
 * @throws AsmError on a character that begins no token, a numeric literal with
 *   no digits or a stray digit, or an unterminated string. These are shapes with
 *   no plausible recovery, so scanning stops at the first one rather than
 *   inventing a token and reporting a confusing parse error further down.
 */
export function tokenize(source: string, file: string = DEFAULT_SOURCE_NAME): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  const here = (): SourcePosition => ({ file, line, column, offset });

  const peek = (ahead = 0): string => source[offset + ahead] ?? '';

  /** Consume `count` characters that are known not to be line terminators. */
  const advance = (count = 1): void => {
    offset += count;
    column += count;
  };

  const push = (
    kind: TokenKind,
    position: SourcePosition,
    text: string,
    value: string,
    numericValue?: number,
  ): void => {
    const token: Token =
      numericValue === undefined
        ? { kind, text, value, position }
        : { kind, text, value, numericValue, position };
    tokens.push(Object.freeze(token));
  };

  /** Consume digits of `radix`, rejecting an empty run or a trailing stray. */
  const scanDigits = (
    start: SourcePosition,
    accept: (ch: string) => boolean,
    radix: number,
    formName: string,
  ): number => {
    const first = offset;
    while (offset < source.length && accept(peek())) {
      advance();
    }
    if (offset === first) {
      throw new AsmError(`${formName} literal has no digits`, start);
    }
    // `12A` or `$1FG`: the run stopped on something that reads as part of the
    // same word. Silently starting a new token there would turn a typo into a
    // baffling "expected end of line", so name the offending character instead.
    if (offset < source.length && isIdentifierPart(peek())) {
      throw new AsmError(`invalid digit '${peek()}' in ${formName} literal`, here());
    }
    const digits = source.slice(first, offset);
    const value = Number.parseInt(digits, radix);
    if (!Number.isSafeInteger(value)) {
      throw new AsmError(`${formName} literal is too large: ${digits}`, start);
    }
    return value;
  };

  const scanNumber = (): void => {
    const start = here();
    if (peek() === '$') {
      advance();
      const value = scanDigits(start, isHexDigit, RADIX.hexadecimal, 'hexadecimal');
      push(TokenKind.NUMBER, start, source.slice(start.offset, offset), String(value), value);
      return;
    }
    if (peek() === '%') {
      advance();
      const value = scanDigits(start, isBinaryDigit, RADIX.binary, 'binary');
      push(TokenKind.NUMBER, start, source.slice(start.offset, offset), String(value), value);
      return;
    }
    if (peek() === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
      advance(2);
      const value = scanDigits(start, isHexDigit, RADIX.hexadecimal, 'hexadecimal');
      push(TokenKind.NUMBER, start, source.slice(start.offset, offset), String(value), value);
      return;
    }
    if (peek() === '0' && (peek(1) === 'b' || peek(1) === 'B')) {
      advance(2);
      const value = scanDigits(start, isBinaryDigit, RADIX.binary, 'binary');
      push(TokenKind.NUMBER, start, source.slice(start.offset, offset), String(value), value);
      return;
    }
    const value = scanDigits(start, isDigit, RADIX.decimal, 'decimal');
    push(TokenKind.NUMBER, start, source.slice(start.offset, offset), String(value), value);
  };

  const scanString = (): void => {
    const start = here();
    advance(); // opening quote
    let decoded = '';
    for (;;) {
      if (offset >= source.length || peek() === '\n' || peek() === '\r') {
        throw new AsmError('unterminated string literal', start);
      }
      const ch = peek();
      if (ch === '"') {
        advance();
        break;
      }
      if (ch === '\\') {
        const escapePosition = here();
        advance();
        const escaped = peek();
        const replacement = STRING_ESCAPES[escaped];
        if (replacement === undefined) {
          throw new AsmError(
            `unknown escape sequence '\\${escaped}' - the string escapes are \\\\ \\" \\n \\t \\r \\0`,
            escapePosition,
          );
        }
        decoded += replacement;
        advance();
        continue;
      }
      decoded += ch;
      advance();
    }
    push(TokenKind.STRING, start, source.slice(start.offset, offset), decoded);
  };

  const scanWord = (): void => {
    const start = here();
    while (offset < source.length && isIdentifierPart(peek())) {
      advance();
    }
    const name = source.slice(start.offset, offset);
    if (peek() === ':') {
      advance();
      push(TokenKind.LABEL, start, source.slice(start.offset, offset), name);
      return;
    }
    push(TokenKind.IDENTIFIER, start, name, name);
  };

  const scanDirective = (): void => {
    const start = here();
    advance(); // the dot
    if (!isIdentifierStart(peek())) {
      throw new AsmError("expected a directive name after '.'", start);
    }
    while (offset < source.length && isIdentifierPart(peek())) {
      advance();
    }
    const text = source.slice(start.offset, offset);
    push(TokenKind.DIRECTIVE, start, text, text.toUpperCase());
  };

  const single = (kind: TokenKind): void => {
    const start = here();
    const text = peek();
    advance();
    push(kind, start, text, text);
  };

  while (offset < source.length) {
    const ch = peek();

    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
      advance();
      continue;
    }

    if (ch === ';') {
      while (offset < source.length && peek() !== '\n' && peek() !== '\r') {
        advance();
      }
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      const start = here();
      const width = ch === '\r' && peek(1) === '\n' ? 2 : 1;
      offset += width;
      line += 1;
      column = 1;
      push(TokenKind.NEWLINE, start, source.slice(start.offset, offset), '\n');
      continue;
    }

    if (ch === '$' || ch === '%' || isDigit(ch)) {
      scanNumber();
      continue;
    }

    if (ch === '"') {
      scanString();
      continue;
    }

    if (ch === "'") {
      throw new AsmError(
        'single quotes are not a literal form - use "..." for text, or a number for one character',
        here(),
      );
    }

    if (ch === '.') {
      scanDirective();
      continue;
    }

    if (isIdentifierStart(ch)) {
      scanWord();
      continue;
    }

    switch (ch) {
      case ',':
        single(TokenKind.COMMA);
        continue;
      case '+':
        single(TokenKind.PLUS);
        continue;
      case '-':
        single(TokenKind.MINUS);
        continue;
      case '(':
        single(TokenKind.LPAREN);
        continue;
      case ')':
        single(TokenKind.RPAREN);
        continue;
      default:
        throw new AsmError(`unexpected character '${ch}'`, here());
    }
  }

  push(TokenKind.EOF, here(), '', '');
  return tokens;
}
