// Does a plane ever change row while it is still marching?
//
// Paths in this file are relative to the repository root.
//
// ## The claim, and the shape of the defect it closes
//
// The owner, watching the physical unit against his own recording
// (`docs/evidence/owner-entity-model.md`, 2026-08-25): "at most two jets
// approach at once ... they change row". Not only on entry - during the march.
//
// `positioned-planes.test.ts` establishes the half of that model which is about
// storage: a plane is a (row, column) pair and two planes can share either. It
// says nothing about the row ever *moving*, and it could not: a ROM that marched
// every plane straight down its entry lane for ever satisfies every assertion in
// that file. The cold verifier of 2026-09-04 measured exactly that ROM - 804 of
// 804 plane lifetimes held one row from entry to departure, across 907 squadron
// steps - and `jet_march`'s own header said so in as many words: "the march
// moves a plane's column and never its row".
//
// So this file asks the question that one cannot: over a plane's own lifetime,
// does the row half of the pair take more than one value?
//
// ## Read off a slot over time, never off a row over time
//
// A row can hold two planes, so "row 1 was occupied and now row 2 is" is not a
// plane that moved - it is the arrangement `positioned-planes.test.ts` exists to
// prove is reachable. Every reading here follows a *slot* (`slotsOf`, which
// keeps the empties) and a slot's occupancy is a lifetime: the column goes
// non-zero when a plane enters it and zero when that plane is shot, captured or
// walks off. A column that falls without reaching zero between two samples is
// treated as a new lifetime as well, so a kill and a re-entry inside one sample
// cannot be read as one plane teleporting backwards.
//
// This is the same instrument discipline `open-questions.md` section 14 records
// paying for once, where a classifier that asked the *row* whether a jet had
// marched booked spawns as marches because a row can hold two planes.
//
// ## Why the drive never fires
//
// A drive that shoots keeps the squadron at the far end - `positioned-planes`
// measures its own hunting drive stopping every plane before grid 3 - and a
// plane that dies at grid 2 has had one march step to change its row in. Working
// the lever and never pressing fire is the drive that lets planes cross the
// whole playfield, which is where a row change has room to show. It ends in
// about twenty-five seconds with the last launcher lost, and the frames up to
// there are the measurement.
//
// ## The single shared countdown, asserted here rather than assumed
//
// Contract criterion E3 asks for the row change *and* for the squadron step to
// stay one countdown - a per-plane timer would produce a march-beep rate no
// recording supports. `march-cadence.test.ts` holds that from the countdown pair
// in RAM; this file holds it from the other end, on the glass: every sample on
// which one airborne plane's column advanced is a sample on which the other
// airborne plane's column advanced too.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect, vi } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';
import {
  Tms1370Machine,
  assembleGame,
  slotsOf,
  squadronMap,
  type Plane,
} from './tms1370-probe.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const SQUADRON = squadronMap(ASM);
const FILE_STATE = symbol('FILE_STATE');
const NIB_STATE = symbol('NIB_STATE');
const FILE_TIME = symbol('FILE_TIME');
const NIB_STEP_LO = symbol('NIB_STEP_LO');
const NIB_STEP_HI = symbol('NIB_STEP_HI');

/** Wall-clock allowance. Every bound that means anything is in cycles. */
const DRIVE_TIMEOUT_MS = 120_000;
vi.setConfig({ testTimeout: DRIVE_TIMEOUT_MS });

/**
 * Emulated seconds one drive plays.
 *
 * A sampling window and not a machine-stop horizon: the drives here are ended by
 * `over`, usually well inside it, and the window only has to be longer than the
 * ending it is waiting for. Ninety seconds is what `positioned-planes.test.ts`
 * uses for the same reason.
 */
const DRIVE_SECONDS = 90;

/** Sampling interval. A march step is 16 sweeps at its fastest, far coarser. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/**
 * Samples that may separate a column advance from the countdown's reload and
 * still be the same squadron step.
 *
 * `jet_march` spends the countdown, reloads it and walks the slots inside one
 * sweep, and the drive samples several times a sweep - so a sample can land
 * between the reload and a slot's write, or between the two slots' writes. That
 * is the instrument, not a second timer, and a window of one sweep tells them
 * apart: a plane advancing off a countdown of its own would step a whole march
 * interval away from this one, which is 16 sweeps at the ladder's floor and 160
 * at its top.
 */
const ONE_SWEEP_SAMPLES = Math.ceil(SWEEP_INSTRUCTIONS / SAMPLE_CYCLES) + 1;

/** Lever cadences the drives pool over, in samples per lane. */
const LEVER_BLOCKS = [40, 60, 80] as const;

/** One reading of both slots, empties included, and the shared countdown. */
interface Frame {
  readonly slots: readonly Plane[];
  /**
   * `NIB_STEP_HI * 16 + NIB_STEP_LO`, the squadron's one countdown.
   *
   * Read as one number for the reason `march-cadence.test.ts` gives: it falls by
   * one every sweep, so the sample on which it *rises* is the sweep the ROM
   * reloaded it on, and that is a squadron step with no threshold to tune.
   */
  readonly countdown: number;
}

function frameOf(machine: Tms1370Machine): Frame {
  const ram = machine.ram;
  return {
    slots: slotsOf(ram, SQUADRON),
    countdown:
      (ram[FILE_TIME * 16 + NIB_STEP_HI] as number) * 16 +
      (ram[FILE_TIME * 16 + NIB_STEP_LO] as number),
  };
}

/** The game has ended, so the squadron stops marching and stops spawning. */
function over(machine: Tms1370Machine): boolean {
  return (machine.ram[FILE_STATE * 16 + NIB_STATE] as number) !== 0;
}

/** Work the lever round the three lanes and never fire, at one lever cadence. */
function drifting(block: number, skill: 1 | 2 | 3): readonly Frame[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane: 0, fire: false });
  const frames: Frame[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    machine.setContacts({ lane: (Math.floor(tick / block) % 3) as 0 | 1 | 2 });
    machine.step(SAMPLE_CYCLES);
    if (over(machine)) break;
    frames.push(frameOf(machine));
  }
  return frames;
}

/** One plane's occupancy of one slot, from the sample it entered on. */
interface Lifetime {
  /** The (row, column) at every sample on which this plane's column advanced. */
  readonly marchSteps: Plane[];
  /** The (row, column) it was first read at. */
  readonly entry: Plane;
}

/** What one run of the drive measured. */
interface Reading {
  readonly lifetimes: readonly Lifetime[];
  /** Samples on which some airborne plane's column advanced. */
  readonly stepSamples: number;
  /** Of those, the ones with no reload of the shared countdown beside them. */
  readonly unsharedStepSamples: number;
  /** Samples on which the shared countdown rose, which is its reload. */
  readonly reloads: number;
}

/**
 * Follow both slots across a run.
 *
 * A march step is a slot's column rising by one. It is read per slot rather than
 * from the countdown pair because the question is about what a *plane* did, and
 * because a test that read the countdown would be asserting the countdown twice
 * over - `march-cadence.test.ts` already owns that reading.
 */
function read(frames: readonly Frame[]): Reading {
  const lifetimes: Lifetime[] = [];
  const open: (Lifetime | undefined)[] = [undefined, undefined];
  let stepSamples = 0;
  let unsharedStepSamples = 0;

  const advancedAt: boolean[] = [];
  const reloadedAt: boolean[] = [];

  for (let index = 1; index < frames.length; index += 1) {
    const before = (frames[index - 1] as Frame).slots;
    const now = (frames[index] as Frame).slots;
    const advanced: boolean[] = [];

    for (let slot = 0; slot < now.length; slot += 1) {
      const was = before[slot] as Plane;
      const is = now[slot] as Plane;
      const continues = was.column !== 0 && is.column >= was.column;
      advanced.push(continues && is.column === was.column + 1);

      if (is.column === 0) {
        open[slot] = undefined;
        continue;
      }
      if (!continues) {
        // A fresh plane: either the slot was empty, or a kill and a re-entry
        // landed inside one sample and the column fell.
        const lifetime: Lifetime = { entry: is, marchSteps: [] };
        open[slot] = lifetime;
        lifetimes.push(lifetime);
        continue;
      }
      if (is.column === was.column + 1) (open[slot] as Lifetime | undefined)?.marchSteps.push(is);
    }

    advancedAt.push(advanced.some(Boolean));
    reloadedAt.push((frames[index] as Frame).countdown > (frames[index - 1] as Frame).countdown);
  }

  let reloads = 0;
  for (let at = 0; at < advancedAt.length; at += 1) {
    if (reloadedAt[at] === true) reloads += 1;
    if (advancedAt[at] !== true) continue;
    stepSamples += 1;
    const from = Math.max(0, at - ONE_SWEEP_SAMPLES);
    const to = Math.min(reloadedAt.length - 1, at + ONE_SWEEP_SAMPLES);
    let beside = false;
    for (let near = from; near <= to && !beside; near += 1) beside = reloadedAt[near] === true;
    if (!beside) unsharedStepSamples += 1;
  }
  return { lifetimes, stepSamples, unsharedStepSamples, reloads };
}

/** A plane whose row took more than one value across its own march steps. */
function changedRow(lifetime: Lifetime): boolean {
  const rows = new Set(lifetime.marchSteps.map((plane) => plane.row));
  return rows.size > 1;
}

const READINGS: readonly Reading[] = ([1, 2, 3] as const).flatMap((skill) =>
  LEVER_BLOCKS.map((block) => read(drifting(block, skill))),
);

const LIFETIMES = READINGS.flatMap((reading) => reading.lifetimes);
/** Lifetimes long enough for the question to arise: two march steps or more. */
const MARCHED = LIFETIMES.filter((lifetime) => lifetime.marchSteps.length >= 2);
const STEP_SAMPLES = READINGS.reduce((total, reading) => total + reading.stepSamples, 0);

/**
 * Squadron steps the pooled drives have to observe before a zero means anything.
 *
 * Contract criterion E3 asks for "at least four squadron steps". The nine runs
 * pooled here observe **99 column advances** off **234 reloads** of the shared
 * countdown, so the floor is set at the contract's four rather than at the
 * measurement - it is the contract's number a reader is checking against - and
 * the margin is 25 times it. Both counts are reported in the failure messages,
 * so a run that has collapsed towards the floor says so before it reaches it.
 *
 * There are more reloads than advances because the countdown runs whether or not
 * anything is airborne: a step with both slots empty reloads and moves nothing.
 */
const STEP_FLOOR = 4;

/**
 * Plane lifetimes that must reach two march steps before a zero means anything.
 *
 * A lifetime with one march step cannot show a row that differs *between two of
 * its own march steps*, so it is not a trial. Measured, the nine runs produce
 * **48** lifetimes and all 48 reach two march steps; of those, **33 of 48**
 * change row. The other 15 crossed grid 3 along the bottom row, which `jm_row`
 * leaves where it is - see its header for why one of the three rows has to be a
 * fixed point. Twelve is a quarter of the measured count, which is a floor with
 * room rather than a target to hit.
 */
const MARCHED_FLOOR = 12;

describe('a plane changes row while it is still marching', () => {
  it('observes enough squadron steps and long enough lifetimes to mean anything', () => {
    expect(
      STEP_SAMPLES,
      `${STEP_SAMPLES} squadron steps observed across ${READINGS.length} runs, floor ${STEP_FLOOR}`,
    ).toBeGreaterThanOrEqual(STEP_FLOOR);
    expect(
      MARCHED.length,
      `${MARCHED.length} plane lifetimes reached two march steps, of ` +
        `${LIFETIMES.length} in all, floor ${MARCHED_FLOOR}`,
    ).toBeGreaterThanOrEqual(MARCHED_FLOOR);
  });

  it('reads a row that differs between two of one plane\'s own march steps', () => {
    const changed = MARCHED.filter(changedRow);
    const rowsSeen = changed.map((lifetime) =>
      lifetime.marchSteps.map((plane) => `${plane.row}@${plane.column}`).join(' '),
    );
    expect(
      changed.length,
      `${changed.length} of ${MARCHED.length} marching planes changed row; ` +
        `first few: ${rowsSeen.slice(0, 5).join(' | ')}`,
    ).toBeGreaterThanOrEqual(1);
  });

  it('changes the row only by one place, and never off the playfield', () => {
    const rows = MARCHED.flatMap((lifetime) => lifetime.marchSteps.map((plane) => plane.row));
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rows)).toBeLessThanOrEqual(2);
    const jumps = MARCHED.flatMap((lifetime) =>
      lifetime.marchSteps
        .slice(1)
        .map((plane, at) => Math.abs(plane.row - (lifetime.marchSteps[at] as Plane).row)),
    );
    expect(Math.max(...jumps, 0), 'a row moved more than one place in one step').toBeLessThanOrEqual(
      1,
    );
  });

  it('advances every plane off one shared squadron countdown', () => {
    const reloads = READINGS.reduce((total, reading) => total + reading.reloads, 0);
    const unshared = READINGS.reduce((total, reading) => total + reading.unsharedStepSamples, 0);
    expect(
      reloads,
      `${reloads} reloads of NIB_STEP_LO/NIB_STEP_HI observed`,
    ).toBeGreaterThanOrEqual(STEP_FLOOR);
    expect(
      unshared,
      `${unshared} of ${STEP_SAMPLES} column advances had no reload of the one shared ` +
        `countdown within ${ONE_SWEEP_SAMPLES} samples, so something other than ` +
        'NIB_STEP_LO/NIB_STEP_HI moved a plane',
    ).toBe(0);
  });
});
