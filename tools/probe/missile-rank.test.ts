// Does the collision test run for every lane, or only for the one that is easy?
//
// Paths in this file are relative to the repository root.
//
// ## The gap this exists to close
//
// `render-fidelity.test.ts` proves shots EXIST in more than one lane. Nothing
// before this file proved that the LEAVE/ARRIVE pair runs for all of them. A
// build that walked three shots and hit-tested only lane 0 would pass every
// assertion in that file, because each of them is about where a shot is drawn
// rather than about what happens when it meets a jet.
//
// The failure is not hypothetical. `missile_walk` carries its loop index in
// `NIB_MWORK` in RAM rather than in a register, precisely because the kill arm
// crosses into chapter 1 and clobbers X, Y and A; an index that failed to
// advance, or a `mw_next` that fell out of the walk early, leaves lanes 1 and 2
// drawn and stepped and never hit-tested. That is a silent defect: the shot
// passes through the jet and both carry on.
//
// ## What a pass-through is, and why it is read off state rather than off sound
//
// A shot and a jet in the same lane on the same column is a *coincidence*. The
// ROM must resolve it by killing the jet - `mw_live` before the step (the jet
// is standing where the shot already is) or `mw_arrive` after it (the jet is
// standing where the shot has just moved to). So a coincidence that ends with
// the shot **stepping onward to a lower column** rather than clearing is a
// pass-through, and is exactly the defect above.
//
// Read off `FILE_MISS` and the plane slots rather than off the kill sound, because
// the sound says a kill happened somewhere and this file's whole question is
// *which lane*. `NIB_KILLS` is read too, but only to distinguish a kill from a
// shot that simply expired against the horizon.
//
// ## Both halves are covered separately, per lane
//
// A build that dropped one of the two tests would still pass the other, so
// LEAVE and ARRIVE are counted apart. Six assertions, never fewer: a
// pass-through count per lane per half, each asserted zero, each with its own
// non-vacuity floor. A lane that never produced a coincidence has proved
// nothing about that lane, which is the shape `tms1370-rom.test.ts` names.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect, vi } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, assembleGame, planesOf, rowColumns, squadronMap } from './tms1370-probe.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const FILE_MISS = symbol('FILE_MISS');
const FILE_STATE = symbol('FILE_STATE');
const NIB_MC = symbol('NIB_MC');
const NIB_KILLS = symbol('NIB_KILLS');
const SQUADRON = squadronMap(ASM);
const LANE_COUNT = symbol('LANE_COUNT');

/** Wall-clock allowance. The bounds that mean anything are all in cycles. */
const DRIVE_TIMEOUT_MS = 120_000;
vi.setConfig({ testTimeout: DRIVE_TIMEOUT_MS });

/**
 * Emulated seconds the drive plays.
 *
 * Long enough for many waves: a coincidence needs a jet and a shot to meet in
 * the same lane on the same column, and the drive has no way to force one - it
 * fires into every lane repeatedly and lets the march bring jets onto the
 * shots. 90 s produces coincidences in all three lanes with room to spare; the
 * non-vacuity floors below are what fail if that ever stops being true.
 */
const DRIVE_SECONDS = 90;

/** Sampling interval. A missile step is 32 sweeps, so this is far finer. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/**
 * The lever walks the lanes and taps fire once settled in each.
 *
 * Obeys the aiming rule `tms1370-probe.ts` sets out - the lever must settle for
 * at least one sweep before the press or the shot goes down whichever lane the
 * lever held last. It settles for half the block, which is many sweeps.
 */
const BLOCKS = [50, 60, 70] as const;

interface Frame {
  readonly missiles: readonly number[];
  /**
   * Per lane, the grids a plane stands on in that lane, as a bitmap.
   *
   * A bitmap and not a column, and that is the whole of what the positioned
   * model changed here. `FILE_JETS[lane]` used to be *the* jet in that lane,
   * because a lane held at most one; two planes can now be in one row, and a
   * reader that returned one column per row would drop the second - which is
   * precisely the plane a collision test is most likely to miss. So the
   * coincidence test below asks "is any plane standing on the shot's column"
   * rather than "is the lane's jet on it".
   */
  readonly jets: readonly number[];
  readonly kills: number;
}

function drive(BLOCK: number): readonly Frame[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const frames: Frame[] = [];
  let tick = 0;
  const until = DRIVE_SECONDS * CYCLE_HZ;
  while (machine.cycles < until) {
    const within = tick % BLOCK;
    machine.setContacts({
      lane: (Math.floor(tick / BLOCK) % LANE_COUNT) as 0 | 1 | 2,
      fire: within >= BLOCK / 2 && within < BLOCK / 2 + 5,
    });
    tick += 1;
    machine.step(SAMPLE_CYCLES);
    const ram = machine.ram;
    frames.push({
      missiles: Array.from({ length: LANE_COUNT }, (_u, l) => ram[FILE_MISS * 16 + NIB_MC + l] as number),
      jets: (() => {
        const planes = planesOf(ram, SQUADRON);
        return Array.from({ length: LANE_COUNT }, (_u, l) => rowColumns(planes, l));
      })(),
      kills: ram[FILE_STATE * 16 + NIB_KILLS] as number,
    });
  }
  return frames;
}

interface LaneTally {
  /** Coincidences where the jet already stood on the shot's column. */
  leaveSeen: number;
  /** Coincidences where the jet stood on the column the shot stepped into. */
  arriveSeen: number;
  /** Of those, the ones the shot walked away from without a kill. */
  leavePassed: number;
  arrivePassed: number;
}

/**
 * Walk the frames and classify every coincidence in every lane.
 *
 * The state machine is per lane and deliberately small: remember the last frame
 * in which this lane's shot coincided with this lane's jet, and which half of
 * the pair it was, then look at what the shot does next. Clearing is a kill
 * (confirmed against `NIB_KILLS`, so a shot that expired against the horizon is
 * not miscounted as one); stepping to a lower non-zero column is a pass-through.
 */
function tally(frames: readonly Frame[]): readonly LaneTally[] {
  const tallies: LaneTally[] = Array.from({ length: LANE_COUNT }, () => ({
    leaveSeen: 0,
    arriveSeen: 0,
    leavePassed: 0,
    arrivePassed: 0,
  }));
  // Per lane: the column a coincidence was standing on, and which half it was.
  const pending: ({ column: number; half: 'leave' | 'arrive' } | undefined)[] = new Array(
    LANE_COUNT,
  ).fill(undefined);

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1] as Frame;
    const current = frames[i] as Frame;
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const wasShot = previous.missiles[lane] as number;
      const nowShot = current.missiles[lane] as number;
      const wasJet = previous.jets[lane] as number;
      const nowJet = current.jets[lane] as number;
      const tallyLane = tallies[lane] as LaneTally;
      const open = pending[lane];

      // Resolve an open coincidence the moment the shot's column moves.
      if (open !== undefined && nowShot !== open.column) {
        const killed = nowShot === 0 && current.kills !== previous.kills;
        if (!killed && nowShot !== 0 && nowShot < open.column) {
          if (open.half === 'leave') tallyLane.leavePassed += 1;
          else tallyLane.arrivePassed += 1;
        }
        pending[lane] = undefined;
      }

      if (nowShot === 0) {
        continue;
      }
      // LEAVE: the jet was already standing on the shot's column before the
      // step. ARRIVE: the jet stands on the column the shot has just entered.
      if ((nowJet & (1 << nowShot)) !== 0) {
        const half: 'leave' | 'arrive' = nowShot === wasShot ? 'leave' : 'arrive';
        if (pending[lane] === undefined) {
          if (half === 'leave') tallyLane.leaveSeen += 1;
          else tallyLane.arriveSeen += 1;
          pending[lane] = { column: nowShot, half };
        }
      }
      void wasJet;
    }
  }
  return tallies;
}

/**
 * Pool several firing cadences.
 *
 * One cadence fixes the phase between the shot's 32-sweep step and the
 * squadron's march, and a fixed phase decides which HALF of the pair each lane
 * gets: measured, a single 60-sample cadence gave lane 0 eleven LEAVE
 * coincidences and no ARRIVE at all, so that half of that lane went untested
 * while the file looked covered. Varying the cadence varies the phase, which is
 * the same lesson four other instruments in this tag have already taught - a
 * drive sized in cycles carrying an assertion counted in game events.
 */
function pooled(): readonly LaneTally[] {
  const total: LaneTally[] = Array.from({ length: LANE_COUNT }, () => ({
    leaveSeen: 0,
    arriveSeen: 0,
    leavePassed: 0,
    arrivePassed: 0,
  }));
  for (const block of BLOCKS) {
    const run = tally(drive(block));
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const into = total[lane] as LaneTally;
      const from = run[lane] as LaneTally;
      into.leaveSeen += from.leaveSeen;
      into.arriveSeen += from.arriveSeen;
      into.leavePassed += from.leavePassed;
      into.arrivePassed += from.arrivePassed;
    }
  }
  return total;
}

describe('the collision test runs for every lane, not just lane 0', () => {
  const tallies = pooled();

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    it(`hit-tests lane ${lane} on both halves of the pair`, () => {
      const t = tallies[lane] as LaneTally;
      // Non-vacuity first, and per half: a zero pass-through count over zero
      // coincidences is a check over nothing, and would let a build that never
      // hit-tests this lane pass by never producing an opportunity either.
      expect(
        t.leaveSeen,
        `lane ${lane} never produced a LEAVE coincidence, so that half is untested here`,
      ).toBeGreaterThan(0);
      expect(
        t.arriveSeen,
        `lane ${lane} never produced an ARRIVE coincidence, so that half is untested here`,
      ).toBeGreaterThan(0);
      expect(
        t.leavePassed,
        `lane ${lane}: a shot walked away from a jet already on its column (LEAVE), ` +
          `${t.leavePassed} of ${t.leaveSeen}`,
      ).toBe(0);
      expect(
        t.arrivePassed,
        `lane ${lane}: a shot stepped onto a jet and carried on (ARRIVE), ` +
          `${t.arrivePassed} of ${t.arriveSeen}`,
      ).toBe(0);
    });
  }

  it('produced coincidences in all three lanes, or it has not tested the walk', () => {
    // The whole point of the file: lane 0 alone proves nothing about a walk.
    const covered = tallies
      .map((t, lane) => ({ lane, n: t.leaveSeen + t.arriveSeen }))
      .filter((entry) => entry.n > 0)
      .map((entry) => entry.lane);
    expect(covered, 'some lane produced no coincidence at all').toEqual([0, 1, 2]);
  });
});
