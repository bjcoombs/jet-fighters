// The O output PLA's *contents*: the 32-entry plate vocabulary this machine has.
//
// Paths in this file are relative to the repository root.
//
// The core-side half of the O PLA - the type that turns a 5-bit index into eight
// O lines, and the structural guarantee that the core can express nothing else -
// is `src/machine/cpu/tms1370/opla.ts`. This file takes no position on that
// mechanism and duplicates none of it. What it owns is the other half: *which*
// 32 masks the table holds, why those, and how a program picks one cheaply.
//
// The table is authored, not discovered. `docs/research/tms1370-io.md` records
// TI's own description of the part (Data Manual Dec 1976 §2.6) - the O pins come
// out of a five-bit-to-eight-bit code converter whose decoding "the user
// defines" - and MAME has Gakken's own table for our mask ROM as
// `tms1100_ginv_output.pla`. **That artifact has not been obtained by this
// project and this table is not a reproduction of it.** Reproducing Gakken's
// PLA is an explicit non-goal of the v3 contract. Every mask below is this
// repository's own design decision, justified from `src/machine/tube/atlas.json`
// and from nothing else.
//
// The design in one paragraph. Twelve plates reach the tube; the low eight come
// through this table and the high four (plates 8-11) come from R11-R14, where
// the program can set any combination one line at a time. So this table only
// ever has to express subsets of plates 0-7. The atlas puts three *lane
// families* on those plates - plates 0-2, plates 3-5, and plates 6-7 - and a
// seven-segment score digit across plates 0-6. The table therefore holds every
// subset of each lane family plus the ten decoded digits, and the sweep writes
// one family per strobe. See `docs/research/pla-design.md` for the arithmetic
// that forces the strobe split and for the instruction-cost bound.
//
// Pure data: no DOM, no timers, no state.

import {
  O_MASK,
  O_PLA_INDEX_COUNT,
  O_PLATE_COUNT,
  GRID_COUNT,
} from '../cpu/tms1370/ports.js';

/**
 * Slots the table has: 32, the ceiling `ports.ts` derives from the pin budget.
 *
 * Re-exported under this file's own name rather than restated, so the table
 * length and the core's index width cannot drift apart.
 */
export const O_PLA_SLOT_COUNT = O_PLA_INDEX_COUNT;

/**
 * The slot reset writes, and the slot that must be dark.
 *
 * Reset clears the accumulator and the status latch, so the index it composes is
 * 0. There is no `CLO` on this core (research doc §5), so the program's own way
 * of blanking a grid is also `TDO` with A = 0 - the same slot for the same
 * reason. `tools/tmsasm` rejects a `.OPLA 0` declaration with a lit mask, so the
 * rule is enforced at assembly time and not only asserted here.
 */
export const O_PLA_DARK_INDEX = 0;

/**
 * Slots the index space has above the accumulator's four bits.
 *
 * The fifth index bit is the status latch, and on this core the status latch is
 * loaded by exactly one instruction - `YNEA`. There is no set and no clear. That
 * single fact is why the table is laid out in two banks of sixteen and why the
 * sweep is organised to cross the bank boundary twice per sweep rather than
 * per grid: see {@link O_PLA_BANK_SIZE} and the design document's cost section.
 */
export const O_PLA_BANK_SIZE = 16;

/** First index of the bank the status latch selects. */
export const O_PLA_HIGH_BANK_FIRST = O_PLA_BANK_SIZE;

// --- Lane families ----------------------------------------------------------

/**
 * A run of O plates carrying one family of same-shaped segments, one per lane.
 *
 * The atlas lays every playfield grid out the same way: three lanes of one
 * actor on plates 0-2, three lanes of another on plates 3-5, and two lanes of a
 * third on plates 6-7 (that family's third lane is plate 8, which is R11 and not
 * this table's business). Because the layout repeats, one set of masks serves
 * every grid - which is what makes a 32-slot table cover a nine-grid tube.
 */
export interface PlateGroup {
  /** Name used in diagnostics, the listing commentary and the design document. */
  readonly name: string;
  /** Lowest O plate of the run. */
  readonly firstPlate: number;
  /** Plates in the run, and therefore lanes the family has on the O port. */
  readonly plateCount: number;
  /** Index of this group's empty subset. Subset s lives at `firstIndex + s`. */
  readonly firstIndex: number;
}

/** Subsets a group has: one per combination of its lanes, empty included. */
export function subsetCount(group: PlateGroup): number {
  return 1 << group.plateCount;
}

/**
 * Plates 0-2: the battleship on grid 0, the jet on grids 1-5.
 *
 * This is the group that needs all eight subsets rather than four. The v2 ROM
 * keeps one jet per lane and flies each independently (`asm/jetfighter.asm`,
 * `FILE_JETS`: "one jet per lane, each flying its own step"), so a column can
 * hold three at once and any of the eight combinations is reachable. Cutting
 * this group to "at most one lit" would be a cut in the *game*, not in the
 * table.
 */
export const NEAR_GROUP: PlateGroup = Object.freeze({
  name: 'near',
  firstPlate: 0,
  plateCount: 3,
  firstIndex: 0,
});

/**
 * Plates 3-5: the sea on grid 0, the attacker's colon on grids 1-5, the capture
 * burst on grid 6.
 *
 * Held to all eight subsets like {@link NEAR_GROUP}, though the v2 ROM flies one
 * colon at a time (`NIB_RCOL`, a single column nibble). Two of the eight are
 * known to be wanted - the printed sea is three lane segments that read as one
 * horizon, so grid 0 wants `%111` - and there is no slot to save by guessing
 * which of the remaining five task 8 will need. Generality here is free.
 */
export const FAR_GROUP: PlateGroup = Object.freeze({
  name: 'far',
  firstPlate: 3,
  plateCount: 3,
  firstIndex: 8,
});

/**
 * Plates 6-7: the battleship's burst, the player's missile, the player's ship,
 * and the two score indicators.
 *
 * Two plates, not three: every one of these families has its third lane on plate
 * 8, which is R11. The score grids borrow this group for a single plate each -
 * `score_hundreds` and `score_label` are both plate 7 - which is why the score
 * needs no slot of its own for them.
 */
export const PAIR_GROUP: PlateGroup = Object.freeze({
  name: 'pair',
  firstPlate: 6,
  plateCount: 2,
  firstIndex: 28,
});

/** The three lane families, in plate order. */
export const PLATE_GROUPS: readonly PlateGroup[] = Object.freeze([
  NEAR_GROUP,
  FAR_GROUP,
  PAIR_GROUP,
]);

/**
 * The index that lights subset `s` of `group`.
 *
 * The whole selection rule, and it is deliberately an *identity* on the low
 * bits: a program holding the lane bitmap in the accumulator already holds the
 * low three bits of the index, and reaching the far group is a single `A8AAC`
 * on top of it. Nothing here needs a lookup table in ROM.
 */
export function groupIndex(group: PlateGroup, subset: number): number {
  if (!Number.isInteger(subset) || subset < 0 || subset >= subsetCount(group)) {
    throw new RangeError(
      `${group.name} group has ${subsetCount(group)} subsets, got ${subset}`,
    );
  }
  return group.firstIndex + subset;
}

/** The plate mask subset `s` of `group` puts on the O pins. */
export function groupMask(group: PlateGroup, subset: number): number {
  if (!Number.isInteger(subset) || subset < 0 || subset >= subsetCount(group)) {
    throw new RangeError(
      `${group.name} group has ${subsetCount(group)} subsets, got ${subset}`,
    );
  }
  return (subset << group.firstPlate) & O_MASK;
}

// --- The score digits -------------------------------------------------------

/**
 * Segments a-g of a score digit, in plate order.
 *
 * Read off `src/machine/tube/atlas.json`: `score_tens_sega` is plate 0 through
 * `score_tens_segg` at plate 6, and the units digit repeats it on grid 8. The
 * order is data here rather than a comment because the digit masks below are
 * built from it.
 */
export const SEVEN_SEGMENT_KEYS: readonly string[] = Object.freeze([
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
]);

/** Plate carrying segment `key` of a score digit. */
export function sevenSegmentPlate(key: string): number {
  const plate = SEVEN_SEGMENT_KEYS.indexOf(key);
  if (plate < 0) {
    throw new RangeError(`no seven-segment key ${key}`);
  }
  return plate;
}

/** Which segments each decimal digit lights. The conventional shapes. */
const DIGIT_SEGMENTS: readonly string[] = Object.freeze([
  'abcdef',
  'bc',
  'abdeg',
  'abcdg',
  'bcfg',
  'acdfg',
  'acdefg',
  'abc',
  'abcdefg',
  'abcdfg',
]);

/** Decimal digits the table decodes: 0-9. */
export const DIGIT_COUNT = DIGIT_SEGMENTS.length;

/**
 * First index of the decoded-digit run.
 *
 * The digits sit at the bottom of the high bank so that the index is
 * `status_latch:digit` with the BCD nibble passed through untouched. A program
 * holding a score digit in the accumulator writes it with `TDO` and no
 * conversion at all - which is the use TI's own data manual gives as the
 * example ("can encode any 16 characters of eight-segment display information").
 * The seven-segment decode lives in the mask, so no ROM page is spent on it.
 */
export const DIGIT_FIRST_INDEX = O_PLA_HIGH_BANK_FIRST;

/**
 * The blank digit, for leading-zero suppression on the tens column.
 *
 * A dark slot reachable *from the high bank*, so blanking the tens digit costs
 * the same two instructions as drawing it and does not need the status latch
 * moved. Slot {@link O_PLA_DARK_INDEX} is the low bank's dark slot and cannot
 * serve here for that reason - the two are the same pattern and different costs.
 */
export const DIGIT_BLANK_INDEX = DIGIT_FIRST_INDEX + DIGIT_COUNT;

/**
 * The one slot this design leaves unspent.
 *
 * Declared as headroom rather than filled with a mask nothing asks for: task 8
 * writes the ROM against this table and is the first party in a position to know
 * what it is short of. It assembles to 0 whether or not anything declares it.
 */
export const RESERVED_INDEX = DIGIT_BLANK_INDEX + 1;

/** The plate mask for decimal digit `d`. */
export function digitMask(digit: number): number {
  const segments = DIGIT_SEGMENTS[digit];
  if (segments === undefined) {
    throw new RangeError(`no seven-segment shape for digit ${digit}`);
  }
  let mask = 0;
  for (const key of segments) {
    mask |= 1 << sevenSegmentPlate(key);
  }
  return mask;
}

/** The index that draws decimal digit `d`. */
export function digitIndex(digit: number): number {
  if (!Number.isInteger(digit) || digit < 0 || digit >= DIGIT_COUNT) {
    throw new RangeError(`digits run 0..${DIGIT_COUNT - 1}, got ${digit}`);
  }
  return DIGIT_FIRST_INDEX + digit;
}

// --- The table --------------------------------------------------------------

/**
 * Build the 32 masks from the rules above.
 *
 * Generated rather than written out, so a slot cannot disagree with the rule it
 * is meant to follow. `asm/opla.inc.asm` states the same table in the source the
 * machine image is assembled from, and `tools/tmsasm/opla-table.test.ts` asserts
 * the two agree slot for slot - the assembly is what the machine runs, this is
 * what the tests and the board reason about, and neither is allowed to drift.
 */
function buildTable(): readonly number[] {
  const slots = new Array<number>(O_PLA_SLOT_COUNT).fill(0);
  for (const group of PLATE_GROUPS) {
    for (let subset = 0; subset < subsetCount(group); subset += 1) {
      slots[groupIndex(group, subset)] = groupMask(group, subset);
    }
  }
  for (let digit = 0; digit < DIGIT_COUNT; digit += 1) {
    slots[digitIndex(digit)] = digitMask(digit);
  }
  slots[DIGIT_BLANK_INDEX] = 0;
  return Object.freeze(slots);
}

/**
 * This machine's O output PLA: 32 plate masks, one per 5-bit index.
 *
 * Slot 0 is dark. Slots 0-15 are the low bank (status latch clear) and hold the
 * two three-lane families; slots 16-31 are the high bank and hold the score
 * digits and the two-lane family.
 */
export const O_PLA_TABLE: readonly number[] = buildTable();

// --- The sweep plan, and what closure means over it -------------------------

/** A strobe phase: one `TDO` against one grid, drawing one family. */
export type SweepPhaseKind = 'group' | 'digit';

/** One pass of the sweep: a family, the grids it visits, and its bank. */
export interface SweepPass {
  readonly name: string;
  readonly kind: SweepPhaseKind;
  /** The lane family this pass draws, for a `group` pass. */
  readonly group?: PlateGroup;
  /** Grids this pass strobes. A grid with nothing in the family is skipped. */
  readonly grids: readonly number[];
  /** Status latch value every index in this pass carries. */
  readonly statusLatch: 0 | 1;
}

/** Grid carrying the battleship, the sea and the battleship's burst. */
export const GRID_BATTLESHIP = 0;

/** First and last of the five jet columns. */
export const GRID_COLUMN_FIRST = 1;
export const GRID_COLUMN_LAST = 5;

/** Grid carrying the player's ship and the capture burst. */
export const GRID_PLAYER = 6;

/** Grid carrying the tens digit and the hundreds indicator. */
export const GRID_SCORE_TENS = 7;

/** Grid carrying the units digit and the SCORE label. */
export const GRID_SCORE_UNITS = 8;

const gridRange = (first: number, last: number): readonly number[] =>
  Object.freeze(Array.from({ length: last - first + 1 }, (_unused, step) => first + step));

/**
 * The sweep, as four passes rather than nine grid dwells.
 *
 * A grid cannot be drawn in one `TDO`: a jet column's O-visible state space is
 * 8 jet subsets x 4 colon states x 3 missile states = 96 masks, and no 32-slot
 * table covers 96. The split is forced by that arithmetic, not chosen for
 * convenience - the design document works it through. Given a split, passes
 * rather than per-grid phases are what keeps the status latch still: `YNEA` is
 * the only instruction that loads it, so the two bank-0 passes run first, the
 * latch is set once, and the two bank-1 passes follow.
 *
 * 24 strobes, not 36: a pass skips any grid whose family has no segment there.
 */
export const SWEEP_PASSES: readonly SweepPass[] = Object.freeze([
  Object.freeze({
    name: 'near',
    kind: 'group' as const,
    group: NEAR_GROUP,
    grids: gridRange(GRID_BATTLESHIP, GRID_COLUMN_LAST),
    statusLatch: 0 as const,
  }),
  Object.freeze({
    name: 'far',
    kind: 'group' as const,
    group: FAR_GROUP,
    grids: gridRange(GRID_BATTLESHIP, GRID_PLAYER),
    statusLatch: 0 as const,
  }),
  Object.freeze({
    name: 'pair',
    kind: 'group' as const,
    group: PAIR_GROUP,
    grids: gridRange(GRID_BATTLESHIP, GRID_SCORE_UNITS),
    statusLatch: 1 as const,
  }),
  Object.freeze({
    name: 'digit',
    kind: 'digit' as const,
    grids: gridRange(GRID_SCORE_TENS, GRID_SCORE_UNITS),
    statusLatch: 1 as const,
  }),
]);

/**
 * The pair-family lane the score grids use: lane 1, which is plate 7.
 *
 * `score_hundreds` on grid 7 and `score_label` on grid 8 are both plate 7 - one
 * indicator each, sharing a family with the playfield's two-lane actors so that
 * the score costs no slot of its own for them.
 */
export const SCORE_INDICATOR_LANE = 0b10;

/**
 * Lanes of `pass`'s family the ROM may light on `grid`, as a subset bitmap.
 *
 * All of them, except on the two score grids. There the pair family's plate 6 is
 * *also* segment g of the digit: `score_tens_segg` and `score_units_segg` are
 * plate 6, while `score_hundreds` and `score_label` are plate 7. So the pair
 * pass on grids 7 and 8 may light lane 1 and must never light lane 0 - a pair
 * strobe with plate 6 set would put a stray bar through the digit at half
 * brightness, and it would look like a rendering bug rather than a ROM one.
 *
 * This is the one place the uniform family layout has an exception, so it is
 * stated as a rule with a name rather than left as a comment for task 8 to
 * remember.
 */
export function liveSubsetMask(pass: SweepPass, grid: number): number {
  if (pass.kind === 'digit') {
    return 0;
  }
  const group = pass.group as PlateGroup;
  const all = subsetCount(group) - 1;
  if (group === PAIR_GROUP && (grid === GRID_SCORE_TENS || grid === GRID_SCORE_UNITS)) {
    return SCORE_INDICATOR_LANE;
  }
  return all;
}

/** Strobes one sweep issues. The denominator of every segment's duty. */
export const STROBES_PER_SWEEP = SWEEP_PASSES.reduce(
  (total, pass) => total + pass.grids.length,
  0,
);

/**
 * Bank crossings one sweep needs.
 *
 * Counted from {@link SWEEP_PASSES} rather than asserted, because it is the
 * number the instruction-cost bound multiplies by three - one `CLA`, one `TCY`
 * and one `YNEA` per crossing - and a pass reordered without noticing would
 * change it silently. The wrap from the last pass back to the first counts: the
 * sweep repeats.
 */
export const BANK_CROSSINGS_PER_SWEEP = SWEEP_PASSES.reduce((total, pass, at) => {
  const previous = SWEEP_PASSES[(at + SWEEP_PASSES.length - 1) % SWEEP_PASSES.length];
  return total + (previous?.statusLatch === pass.statusLatch ? 0 : 1);
}, 0);

/**
 * Instructions spent choosing an index, per strobe.
 *
 * `TMA` to load the accumulator from the nibble the game logic maintains for
 * this grid and this pass, then `TDO`. Two, always, whatever the game is doing -
 * which is the property V4 asks the design document to state a bound for.
 */
export const INSTRUCTIONS_PER_STROBE = 2;

/** Instructions one bank crossing costs: `CLA`, `TCY k`, `YNEA`. */
export const INSTRUCTIONS_PER_BANK_CROSSING = 3;

/**
 * The whole per-sweep cost of index selection, in instructions.
 *
 * Constant: no term depends on the game state, so the bound is the value. What
 * this figure deliberately excludes is grid selection - the `SETR`/`RSTR` pair
 * and the `TCY` that addresses them - because that cost exists whatever the O
 * PLA looks like and charging it here would flatter the table.
 */
export const SELECTION_INSTRUCTIONS_PER_SWEEP =
  STROBES_PER_SWEEP * INSTRUCTIONS_PER_STROBE +
  BANK_CROSSINGS_PER_SWEEP * INSTRUCTIONS_PER_BANK_CROSSING;

/**
 * Every plate mask the sweep plan can ever ask the O port for.
 *
 * This is the left-hand side of closure. A ROM written against this plan drives
 * masks from this set and no others, so a table containing this set is a table
 * the ROM cannot leave. Task 8's conformance suite replaces the derivation with
 * the masks its ROM actually drives; until it lands, this is the honest form of
 * the same assertion - it is closed over the *design*, and it says so.
 */
export function requiredPlateMasks(): ReadonlySet<number> {
  const required = new Set<number>();
  for (const pass of SWEEP_PASSES) {
    if (pass.kind === 'digit') {
      required.add(0);
      for (let digit = 0; digit < DIGIT_COUNT; digit += 1) {
        required.add(digitMask(digit));
      }
      continue;
    }
    const group = pass.group as PlateGroup;
    for (let subset = 0; subset < subsetCount(group); subset += 1) {
      required.add(groupMask(group, subset));
    }
  }
  return required;
}

/**
 * The masks `required` asks for that `table` cannot produce.
 *
 * Empty is closure. Exported so the conformance suite can run the same check
 * over the masks a ROM drives rather than over the masks a plan permits, without
 * a second implementation of "is it in the table".
 */
export function unreachablePlateMasks(
  table: readonly number[],
  required: Iterable<number>,
): readonly number[] {
  const vocabulary = new Set(table);
  const missing: number[] = [];
  for (const mask of required) {
    if (!vocabulary.has(mask)) {
      missing.push(mask);
    }
  }
  return Object.freeze(missing.sort((left, right) => left - right));
}

/** `%01011011` - how the assembly source and the design document spell a mask. */
export function formatPlateMask(mask: number): string {
  return `%${(mask & O_MASK).toString(2).padStart(O_PLATE_COUNT, '0')}`;
}

/** Grids this table is designed against. Re-exported so callers need one import. */
export { GRID_COUNT };
