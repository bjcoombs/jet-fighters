// TMS1000-family assembler (PRD R2), stage three: statements -> ROM words.
//
// Paths in this header are relative to the repository root.
//
// ## The one thing this file exists to get right
//
// The program counter is a shift register, so the n-th instruction of a page is
// emitted at physical offset `LFSR_SEQUENCE[n]`, not at offset n (memory.ts).
// The emit cursor here is therefore a *(chapter, page, ordinal)* triple and the
// physical address is derived from it, never the other way round. An assembler
// that carried a linear address and incremented it would produce a listing that
// looks entirely reasonable and a ROM in which every branch lands in the wrong
// place - which is precisely the failure the acceptance contract's V1 ordinal
// column exists to make visible without reassembling.
//
// A label therefore resolves to an **LFSR state**: the full physical address
// whose low six bits are what a `BR` or `CALL` operand carries.
//
// ## The page allocator reserves the reset page up front
//
// Reset enters at chapter 0, page 15, PC 0. That page is claimed before any
// source is looked at, so `.PAGE` with no operand can never hand it to general
// code. The alternative - allocate it like any other page and discover the
// collision when the reset routine is finally placed - fails at the end of an
// assembly, points at the wrong line, and gets worse the closer the ROM is to
// full. `pageAllocations` records who holds each page so the diagnostic can name
// both claimants.
//
// Placing the reset routine there is an ordinary explicit claim: `.ORG` or
// `.PAGE 15` inside chapter 0. The reservation stops the *allocator* handing the
// page out, not the author using it.
//
// ## Two passes, and what each one may look at
//
// Pass one walks the statements for layout only: it advances the emit cursor,
// binds every label to the address of the next word after it, and evaluates
// `.EQU`. Pass two walks the same statements again and emits, with the whole
// symbol table in hand.
//
// The split gives forward references exactly where they are needed and nowhere
// else. An instruction operand or a data item may name a label defined further
// down - that is the point of two passes. The *layout* directives (`.ORG`,
// `.CHAPTER`, `.PAGE`, `.RES`) and `.EQU` may not: their arguments decide where
// the following labels land, so they are evaluated as pass one reaches them and
// can only use symbols already defined above.
//
// ## The two hardware ceilings, enforced as errors
//
// 2048 eight-bit program words and 128 RAM nibbles. Neither is a soft target and
// neither wraps: a page that runs past its 64th word, a `.PAGE` past the last
// page of the last chapter, and a RAM address past the 128th nibble are all
// assembly errors with a source position. Wrapping any of them silently is the
// failure mode this stage is built to make impossible - a ROM that assembles and
// then executes something else entirely.
//
// ## What is deliberately not here yet
//
// Five silent-failure classes in PRD R2 need flow analysis across the assembled
// program rather than a check at the point of emission: a page-crossing branch
// inside a subroutine, a `CALL` reachable from inside a subroutine, `SETR`/`RSTR`
// while X >= 4, an instruction between a status-setting test and its branch, and
// LFSR placement itself. Task 5 of the v3 run adds them. `AssemblyResult.
// instructions` is the ordered, fully-addressed record they run over, and it is
// exported for that purpose rather than for the listing's convenience.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import {
  encodeInstruction,
  OperandKind,
  OPERAND_DESCRIPTION,
  ramReachOfFile,
  type IsaEntry,
} from './isa.js';
import {
  lfsrOffset,
  lfsrOrdinal,
  RAM_FILE_SIZE,
  RAM_SIZE,
  RESET_ADDRESS,
  RESET_CHAPTER,
  RESET_PAGE,
  ROM_CHAPTER_COUNT,
  ROM_PAGE_COUNT,
  ROM_PAGE_SIZE,
  ROM_SIZE,
  romAddress,
  romAddressForOrdinal,
  romChapter,
  romOffset,
  romPage,
  WORD_MASK,
} from './memory.js';
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
  type PageDirective,
  type SourcePosition,
  type Statement,
} from './parser.js';

export { AsmError, DEFAULT_SOURCE_NAME } from './parser.js';

/** Slots of the O output PLA - a five-bit index of status latch and accumulator. */
export const OPLA_SLOT_COUNT = 32;

/** Plates the O output PLA drives. The other four come from R11-R14. */
export const OPLA_PLATE_COUNT = 8;

/** Largest plate mask an O PLA slot can hold. */
export const OPLA_MASK_MAX = (1 << OPLA_PLATE_COUNT) - 1;

/** Words a `.DW` item occupies. A word is eight bits, so a 16-bit value is two. */
export const DW_WORDS_PER_ITEM = 2;

/** Largest value a `.DW` item may take. */
export const DW_ITEM_MAX = 0xffff;

/**
 * Prefix marking an `.EQU` constant as naming a RAM nibble.
 *
 * The assembler cannot otherwise tell `RAM_SCORE` (a RAM address) from `SPEED`
 * (a loop count): both are constants, and the instruction that eventually loads
 * one into X or Y looks the same either way. Rather than guess, the tool reads
 * one convention - see `ramHighWater` for exactly what it is used for and what
 * it does not claim.
 */
export const RAM_SYMBOL_PREFIX = 'RAM_';

/** How a symbol got its value. */
export enum SymbolKind {
  /** `name:` - bound to the LFSR state of the next word emitted after it. */
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

/** Where in the ROM a word landed, in the terms the hardware uses. */
export interface WordPlacement {
  /** The 11-bit ROM address: `chapter << 10 | page << 6 | offset`. */
  readonly address: number;
  readonly chapter: number;
  readonly page: number;
  /**
   * Which instruction of its page this is, counting from 0 in execution order.
   *
   * The listing prints this beside `offset` so the two orders can be compared
   * without reassembling. They agree on only five of a page's sixty-four words.
   */
  readonly ordinal: number;
  /** The physical offset within the page - `LFSR_SEQUENCE[ordinal]`. */
  readonly offset: number;
}

/** One assembled ROM word and where it came from. */
export interface AssembledWord extends WordPlacement {
  /** The eight-bit word itself. */
  readonly word: number;
  /** Position of the statement that produced it. */
  readonly position: SourcePosition;
  /** The source line it came from, verbatim - the listing's last column. */
  readonly sourceLine: string;
  /**
   * False for the first word a statement emits, true for every word after it.
   *
   * A `.DW` item and a five-item `.DB` each occupy one source line, so the
   * listing prints the line once and leaves the continuation rows blank.
   */
  readonly continuation: boolean;
}

/**
 * One assembled instruction, addressed.
 *
 * Separate from `AssembledWord` because the silent-failure analyses task 5 adds
 * are about instructions and their operands, not about bytes: "a CALL reachable
 * from inside a subroutine" is a question about a graph whose nodes are these.
 */
export interface AssembledInstruction extends WordPlacement {
  readonly mnemonic: string;
  readonly entry: IsaEntry;
  /** The operand as written, already evaluated. Absent when there is none. */
  readonly operand?: number;
  /**
   * For `BR`/`CALL`, the full ROM address the branch resolves to.
   *
   * The emitted operand is only the low six bits of it, so the page and chapter
   * the author *meant* are recoverable here and nowhere else in the output.
   */
  readonly target?: number;
  readonly position: SourcePosition;
}

/** One declared slot of the O output PLA. */
export interface OplaEntry {
  /** The five-bit index - `status_latch << 4 | accumulator`. */
  readonly index: number;
  /** The eight-bit plate mask the slot drives. */
  readonly mask: number;
  readonly position: SourcePosition;
}

/** Which page numbers a program claimed, and how. */
export interface PageClaim {
  readonly chapter: number;
  readonly page: number;
  /** True for the reset page, claimed before any source is read. */
  readonly reserved: boolean;
  /** Where the claim came from; absent for the reset reservation. */
  readonly position?: SourcePosition;
}

/** Everything an assembly produced. */
export interface AssemblyResult {
  /** Name of the top-level source file, as diagnostics quote it. */
  readonly file: string;
  /** Every emitted word, in physical address order. */
  readonly words: readonly AssembledWord[];
  /** Every assembled instruction, in the order the source wrote them. */
  readonly instructions: readonly AssembledInstruction[];
  /** Every label and constant, in definition order. */
  readonly symbols: readonly SymbolDefinition[];
  /**
   * The O output PLA, all 32 slots.
   *
   * Undeclared slots are 0, which is every plate dark. Slot 0 must be dark
   * because reset writes index 0 to the O register before the program has
   * chosen anything, so a lit slot 0 is a flash of garbage at power-on.
   */
  readonly opla: Uint8Array;
  /** The slots the source actually declared, in declaration order. */
  readonly oplaEntries: readonly OplaEntry[];
  /** Highest address any word landed at, or -1 when nothing was emitted. */
  readonly highestAddress: number;
  /** Pages claimed, in claim order, the reset reservation first. */
  readonly pageClaims: readonly PageClaim[];
  /** True when a word was emitted at the reset entry point. */
  readonly resetVectorPresent: boolean;
  /**
   * RAM nibbles the assembled program can be *statically shown* to address.
   *
   * A count derived from operands in the source, not a measurement of a run.
   * Nothing here executes the program; the number is the largest of:
   *
   * - `(k + 1) * 16` for each `LDX k`. X selects one of the eight 16-nibble RAM
   *   files, so naming file `k` puts every nibble up to `(k << 4) | 15` in reach.
   * - `value + 1` for each `.EQU` constant whose name starts with `RAM_`.
   *
   * It is therefore a *lower bound* on what the program touches, and an exact
   * figure only for a ROM that selects its files with literal `LDX`. A file
   * reached by `COMX` from a computed X is invisible to it by construction:
   * deciding what that reaches means running the program, which is the
   * emulator's job and not the assembler's.
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
   */
  readonly readInclude?: (path: string, fromFile: string) => IncludedSource;
}

/** `$07F` - the hexadecimal spelling diagnostics and listings both use. */
export function formatAddress(address: number): string {
  return `$${address.toString(16).toUpperCase().padStart(3, '0')}`;
}

/** `$1A` - an eight-bit ROM word, two digits because a word is one byte. */
export function formatWord(word: number): string {
  return `$${word.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** `chapter 0, page 15` - how a diagnostic names a page. */
export function formatPage(chapter: number, page: number): string {
  return `chapter ${chapter}, page ${page}`;
}

/** Split source into lines once, so the listing can quote any of them. */
function splitLines(source: string): readonly string[] {
  return source.split(/\r\n|\r|\n/);
}

/** The emit cursor: where the next word goes, in the hardware's own terms. */
interface Cursor {
  chapter: number;
  page: number;
  ordinal: number;
}

/**
 * Assemble one source file.
 *
 * @param source the program text.
 * @param file the name diagnostics quote.
 * @param options host services - currently only `.INCLUDE` resolution.
 * @throws AsmError on the first thing the architecture or the source rejects.
 *   Every message carries file, line and column.
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
        throw new AsmError(
          `cannot read .INCLUDE "${statement.path}": ${reason}`,
          statement.pathPosition,
        );
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

  // --- The page allocator --------------------------------------------------

  /** Who holds each claimed page, keyed `chapter:page`. */
  const pageAllocations = new Map<string, PageClaim>();
  const pageClaims: PageClaim[] = [];

  const pageKey = (chapter: number, page: number): string => `${chapter}:${page}`;

  const claimPage = (
    chapter: number,
    page: number,
    position: SourcePosition | undefined,
    reserved: boolean,
  ): void => {
    const key = pageKey(chapter, page);
    if (pageAllocations.has(key)) {
      return;
    }
    const claim: PageClaim = position === undefined
      ? { chapter, page, reserved }
      : { chapter, page, reserved, position };
    pageAllocations.set(key, Object.freeze(claim));
    pageClaims.push(claim);
  };

  /**
   * Reserve the reset page before a single statement is looked at.
   *
   * This is the whole point of having an allocator rather than a running
   * address. `.PAGE` with no operand asks for the next *free* page, and the
   * reset page is not free from the moment the assembly starts.
   */
  const reserveResetPage = (): void => {
    claimPage(RESET_CHAPTER, RESET_PAGE, undefined, true);
  };

  /**
   * The next page the allocator will hand out.
   *
   * Scans forward from the page the cursor is on and wraps to the start of the
   * chapter, taking the first page nothing has claimed - by an explicit
   * `.PAGE`/`.ORG`, by code already emitted onto it, or by the reset
   * reservation. Wrapping cannot put two routines in one place, because a
   * claimed page is never offered; refusing to wrap could only turn a layout
   * that has room into an error, and the layout it would refuse is a common one
   * - the reset routine on page 15 first, then a bare `.PAGE` for everything
   * else.
   */
  const nextFreePage = (position: SourcePosition): number => {
    for (let step = 0; step < ROM_PAGE_COUNT; step += 1) {
      const page = (cursor.page + step) % ROM_PAGE_COUNT;
      if (!pageAllocations.has(pageKey(cursor.chapter, page))) {
        return page;
      }
    }
    const note =
      cursor.chapter === RESET_CHAPTER
        ? `. ${formatPage(RESET_CHAPTER, RESET_PAGE)} is reserved for the reset routine and ` +
          `is never allocated to general code - put the reset routine there with .PAGE ${RESET_PAGE}`
        : '';
    throw new AsmError(
      `no free page left in chapter ${cursor.chapter}: all ${ROM_PAGE_COUNT} pages are ` +
        `claimed${note}`,
      position,
    );
  };

  /**
   * The page a bare `.PAGE` resolved to on pass one.
   *
   * Pass two must not ask the allocator again: by then pass one has claimed
   * every page the program uses, so the same `.PAGE` would be handed a different
   * answer and the two passes would disagree about where every following label
   * lives. The statement object is the key because it is the one thing that is
   * identical between the passes.
   */
  const resolvedPages = new Map<PageDirective, number>();

  // --- Emission ------------------------------------------------------------

  const emitted = new Map<number, AssembledWord>();
  const instructions: AssembledInstruction[] = [];
  const opla = new Uint8Array(OPLA_SLOT_COUNT);
  const oplaEntries: OplaEntry[] = [];
  const oplaDeclared = new Map<number, OplaEntry>();

  const cursor: Cursor = { chapter: 0, page: 0, ordinal: 0 };
  /** Set per statement so a multi-word statement quotes its line once. */
  let emittedThisStatement = false;

  const placement = (): WordPlacement => {
    if (cursor.ordinal >= ROM_PAGE_SIZE) {
      throw new RangeError('cursor is past the end of its page - assertPageHasRoom missed it');
    }
    const offset = lfsrOffset(cursor.ordinal);
    return Object.freeze({
      address: romAddress(cursor.chapter, cursor.page, offset),
      chapter: cursor.chapter,
      page: cursor.page,
      ordinal: cursor.ordinal,
      offset,
    });
  };

  const assertPageHasRoom = (count: number, position: SourcePosition): void => {
    if (cursor.ordinal + count <= ROM_PAGE_SIZE) {
      return;
    }
    throw new AsmError(
      `${formatPage(cursor.chapter, cursor.page)} is full: a page holds ${ROM_PAGE_SIZE} ` +
        `words and this statement would place word ${cursor.ordinal + count} on it. ` +
        'A page does not wrap into the next one - move the routine with .PAGE, or split it',
      position,
    );
  };

  /**
   * Claim the page the cursor is writing on.
   *
   * Called from every path that consumes a word, so a page filled by code that
   * never named a `.PAGE` is still off the allocator's list. Without this, a
   * program that starts writing at page 0 and later says `.PAGE` would be handed
   * page 0 back and overlap itself.
   */
  const claimCurrentPage = (position: SourcePosition): void => {
    claimPage(cursor.chapter, cursor.page, position, false);
  };

  /** Move the cursor on without emitting - `.RES`, and pass one's instructions. */
  const skip = (count: number, position: SourcePosition): void => {
    assertPageHasRoom(count, position);
    if (count > 0) {
      claimCurrentPage(position);
    }
    cursor.ordinal += count;
  };

  const emit = (word: number, position: SourcePosition): WordPlacement => {
    assertPageHasRoom(1, position);
    claimCurrentPage(position);
    const where = placement();
    const clash = emitted.get(where.address);
    if (clash) {
      throw new AsmError(
        `${formatAddress(where.address)} (${formatPage(where.chapter, where.page)}, word ` +
          `${where.ordinal}) already holds a word emitted at ${clash.position.file}:` +
          `${clash.position.line}:${clash.position.column} - two regions overlap`,
        position,
      );
    }
    emitted.set(
      where.address,
      Object.freeze({
        ...where,
        word,
        position,
        sourceLine: sourceLineAt(position),
        continuation: emittedThisStatement,
      }),
    );
    emittedThisStatement = true;
    cursor.ordinal += 1;
    return where;
  };

  // --- Operand encoding ----------------------------------------------------

  /**
   * The six bits a `BR` or `CALL` carries: the target's LFSR state.
   *
   * The source writes a target *address* - a label - and the assembler takes its
   * low six bits, because that is literally what the hardware loads into the
   * shift register. Nothing here checks that the target's page is reachable:
   * whether it is depends on the `LDP` that preceded the branch and on whether
   * the branch is inside a subroutine, which are flow questions and task 5's.
   * The page the author meant is recorded on the instruction so that pass can
   * ask them.
   */
  const branchTargetFor = (
    entry: IsaEntry,
    target: number,
    position: SourcePosition,
  ): number => {
    if (!Number.isInteger(target) || target < 0 || target >= ROM_SIZE) {
      throw new AsmError(
        `${entry.mnemonic} target out of the program region: ${target} ` +
          `(expected 0..${ROM_SIZE - 1})`,
        position,
      );
    }
    return romOffset(target);
  };

  const assembleInstruction = (
    entry: IsaEntry,
    operands: readonly Expression[],
    mnemonic: string,
    position: SourcePosition,
  ): void => {
    if (entry.operandKind === OperandKind.NONE) {
      const where = emit(encodeInstruction(entry), position);
      instructions.push(Object.freeze({ ...where, mnemonic, entry, position }));
      return;
    }

    const operand = operands[0] as Expression;

    if (entry.operandKind === OperandKind.BRANCH_TARGET) {
      const target = evaluate(operand, false);
      const state = branchTargetFor(entry, target, operand.position);
      const where = emit(encodeInstruction(entry, state), position);
      instructions.push(
        Object.freeze({ ...where, mnemonic, entry, operand: state, target, position }),
      );
      return;
    }

    // The range comes off the ISA row, never from a limit spelled out here:
    // pages, RAM files and bit indices each have their own, and they are
    // properties of the hardware the table already describes.
    const value = evaluateBounded(
      operand,
      false,
      entry.operandLimit,
      `${entry.mnemonic} ${OPERAND_DESCRIPTION[entry.operandKind]}`,
    );
    if (entry.operandKind === OperandKind.RAM_FILE) {
      noteRamUse(
        ramReachOfFile(value),
        position,
        `${entry.mnemonic} ${value} selects RAM file ${value}, which`,
      );
    }
    const where = emit(encodeInstruction(entry, value), position);
    instructions.push(Object.freeze({ ...where, mnemonic, entry, operand: value, position }));
  };

  const assembleDataItem = (item: DataItem, wide: boolean): void => {
    const directive = wide ? DirectiveKind.DW : DirectiveKind.DB;
    if (isStringExpression(item)) {
      for (const character of item.value) {
        const code = character.codePointAt(0) ?? 0;
        if (code > WORD_MASK) {
          throw new AsmError(
            `${directive} cannot hold ${JSON.stringify(character)}: character code ${code} ` +
              `does not fit in 0..${WORD_MASK}`,
            item.position,
          );
        }
        emit(code, item.position);
      }
      return;
    }
    if (!wide) {
      emit(evaluateBounded(item, false, WORD_MASK + 1, `${directive} value`), item.position);
      return;
    }
    const value = evaluateBounded(item, false, DW_ITEM_MAX + 1, `${directive} value`);
    // High byte first: the order is stated rather than inherited, so the same
    // source assembles to the same ROM whatever the host's byte order.
    emit((value >>> 8) & WORD_MASK, item.position);
    emit(value & WORD_MASK, item.position);
  };

  /** The number of words a data directive occupies - pass one needs it too. */
  const dataWordCount = (items: readonly DataItem[], wide: boolean): number =>
    items.reduce(
      (total, item) =>
        total +
        (isStringExpression(item) ? [...item.value].length : wide ? DW_WORDS_PER_ITEM : 1),
      0,
    );

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
    cursor.chapter = 0;
    cursor.page = 0;
    cursor.ordinal = 0;
    if (!emitting) {
      pageAllocations.clear();
      pageClaims.length = 0;
      reserveResetPage();
    }

    for (const statement of statements) {
      emittedThisStatement = false;

      if (statement.kind === StatementKind.LABEL) {
        if (!emitting) {
          assertPageHasRoom(1, statement.position);
          define({
            name: statement.name,
            value: romAddressForOrdinal(cursor.chapter, cursor.page, cursor.ordinal),
            kind: SymbolKind.LABEL,
            position: statement.position,
          });
        }
        continue;
      }

      if (statement.kind === StatementKind.INSTRUCTION) {
        if (emitting) {
          assembleInstruction(
            statement.entry,
            statement.operands,
            statement.mnemonic,
            statement.position,
          );
        } else {
          skip(1, statement.position);
        }
        continue;
      }

      switch (statement.directive) {
        case DirectiveKind.ORG: {
          const address = evaluateBounded(statement.address, !emitting, ROM_SIZE, '.ORG address');
          cursor.chapter = romChapter(address);
          cursor.page = romPage(address);
          cursor.ordinal = lfsrOrdinal(romOffset(address));
          if (!emitting) {
            claimPage(cursor.chapter, cursor.page, statement.position, false);
          }
          break;
        }

        case DirectiveKind.CHAPTER: {
          cursor.chapter = evaluateBounded(
            statement.chapter,
            !emitting,
            ROM_CHAPTER_COUNT,
            '.CHAPTER number',
          );
          cursor.page = 0;
          cursor.ordinal = 0;
          // No claim: `.CHAPTER` selects a chapter, it does not say "put things
          // on page 0 of it". The page is claimed if and when a word lands there.
          break;
        }

        case DirectiveKind.PAGE: {
          let page: number;
          if (statement.page !== undefined) {
            page = evaluateBounded(statement.page, !emitting, ROM_PAGE_COUNT, '.PAGE number');
          } else if (!emitting) {
            page = nextFreePage(statement.position);
            resolvedPages.set(statement, page);
          } else {
            page = resolvedPages.get(statement) ?? 0;
          }
          cursor.page = page;
          cursor.ordinal = 0;
          if (!emitting) {
            claimPage(cursor.chapter, page, statement.position, false);
          }
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
          const wide = statement.directive === DirectiveKind.DW;
          if (emitting) {
            for (const item of statement.items) {
              assembleDataItem(item, wide);
            }
          } else {
            skip(dataWordCount(statement.items, wide), statement.position);
          }
          break;
        }

        case DirectiveKind.OPLA: {
          if (emitting) {
            const slot = evaluateBounded(
              statement.index,
              false,
              OPLA_SLOT_COUNT,
              '.OPLA slot index',
            );
            const mask = evaluateBounded(
              statement.mask,
              false,
              OPLA_MASK_MAX + 1,
              '.OPLA plate mask',
            );
            const existing = oplaDeclared.get(slot);
            if (existing) {
              throw new AsmError(
                `O PLA slot ${slot} is already declared at ${existing.position.file}:` +
                  `${existing.position.line}:${existing.position.column}`,
                statement.position,
              );
            }
            if (slot === 0 && mask !== 0) {
              throw new AsmError(
                'O PLA slot 0 must be all plates dark: reset writes index 0 to the O ' +
                  'register before the program has chosen a pattern, so a lit slot 0 is a ' +
                  `flash of garbage at power-on. Got ${formatWord(mask)}`,
                statement.position,
              );
            }
            const entry = Object.freeze({ index: slot, mask, position: statement.position });
            oplaDeclared.set(slot, entry);
            oplaEntries.push(entry);
            opla[slot] = mask;
          }
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
    instructions: Object.freeze(instructions),
    symbols: Object.freeze([...symbolOrder]),
    opla,
    oplaEntries: Object.freeze([...oplaEntries]),
    highestAddress: words.length === 0 ? -1 : (words.at(-1) as AssembledWord).address,
    pageClaims: Object.freeze([...pageClaims]),
    resetVectorPresent: emitted.has(RESET_ADDRESS),
    ramHighWater,
  });
}

/** Re-exported so callers can name the reset entry without a second import. */
export {
  RESET_ADDRESS,
  RESET_CHAPTER,
  RESET_ORDINAL,
  RESET_PAGE,
  ROM_SIZE,
  RAM_SIZE,
} from './memory.js';
