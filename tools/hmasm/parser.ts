// HMCS40 assembler (PRD R2), stage two: tokens -> a typed statement list.
//
// The parser's contract with the rest of the tool chain is that the assembler
// never looks at source text again. Every statement it needs is here, already
// matched against the architecture, already carrying the position it came from.
//
// ## One instruction table, not two
//
// Mnemonics are resolved against `ISA` in src/machine/cpu/isa.ts - the same
// array the decoder derives its opcode map from. Nothing in this file spells out
// a mnemonic, an opcode, an operand width or an arity; all of it is read off the
// `IsaEntry`, and the entry itself is carried on the parsed statement so the
// assembler encodes straight from it. An assembler with its own opcode table
// would drift from the CPU, and the failure mode is a ROM that assembles cleanly
// and then behaves inexplicably at run time (isa.ts, header).
//
// Operand arity follows from the table rather than from a list kept here: an
// instruction takes one operand when its `operandKind` is anything but `NONE`,
// and none when it is `NONE`. That covers the whole architecture - the widest
// operand field is four bits and no instruction has two.
//
// ## Statement grammar
//
//     line      := label* (instruction | directive)? comment? EOL
//     label     := identifier ':'
//     instr     := mnemonic (expression (',' expression)*)?
//     directive := '.' name arguments
//     expression:= term (('+' | '-') term)*
//     term      := number | symbol | ('-' | '+') term | '(' expression ')'
//
// A label is emitted as its own statement even when it shares a line with an
// instruction, so `loop: LAI 3` yields two statements. Address assignment in the
// assembler then has one rule with no special cases: a label takes the address
// of the next word emitted after it.
//
// Expressions are additive only - `start + 2`, `-1`, `(base + offset) - 1`. The
// operand fields on this machine are four and five bits wide; a ROM that needs
// multiplication in an operand is doing something the assembler should not be
// hiding.
//
// ## Directives
//
// | directive             | argument shape        | what the assembler does with it     |
// |-----------------------|-----------------------|-------------------------------------|
// | `.ORG addr`           | one expression        | set the emit address                |
// | `.EQU NAME, value`    | name, then expression | define a constant symbol            |
// | `.DB item, ...`       | expressions, strings  | one word per item, 8-bit values     |
// | `.DW item, ...`       | expressions           | one word per item, full 10-bit words|
// | `.INCLUDE "path"`     | one string            | splice another source file          |
// | `.PAGE [n]`           | optional expression   | start page n, or the next page      |
// | `.ALIGN n`            | one expression        | pad to the next multiple of n       |
// | `.RES n`              | one expression        | reserve n words                     |
// | `.PATTERN [t]`        | optional expression   | assemble into the pattern region    |
// | `.END`                | none                  | stop assembling this file           |
//
// `.PAGE`, `.ALIGN` and `.PATTERN` are the banking and paging directives the
// architecture forces on the source. BR and CAL carry a five-bit in-page offset
// against 32-word pages (memory.ts), so a routine that must be branch-reachable
// has to start where the author says it starts, not wherever the previous
// routine happened to end. `.PATTERN` names the 128-word region above the
// program space that the `P` instruction reads its tables from, in units of the
// eight 16-entry tables `P` can select.
//
// `.EQU` puts the name inside the directive - `.EQU SPEED, 3` - rather than in
// front of it. The label-per-statement rule above means a leading `NAME` would
// be indistinguishable from a code label at parse time, and a constant that
// silently became an address would be a nasty bug to chase.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { ISA, OperandKind, type IsaEntry } from '../../src/machine/cpu/isa.js';
import type { InstructionType } from '../../src/machine/cpu/instruction.js';
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

/** Every instruction, by upper-cased mnemonic. Built from `ISA`, never beside it. */
const ENTRY_BY_MNEMONIC: ReadonlyMap<string, IsaEntry> = new Map(
  ISA.map((entry) => [entry.mnemonic.toUpperCase(), entry]),
);

/** Every mnemonic the assembler accepts, in alphabetical order. */
export const MNEMONICS: readonly string[] = Object.freeze(
  ISA.map((entry) => entry.mnemonic).sort(),
);

/**
 * How many operands an instruction is written with.
 *
 * Derived from the shared table, not listed here: the operand-less instructions
 * are exactly those whose `operandKind` is `NONE`, and every other instruction
 * carries a single field. `JMPL`/`CALL` are two ROM words but one written
 * operand - the assembler splits the target across the words.
 */
export function operandArity(entry: IsaEntry): number {
  return entry.operandKind === OperandKind.NONE ? 0 : 1;
}

/** The entry for a mnemonic, case-insensitively, or undefined if there is none. */
export function isaEntryForMnemonic(mnemonic: string): IsaEntry | undefined {
  return ENTRY_BY_MNEMONIC.get(mnemonic.toUpperCase());
}

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

/** One instruction, already matched against the shared instruction table. */
export interface InstructionStatement {
  readonly kind: StatementKind.INSTRUCTION;
  /** The canonical upper-case mnemonic, whatever case the source used. */
  readonly mnemonic: string;
  /** Which instruction it is, for the CPU-side enum. */
  readonly type: InstructionType;
  /**
   * The row of `ISA` this mnemonic resolves to.
   *
   * Carried so the assembler encodes from the same table the decoder decodes
   * from, with no second lookup and no chance of a divergent one.
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
  EQU = '.EQU',
  DB = '.DB',
  DW = '.DW',
  INCLUDE = '.INCLUDE',
  PAGE = '.PAGE',
  ALIGN = '.ALIGN',
  RES = '.RES',
  PATTERN = '.PATTERN',
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

/** `.EQU NAME, value` - bind a name to a constant. */
export interface EquDirective extends DirectiveBase {
  readonly directive: DirectiveKind.EQU;
  readonly name: string;
  /** Position of the name itself, for a redefinition diagnostic. */
  readonly namePosition: SourcePosition;
  readonly value: Expression;
}

/** `.DB`/`.DW` - a run of data words. `.DB` items are 8-bit; `.DW` items 10-bit. */
export interface DataDirective extends DirectiveBase {
  readonly directive: DirectiveKind.DB | DirectiveKind.DW;
  readonly items: readonly DataItem[];
}

/** `.INCLUDE "path"` - splice another source file in at this point. */
export interface IncludeDirective extends DirectiveBase {
  readonly directive: DirectiveKind.INCLUDE;
  readonly path: string;
  /** Position of the path string, so a missing file can be pointed at. */
  readonly pathPosition: SourcePosition;
}

/** `.PAGE [n]` - start ROM page n, or the next page when the operand is absent. */
export interface PageDirective extends DirectiveBase {
  readonly directive: DirectiveKind.PAGE;
  readonly page?: Expression;
}

/** `.ALIGN n` - pad forward to the next multiple of n words. */
export interface AlignDirective extends DirectiveBase {
  readonly directive: DirectiveKind.ALIGN;
  readonly boundary: Expression;
}

/** `.RES n` - reserve n words without emitting a value for them. */
export interface ReserveDirective extends DirectiveBase {
  readonly directive: DirectiveKind.RES;
  readonly count: Expression;
}

/** `.PATTERN [t]` - assemble into pattern table t of the pattern region. */
export interface PatternDirective extends DirectiveBase {
  readonly directive: DirectiveKind.PATTERN;
  readonly table?: Expression;
}

/** `.END` - stop assembling this file. */
export interface EndDirective extends DirectiveBase {
  readonly directive: DirectiveKind.END;
}

/** One directive, discriminated by `directive` so its arguments are typed. */
export type DirectiveStatement =
  | OrgDirective
  | EquDirective
  | DataDirective
  | IncludeDirective
  | PageDirective
  | AlignDirective
  | ReserveDirective
  | PatternDirective
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
 * Only used to suggest a correction for a misspelled mnemonic, over a fixed
 * 91-entry table of names no longer than five characters.
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

/** ` (did you mean 'LAI'?)`, or nothing when no candidate is close. */
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

  const peek = (): Token => tokens[index] ?? lastToken();
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
      const operator: AdditiveOperator =
        operatorToken.kind === TokenKind.PLUS ? '+' : '-';
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
        throw new AsmError(
          'a string literal is only valid as a .DB item',
          token.position,
        );
      default:
        throw new AsmError(
          `expected a value, got ${describeToken(token)}`,
          token.position,
        );
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

      case DirectiveKind.ALIGN:
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.ALIGN,
          boundary: parseExpression(),
          position,
        } satisfies AlignDirective);

      case DirectiveKind.RES:
        return Object.freeze({
          kind: StatementKind.DIRECTIVE,
          directive: DirectiveKind.RES,
          count: parseExpression(),
          position,
        } satisfies ReserveDirective);

      case DirectiveKind.PATTERN: {
        const table = atStatementEnd() ? undefined : parseExpression();
        return Object.freeze(
          table === undefined
            ? ({
                kind: StatementKind.DIRECTIVE,
                directive: DirectiveKind.PATTERN,
                position,
              } satisfies PatternDirective)
            : ({
                kind: StatementKind.DIRECTIVE,
                directive: DirectiveKind.PATTERN,
                table,
                position,
              } satisfies PatternDirective),
        );
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
    const entry = ENTRY_BY_MNEMONIC.get(mnemonic);
    if (!entry) {
      // A directive typed without its dot reads as a mnemonic here, and the
      // author's mistake is one character, so say so rather than listing 91
      // mnemonics they did not mean.
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
      const expected =
        arity === 0 ? 'no operand' : `${arity} operand${arity === 1 ? '' : 's'}`;
      throw new AsmError(
        `${entry.mnemonic} takes ${expected}, got ${operands.length}`,
        token.position,
      );
    }

    return Object.freeze({
      kind: StatementKind.INSTRUCTION,
      mnemonic: entry.mnemonic,
      type: entry.type,
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
