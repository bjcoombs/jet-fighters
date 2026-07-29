// What this suite is for, and what it deliberately cannot do yet.
//
// Contract V4 (docs/contract/v3.contract.md; paths in this file are relative to
// the repository root) asks four things of the O output PLA. Two of them are
// this file's:
//
//   - the table has 32 slots and slot 0 is all plates dark;
//   - closure - every low-8 plate mask the ROM drives appears in the table -
//     with a mutation case present that alters one slot and expects the closure
//     assertion to fail, proving it is armed rather than vacuous.
//
// The other two are elsewhere by design. The *structural* conjunct - that the
// core's O write path is indexed by five bits and cannot express a mask absent
// from the table - is `src/machine/cpu/tms1370/opla.ts` and its own suite, and
// nothing here weakens or restates it. What this file adds is the *join*: that
// this table loads into `Tms1370OutputPla` whole, decodes through its five-bit
// index, and gives the core exactly the vocabulary designed and no wider one.
// The board conjunct - plates 8-11 from R11-R14 - is the port layer's.
//
// The scope this file keeps: closure is asserted over the *sweep plan* - the
// set of masks a ROM written against this design is able to ask for - rather
// than over one particular program. `unreachablePlateMasks` is exported so
// `tools/probe/rom-atlas-conformance.test.ts` runs the identical check over the
// masks its ROM actually drives, with no second implementation. The distinction
// is stated rather than papered over: a green run here is not yet a green V4.
//
// Node-side test: no DOM, no browser globals.

import { describe, expect, it } from 'vitest';
import {
  BANK_CROSSINGS_PER_SWEEP,
  DIGIT_BLANK_INDEX,
  DIGIT_COUNT,
  DIGIT_FIRST_INDEX,
  FAR_GROUP,
  GRID_BATTLESHIP,
  GRID_COLUMN_FIRST,
  GRID_COLUMN_LAST,
  GRID_COUNT,
  GRID_PLAYER,
  GRID_SCORE_TENS,
  GRID_SCORE_UNITS,
  INSTRUCTIONS_PER_BANK_CROSSING,
  INSTRUCTIONS_PER_STROBE,
  NEAR_GROUP,
  O_PLA_BANK_SIZE,
  O_PLA_DARK_INDEX,
  O_PLA_SLOT_COUNT,
  O_PLA_TABLE,
  PAIR_GROUP,
  PLATE_GROUPS,
  RESERVED_INDEX,
  SCORE_INDICATOR_LANE,
  SEVEN_SEGMENT_KEYS,
  SELECTION_INSTRUCTIONS_PER_SWEEP,
  STROBES_PER_SWEEP,
  SWEEP_PASSES,
  digitIndex,
  digitMask,
  formatPlateMask,
  groupIndex,
  groupMask,
  liveSubsetMask,
  requiredPlateMasks,
  sevenSegmentPlate,
  subsetCount,
  unreachablePlateMasks,
} from './o-pla.js';
import { O_MASK, O_PLATE_COUNT, O_PLA_INDEX_COUNT } from '../cpu/tms1370/ports.js';
import {
  O_INDEX_MASK,
  O_PLA_ENTRY_COUNT,
  O_RESET_INDEX,
  Tms1370OutputPla,
} from '../cpu/tms1370/opla.js';
import { loadAtlas } from '../tube/atlas.js';

const atlas = loadAtlas();

/** Every atlas segment addressed on a plate the O PLA governs. */
const oPortSegments = atlas.segments.filter((segment) => segment.plate < O_PLATE_COUNT);

describe('the table has the shape the hardware fixes', () => {
  it('holds exactly 32 slots', () => {
    expect(O_PLA_TABLE).toHaveLength(O_PLA_SLOT_COUNT);
    expect(O_PLA_SLOT_COUNT).toBe(O_PLA_INDEX_COUNT);
  });

  it('has slot 0 all plates dark, because reset writes index 0', () => {
    expect(O_PLA_TABLE[O_PLA_DARK_INDEX]).toBe(0);
  });

  it('holds an eight-bit plate mask in every slot', () => {
    for (const [index, mask] of O_PLA_TABLE.entries()) {
      expect(mask, `slot ${index}`).toBe(mask & O_MASK);
    }
  });

  it('leaves exactly one slot unspent, and it assembles to 0', () => {
    const declared = new Set<number>([DIGIT_BLANK_INDEX]);
    for (const group of PLATE_GROUPS) {
      for (let subset = 0; subset < subsetCount(group); subset += 1) {
        declared.add(groupIndex(group, subset));
      }
    }
    for (let digit = 0; digit < DIGIT_COUNT; digit += 1) {
      declared.add(digitIndex(digit));
    }
    const undeclared = Array.from({ length: O_PLA_SLOT_COUNT }, (_unused, index) => index).filter(
      (index) => !declared.has(index),
    );
    expect(undeclared).toEqual([RESERVED_INDEX]);
    expect(O_PLA_TABLE[RESERVED_INDEX]).toBe(0);
  });
});

describe('the table loads into the core the contract requires', () => {
  // The structural conjunct of V4 lives in src/machine/cpu/tms1370/opla.ts and is
  // tested there. What is asserted here is the join: this table is a legal one
  // for that type, every mask it holds is reachable only through a five-bit
  // index, and the vocabulary the core would have is exactly the vocabulary
  // designed. A table that had to be widened to fit would show up here.
  const pla = new Tms1370OutputPla(O_PLA_TABLE);

  it('fits the core table without truncation', () => {
    expect(O_PLA_SLOT_COUNT).toBe(O_PLA_ENTRY_COUNT);
    expect(pla.entries).toEqual([...O_PLA_TABLE]);
  });

  it('decodes every five-bit index to the mask this design assigns it', () => {
    for (let index = 0; index <= O_INDEX_MASK; index += 1) {
      expect(pla.decode(index), `index ${index}`).toBe(O_PLA_TABLE[index]);
    }
  });

  it('gives the core exactly this table vocabulary and no wider one', () => {
    expect([...pla.vocabulary].sort((left, right) => left - right)).toEqual(
      [...new Set(O_PLA_TABLE)].sort((left, right) => left - right),
    );
  });

  it('drives darkness at the index reset writes', () => {
    expect(O_RESET_INDEX).toBe(O_PLA_DARK_INDEX);
    expect(pla.decode(O_RESET_INDEX)).toBe(0);
  });
});

describe('the index layout is the rule, not a list', () => {
  it('puts each lane family where its own rule says', () => {
    for (const group of PLATE_GROUPS) {
      for (let subset = 0; subset < subsetCount(group); subset += 1) {
        expect(O_PLA_TABLE[groupIndex(group, subset)], `${group.name} subset ${subset}`).toBe(
          groupMask(group, subset),
        );
      }
    }
  });

  it('makes the low bits of a low-bank index the lane bitmap itself', () => {
    // The property the instruction cost rests on: a routine holding "which lanes
    // of this family are lit" already holds the index, so selection is a load
    // and a write rather than a lookup.
    for (let subset = 0; subset < subsetCount(NEAR_GROUP); subset += 1) {
      expect(groupIndex(NEAR_GROUP, subset)).toBe(subset);
      expect(O_PLA_TABLE[subset]).toBe(subset);
    }
    for (let subset = 0; subset < subsetCount(FAR_GROUP); subset += 1) {
      expect(groupIndex(FAR_GROUP, subset) - FAR_GROUP.firstIndex).toBe(subset);
    }
  });

  it('keeps the three lane families on disjoint plates that cover the O port', () => {
    const seen = new Set<number>();
    for (const group of PLATE_GROUPS) {
      for (let step = 0; step < group.plateCount; step += 1) {
        const plate = group.firstPlate + step;
        expect(seen.has(plate), `plate ${plate} claimed twice`).toBe(false);
        seen.add(plate);
      }
    }
    expect(seen.size).toBe(O_PLATE_COUNT);
  });

  it('passes a BCD digit through untouched, so no ROM decode table is needed', () => {
    for (let digit = 0; digit < DIGIT_COUNT; digit += 1) {
      expect(digitIndex(digit) - DIGIT_FIRST_INDEX).toBe(digit);
    }
    expect(DIGIT_FIRST_INDEX).toBe(O_PLA_BANK_SIZE);
  });

  it('gives the blank digit its own high-bank slot rather than reusing slot 0', () => {
    // Same pattern, different price: slot 0 is only reachable with the status
    // latch clear, and moving the latch costs three instructions the score
    // column would otherwise pay twice a sweep for a leading zero.
    expect(O_PLA_TABLE[DIGIT_BLANK_INDEX]).toBe(0);
    expect(DIGIT_BLANK_INDEX).toBeGreaterThanOrEqual(O_PLA_BANK_SIZE);
  });

  it('draws each digit with the conventional seven-segment shape', () => {
    expect(digitMask(0)).toBe(0b0111111);
    expect(digitMask(1)).toBe(0b0000110);
    expect(digitMask(8)).toBe(0b1111111);
    // Segment g is plate 6, so no digit ever reaches plate 7 - which is what
    // leaves plate 7 free for the hundreds indicator and the SCORE label.
    for (let digit = 0; digit < DIGIT_COUNT; digit += 1) {
      expect(digitMask(digit) & 0x80, `digit ${digit} on plate 7`).toBe(0);
    }
  });

  it('rejects an out-of-range subset or digit rather than wrapping', () => {
    expect(() => groupIndex(NEAR_GROUP, subsetCount(NEAR_GROUP))).toThrow(RangeError);
    expect(() => groupMask(PAIR_GROUP, -1)).toThrow(RangeError);
    expect(() => digitIndex(DIGIT_COUNT)).toThrow(RangeError);
    expect(() => sevenSegmentPlate('h')).toThrow(RangeError);
  });
});

describe('the sweep plan covers the tube', () => {
  it('claims every atlas segment on plates 0-7 exactly once', () => {
    // The atlas -> table direction. A family the plan forgot is a family the
    // ROM has no way to draw, and it would not show up as a missing mask -
    // requiredPlateMasks() derives from the plan, so an unclaimed family would
    // silently shrink both sides of closure at once.
    const claims = new Map<string, string[]>();
    for (const segment of oPortSegments) {
      claims.set(`${segment.grid}-${segment.plate}`, []);
    }
    for (const pass of SWEEP_PASSES) {
      for (const grid of pass.grids) {
        const plates =
          pass.kind === 'digit'
            ? SEVEN_SEGMENT_KEYS.map((key) => sevenSegmentPlate(key))
            : Array.from(
                { length: (pass.group as typeof NEAR_GROUP).plateCount },
                (_unused, step) => step,
              )
                .filter((lane) => (liveSubsetMask(pass, grid) >> lane) & 1)
                .map((lane) => (pass.group as typeof NEAR_GROUP).firstPlate + lane);
        for (const plate of plates) {
          claims.get(`${grid}-${plate}`)?.push(pass.name);
        }
      }
    }
    const unclaimed = [...claims.entries()].filter(([, by]) => by.length === 0);
    const contested = [...claims.entries()].filter(([, by]) => by.length > 1);
    expect(unclaimed, 'segments no pass draws').toEqual([]);
    expect(contested, 'segments two passes both draw').toEqual([]);
  });

  it('keeps the pair pass off plate 6 on the score grids', () => {
    // Plate 6 is segment g of the digit there. A pair strobe with lane 0 set
    // would put a stray bar through the numeral at half brightness, which reads
    // as a renderer fault rather than a ROM one - so the restriction is a rule
    // with a name and not a comment task 8 has to remember.
    const pair = SWEEP_PASSES.find((pass) => pass.group === PAIR_GROUP);
    expect(pair).toBeDefined();
    for (const grid of [GRID_SCORE_TENS, GRID_SCORE_UNITS]) {
      expect(liveSubsetMask(pair as (typeof SWEEP_PASSES)[number], grid)).toBe(
        SCORE_INDICATOR_LANE,
      );
    }
    for (const grid of [GRID_BATTLESHIP, GRID_PLAYER]) {
      expect(liveSubsetMask(pair as (typeof SWEEP_PASSES)[number], grid)).toBe(
        subsetCount(PAIR_GROUP) - 1,
      );
    }
  });

  it('visits every grid the hardware has', () => {
    const visited = new Set(SWEEP_PASSES.flatMap((pass) => [...pass.grids]));
    expect([...visited].sort((left, right) => left - right)).toEqual(
      Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
    );
  });

  it('names the grids the atlas actually addresses those families on', () => {
    const gridsOf = (pattern: RegExp): number[] =>
      [...new Set(atlas.segments.filter((s) => pattern.test(s.id)).map((s) => s.grid))].sort(
        (left, right) => left - right,
      );
    expect(gridsOf(/^battleship_lane[0-2]$/)).toEqual([GRID_BATTLESHIP]);
    expect(gridsOf(/^jet_lane[0-2]_col[1-5]$/)).toEqual(
      Array.from({ length: GRID_COLUMN_LAST - GRID_COLUMN_FIRST + 1 }, (_u, i) => GRID_COLUMN_FIRST + i),
    );
    expect(gridsOf(/^launcher_lane[0-2]$/)).toEqual([GRID_PLAYER]);
    expect(gridsOf(/^score_tens_seg[a-g]$/)).toEqual([GRID_SCORE_TENS]);
    expect(gridsOf(/^score_units_seg[a-g]$/)).toEqual([GRID_SCORE_UNITS]);
  });

  it('skips a grid whose family has nothing on it rather than strobing darkness', () => {
    // 24 strobes and not 36. The saving is the whole reason the design document
    // can quote a duty of 1/24 rather than 1/36.
    expect(STROBES_PER_SWEEP).toBe(24);
    expect(STROBES_PER_SWEEP).toBeLessThan(SWEEP_PASSES.length * GRID_COUNT);
  });

  it('crosses the status-latch bank exactly twice a sweep', () => {
    // YNEA is the only instruction that loads the latch, so a plan that
    // interleaved banks per grid would pay three instructions a grid for it.
    expect(BANK_CROSSINGS_PER_SWEEP).toBe(2);
    const banks = SWEEP_PASSES.map((pass) => pass.statusLatch);
    expect(banks).toEqual([0, 0, 1, 1]);
  });

  it('agrees with the table about which bank each pass indexes', () => {
    for (const pass of SWEEP_PASSES) {
      const indices =
        pass.kind === 'digit'
          ? [...Array.from({ length: DIGIT_COUNT }, (_u, d) => digitIndex(d)), DIGIT_BLANK_INDEX]
          : Array.from({ length: subsetCount(pass.group as typeof NEAR_GROUP) }, (_u, subset) =>
              groupIndex(pass.group as typeof NEAR_GROUP, subset),
            );
      for (const index of indices) {
        expect(index >= O_PLA_BANK_SIZE ? 1 : 0, `${pass.name} index ${index}`).toBe(
          pass.statusLatch,
        );
      }
    }
  });
});

describe('closure: the ROM cannot ask for a mask the table has not got', () => {
  it('reaches every mask the sweep plan can ask for', () => {
    const missing = unreachablePlateMasks(O_PLA_TABLE, requiredPlateMasks());
    expect(missing.map(formatPlateMask)).toEqual([]);
  });

  it('is armed: altering one slot makes closure fail', () => {
    // The mutation case V4 requires. It picks a slot whose mask nothing else in
    // the table produces - several masks are reachable twice over (digit 7 and
    // the full near triple are both %00000111), and mutating one of those would
    // leave closure green and prove nothing.
    const occurrences = new Map<number, number>();
    for (const mask of O_PLA_TABLE) {
      occurrences.set(mask, (occurrences.get(mask) ?? 0) + 1);
    }
    const victim = O_PLA_TABLE.findIndex(
      (mask, index) => index !== O_PLA_DARK_INDEX && occurrences.get(mask) === 1,
    );
    expect(victim, 'no uniquely-reachable slot to mutate').toBeGreaterThan(0);

    const mutated = [...O_PLA_TABLE];
    const lost = mutated[victim] as number;
    mutated[victim] = 0;

    const missing = unreachablePlateMasks(mutated, requiredPlateMasks());
    expect(missing, `mutating slot ${victim} (${formatPlateMask(lost)}) went unnoticed`).toEqual([
      lost,
    ]);
  });

  it('is armed in the other direction too: an emptied table fails wholesale', () => {
    const dark = new Array<number>(O_PLA_SLOT_COUNT).fill(0);
    const missing = unreachablePlateMasks(dark, requiredPlateMasks());
    expect(missing.length).toBe(requiredPlateMasks().size - 1); // all but darkness
  });

  it('reports nothing missing for a mask set the table happens to cover', () => {
    expect(unreachablePlateMasks(O_PLA_TABLE, [0, 0x38, 0xc0])).toEqual([]);
    expect(unreachablePlateMasks(O_PLA_TABLE, [0x39])).toEqual([0x39]);
  });
});

describe('selecting an index is bounded, and the bound is small', () => {
  it('costs two instructions a strobe whatever the game is doing', () => {
    // TMA from the nibble the game logic maintains, then TDO. No branch, no
    // table walk, no dependence on how much is on the tube.
    expect(INSTRUCTIONS_PER_STROBE).toBe(2);
  });

  it('costs three instructions a bank crossing, and there are two', () => {
    // CLA; TCY k; YNEA - the only route to the status latch on this core.
    expect(INSTRUCTIONS_PER_BANK_CROSSING).toBe(3);
    expect(SELECTION_INSTRUCTIONS_PER_SWEEP).toBe(
      STROBES_PER_SWEEP * INSTRUCTIONS_PER_STROBE +
        BANK_CROSSINGS_PER_SWEEP * INSTRUCTIONS_PER_BANK_CROSSING,
    );
  });

  it('stays under a tenth of a sweep at the rate the research document records', () => {
    // ~91 instructions per grid dwell x 9 grids is the sweep budget V4 measures
    // an "unbounded selection cost" against. Named here rather than inlined so
    // the comparison moves with the rate when task 9's provisional figure firms
    // up; the assertion is the ratio, not the rate.
    const INSTRUCTIONS_PER_GRID_DWELL = 91;
    const sweepBudget = INSTRUCTIONS_PER_GRID_DWELL * GRID_COUNT;
    expect(SELECTION_INSTRUCTIONS_PER_SWEEP / sweepBudget).toBeLessThan(0.1);
  });
});
