// TMS1000-family assembler (PRD R2), stage two: tokens -> a typed statement list.
//
// Paths in this header are relative to the repository root.
//
// The parser's contract with the rest of the tool chain is that the assembler
// never looks at source text again. Every statement it needs is here, already
// matched against the architecture, already carrying the position it came from.
//
// ## Statement grammar
//
//     line      := label* (instruction | directive)? comment? EOL
//     label     := identifier ':'
//     instr     := mnemonic expression?
//     directive := '.' name arguments
//     expression:= term (('+' | '-') term)*
//     term      := number | symbol | ('-' | '+') term | '(' expression ')'
//
// A label is emitted as its own statement even when it shares a line with an
// instruction, so `loop: TAY` yields two statements. Address assignment in the
// assembler then has one rule with no special cases: a label takes the address
// of the next word emitted after it - which on this machine is an LFSR state
// rather than an ordinal position (memory.ts).
//
// Expressions are additive only - `start + 2`, `-1`, `(base + offset) - 1`. Every
// operand field on this machine is six bits or narrower; a ROM that needs
// multiplication in an operand is doing something the assembler should not be
// hiding.
//
// Arithmetic on a *label* deserves a warning that belongs here rather than in a
// comment on the ROM source. `label + 1` is arithmetic on a physical address,
// and physical addresses are not consecutive in execution order. The word after
// `label` is not `label + 1`; it is the next LFSR state. The assembler offers no
// operator for "the next instruction" because a branch to one is a branch to a
// place the author has not named, and naming it costs one line.
//
// ## Directives
//
// | directive             | argument shape        | what the assembler does with it       |
// |-----------------------|-----------------------|---------------------------------------|
// | `.ORG addr`           | one expression        | set the emit address                  |
// | `.CHAPTER n`          | one expression        | select a chapter, at its page 0       |
// | `.PAGE [n]`           | optional expression   | start page n, or the next free page   |
// | `.EQU NAME, value`    | name, then expression | define a constant symbol              |
// | `.DB item, ...`       | expressions, strings  | one eight-bit word per item           |
// | `.DW item, ...`       | expressions           | two words per item, high byte first   |
// | `.OPLA index, mask`   | two expressions       | one O output PLA slot                 |
// | `.RES n`              | one expression        | reserve n words                       |
// | `.INCLUDE "path"`     | one string            | splice another source file            |
// | `.END`                | none                  | stop assembling this file             |
//
// `.PAGE` and `.CHAPTER` are the paging directives the architecture forces on
// the source. `BR` and `CALL` carry a six-bit target within a page and there is
// no long jump, so a routine that must be branch-reachable has to start where
// the author says it starts, not wherever the previous routine happened to end.
//
// `.DW` emits *two* words, high byte first, because a word on this machine is
// eight bits. It exists for sixteen-bit tables; a program that means one word
// should say `.DB`. Both are checked against their width, so every emitted word
// is a value in 0..255 whichever directive produced it.
//
// `.OPLA` declares one slot of the O output PLA - a 32-entry, five-bit-indexed,
// eight-bit-wide table that is mask-programmed rather than executed, so it is
// data the assembly carries rather than words in the program region. Task 6 of
// the v3 run authors the table itself; this stage only has to make declaring one
// possible and keep every undeclared slot at zero.
//
// `.EQU` puts the name inside the directive - `.EQU SPEED, 3` - rather than in
// front of it. The label-per-statement rule above means a leading `NAME` would
// be indistinguishable from a code label at parse time, and a constant that
// silently became an address would be a nasty bug to chase.
//
// There is deliberately no `.ALIGN`. On a page whose words are visited in LFSR
// order, "pad to the next multiple of n" names nothing the hardware has.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { isaEntryForMnemonic, MNEMONICS, operandArity, type IsaEntry } from './isa.js';
import {
  AsmError,
  DEFAULT_SOURCE_NAME,
  describeToken,
  TokenKind,
  tokenize,
  type SourcePosition,
  type Token,
} from './lexer.js';

export {
  AsmError,
  DEFAULT_SOURCE_NAME,
  TokenKind,
  tokenize,
  type SourcePosition,
  type Token,
} from './lexer.js';

export { MNEMONICS, OperandKind, operandArity, isaEntryForMnemonic } from './isa.js';

/** Node kinds an operand or directive argument can take. */
export enum ExpressionKind {
  /** A numeric literal. */
  NUMBER = 'NUMBER',
  /** A reference to a label or an `.EQU` constant. */
  SYMBOL = 'SYMBOL',
  /** Unary `+` or `-`. */
  UNARY = 'UNARY',
  /** Binary `+` or `-`. */
  BINARY = 'BINARY',
  /** A string literal. Only valid as a `.DB` item - never an instruction operand. */
  STRING = 'STRING',
}

/** The two operators the expression grammar has. */
export type AdditiveOperator = '+' | '-';

export interface NumberExpression {
  readonly kind: ExpressionKind.NUMBER;
  readonly value: number;
  readonly position: SourcePosition;
}

export interface SymbolExpression {
  readonly kind: ExpressionKind.SYMBOL;
  /** The name exactly as written - symbol names are case-sensitive. */
  readonly name: string;
  readonly position: SourcePosition;
}

export interface UnaryExpression {
  readonly kind: ExpressionKind.UNARY;
  readonly operator: AdditiveOperator;
  readonly operand: Expression;
  readonly position: SourcePosition;
}

export interface BinaryExpression {
  readonly kind: ExpressionKind.BINARY;
  readonly operator: AdditiveOperator;
  readonly left: Expression;
  readonly right: Expression;
  readonly position: SourcePosition;
}

/** Anything that evaluates to a number once symbols are known. */
export type Expression =
  | NumberExpression
  | SymbolExpression
  | UnaryExpression
  | BinaryExpression;

export interface StringExpression {
  readonly kind: ExpressionKind.STRING;
  /** The decoded contents, escapes already resolved by the lexer. */
  readonly value: string;
  readonly position: SourcePosition;
}

/** One item of a data directive: a value, or text expanding to one word each. */
export type DataItem = Expression | StringExpression;

/** True when a data item is text rather than a value. */
export function isStringExpression(item: DataItem): item is StringExpression {
  return item.kind === ExpressionKind.STRING;
}

/** The three shapes a statement can take. */
export enum StatementKind {
  LABEL = 'LABEL',
  INSTRUCTION = 'INSTRUCTION',
  DIRECTIVE = 'DIRECTIVE',
}

/**
 * A name bound to the address of the next word emitted.
 *
 * Emitted separately from the statement it precedes, including when the two
 * share a line.
 */
export interface LabelStatement {
  readonly kind: StatementKind.LABEL;
  readonly name: string;
  readonly position: SourcePosition;
}

/** One instruction, already matched against the instruction table. */
export interface InstructionStatement {
  readonly kind: StatementKind.INSTRUCTION;
  /** The canonical upper-case mnemonic, whatever spelling the source used. */
  readonly mnemonic: string;
  /**
   * The row of `ISA` this mnemonic resolves to.
   *
   * Carried so the assembler encodes from the same table the parser matched
   * against, with no second lookup and no chance of a divergent one.
   */
  readonly entry: IsaEntry;
  /** Zero or one operand - see `operandArity`. */
  readonly operands: readonly Expression[];
  /** Position of the mnemonic. */
  readonly position: SourcePosition;
}

/** The directives the assembler understands. Values are the source spelling. */
export enum DirectiveKind {
  ORG = '.ORG',
  CHAPTER = '.CHAPTER',
  PAGE = '.PAGE',
  EQU = '.EQU',
  DB = '.DB',
  DW = '.DW',
  OPLA = '.OPLA',
  RES = '.RES',
  INCLUDE = '.INCLUDE',
  END = '.END',
}

interface DirectiveBase {
  readonly kind: StatementKind.DIRECTIVE;
  readonly position: SourcePosition;
}

/** `.ORG addr` - set the address the next word is emitted at. */
export interface OrgDirective extends DirectiveBase {
  readonly directive: DirectiveKind.ORG;
  readonly address: Expression;
}

/** `.CHAPTER n` - select a chapter, positioned at its page 0. */
export interface ChapterDirective extends DirectiveBase {
  readonly directive: DirectiveKind.CHAPTER;
  readonly chapter: Expression;
}

/** `.PAGE [n]` - start page n of the current chapter, or the next free page. */
export interface PageDirective extends DirectiveBase {
  readonly directive: DirectiveKind.PAGE;
  readonly page?: Expression;
}

/** `.EQU NAME, value` - bind a name to a constant. */
export interface EquDirective extends DirectiveBase {
  readonly directive: DirectiveKind.EQU;
  readonly name: string;
  /** Position of the name itself, for a redefinition diagnostic. */
  readonly namePosition: SourcePosition;
  readonly value: Expression;
}

/** `.DB`/`.DW` - a run of data words. `.DB` is one word per item, `.DW` two. */
export interface DataDirective extends DirectiveBase {
  readonly directive: DirectiveKind.DB | DirectiveKind.DW;
  readonly items: readonly DataItem[];
}

/** `.OPLA index, mask` - one slot of the O output PLA. */
export interface OplaDirective extends DirectiveBase {
  readonly directive: DirectiveKind.OPLA;
  readonly index: Expression;
  readonly mask: Expression;
}

/** `.RES n` - reserve n words without emitting a value for them. */
export interface ReserveDirective extends DirectiveBase {
  readonly directive: DirectiveKind.RES;
  readonly count: Expression;
}

/** `.INCLUDE "path"` - splice another source file in at this point. */
export interface IncludeDirective extends DirectiveBase {
  readonly directive: DirectiveKind.INCLUDE;
  readonly path: string;
  /** Position of the path string, so a missing file can be pointed at. */
  readonly pathPosition: SourcePosition;
}

/** `.END` - stop assembling this file. */
export interface EndDirective extends DirectiveBase {
  readonly directive: DirectiveKind.END;
}

/** One directive, discriminated by `directive` so its arguments are typed. */
export type DirectiveStatement =
  | OrgDirective
  | ChapterDirective
  | PageDirective
  | EquDirective
  | DataDirective
  | OplaDirective
  | ReserveDirective
  | IncludeDirective
  | EndDirective;

/** One parsed statement. */
export type Statement = LabelStatement | InstructionStatement | DirectiveStatement;

/** A parsed source file. */
export interface Program {
  /** The file name diagnostics quote. */
  readonly file: string;
  readonly statements: readonly Statement[];
}

/** Directive spellings, for the "did you mean" hint on a typo. */
const DIRECTIVE_SPELLINGS: readonly string[] = Object.freeze(Object.values(DirectiveKind));

/**
 * Levenshtein distance, capped: anything past `limit` is reported as `limit + 1`.
 *
 * Only used to suggest a correction for a misspelled mnemonic, over a table of
 * short names.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) {
    return limit + 1;
  }
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}

/** The closest name in `candidates`, if one is close enough to be worth naming. */
function nearestName(name: string, candidates: readonly string[]): string | undefined {
  const limit = name.length <= 3 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate, limit);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

/** ` (did you mean 'TCY'?)`, or nothing when no candidate is close. */
function suggestion(name: string, candidates: readonly string[]): string {
  const nearest = nearestName(name, candidates);
  return nearest === undefined ? '' : ` (did you mean '${nearest}'?)`;
}

/**
 * Parse assembly source.
 *
 * @throws AsmError on the first shape the grammar or the instruction table
 *   rejects. The message carries file, line and column.
 */
export function parse(source: string, file: string = DEFAULT_SOURCE_NAME): Program {
  return parseTokens(tokenize(source, file), file);
}

/**
 * Parse an already-scanned token stream.
 *
 * Separate from `parse` so a caller that has tokens in hand - a listing writer,
 * a test - does not have to re-scan to get them.
 *
 * @throws AsmError as `parse` does.
 */
export function parseTokens(
  tokens: readonly Token[],
  file: string = DEFAULT_SOURCE_NAME,
): Program {
  const statements: Statement[] = [];
  let index = 0;

  const lastToken = (): Token => {
    const final = tokens.at(-1);
    if (!final) {
      throw new AsmError('empty token stream - the lexer always emits EOF', {
        file,
        line: 1,
        column: 1,
        offset: 0,
      });
    }
    return final;
  };

  const peek = (): Token => tokens[index] ?? lastToken();

  const next = (): Token => {
    const token = peek();
    if (token.kind !== TokenKind.EOF) {
      index += 1;
    }
    return token;
  };

  const at = (kind: TokenKind): boolean => peek().kind === kind;

  const expect = (kind: TokenKind, what: string): Token => {
    const token = peek();
    if (token.kind !== kind) {
      throw new AsmError(`expected ${what}, got ${describeToken(token)}`, token.position);
    }
    return next();
  };

  const atStatementEnd = (): boolean => at(TokenKind.NEWLINE) || at(TokenKind.EOF);

  const endStatement = (): void => {
    if (atStatementEnd()) {
      if (at(TokenKind.NEWLINE)) {
        next();
      }
      return;
    }
    const token = peek();
    throw new AsmError(`expected end of line, got ${describeToken(token)}`, token.position);
  };

  const parseExpression = (): Expression => {
    let left = parseTerm();
    while (at(TokenKind.PLUS) || at(TokenKind.MINUS)) {
      const operatorToken = next();
      const operator: AdditiveOperator = operatorToken.kind === TokenKind.PLUS ? '+' : '-';
      const right = parseTerm();
      left = Object.freeze({
        kind: ExpressionKind.BINARY,
        operator,
        left,
        right,
        position: left.position,
      } satisfies BinaryExpression);
    }
    return left;
  };

  function parseTerm(): Expression {
    const token = peek();
    switch (token.kind) {
      case TokenKind.NUMBER:
        next();
        return Object.freeze({
          kind: ExpressionKind.NUMBER,
          value: token.numericValue ?? 0,
          position: token.position,
        } satisfies NumberExpression);
      case TokenKind.IDENTIFIER:
        next();
        return Object.freeze({
          kind: ExpressionKind.SYMBOL,
          name: token.value,
          position: token.position,
        } satisfies SymbolExpression);
      case TokenKind.PLUS:
      case TokenKind.MINUS: {
        next();
        const operator: AdditiveOperator = token.kind === TokenKind.PLUS ? '+' : '-';
        return Object.freeze({
          kind: ExpressionKind.UNARY,
          operator,
          operand: parseTerm(),
          position: token.position,
        } satisfies UnaryExpression);
      }
      case TokenKind.LPAREN: {
        next();
        const inner = parseExpression();
        expect(TokenKind.RPAREN, "')'");
        return inner;
      }
      case TokenKind.STRING:
        throw new AsmError('a string literal is only valid as a .DB item', token.position);
      default:
        throw new AsmError(`expected a value, got ${describeToken(token)}`, token.position);
    }
  }

  const parseDataItem = (allowStrings: boolean, directive: string): DataItem => {
    const token = peek();
    if (token.kind === TokenKind.STRING) {
      if (!allowStrings) {
        throw new AsmError(
          `${directive} takes values, not text - use .DB for strings`,
          token.position,
        );
      }
      next();
      return Object.freeze({
        kind: ExpressionKind.STRING,
        value: token.value,
        position: token.position,
      } satisfies StringExpression);
    }
    return parseExpression();
  };

  /** `item (',' item)*`, one or more. */
  const parseDataItems = (allowStrings: boolean, directive: string): DataItem[] => {
    const items: DataItem[] = [parseDataItem(allowStrings, directive)];
    while (at(TokenKind.COMMA)) {
      next();
      items.push(parseDataItem(allowStrings, directive));
    }
    return items;
  };

  const parseDirective = (): DirectiveStatement => {
    const token = next();
    const position = token.position;
    switch (token.value) {
      case DirectiveKind.ORG:
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.ORG,
          address: parseExpression(),
          position,
        } satisfies OrgDirective);

      case DirectiveKind.CHAPTER:
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.CHAPTER,
          chapter: parseExpression(),
          position,
        } satisfies ChapterDirective);

      case DirectiveKind.PAGE: {
        const page = atStatementEnd() ? undefined : parseExpression();
        return Object.freeze(
          page === undefined
            ? ({
                kind: StatementKind.DIRECTIVE,
                directive: DirectiveKind.PAGE,
                position,
              } satisfies PageDirective)
            : ({
                kind: StatementKind.DIRECTIVE,
                directive: DirectiveKind.PAGE,
                page,
                position,
              } satisfies PageDirective),
        );
      }

      case DirectiveKind.EQU: {
        const name = expect(TokenKind.IDENTIFIER, 'a symbol name after .EQU');
        expect(TokenKind.COMMA, "',' after the .EQU symbol name");
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.EQU,
          name: name.value,
          namePosition: name.position,
          value: parseExpression(),
          position,
        } satisfies EquDirective);
      }

      case DirectiveKind.DB:
      case DirectiveKind.DW: {
        const directive = token.value === DirectiveKind.DB ? DirectiveKind.DB : DirectiveKind.DW;
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive,
          items: Object.freeze(parseDataItems(directive === DirectiveKind.DB, directive)),
          position,
        } satisfies DataDirective);
      }

      case DirectiveKind.OPLA: {
        const slot = parseExpression();
        expect(TokenKind.COMMA, "',' between the .OPLA slot index and its plate mask");
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.OPLA,
          index: slot,
          mask: parseExpression(),
          position,
        } satisfies OplaDirective);
      }

      case DirectiveKind.RES:
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.RES,
          count: parseExpression(),
          position,
        } satisfies ReserveDirective);

      case DirectiveKind.INCLUDE: {
        const path = expect(TokenKind.STRING, 'a quoted file path after .INCLUDE');
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.INCLUDE,
          path: path.value,
          pathPosition: path.position,
          position,
        } satisfies IncludeDirective);
      }

      case DirectiveKind.END:
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.END,
          position,
        } satisfies EndDirective);

      default:
        throw new AsmError(
          `unknown directive '${token.text}'${suggestion(token.value, DIRECTIVE_SPELLINGS)}`,
          position,
        );
    }
  };

  const parseInstruction = (): InstructionStatement => {
    const token = next();
    const mnemonic = token.value.toUpperCase();
    const entry = isaEntryForMnemonic(mnemonic);
    if (!entry) {
      // A directive typed without its dot reads as a mnemonic here, and the
      // author's mistake is one character, so say so rather than listing every
      // mnemonic they did not mean.
      const asDirective = `.${mnemonic}`;
      if (DIRECTIVE_SPELLINGS.includes(asDirective)) {
        throw new AsmError(
          `unknown mnemonic '${token.text}' - directives start with a dot, as '${asDirective}'`,
          token.position,
        );
      }
      throw new AsmError(
        `unknown mnemonic '${token.text}'${suggestion(mnemonic, MNEMONICS)}`,
        token.position,
      );
    }

    const operands: Expression[] = [];
    if (!atStatementEnd()) {
      operands.push(parseExpression());
      while (at(TokenKind.COMMA)) {
        next();
        operands.push(parseExpression());
      }
    }

    const arity = operandArity(entry);
    if (operands.length !== arity) {
      const expected = arity === 0 ? 'no operand' : 'one operand';
      throw new AsmError(
        `${entry.mnemonic} takes ${expected}, got ${operands.length}`,
        token.position,
      );
    }

    return Object.freeze({
      kind: StatementKind.INSTRUCTION,
      mnemonic: entry.mnemonic,
      entry,
      operands: Object.freeze(operands),
      position: token.position,
    } satisfies InstructionStatement);
  };

  while (!at(TokenKind.EOF)) {
    if (at(TokenKind.NEWLINE)) {
      next();
      continue;
    }

    while (at(TokenKind.LABEL)) {
      const token = next();
      statements.push(
        Object.freeze({
          kind: StatementKind.LABEL,
          name: token.value,
          position: token.position,
        } satisfies LabelStatement),
      );
    }

    if (atStatementEnd()) {
      endStatement();
      continue;
    }

    if (at(TokenKind.DIRECTIVE)) {
      statements.push(parseDirective());
    } else if (at(TokenKind.IDENTIFIER)) {
      statements.push(parseInstruction());
    } else {
      const token = peek();
      throw new AsmError(
        `expected a label, a mnemonic or a directive, got ${describeToken(token)}`,
        token.position,
      );
    }

    endStatement();
  }

  return Object.freeze({ file, statements: Object.freeze(statements) });
}

/** Re-exported so the assembler can type a statement without importing isa.ts too. */
export type { IsaEntry } from './isa.js';
