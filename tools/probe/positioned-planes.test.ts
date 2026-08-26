// Can two planes stand in one row, and can two stand in one column?
//
// Paths in this file are relative to the repository root.
//
// ## What this exists to close, and why nothing before it could
//
// The owner reports both arrangements from the physical unit
// (`docs/evidence/owner-entity-model.md`): two planes at the same distance in
// different rows, and - the structural one - two planes in the same row.
// `docs/design/jet-model.md` records that the second was not merely absent from
// the emulation but **unrepresentable**: `FILE_JETS` held one nibble per lane and
// the nibble *was* the column, so a lane carried at most one jet and the lane WAS
// the row.
//
// Making it representable is a RAM layout, and a layout is not a behaviour. Two
// further things have to be true before the model is worth anything, and each of
// them can fail on its own:
//
//   - **Reachable.** The spawn path has to be able to produce the arrangement.
//     A layout that admits two planes in a row, with a `jet_enter` that gives
//     every entry a distinct row, is a model the machine can express and never
//     enters. That is the same defect one level up, and it would pass every
//     assertion written about the nibbles.
//   - **Handled.** Two planes in a row have to be independently hittable, and
//     two planes in a column have to be independently drawable. A collision test
//     that stops at the first slot kills the wrong plane or misses the second; a
//     render walk keyed on the lane draws one where there are two.
//
// ## Everything here is reached by playing, never by poking RAM
//
// No test in this file writes a nibble. The arrangements are produced by the
// ROM's own `jet_enter` under a drive that works the lever and the fire button,
// which is the whole point: writing `FILE_JETS` 10-13 directly would assert that
// the *layout* admits the arrangement, which is the part that was never in doubt.
// The vacuity floors below are what fail if the spawn path stops reaching it.
//
// ## What this does not claim
//
// It says nothing about *how often* either arrangement occurs, or about the rule
// that decides an entry row. `jet_enter` takes the row from a rotor today and
// takes it from `NIB_ENT` at task 14; both are covered by the same assertions
// here, because both have to keep producing the arrangements or this goes red.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect, vi } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';
import {
  Tms1370Machine,
  assembleGame,
  slotsOf,
  type Plane,
} from './tms1370-probe.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const SQUADRON = {
  base: symbol('FILE_JETS') * 16 + symbol('NIB_P_BASE'),
  stride: symbol('PLANE_STRIDE'),
  count: symbol('PLANE_COUNT'),
};
const FILE_MISS = symbol('FILE_MISS');
const NIB_MC = symbol('NIB_MC');
const FILE_STATE = symbol('FILE_STATE');
const NIB_KILLS = symbol('NIB_KILLS');
const NIB_STATE = symbol('NIB_STATE');
const FILE_D0 = symbol('FILE_D0');
const GRID_COL_FIRST = symbol('GRID_COL_FIRST');
const GRID_COL_LAST = symbol('GRID_COL_LAST');

/**
 * `OPLA_A_NEAR` is 0 and the near group is indices 0-7, so a near nibble of 0-7
 * is a bitmap of plates 0-2 - one plate per row. Above seven it is a FAR index
 * and says nothing about the squadron; `render-fidelity.test.ts` is what asserts
 * that never happens, and this file simply declines to read those samples.
 */
const NEAR_INDEX_MAX = 7;

/** Wall-clock allowance. Every bound that means anything is in cycles. */
const DRIVE_TIMEOUT_MS = 120_000;
vi.setConfig({ testTimeout: DRIVE_TIMEOUT_MS });

/**
 * Emulated seconds one drive plays.
 *
 * Not a machine-stop horizon and so not the kind of literal CLAUDE.md warns
 * about: the drive plays well enough that the game outlives it, and the run is a
 * *sampling* window rather than a wait for an ending. Measured, the shared-row
 * arrangement appears within the first ten seconds of every cadence below and
 * tens of times over the window; the floors are what report it if that changes.
 */
const DRIVE_SECONDS = 90;

/** Sampling interval. A march step is 32 sweeps at its fastest, far coarser. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/**
 * Firing cadences the roving drive pools over, in samples per lever-and-fire
 * block.
 *
 * One cadence fixes the phase between the squadron's march, the missile's step
 * and the entry countdown, and a fixed phase decides which arrangements the
 * spawn path happens to produce - the same lesson `missile-rank.test.ts` records
 * about the halves of its own pair. Three cadences vary that phase.
 */
const BLOCKS = [50, 60, 70] as const;

/**
 * A sweep, in cycles, as the aim-then-fire stagger every drive here obeys.
 *
 * The ROM samples the lever and the fire button in one pass and `tick_fire` is
 * edge triggered, so a lever moved in the same call as the press can arrive
 * after the button has been read and the shot goes down the *previous* lane.
 * Every drive in `tools/probe/` stages the two a sweep apart for this reason.
 */
const AIM_AHEAD_CYCLES = SWEEP_INSTRUCTIONS;

/** How long the fire contact is held, which is comfortably more than a sweep. */
const FIRE_HOLD_CYCLES = 3_000;

interface Frame {
  /** Both slots as the RAM holds them, empties included, in slot order. */
  readonly slots: readonly Plane[];
  /** The grid the player's shot in each lane stands on, 0 for none. */
  readonly missiles: readonly number[];
  /** Near nibble per grid: an index that, below 8, is a bitmap of plates 0-2. */
  readonly near: readonly number[];
  /** `NIB_KILLS`, which tells a shot-down plane from one that simply left. */
  readonly kills: number;
  /** The tube is being refreshed, so the near nibbles are a picture. */
  readonly refreshing: boolean;
}

/** Read one frame out of the machine's RAM. */
function frameOf(machine: Tms1370Machine): Frame {
  const ram = machine.ram;
  return {
    slots: slotsOf(ram, SQUADRON),
    missiles: [0, 1, 2].map((lane) => ram[FILE_MISS * 16 + NIB_MC + lane] as number),
    near: Array.from(
      { length: GRID_COL_LAST + 1 },
      (_unused, grid) => ram[FILE_D0 * 16 + grid] as number,
    ),
    kills: ram[FILE_STATE * 16 + NIB_KILLS] as number,
    refreshing: machine.isRefreshing(),
  };
}

/** The game has ended, so the squadron stops marching and stops spawning. */
function over(machine: Tms1370Machine): boolean {
  return (machine.ram[FILE_STATE * 16 + NIB_STATE] as number) !== 0;
}

/**
 * The roving drive: walk the lever round the three lanes, firing once a block.
 *
 * A player who is not aiming at anything in particular. This is what produces
 * the *variety* the arrangements need - entries land at whatever phase the
 * countdown reaches them at - and it is the drive the breadth floors read.
 */
function roving(block: number): readonly Frame[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const frames: Frame[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    const within = tick % block;
    machine.setContacts({
      lane: (Math.floor(tick / block) % 3) as 0 | 1 | 2,
      fire: within >= block / 2 && within < block / 2 + 5,
    });
    machine.step(SAMPLE_CYCLES);
    if (over(machine)) break;
    frames.push(frameOf(machine));
  }
  return frames;
}

/**
 * The hunting drive: when two planes share a row, shoot down that row.
 *
 * **The roving drive cannot carry the hittability claim and it is worth saying
 * why.** It reaches the shared-row arrangement often - hundreds of samples - but
 * it fires wherever the lever happens to be, so a shot that meets one of a
 * shared pair is a coincidence on top of a coincidence: measured, three cadences
 * over ninety seconds produced **four** such kills in total, all of them of the
 * same slot. A floor of one per slot over four events is a floor over noise.
 *
 * This drive goes looking instead. It aims at the row two planes are sharing and
 * fires whenever the barrel is free, which turns the same ninety seconds into
 * fifteen shared-row kills split across both slots - and, because it defends,
 * keeps the game alive for the whole window rather than losing three launchers
 * to the planes it is not shooting at.
 *
 * Which slot a shot meets is not this drive's choice: the missile flies inward
 * from grid 5 and meets whichever of the two stands deeper, and which slot that
 * is depends on the order they entered. That is exactly why both slots have to
 * turn up as the victim before "independently hittable" is established, and why
 * neither can be arranged for.
 */
function hunting(): readonly Frame[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const frames: Frame[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  let releaseAt = -1;
  let fireAt = -1;
  while (machine.cycles < until) {
    machine.step(SAMPLE_CYCLES);
    if (over(machine)) break;
    const frame = frameOf(machine);
    frames.push(frame);

    if (releaseAt > 0 && machine.cycles >= releaseAt) {
      machine.setContacts({ fire: false });
      releaseAt = -1;
      continue;
    }
    if (releaseAt > 0) continue;
    if (fireAt > 0 && machine.cycles >= fireAt) {
      machine.setContacts({ fire: true });
      releaseAt = machine.cycles + FIRE_HOLD_CYCLES;
      fireAt = -1;
      continue;
    }
    if (fireAt > 0) continue;
    // One shot at a time: `fire_missile` refuses a second in the same lane and
    // firing into a lane that already has one wastes the press.
    if (frame.missiles.some((column) => column !== 0)) continue;

    const planes = flying(frame);
    if (planes.length === 0) continue;
    const pair = sharesRow(frame) ? (planes[0] as Plane).row : undefined;
    const deepest = planes.reduce((best, plane) => (plane.column > best.column ? plane : best));
    machine.setContacts({ lane: (pair ?? deepest.row) as 0 | 1 | 2 });
    fireAt = machine.cycles + AIM_AHEAD_CYCLES;
  }
  return frames;
}

/**
 * The drifting drive: work the lever, never fire, and let the squadron come in.
 *
 * The only way the deep columns are reached at all. Both drives above shoot the
 * planes down before they get past grid 3, so a claim that the squadron uses the
 * whole playfield needs a run where nothing stops it - which is a run that loses,
 * in about twenty-five seconds, and that is fine: `over` ends it and the frames
 * up to there are the ones the breadth floor reads.
 */
function drifting(): readonly Frame[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const frames: Frame[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    machine.setContacts({ lane: (Math.floor(tick / 60) % 3) as 0 | 1 | 2 });
    machine.step(SAMPLE_CYCLES);
    if (over(machine)) break;
    frames.push(frameOf(machine));
  }
  return frames;
}

const ROVED: readonly (readonly Frame[])[] = BLOCKS.map(roving);
const HUNTED: readonly Frame[] = hunting();
const DRIFTED: readonly Frame[] = drifting();

/** Every frame of every drive, for the claims that are about the pool. */
const FRAMES: readonly Frame[] = [...ROVED.flat(), ...HUNTED, ...DRIFTED];

/** The airborne planes of a frame, empties dropped. */
function flying(frame: Frame): readonly Plane[] {
  return frame.slots.filter((plane) => plane.column !== 0);
}

/** The two slots hold planes and they are in the same row. */
function sharesRow(frame: Frame): boolean {
  const planes = flying(frame);
  return planes.length === 2 && (planes[0] as Plane).row === (planes[1] as Plane).row;
}

/**
 * The two slots hold planes at the same distance in **different rows**.
 *
 * The owner's claim is two planes at one distance in two rows, and that is what
 * this is. Two planes in the *same cell* - one row, one column - is a state the
 * layout also admits and the ROM does reach: measured, about 13% of the frames
 * where the two share a column. It is excluded here rather than counted, because
 * a cell has one near nibble with one bit for its row and "both are drawn" is
 * not a question that nibble can answer about it. {@link sameCell} is what keeps
 * that exclusion honest by counting what it removed.
 */
function sharesColumn(frame: Frame): boolean {
  const planes = flying(frame);
  return (
    planes.length === 2 &&
    (planes[0] as Plane).column === (planes[1] as Plane).column &&
    (planes[0] as Plane).row !== (planes[1] as Plane).row
  );
}

/** Both slots hold planes standing in the same cell: one row, one column. */
function sameCell(frame: Frame): boolean {
  const planes = flying(frame);
  return (
    planes.length === 2 &&
    (planes[0] as Plane).column === (planes[1] as Plane).column &&
    (planes[0] as Plane).row === (planes[1] as Plane).row
  );
}

/**
 * How many consecutive samples an arrangement must hold, while the tube is
 * being refreshed, before "it was never drawn" is a claim about the ROM.
 *
 * `render` runs at the end of a sweep, so an arrangement the march has just
 * produced is not on the glass until the next pass - the same lag
 * `render-fidelity.test.ts` allows for, and the same figure. An arrangement that
 * came and went inside one render cycle was never drawable; a march step is 32
 * sweeps at its very fastest, two orders of magnitude above this floor, so every
 * arrangement the squadron holds by marching is asserted over.
 */
const STALE_SAMPLES = 3;

/** An arrangement's identity, so a run of samples holding it can be grouped. */
function arrangementKey(frame: Frame): string {
  return frame.slots.map((plane) => `${plane.row}:${plane.column}`).join('|');
}

describe('two planes can stand in one row', () => {
  // The structural claim. `FILE_JETS`' old rank could not express this at all,
  // so a run that never produces it is a run against a machine that has not
  // actually changed - which is why the count is asserted before anything else
  // is said about it.
  const shared = FRAMES.filter(sharesRow);

  it('reaches the arrangement through the spawn path, with no RAM written', () => {
    // Nothing in this file writes a nibble: every plane below was placed by
    // `je_place` off the ROM's own entry countdown and row rotor. A `jet_enter`
    // that handed every entry a distinct row would take this to zero while
    // leaving the RAM layout, the march, the render and the collision test all
    // exactly as they are.
    expect(
      shared.length,
      'no two planes were ever in the same row, so the spawn path cannot reach the arrangement',
    ).toBeGreaterThan(0);

    // ...and in more than one row, so this is not one lucky coincidence in one
    // place. Two planes in row 1 and two planes in row 1 again is one fact.
    const rows = [...new Set(shared.map((frame) => (flying(frame)[0] as Plane).row))].sort();
    expect(rows.length, `the arrangement only ever occurred in row(s) ${rows}`).toBeGreaterThan(1);
  });

  it('reaches it on every firing cadence, not just a lucky phase', () => {
    // Per run rather than pooled. A single cadence fixes the phase between the
    // entry countdown and everything else, and a floor over the pool would let
    // two of the three contribute nothing.
    for (const [index, frames] of ROVED.entries()) {
      expect(
        frames.filter(sharesRow).length,
        `cadence ${BLOCKS[index]} never put two planes in one row`,
      ).toBeGreaterThan(0);
    }
    expect(HUNTED.filter(sharesRow).length, 'the hunting drive never saw one').toBeGreaterThan(0);
    // `drifting` is deliberately not required to see one. It never fires, so it
    // loses three launchers in about twenty-five seconds and the window it gives
    // is a quarter of the others'; it is pooled for the breadth floor below and
    // for nothing else.
  });

  it('lets a shot take either one of them and leave the other flying', () => {
    // ## What "independently hittable" is, read off the state
    //
    // Two planes in one row stand on different columns, so a shot down that row
    // meets one of them. The claim is that the ROM removes **that** one and
    // leaves the other where it was - which is precisely what a collision test
    // that stopped at the first slot, or that compared only columns, would get
    // wrong.
    //
    // Counted per *slot*, and both slots have to be the victim at least once.
    // A build whose hit test only ever reached slot 0 would still register kills
    // and would still leave a plane behind; what it could never do is take slot
    // 1 out of a shared row while slot 0 flew on.
    const takenWhileSharing = [0, 0];
    const survivedWhileSharing = [0, 0];
    for (let index = 1; index < HUNTED.length; index += 1) {
      const before = HUNTED[index - 1] as Frame;
      const after = HUNTED[index] as Frame;
      if (!sharesRow(before)) continue;
      // A kill and not a capture or a wave reset: `NIB_KILLS` counts shot-down
      // planes only, and a capture clears a column without touching it.
      if (after.kills <= before.kills) continue;
      for (const slot of [0, 1]) {
        const other = 1 - slot;
        const wasHit =
          (before.slots[slot] as Plane).column !== 0 && (after.slots[slot] as Plane).column === 0;
        const otherStillThere =
          (after.slots[other] as Plane).column === (before.slots[other] as Plane).column &&
          (after.slots[other] as Plane).row === (before.slots[other] as Plane).row;
        if (wasHit && otherStillThere) {
          takenWhileSharing[slot] = (takenWhileSharing[slot] as number) + 1;
          survivedWhileSharing[other] = (survivedWhileSharing[other] as number) + 1;
        }
      }
    }
    for (const slot of [0, 1]) {
      expect(
        takenWhileSharing[slot],
        `slot ${slot} was never the plane a shot took out of a shared row, ` +
          `so it has not been shown to be hittable there`,
      ).toBeGreaterThan(0);
      expect(
        survivedWhileSharing[slot],
        `slot ${slot} never survived a shot that took the other plane out of its row, ` +
          `so the two have not been shown to be independent`,
      ).toBeGreaterThan(0);
    }
  });

  it('never lets one shot take both planes out of a shared row', () => {
    // The other half of independence, and the failure a hit test that kept
    // walking after a match would produce. One missile, one plane.
    const doubles: string[] = [];
    for (let index = 1; index < FRAMES.length; index += 1) {
      const before = FRAMES[index - 1] as Frame;
      const after = FRAMES[index] as Frame;
      if (!sharesRow(before)) continue;
      if (flying(after).length !== 0) continue;
      // A wave that emptied because both planes were captured, or because the
      // squadron was cleared, is not one shot taking two: `NIB_KILLS` moving by
      // one is what a single kill looks like.
      if (after.kills - before.kills < 2) continue;
      doubles.push(
        `${(before.slots[0] as Plane).row}:${(before.slots[0] as Plane).column} and ` +
          `${(before.slots[1] as Plane).row}:${(before.slots[1] as Plane).column} went together`,
      );
    }
    expect(doubles.slice(0, 5), `${doubles.length} shots took two planes at once`).toEqual([]);
  });
});

describe('two planes can stand in one column', () => {
  const shared = FRAMES.filter(sharesColumn);

  it('reaches the arrangement through the spawn path', () => {
    expect(
      shared.length,
      'no two planes ever stood on the same column, so nothing below is being tested',
    ).toBeGreaterThan(0);
  });

  it('draws both of them, on the one near nibble that column has', () => {
    // ## Why this is a claim about the near group and not about two nibbles
    //
    // The tube has one near nibble per grid and it is an *index* into the output
    // PLA, not a bitmap the CPU can OR into. The near group holds all eight
    // subsets of plates 0-2 - `o-pla.ts` says so, and says it is because three
    // lanes can stand in one column - so a column holding two planes has a legal
    // index of its own, and `rd_jets` adds rather than overwrites to reach it.
    //
    // So "both are drawable" is: on a refreshing sample where two planes share a
    // column, the near nibble for that grid lights **both** their rows' plates.
    // A render walk that overwrote instead of adding, or that drew one plane per
    // lane, would light one of the two and this is what would say so.
    //
    // Asserted over each *stay* rather than over each sample, for the reason
    // {@link STALE_SAMPLES} gives: `render` runs at the end of a sweep, so the
    // sample in which the march produced an arrangement is a sample of the
    // previous frame. What has to be true is that an arrangement the squadron
    // holds long enough to draw was drawn - on at least one of the passes it
    // was up for.
    const undrawn: string[] = [];
    let checked = 0;
    let key = '';
    let wanted = 0;
    let grid = 0;
    let drawable = 0;
    let drawn = false;
    let from = 0;
    const closeStay = (): void => {
      if (wanted !== 0 && drawable >= STALE_SAMPLES) {
        checked += 1;
        if (!drawn) {
          undrawn.push(
            `two planes stood on grid ${grid} in rows ` +
              `${[0, 1, 2].filter((row) => (wanted >> row) & 1)} from sample ${from} for ` +
              `${drawable} lit samples and the near nibble never lit both`,
          );
        }
      }
    };
    FRAMES.forEach((frame, index) => {
      const now = sharesColumn(frame) ? arrangementKey(frame) : '';
      if (now !== key) {
        closeStay();
        key = now;
        drawable = 0;
        drawn = false;
        from = index;
        const planes = flying(frame);
        const column = now === '' ? 0 : (planes[0] as Plane).column;
        const onField = column >= GRID_COL_FIRST && column <= GRID_COL_LAST;
        grid = column;
        wanted = onField ? planes.reduce((bits, plane) => bits | (1 << plane.row), 0) : 0;
      }
      if (wanted === 0 || !frame.refreshing) return;
      const lit = frame.near[grid] as number;
      // A near nibble above seven is a FAR index and is not a plate bitmap at
      // all. `render-fidelity.test.ts` asserts that never happens; here it would
      // only make this test lie, so those samples are not counted either way.
      if (lit > NEAR_INDEX_MAX) return;
      drawable += 1;
      if ((lit & wanted) === wanted) drawn = true;
    });
    closeStay();

    // Non-vacuity first: a run that never held two planes on one column long
    // enough to draw has checked nothing, and would pass by never looking.
    expect(
      checked,
      'no arrangement of two planes on one column was ever held long enough to be drawn',
    ).toBeGreaterThan(0);
    expect(
      undrawn.slice(0, 5),
      `${undrawn.length} of ${checked} stays drew only one of two planes sharing a column`,
    ).toEqual([]);
  });

  it('is most of the two-planes-on-one-column case, and not the leftovers of it', () => {
    // Guards the reading of the test above rather than the ROM. Two planes in
    // the same *cell* share a column too, and the draw test excludes them
    // because one cell has one near bit and "both drawn" is not a question it
    // can answer. That exclusion is only honest while the excluded case is the
    // minority: if the ROM started putting almost every pair in one cell, the
    // test above would quietly be asserting over a handful of stays and this is
    // what reports it. Measured, same-cell is about an eighth of the pairs.
    const stacked = FRAMES.filter(sameCell).length;
    expect(
      shared.length / (shared.length + stacked),
      `${stacked} same-cell samples against ${shared.length} in different rows`,
    ).toBeGreaterThan(0.5);
  });
});

describe('the two arrangements are not the same run of luck', () => {
  it('produced planes in every row and on every playfield column', () => {
    // The breadth this file's other floors rest on. A drive that only ever put
    // planes in one row could satisfy "two in a row" and prove very little.
    const rows = new Set<number>();
    const columns = new Set<number>();
    for (const frame of FRAMES) {
      for (const plane of flying(frame)) {
        rows.add(plane.row);
        columns.add(plane.column);
      }
    }
    expect([...rows].sort(), 'the squadron never used every row').toEqual([0, 1, 2]);
    expect([...columns].sort((a, b) => a - b), 'the squadron never used every column').toEqual(
      [1, 2, 3, 4, 5],
    );
  });

  it('kept two planes airborne for a real share of the run', () => {
    // `planesOf` returning two is the precondition for both arrangements, and a
    // run where the second slot was almost always empty would make every count
    // above a handful of samples. Measured, both slots are full for most of it.
    const both = FRAMES.filter((frame) => flying(frame).length === 2).length;
    expect(both / FRAMES.length, 'the second slot was almost never in use').toBeGreaterThan(0.25);
  });
});
