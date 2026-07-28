// TMS1370 output PLA: the 32-entry table that turns the core's 5-bit O register
// index into eight O lines.
//
// Source: docs/research/tms1370-architecture.md §4 - the O register is "5 in /
// 8 out", its index is `status_latch << 4 | A`, and the index is decoded through
// the output PLA (S1 `op_tdo`, `tms1k_base.cpp:540-544`). §5 adds the
// consequence that costs a programmer sleep: **there is no CLO on this core**,
// so clearing the O register means executing TDO with A = 0 and the status latch
// clear - i.e. writing index 0. Slot 0 is therefore the "everything dark" slot
// by convention, and reset writes it.
//
// Why this type exists at all, rather than an 8-bit field on the core.
// `docs/contract/v3.contract.md` names "an unbounded output vocabulary" as one
// of three shapes a TMS1370-in-name build takes, and requires (V4) that the
// core's O write path be **structurally** indexed by five bits and unable to
// express a plate mask absent from the table. A core that accepts an arbitrary
// 8-bit O write fails that criterion even if the ROM never exercises it. So the
// core holds an index and nothing else; the only route from an index to eight
// lines is {@link Tms1370OutputPla.decode}; and the table it reads is fixed at
// construction. The constraint is a shape, not a check a caller could skip.
//
// Which masks the table *holds* is the I/O layer's business and this file takes
// no position on it: the entries are supplied by the caller, and the default is
// darkness.
//
// Pure data only: no DOM, no timers, no Web APIs.

import { O_MASK, O_PIN_COUNT } from './ports.js';
import { O_INDEX_BITS, O_INDEX_MASK } from './registers.js';

/**
 * The index width and mask, re-exported from the register file.
 *
 * Consumers of the O port should not have to know that the index is composed in
 * `registers.ts` and decoded here - and re-exporting rather than restating keeps
 * the five bits stated once.
 */
export { O_INDEX_BITS, O_INDEX_MASK } from './registers.js';

/**
 * Entries in the output PLA: one per value the 5-bit index can take.
 *
 * Derived from the index width rather than written as 32, so the table's size
 * and the core's index width cannot drift apart. `ports.ts` states the same
 * ceiling as `O_PLA_INDEX_COUNT` from the pin budget's side; `opla.test.ts`
 * asserts the two agree.
 */
export const O_PLA_ENTRY_COUNT = O_INDEX_MASK + 1;

/** O output lines on this part - the 8 O pins the port file counts. */
export const O_LINE_COUNT = O_PIN_COUNT;

/** Mask of the decoded O output word, i.e. the port file's `O_MASK`. */
export const O_LINE_MASK = O_MASK;

/**
 * The index reset writes.
 *
 * Reset clears the status latch and the accumulator, so the index it composes is
 * 0 (research doc §7: "the O register is written with index 0"). Naming it
 * matters because slot 0 is also the slot the ROM uses to blank the display -
 * the two are the same slot for the same reason, and a build that let them drift
 * would flash whatever slot 0 happened to hold at power-on.
 */
export const O_RESET_INDEX = 0;

/**
 * The output PLA as the core sees it: 32 slots, 8 lines each.
 *
 * Fewer than 32 entries may be supplied; the rest read as all-dark, matching the
 * contract's "undeclared slots assemble to 0". More than 32 is an error rather
 * than a truncation - a caller with 33 masks has a table the hardware cannot
 * address, and silently dropping the last one is how an output vocabulary grows
 * a member nothing can reach.
 */
export class Tms1370OutputPla {
  private readonly slots: Uint8Array;

  constructor(entries: ArrayLike<number> = []) {
    if (entries.length > O_PLA_ENTRY_COUNT) {
      throw new Error(
        `TMS1370 output PLA takes at most ${O_PLA_ENTRY_COUNT} entries ` +
          `(a ${O_INDEX_BITS}-bit index), got ${entries.length}`,
      );
    }
    this.slots = new Uint8Array(O_PLA_ENTRY_COUNT);
    for (let index = 0; index < entries.length; index += 1) {
      this.slots[index] = (entries[index] as number) & O_LINE_MASK;
    }
  }

  /**
   * Decode one index into eight O lines.
   *
   * The index is masked to five bits, so there is no index outside the table and
   * therefore no output outside it either. This is the whole of the core's O
   * write path.
   */
  decode(index: number): number {
    return this.slots[index & O_INDEX_MASK] as number;
  }

  /** Every mask the table can produce, in index order. */
  get entries(): readonly number[] {
    return Array.from(this.slots);
  }

  /**
   * The set of masks this table can ever put on the O pins.
   *
   * The core's whole output vocabulary, computable without running anything -
   * which is what makes V4's "cannot express a plate mask absent from the table"
   * an assertion about the machine rather than about the program.
   */
  get vocabulary(): ReadonlySet<number> {
    return new Set(this.slots);
  }
}

/**
 * An output PLA with every slot dark.
 *
 * The default for a core constructed without one: a machine with no output
 * table drives no plates, rather than drives an arbitrary pattern.
 */
export const DARK_OUTPUT_PLA = new Tms1370OutputPla();

/**
 * Where the core sends O register writes.
 *
 * The parameter is an **index**, not a mask. That is the structural half of
 * contract V4: a board wired to this interface cannot be handed a plate pattern
 * the output PLA does not contain, because the core has no way to name one.
 */
export interface Tms1370OutputSink {
  /** The core wrote the O register with this 5-bit index. */
  writeOIndex(index: number): void;
}
