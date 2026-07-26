// HMCS40 assembler (PRD R2), stage three: statements -> ROM words.
//
// ## One instruction table, not two
//
// Every word this module emits comes out of `encodeInstruction` /
// `encodeLongInstruction` in src/machine/cpu/isa.ts - the same table decoder.ts
// derives its opcode map from. No opcode, mask or operand width is spelled out
// here, and no operand limit is re-derived: the range an operand must fall in is
// `entry.operandLimit`, read off the row the parser already attached to the
// statement. An assembler with an opcode table of its own would drift from the
// CPU silently, and the symptom - a ROM that assembles cleanly and then
// misbehaves - surfaces far from the cause (isa.ts, header).
//
// ## Two passes, and what each one may look at
//
// Pass one walks the statements for layout only: it advances the emit address,
// binds every label to the address of the next word after it, and evaluates
// `.EQU`. Pass two walks the same statements again and emits, with the whole
// symbol table in hand.
//
// The split gives forward references exactly where they are needed and nowhere
// else. An instruction operand or a data item may name a label defined further
// down - that is the point of two passes. The *layout* directives (`.ORG`,
// `.PAGE`, `.ALIGN`, `.RES`, `.PATTERN`) and `.EQU` may not: their arguments
// decide where the following labels land, so they are evaluated as pass one
// reaches them and can only use symbols already defined above. A label whose
// address depended on a symbol defined below it would not have a fixed value at
// all, so this is a real restriction of the problem, not a shortcut.
//
// ## The two hardware ceilings, enforced as errors
//
// The HD38800 has 2048 ten-bit program words and 160 RAM nibbles (memory.ts).
// Neither is a soft target. A ROM that runs off the end of the program region
// does not wrap into something harmless: the 128 words above it are the pattern
// region, which the `P` instruction reads as data. So a word landing at 2048
// without an explicit `.PATTERN` is an error here, at build time, and so is a
// program that can be shown to address a RAM file the device does not have.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import {
  encodeInstruction,
  encodeLongInstruction,
  OperandKind,
  PATTERN_TABLE_COUNT,
  type IsaEntry,
} from '../../src/machine/cpu/isa.js';
import { InstructionType } from '../../src/machine/cpu/instruction.js';
import {
  RAM_FILE_SIZE,
  RAM_SIZE,
  ROM_PAGE_COUNT,
  ROM_PAGE_SIZE,
  ROM_PATTERN_SIZE,
  ROM_PROGRAM_SIZE,
  ROM_SIZE,
  romOffset,
  romPage,
  WORD_MASK,
} from '../../src/machine/cpu/memory.js';
import {
  AsmError,
  DEFAULT_SOURCE_NAME,
  DirectiveKind,
  ExpressionKind,
  isStringExpression,
  parse,
  StatementKind,
  type DataItem,
  type Expression,
  type SourcePosition,
  type Statement,
} from './parser.js';

export { AsmError, DEFAULT_SOURCE_NAME } from './parser.js';

/** Largest value a `.DB` item may take - the directive emits byte-sized data. */
export const BYTE_MAX = 0xff;

/**
 * Prefix marking an `.EQU` constant as naming a RAM nibble.
 *
 * The assembler cannot otherwise tell `RAM_SCORE` (a RAM address) from
 * `SPEED` (a loop count): both are constants, and the instruction that
 * eventually loads one into X or Y looks the same either way. Rather than guess,
 * the tool reads one convention - see `ramHighWater` for exactly what it is used
 * for and what it does not claim.
 */
export const RAM_SYMBOL_PREFIX = 'RAM_';

/** How a symbol got its value. */
export enum SymbolKind {
  /** `name:` - bound to the address of the next word emitted after it. */
  LABEL = 'LABEL',
  /** `.EQU NAME, value` - bound to a constant. */
  CONSTANT = 'CONSTANT',
}

/** One entry of the symbol table. */
export interface SymbolDefinition {
  /** The name exactly as written - symbol names are case-sensitive. */
  readonly name: string;
  readonly value: number;
  readonly kind: SymbolKind;
  /** Where it was defined, so a redefinition can name both places. */
  readonly position: SourcePosition;
}

/** One assembled ROM word and where it came from. */
export interface AssembledWord {
  /** Linear ROM address: 0..2047 program, 2048..2175 pattern region. */
  readonly address: number;
  /** The ten-bit word itself. */
  readonly word: number;
  /** Position of the statement that produced it. */
  readonly position: SourcePosition;
  /** The source line it came from, verbatim - the listing's third column. */
  readonly sourceLine: string;
  /**
   * False for the first word a statement emits, true for every word after it.
   *
   * A two-word `CALL` and a five-item `.DW` each occupy one source line, so the
   * listing prints the line once and leaves the continuation rows blank.
   */
  readonly continuation: boolean;
}

/** Everything an assembly produced. */
export interface AssemblyResult {
  /** Name of the top-level source file, as diagnostics quote it. */
  readonly file: string;
  /** Every emitted word, in address order. */
  readonly words: readonly AssembledWord[];
  /** Every label and constant, in definition order. */
  readonly symbols: readonly SymbolDefinition[];
  /** Highest address any word landed at, or -1 when nothing was emitted. */
  readonly highestAddress: number;
  /**
   * RAM nibbles the assembled program can be *statically shown* to address.
   *
   * This is a count derived from operands in the source, not a measurement of a
   * run. Nothing here executes the program; the number is the largest of:
   *
   * - `(i + 1) * 16` for each `LXI i` in the assembled program. X selects one of
   *   the ten 16-nibble RAM files (memory.ts), so naming file `i` puts every
   *   nibble up to `(i << 4) | 15` in reach.
   * - `value + 1` for each `.EQU` constant whose name starts with `RAM_`.
   *
   * It is therefore a *lower bound* on what the program touches, and an exact
   * figure only for a ROM that selects its RAM files with literal `LXI`. A file
   * chosen at run time - `LXA` with a computed accumulator, or `XSP` swapping in
   * a pointer built elsewhere - is invisible to it, by construction: deciding
   * what those reach means running the program, which is the emulator's job and
   * not the assembler's.
   *
   * Its purpose is the build-time ceiling check: the device has 160 nibbles, and
   * a static count above that is a bug the author can see and fix here rather
   * than debug in the emulator later.
   */
  readonly ramHighWater: number;
}

/** A source file an `.INCLUDE` resolved to. */
export interface IncludedSource {
  /** The name diagnostics from inside this file will quote. */
  readonly file: string;
  readonly source: string;
}

/** Knobs the pure assembler needs from its host. */
export interface AssembleOptions {
  /**
   * Resolve and read an `.INCLUDE`.
   *
   * Supplied by the CLI, which owns the file system; the assembler itself stays
   * pure. Without it, `.INCLUDE` is a diagnostic rather than a silent skip.
   * Throwing from here is fine - the message is re-pointed at the `.INCLUDE`.
   */
  readonly readInclude?: (path: string, fromFile: string) => IncludedSource;
}

/** `$07F` - the hexadecimal spelling diagnostics and listings both use. */
export function formatAddress(address: number): string {
  return `$${address.toString(16).toUpperCase().padStart(3, '0')}`;
}

/** `$1A3` - a ten-bit ROM word, in the same three-digit form as an address. */
export function formatWord(word: number): string {
  return formatAddress(word);
}

/** What an operand of each kind is called in a diagnostic. */
const OPERAND_DESCRIPTION: Readonly<Record<OperandKind, string>> = Object.freeze({
  [OperandKind.NONE]: 'operand',
  [OperandKind.IMMEDIATE]: 'immediate',
  [OperandKind.D_PIN]: 'D-port pin',
  [OperandKind.R_PORT]: 'R port',
  [OperandKind.RAM_BIT]: 'RAM bit',
  [OperandKind.PATTERN_TABLE]: 'pattern table',
  [OperandKind.PAGE_OFFSET]: 'branch target',
  [OperandKind.LONG_HIGH]: 'target address',
});

/** Split source into lines once, so the listing can quote any of them. */
function splitLines(source: string): readonly string[] {
  return source.split(/\r\n|\r|\n/);
}

/**
 * Assemble one source file.
 *
 * @param source the program text.
 * @param file the name diagnostics quote.
 * @param options host services - currently only `.INCLUDE` resolution.
 * @throws AsmError on the first thing the architecture or the source rejects.
 *   Every message carries file, line and column: this tool's whole job is to be
 *   readable at two thousand words of hand-written assembly.
 */
export function assemble(
  source: string,
  file: string = DEFAULT_SOURCE_NAME,
  options: AssembleOptions = {},
): AssemblyResult {
  /** Every file seen, so the listing can quote a line from an include too. */
  const linesByFile = new Map<string, readonly string[]>();

  const sourceLineAt = (position: SourcePosition): string =>
    linesByFile.get(position.file)?.[position.line - 1] ?? '';

  // --- Flatten includes ----------------------------------------------------

  const load = (text: string, name: string, stack: readonly string[]): Statement[] => {
    linesByFile.set(name, splitLines(text));
    const statements: Statement[] = [];
    for (const statement of parse(text, name).statements) {
      if (statement.kind !== StatementKind.DIRECTIVE) {
        statements.push(statement);
        continue;
      }
      // `.END` stops assembling *this* file, so an include ends at its own
      // `.END` and the file that included it carries on.
      if (statement.directive === DirectiveKind.END) {
        break;
      }
      if (statement.directive !== DirectiveKind.INCLUDE) {
        statements.push(statement);
        continue;
      }
      if (!options.readInclude) {
        throw new AsmError(
          `.INCLUDE "${statement.path}" cannot be resolved - this assembler was ` +
            'called without a file reader',
          statement.pathPosition,
        );
      }
      let included: IncludedSource;
      try {
        included = options.readInclude(statement.path, name);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new AsmError(`cannot read .INCLUDE "${statement.path}": ${reason}`, statement.pathPosition);
      }
      if (stack.includes(included.file)) {
        throw new AsmError(
          `.INCLUDE cycle: ${[...stack, included.file].join(' -> ')}`,
          statement.pathPosition,
        );
      }
      statements.push(...load(included.source, included.file, [...stack, included.file]));
    }
    return statements;
  };

  const statements = load(source, file, [file]);

  // --- Symbols -------------------------------------------------------------

  const symbols = new Map<string, SymbolDefinition>();
  const symbolOrder: SymbolDefinition[] = [];

  const define = (definition: SymbolDefinition): void => {
    const existing = symbols.get(definition.name);
    if (existing) {
      throw new AsmError(
        `'${definition.name}' is already defined at ` +
          `${existing.position.file}:${existing.position.line}:${existing.position.column}`,
        definition.position,
      );
    }
    symbols.set(definition.name, definition);
    symbolOrder.push(definition);
  };

  const lookup = (name: string, position: SourcePosition, layout: boolean): number => {
    const found = symbols.get(name);
    if (found) {
      return found.value;
    }
    if (layout) {
      // Distinguish "no such symbol" from "defined, but below here": the second
      // is the one an author hits by accident, and the fix is different.
      throw new AsmError(
        `unknown symbol '${name}' - layout directives and .EQU are resolved as the ` +
          'assembler reaches them, so they can only use symbols defined above',
        position,
      );
    }
    throw new AsmError(`unknown symbol '${name}'`, position);
  };

  const evaluate = (expression: Expression, layout: boolean): number => {
    switch (expression.kind) {
      case ExpressionKind.NUMBER:
        return expression.value;
      case ExpressionKind.SYMBOL:
        return lookup(expression.name, expression.position, layout);
      case ExpressionKind.UNARY:
        return expression.operator === '-'
          ? -evaluate(expression.operand, layout)
          : evaluate(expression.operand, layout);
      case ExpressionKind.BINARY:
        return expression.operator === '+'
          ? evaluate(expression.left, layout) + evaluate(expression.right, layout)
          : evaluate(expression.left, layout) - evaluate(expression.right, layout);
    }
  };

  /** Evaluate and insist the result is a whole number in `0..limit - 1`. */
  const evaluateBounded = (
    expression: Expression,
    layout: boolean,
    limit: number,
    what: string,
  ): number => {
    const value = evaluate(expression, layout);
    if (!Number.isInteger(value) || value < 0 || value >= limit) {
      throw new AsmError(
        `${what} out of range: ${value} (expected 0..${limit - 1})`,
        expression.position,
      );
    }
    return value;
  };

  // --- RAM ceiling ---------------------------------------------------------

  let ramHighWater = 0;

  const noteRamUse = (nibbles: number, position: SourcePosition, what: string): void => {
    if (nibbles > RAM_SIZE) {
      throw new AsmError(
        `${what} reaches RAM nibble ${nibbles - 1}, past the ${RAM_SIZE} nibbles the ` +
          `device implements (${RAM_SIZE / RAM_FILE_SIZE} files of ${RAM_FILE_SIZE})`,
        position,
      );
    }
    ramHighWater = Math.max(ramHighWater, nibbles);
  };

  // --- Emission ------------------------------------------------------------

  const emitted = new Map<number, AssembledWord>();
  let address = 0;
  let inPattern = false;
  /** Set per statement so a multi-word statement quotes its line once. */
  let emittedThisStatement = false;

  const assertAddressInRegion = (candidate: number, position: SourcePosition): void => {
    if (candidate >= ROM_SIZE) {
      throw new AsmError(
        `ROM overflow: ${formatAddress(candidate)} is past the last ROM word ` +
          `${formatAddress(ROM_SIZE - 1)}`,
        position,
      );
    }
    if (!inPattern && candidate >= ROM_PROGRAM_SIZE) {
      throw new AsmError(
        `ROM overflow: the program region holds ${ROM_PROGRAM_SIZE} words ` +
          `(${formatAddress(0)}..${formatAddress(ROM_PROGRAM_SIZE - 1)}) and this word ` +
          `would land at ${formatAddress(candidate)}. The ${ROM_PATTERN_SIZE}-word ` +
          'pattern region above it is reached with .PATTERN, not by running off the end',
        position,
      );
    }
  };

  /** Move the emit address on without emitting - `.RES`, `.ALIGN` padding. */
  const skip = (count: number, position: SourcePosition): void => {
    if (count > 0) {
      assertAddressInRegion(address + count - 1, position);
    }
    address += count;
  };

  const emit = (word: number, position: SourcePosition): void => {
    assertAddressInRegion(address, position);
    const clash = emitted.get(address);
    if (clash) {
      throw new AsmError(
        `${formatAddress(address)} already holds a word emitted at ` +
          `${clash.position.file}:${clash.position.line}:${clash.position.column} - two ` +
          '.ORG regions overlap',
        position,
      );
    }
    emitted.set(
      address,
      Object.freeze({
        address,
        word,
        position,
        sourceLine: sourceLineAt(position),
        continuation: emittedThisStatement,
      }),
    );
    emittedThisStatement = true;
    address += 1;
  };

  // --- Operand encoding ----------------------------------------------------

  /**
   * The in-page offset a `BR`/`CAL` operand encodes.
   *
   * Both carry a five-bit offset and inherit a page: `BR` the page of its own
   * word, `CAL` page 0 always (isa.ts, cpu.ts). The source writes a *target
   * address* - a label - and the assembler does the arithmetic, because a raw
   * offset would be unreadable and would silently retarget itself the moment the
   * routine moved.
   */
  const pageOffsetFor = (entry: IsaEntry, target: number, position: SourcePosition): number => {
    if (!Number.isInteger(target) || target < 0 || target >= ROM_PROGRAM_SIZE) {
      throw new AsmError(
        `${entry.mnemonic} target out of the program region: ${target} ` +
          `(expected 0..${ROM_PROGRAM_SIZE - 1})`,
        position,
      );
    }
    if (entry.type === InstructionType.CAL) {
      if (romPage(target) !== 0) {
        throw new AsmError(
          `CAL reaches page 0 only: ${formatAddress(target)} is on page ${romPage(target)}. ` +
            'Use CALL for a subroutine outside page 0',
          position,
        );
      }
      return romOffset(target);
    }
    if (romPage(target) !== romPage(address)) {
      throw new AsmError(
        `BR reaches only its own page: the branch at ${formatAddress(address)} is on page ` +
          `${romPage(address)} and ${formatAddress(target)} is on page ${romPage(target)}. ` +
          'Use JMPL to leave the page',
        position,
      );
    }
    return romOffset(target);
  };

  const assembleInstruction = (
    entry: IsaEntry,
    operands: readonly Expression[],
    position: SourcePosition,
  ): void => {
    if (entry.words === 2) {
      // JMPL/CALL: one written operand, an 11-bit target split across the words.
      const operand = operands[0] as Expression;
      const target = evaluateBounded(
        operand,
        false,
        ROM_PROGRAM_SIZE,
        `${entry.mnemonic} ${OPERAND_DESCRIPTION[entry.operandKind]}`,
      );
      const [first, second] = encodeLongInstruction(entry.type, target);
      emit(first, position);
      emit(second, position);
      return;
    }

    if (entry.operandKind === OperandKind.NONE) {
      emit(encodeInstruction(entry.type), position);
      return;
    }

    const operand = operands[0] as Expression;
    let value: number;
    if (entry.operandKind === OperandKind.PAGE_OFFSET) {
      value = pageOffsetFor(entry, evaluate(operand, false), operand.position);
    } else {
      // The range comes off the ISA row, never from a limit spelled out here:
      // R ports, RAM bits and pattern tables each have their own, and they are
      // properties of the hardware the table already describes.
      value = evaluateBounded(
        operand,
        false,
        entry.operandLimit,
        `${entry.mnemonic} ${OPERAND_DESCRIPTION[entry.operandKind]}`,
      );
      if (entry.type === InstructionType.LXI) {
        noteRamUse((value + 1) * RAM_FILE_SIZE, position, `LXI ${value} selects RAM file ${value}, which`);
      }
    }
    emit(encodeInstruction(entry.type, value), position);
  };

  const assembleDataItem = (item: DataItem, limit: number, directive: string): void => {
    if (isStringExpression(item)) {
      for (const character of item.value) {
        const code = character.codePointAt(0) ?? 0;
        if (code > limit) {
          throw new AsmError(
            `${directive} cannot hold ${JSON.stringify(character)}: character code ${code} ` +
              `does not fit in 0..${limit}`,
            item.position,
          );
        }
        emit(code, item.position);
      }
      return;
    }
    emit(evaluateBounded(item, false, limit + 1, `${directive} value`), item.position);
  };

  /** The number of words a data directive occupies - pass one needs it too. */
  const dataWordCount = (items: readonly DataItem[]): number =>
    items.reduce((total, item) => total + (isStringExpression(item) ? [...item.value].length : 1), 0);

  // --- The two passes ------------------------------------------------------

  /**
   * Walk the statements once.
   *
   * `emitting` is false on pass one, which binds labels and constants and does
   * layout only, and true on pass two, which emits with every symbol known.
   * Layout arithmetic happens on both passes through this one body, so the two
   * cannot disagree about where anything lands.
   */
  const walk = (emitting: boolean): void => {
    address = 0;
    inPattern = false;

    for (const statement of statements) {
      emittedThisStatement = false;

      if (statement.kind === StatementKind.LABEL) {
        if (!emitting) {
          define({
            name: statement.name,
            value: address,
            kind: SymbolKind.LABEL,
            position: statement.position,
          });
        }
        continue;
      }

      if (statement.kind === StatementKind.INSTRUCTION) {
        if (emitting) {
          assembleInstruction(statement.entry, statement.operands, statement.position);
        } else {
          skip(statement.entry.words, statement.position);
        }
        continue;
      }

      switch (statement.directive) {
        case DirectiveKind.ORG: {
          address = evaluateBounded(statement.address, !emitting, ROM_SIZE, '.ORG address');
          inPattern = address >= ROM_PROGRAM_SIZE;
          break;
        }

        case DirectiveKind.EQU: {
          if (!emitting) {
            const value = evaluate(statement.value, true);
            define({
              name: statement.name,
              value,
              kind: SymbolKind.CONSTANT,
              position: statement.namePosition,
            });
            if (statement.name.toUpperCase().startsWith(RAM_SYMBOL_PREFIX)) {
              if (!Number.isInteger(value) || value < 0) {
                throw new AsmError(
                  `'${statement.name}' names a RAM nibble by the ${RAM_SYMBOL_PREFIX} ` +
                    `convention, so its value must be a RAM address, got ${value}`,
                  statement.namePosition,
                );
              }
              noteRamUse(value + 1, statement.namePosition, `'${statement.name}'`);
            }
          }
          break;
        }

        case DirectiveKind.DB:
        case DirectiveKind.DW: {
          const limit = statement.directive === DirectiveKind.DB ? BYTE_MAX : WORD_MASK;
          if (emitting) {
            for (const item of statement.items) {
              assembleDataItem(item, limit, statement.directive);
            }
          } else {
            skip(dataWordCount(statement.items), statement.position);
          }
          break;
        }

        case DirectiveKind.PAGE: {
          const page =
            statement.page === undefined
              ? Math.ceil(address / ROM_PAGE_SIZE)
              : evaluateBounded(statement.page, !emitting, ROM_PAGE_COUNT, '.PAGE number');
          if (page >= ROM_PAGE_COUNT) {
            throw new AsmError(
              `.PAGE ran past the last page: the program region has ${ROM_PAGE_COUNT} pages ` +
                `(0..${ROM_PAGE_COUNT - 1})`,
              statement.position,
            );
          }
          address = page * ROM_PAGE_SIZE;
          inPattern = false;
          break;
        }

        case DirectiveKind.ALIGN: {
          const boundary = evaluate(statement.boundary, !emitting);
          if (!Number.isInteger(boundary) || boundary < 1) {
            throw new AsmError(
              `.ALIGN boundary must be a positive whole number of words, got ${boundary}`,
              statement.boundary.position,
            );
          }
          const padded = Math.ceil(address / boundary) * boundary;
          skip(padded - address, statement.position);
          break;
        }

        case DirectiveKind.RES: {
          const count = evaluate(statement.count, !emitting);
          if (!Number.isInteger(count) || count < 0) {
            throw new AsmError(
              `.RES count must be a whole number of words, got ${count}`,
              statement.count.position,
            );
          }
          skip(count, statement.position);
          break;
        }

        case DirectiveKind.PATTERN: {
          const table =
            statement.table === undefined
              ? 0
              : evaluateBounded(statement.table, !emitting, PATTERN_TABLE_COUNT, '.PATTERN table');
          inPattern = true;
          address = ROM_PROGRAM_SIZE + table * (ROM_PATTERN_SIZE / PATTERN_TABLE_COUNT);
          break;
        }

        case DirectiveKind.INCLUDE:
        case DirectiveKind.END:
          // Both were consumed while flattening; neither reaches a pass.
          break;
      }
    }
  };

  walk(false);
  walk(true);

  const words = [...emitted.values()].sort((left, right) => left.address - right.address);

  return Object.freeze({
    file,
    words: Object.freeze(words),
    symbols: Object.freeze([...symbolOrder]),
    highestAddress: words.length === 0 ? -1 : (words.at(-1) as AssembledWord).address,
    ramHighWater,
  });
}
