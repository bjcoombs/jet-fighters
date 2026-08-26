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
// that decides an entry position. `jet_enter` took the row from a plain rotor and
// now takes both row and column from `NIB_ENT` and the release count; both are
// covered by the same assertions here, because both have to keep producing the
// arrangements or this goes red.
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
const NIB_HITS = symbol('NIB_HITS');
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
  /** `NIB_HITS`, the launchers lost - a capture or a rocket takes one. */
  readonly hits: number;
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
    hits: ram[FILE_STATE * 16 + NIB_HITS] as number,
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

/**
 * The staggering drive: break the squadron's lockstep, then let one through.
 *
 * **A squadron of two marching on one countdown arrives together**, which is the
 * awkward fact the retreat assertion ran into: the drifting drive's only capture
 * had both planes on grid 5, so both crossed, nothing survived, and the rule
 * about what survivors do was never exercised. Neither shooting drive helps -
 * they are too good, and shoot everything down before it arrives.
 *
 * So this one shoots exactly once per lockstep: when both planes stand on the
 * same column it takes one of them, which brings a replacement in at the far end
 * while the other carries on. From then the two are a whole entry apart, the
 * deep one reaches the G line alone, and the capture has something left to send
 * back. It fires at nothing else, so the plane that is going to cross is never
 * the one it shoots at.
 */
function staggering(skill: 1 | 2 | 3): readonly Frame[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane: 0, fire: false });
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
    if (frame.missiles.some((column) => column !== 0)) continue;

    const planes = flying(frame);
    // Only a lockstep is worth a shot, and only while the pair is still far
    // enough out that the missile can reach them before they step again.
    if (planes.length !== 2) continue;
    if ((planes[0] as Plane).column !== (planes[1] as Plane).column) continue;
    if ((planes[0] as Plane).column > GRID_COL_LAST - 1) continue;
    machine.setContacts({ lane: (planes[0] as Plane).row as 0 | 1 | 2 });
    fireAt = machine.cycles + AIM_AHEAD_CYCLES;
  }
  return frames;
}

const ROVED: readonly (readonly Frame[])[] = BLOCKS.map(roving);
const STAGGERED: readonly (readonly Frame[])[] = ([1, 2, 3] as const).map(staggering);
const HUNTED: readonly Frame[] = hunting();
const DRIFTED: readonly Frame[] = drifting();

/** Every drive as its own run, for the claims that are about independence. */
const ALL_DRIVES: readonly (readonly Frame[])[] = [
  ...ROVED,
  HUNTED,
  DRIFTED,
  ...STAGGERED,
];

/** Every frame of every drive, for the claims that are about the pool. */
const FRAMES: readonly Frame[] = ALL_DRIVES.flat();

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

/**
 * Samples to look back over for the squadron shrinking around a lost launcher.
 *
 * Six samples is 30 ms, about two sweeps at the measured rate. `jm_capture`
 * clears the crossing plane's column inside the march walk and `launcher_down`
 * increments `NIB_HITS` after the walk finishes, so the two land in the same
 * *sweep* but not reliably in the same 5 ms sample.
 */
/**
 * Samples to wait for the retreat to land after a plane crosses the G line.
 *
 * **The retreat is not in the same sweep as the crossing**, and the gap is a
 * sound rather than slack: `jm_capture` clears the column inside the march walk,
 * and `sr_lost` is reached only after the walk finishes and `jm_beep` has played
 * the 70.2 ms march note. Thirty samples is 150 ms, comfortably past it and far
 * short of the next march step.
 */
const RETREAT_SETTLE_SAMPLES = 30;

/** The plane slots, by index, so a walk over them reads from the ROM's count. */
const slotIndices = [...Array(SQUADRON.count).keys()];

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

  it('reaches it on more than one independent drive, not one lucky phase', () => {
    // **Counted per drive, and deliberately not per firing cadence.** Which
    // entries land on the same rotor value is emergent: the rotor advances once
    // a sweep while both slots are busy, so the row a plane gets depends on the
    // phase between the entry countdown, the march and the drive's own schedule.
    // An earlier form of this required every roving cadence to reach the
    // arrangement, and a change to `rd_jets` that altered the sweep by three
    // instructions - a *rendering* change, with no gameplay in it - moved two of
    // the three to zero. That floor was measuring the phase, not the model.
    //
    // What is worth asserting is that the arrangement is not the property of one
    // drive. Measured, four of the eight runs here reach it and four do not.
    const reaching = ALL_DRIVES.filter((frames) => frames.some(sharesRow)).length;
    expect(
      reaching,
      `only ${reaching} of ${ALL_DRIVES.length} drives ever put two planes in one row`,
    ).toBeGreaterThan(1);
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

  it('draws two planes in one cell as that cell, and never as a far index', () => {
    // ## The case the near nibble cannot be *added* into
    //
    // Two planes in the same cell - one row, one column - is a state the layout
    // admits and `jet_enter` reaches, and it is where `rd_jets` adding each
    // plane's plate bit stops being an OR. The near nibble is an index into the
    // O PLA whose 0-7 are the bitmaps of plates 0-2, so adding the same bit
    // twice carries: 1 and 1 make 2, 2 and 2 make 4, and 4 and 4 make **8**,
    // which is outside the near group altogether and selects a FAR mask.
    //
    // Measured on the ROM that added: **2569 of 2674** lit samples with two
    // planes in one cell drew the wrong plate. `render-fidelity.test.ts` did not
    // report it, because its own justification window ORs over recent samples
    // and a plane that had lately been in the neighbouring row justifies the
    // wrong bit; and the draw test above deliberately excludes same-cell pairs,
    // because a cell has one plate and "both drawn" is not a question it can
    // answer. So this is the assertion that owns the case.
    const lit = FRAMES.filter((frame) => frame.refreshing && sameCell(frame));
    expect(
      lit.length,
      'no lit sample ever had two planes in one cell, so nothing here is tested',
    ).toBeGreaterThan(0);

    // **The far index is absolute and takes no lag allowance.** A near nibble
    // above seven is not a stale near value, it is not a near value at all - it
    // selects a FAR mask and paints the attackers' rockets into cells no rocket
    // is in. No render lag can produce one from a legal history, so a single
    // occurrence is a fault.
    const farIndex = lit
      .filter((frame) => (frame.near[(flying(frame)[0] as Plane).column] as number) > NEAR_INDEX_MAX)
      .map((frame) => {
        const plane = flying(frame)[0] as Plane;
        return `two planes in row ${plane.row} on grid ${plane.column} drove the near pass a ` +
          `far index of ${frame.near[plane.column]}`;
      });
    expect(
      farIndex.slice(0, 5),
      `${farIndex.length} of ${lit.length} same-cell samples left the near group`,
    ).toEqual([]);

    // **That the cell is lit at all is asserted per stay**, for the reason
    // STALE_SAMPLES gives: the sample in which the march produced an
    // arrangement is a sample of the previous frame, so a per-sample form would
    // report the render's own lag as a fault.
    const undrawn: string[] = [];
    let checked = 0;
    let key = '';
    let want = -1;
    let grid = 0;
    let drawable = 0;
    let drawn = false;
    const closeStay = (): void => {
      if (want >= 0 && drawable >= STALE_SAMPLES) {
        checked += 1;
        if (!drawn) {
          undrawn.push(
            `two planes stood in row ${want} on grid ${grid} for ${drawable} lit samples ` +
              'and that plate was never lit',
          );
        }
      }
    };
    FRAMES.forEach((frame) => {
      const now = sameCell(frame) ? arrangementKey(frame) : '';
      if (now !== key) {
        closeStay();
        key = now;
        drawable = 0;
        drawn = false;
        const plane = flying(frame)[0];
        const onField =
          now !== '' &&
          (plane as Plane).column >= GRID_COL_FIRST &&
          (plane as Plane).column <= GRID_COL_LAST;
        want = onField ? (plane as Plane).row : -1;
        grid = onField ? (plane as Plane).column : 0;
      }
      if (want < 0 || !frame.refreshing) return;
      const near = frame.near[grid] as number;
      if (near > NEAR_INDEX_MAX) return; // asserted absolutely above
      drawable += 1;
      if (((near >> want) & 1) !== 0) drawn = true;
    });
    closeStay();
    expect(
      checked,
      'no two-planes-in-one-cell arrangement was held long enough to be drawn',
    ).toBeGreaterThan(0);
    expect(
      undrawn.slice(0, 5),
      `${undrawn.length} of ${checked} same-cell stays never lit their own plate`,
    ).toEqual([]);
  });

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

describe('a capture sends the survivors back to the far end', () => {
  // ## The rule, and why it needs an assertion of its own
  //
  // OWNER-CONFIRMED, and recorded at `sr_lost`: when a jet takes a launcher,
  // every jet still airborne returns to the far side of the field, so the next
  // capture costs the squadron a whole fresh advance rather than the next march
  // step. Without it the three launchers go on three consecutive steps, which is
  // a cascade rather than a difficulty.
  //
  // **Nothing asserted the rule until now, only the spacing it produces**, and
  // the spacing assertions are about which lane lost a launcher rather than
  // about where the survivors ended up. That is how `sr_retreat` came through
  // the move to positioned planes still walking the retired lane rank at nibbles
  // 0-2: it wrote `GRID_COL_FIRST` into three nibbles nothing reads, the retreat
  // stopped happening, and the whole suite stayed green. CodeRabbit caught it on
  // the pull request; this is what would have.
  //
  // ## The capture is read off the squadron, not off `NIB_HITS`
  //
  // **`NIB_HITS` is about 70 ms too late**, and that is a march beep rather than
  // a sampling artefact. `jm_capture` clears the crossing plane's column inside
  // the walk; the walk then finishes, plays the 70.2 ms march note, reloads the
  // countdown, and only then reaches `sr_lost` and `launcher_down`. So by the
  // time the launcher count moves, the retreat has already happened - keying on
  // it looks at the state afterwards and reports that nothing was ever forward.
  // Measured on a run where the pair was at grid 5 and grid 4: the crossing
  // shows at t=11.24 s with the survivor still on 5, and `NIB_HITS` moves at
  // t=11.31 s with it already back on 1.
  //
  // So a capture is "a slot's column went to zero while `NIB_KILLS` did not
  // move" - a plane that left the field rather than one that was shot down.
  // **What is asserted is the survivor's next move, not its column at a fixed
  // offset.** A fixed offset cannot work here and the reason is worth writing
  // down: too short and the retreat has not landed (it is a march note away);
  // too long and the survivor has taken its next march step, so a plane that
  // correctly went back to grid 1 reads as grid 2 and the assertion fails on a
  // ROM that is right. Both failures were measured before this shape was
  // settled on. The rule itself is about a transition - the first thing a
  // survivor does after a capture is go back to the far column - so that is what
  // is read.
  //
  // Only survivors that were *forward* of the far column are asserted over. One
  // already standing on grid 1 has nowhere to retreat to and proves nothing;
  // counting it would let this pass on a ROM with no retreat at all, which is
  // the state this branch shipped in for one commit.
  const captures = ALL_DRIVES.flatMap((frames) => {
    const found: { from: number; next: number | undefined }[] = [];
    for (let index = 1; index < frames.length; index += 1) {
      const before = frames[index - 1] as Frame;
      const after = frames[index] as Frame;
      if (after.kills !== before.kills) continue; // shot down, or a fresh wave
      const crossed = slotIndices.filter(
        (slot) =>
          (before.slots[slot] as Plane).column !== 0 &&
          (after.slots[slot] as Plane).column === 0,
      );
      if (crossed.length === 0) continue;
      // **`NIB_KILLS` not having moved in this one frame pair is not enough to
      // say the plane crossed rather than died, and one misread is one survivor
      // asserted over that never had a retreat coming.** The nibble lags the
      // column clear the same way `NIB_HITS` does, by less than the 5 ms sample
      // interval: measured, a plane shot down at four kills read as a capture
      // here because the column had gone to zero and the count moved in the next
      // sample. So a capture is confirmed by what it costs - a launcher - and
      // `NIB_HITS` rising inside the settle window is the positive signal. A kill
      // never moves it.
      const settle = frames.slice(index + 1, index + 1 + RETREAT_SETTLE_SAMPLES);
      if (!settle.some((frame) => frame.hits !== before.hits)) continue;
      for (const slot of slotIndices) {
        if (crossed.includes(slot)) continue;
        const at = (after.slots[slot] as Plane).column;
        if (at <= GRID_COL_FIRST) continue; // empty, or nowhere to go
        // **A survivor is a plane that was already airborne when the capture
        // happened.** It has to be said outright now that `jet_enter` can place
        // a plane at grid 2 as well as grid 1: a plane that entered *during* the
        // capture is not a survivor, has nothing to retreat from, and sits where
        // it entered until its next march step - which reads exactly like a
        // survivor that refused to retreat, and did, once. The old
        // `at <= GRID_COL_FIRST` line filtered fresh entries out by accident,
        // because every entry landed on grid 1; that accident is over.
        if ((before.slots[slot] as Plane).column !== at) continue;
        // The first column this slot reads as, other than the one it was
        // standing on when the capture happened. A run that ends before it moves
        // contributes `undefined` and is reported rather than ignored.
        const window = settle;
        // **A capture that took the third launcher ends the run**, so the
        // survivor is frozen where it stood and has no next move to read. That
        // is the machine stopping rather than the retreat failing, and a short
        // window is exactly how it presents - so it is dropped here rather than
        // reported as a straggler. Every drive stops sampling at `ST_OVER`, so a
        // window that is short is a window that ran into the ending.
        if (window.length < RETREAT_SETTLE_SAMPLES) continue;
        const next = window
          .map((frame) => (frame.slots[slot] as Plane).column)
          .find((column) => column !== at);
        found.push({ from: at, next });
      }
    }
    return found;
  });

  it('produced a capture with a survivor forward of the far column, or this proves nothing', () => {
    // A squadron of two marching on one countdown used to be in lockstep 66% of
    // the time - measured, when every plane entered at grid 1 - so most captures
    // took both planes together and left nothing to send back. Entry positions
    // drawn from the entropy nibble moved that to 36% zero, 54% one grid apart
    // and 10% two (`tools/probe/drives/entry-spread.ts`), so survivors are more
    // common than they were. This floor is what says the rule was exercised at
    // all, and it is the one that fails if a later change makes the two planes
    // arrive together every time.
    expect(
      captures.length,
      'no capture left a plane standing forward of the far column, so the retreat was never reached',
    ).toBeGreaterThan(0);
    // ...and the ones that were shot down inside the window do not count toward
    // it, or the floor above could be met entirely by planes the rule never
    // touched.
    const retreating = captures.filter(({ next }) => next !== 0).length;
    expect(
      retreating,
      `all ${captures.length} survivors left the field before the retreat could land`,
    ).toBeGreaterThan(0);
  });

  it('sends every one of them back to the far column, and nowhere else', () => {
    // **A survivor that left the field before the retreat landed is not this
    // rule's business.** The retreat is a march note behind the crossing, and a
    // player's missile can reach the survivor inside that window - measured, one
    // did, from grid 2. It reads as a column of 0, which is a plane that was shot
    // down rather than one that marched on, so excluding it cannot hide the
    // failure this test is for: a ROM with no retreat leaves the survivor
    // *marching*, at a column one further in, never at zero.
    const wrong = captures
      .filter(({ next }) => next !== GRID_COL_FIRST && next !== 0)
      .map(({ from, next }) =>
        next === undefined
          ? `a survivor on grid ${from} never moved again`
          : `a survivor on grid ${from} went to ${next} rather than ${GRID_COL_FIRST}`,
      );
    expect(
      wrong.slice(0, 5),
      `${wrong.length} of ${captures.length} survivors did not retreat`,
    ).toEqual([]);
  });
});
