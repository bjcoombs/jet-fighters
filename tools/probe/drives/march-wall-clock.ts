// How long is a squadron step, in wall clock, on the ROM as it stands - and
// which rungs does a played game actually reach?
//
// Paths in this file are relative to the repository root.
//
// The cadence ladder is written in sweeps, and a sweep is not a fixed length of
// time: `note_loop` stops strobing the tube for the whole of every sound, so a
// step with a march note inside it lands longer than `sweeps / SWEEP_HZ`. Every
// figure the owner's recordings give is wall clock, because wall clock is what a
// camera records - so the ladder can only be compared against them in wall clock,
// and that is a measurement of this machine rather than arithmetic on a constant.
//
// **This exists because the table it replaces went stale without failing.**
// `docs/evidence/timing-analysis.md`'s "Wall-clock pace of the current ROM"
// quoted 1995 / 1528 / 1159 / 652 ms for skill 1, 2, 3 and the floor. Those were
// taken at a 13.46 ms sweep against a `PAT_STEP` that no longer exists; the
// ladder is now `STEP_HI_MAX` / `STEP_HI_MIN` / `STEP_SKILL` and the sweep
// constant has moved twice since. Nothing re-derived them and nothing went red.
//
// **The rung is read out of RAM, not computed.** `step_reload` writes `STEP_HI`
// and this drive reports what it wrote. Computing the rung from the rule instead
// is how the first version of this drive missed the thing it found - see
// `march-wall-clock.test.ts`, which asserts that a rung below the documented
// floor is still reachable, because it is.
//
// **What a rung is.** The countdown pair is spent low nibble first and the step
// falls on the sweep after it reaches zero, so a reload of `hi`:15 lasts
// `(hi + 1) * 16` sweeps. The pair rises on the sweep it is reloaded, which is
// the sweep the squadron stepped - the same detector
// `tools/probe/march-cadence.test.ts` uses, and it needs no threshold.
//
// **Read on a sweep boundary and nowhere else.** The countdown spends the low
// nibble first, so on the sweep it wraps the program writes 15 to the low nibble
// and *then* decrements the high one - and a reader sampling between those two
// writes sees the pair rise by 15, which is the same signature as a reload. The
// first version of this drive sampled on a cycle budget and reported a 16-sweep
// march at every skill, which is what sent somebody looking for a defect that
// was in the instrument. `runSweeps` lands the machine at the same point in the
// loop every time.
//
// **Two conditions, and the difference between them is the point.** An idle game
// makes almost no sound and never leaves its top rung, so it measures the rung
// the dial chose and nothing else. A played game fires, kills and walks the
// ladder down - and every shot, hit and march note suspends the sweep, so the
// same rung measures longer. Quoting an idle figure as what a player feels is a
// mistake `asm/jetfighter.asm`'s own cadence header names; both are printed here
// so neither can be quoted alone by accident.

import { CYCLE_HZ } from '../../../src/machine/cpu/tms1370/timing.js';
import { SWEEP_HZ, SWEEP_INSTRUCTIONS } from '../../../src/machine/board/tms1370-cadence.js';
import { Tms1370Machine, assembleGame } from '../tms1370-probe.js';
import { isEntryPoint } from './entry-point.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const NIBBLES_PER_FILE = 16;
const ADDRESS = {
  stepLo: symbol('FILE_TIME') * NIBBLES_PER_FILE + symbol('NIB_STEP_LO'),
  stepHi: symbol('FILE_TIME') * NIBBLES_PER_FILE + symbol('NIB_STEP_HI'),
  kills: symbol('FILE_STATE') * NIBBLES_PER_FILE + symbol('NIB_KILLS'),
  state: symbol('FILE_STATE') * NIBBLES_PER_FILE + symbol('NIB_STATE'),
} as const;

/** Sweeps a reload of `stepHi`:15 lasts. */
export const sweepsFor = (stepHi: number): number =>
  stepHi * NIBBLES_PER_FILE + NIBBLES_PER_FILE;

/** The rung the ladder's own rule asks for, as `asm/jetfighter.asm` states it. */
export const ruleRung = (skill: number, kills: number): number =>
  Math.max(
    symbol('STEP_HI_MIN'),
    symbol('STEP_HI_MAX') - kills - symbol('STEP_SKILL') * (skill - 1),
  );

/** The floor the ROM's constants document: `STEP_HI_MIN`, in sweeps. */
export const DOCUMENTED_FLOOR_SWEEPS = sweepsFor(symbol('STEP_HI_MIN'));

export const SKILLS = [1, 2, 3] as const;
/** Emulated seconds one drive plays before it is stopped. */
const DRIVE_SECONDS = 120;
/**
 * The cycle ceiling one `runSweeps` call is given.
 *
 * `march-cadence.test.ts`'s reasoning, unchanged: the ROM stops sweeping for the
 * whole of every sound, so a caller waiting on a sweep during a loss envelope
 * must not spin for ever. Ten seconds is far longer than any sound the machine
 * makes and far shorter than a hung suite.
 */
const SWEEP_WAIT_CYCLES = Math.round(10 * CYCLE_HZ);

/** One timed march step. */
export interface Step {
  readonly skill: number;
  /** `NIB_KILLS` when the countdown was reloaded. */
  readonly kills: number;
  /** `STEP_HI` as `step_reload` actually wrote it - read, not computed. */
  readonly stepHi: number;
  /** Sweeps since the previous step. */
  readonly sweeps: number;
  /** Wall clock since the previous step, in ms. */
  readonly ms: number;
}

export interface MarchWallClockResult {
  readonly idle: readonly Step[];
  readonly played: readonly Step[];
}

/**
 * Play one game and time every march step.
 *
 * `playing` decides the condition: an idle drive never presses anything, so
 * kills stay at 0 and the ladder stays on its entry rung.
 */
function driveOne(skill: number, playing: boolean): Step[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane: 1, fire: false });
  const steps: Step[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  let previousPair: number | undefined;
  let lastCycles: number | undefined;
  let lastSweeps = 0;
  // The rung an interval ran on is the one the reload at its *start* chose, not
  // the one chosen at its end. Reading `STEP_HI` after the rise labels every
  // interval with the next rung down, which puts a played skill-1 game's first
  // interval under `STEP_HI 8` at 64 sweeps - a rung asking 144.
  let openHi = 0;
  let openKills = 0;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    if (playing) {
      // A blind drive: sweep the lever through the lanes and tap fire. It is not
      // trying to play well - it is trying to make the noise a played game makes
      // and to walk the ladder down, and either of those is enough.
      machine.setContacts({ lane: (Math.floor(tick / 37) % 3) as 0 | 1 | 2, fire: tick % 37 < 4 });
    }
    machine.runSweeps(1, SWEEP_WAIT_CYCLES);
    const ram = machine.ram;
    if ((ram[ADDRESS.state] as number) !== 0) break;
    const stepHi = ram[ADDRESS.stepHi] as number;
    const pair = stepHi * NIBBLES_PER_FILE + (ram[ADDRESS.stepLo] as number);
    if (previousPair !== undefined && pair > previousPair) {
      if (lastCycles !== undefined) {
        steps.push({
          skill,
          kills: openKills,
          stepHi: openHi,
          sweeps: machine.sweepCount - lastSweeps,
          ms: ((machine.cycles - lastCycles) / CYCLE_HZ) * 1000,
        });
      }
      openHi = stepHi;
      openKills = ram[ADDRESS.kills] as number;
      lastCycles = machine.cycles;
      lastSweeps = machine.sweepCount;
    }
    previousPair = pair;
  }
  return steps;
}

/** Time the ladder in both conditions. */
export function runMarchWallClock(): MarchWallClockResult {
  return {
    idle: SKILLS.flatMap((skill) => driveOne(skill, false)),
    played: SKILLS.flatMap((skill) => driveOne(skill, true)),
  };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? NaN : (sorted[(sorted.length - 1) >> 1] as number);
};

/**
 * Steps grouped by the rung they ran on, since the interval before a step ran on
 * the rung the *previous* reload chose. `stepHi` here is that previous reload's,
 * which is why it is carried on the step rather than looked up afterwards.
 */
function rows(steps: readonly Step[]): string[] {
  const groups = new Map<string, Step[]>();
  for (const step of steps) {
    const key = `${step.skill}/${step.kills}/${step.stepHi}`;
    (groups.get(key) ?? groups.set(key, []).get(key) ?? []).push(step);
  }
  return [...groups.values()]
    .sort((a, b) => (a[0] as Step).skill - (b[0] as Step).skill
      || (a[0] as Step).kills - (b[0] as Step).kills)
    .map((group) => {
      const first = group[0] as Step;
      const sweeps = median(group.map((s) => s.sweeps));
      const asked = sweepsFor(first.stepHi);
      const flag = asked < DOCUMENTED_FLOOR_SWEEPS ? '  <- below the documented floor' : '';
      return `  skill ${first.skill}  kills ${first.kills}  STEP_HI ${first.stepHi}  `
        + `${String(asked).padStart(3)} sweeps asked, ${String(sweeps).padStart(3)} run  `
        + `${((asked / SWEEP_HZ) * 1000).toFixed(0).padStart(5)} ms nominal  `
        + `${median(group.map((s) => s.ms)).toFixed(0).padStart(5)} ms measured  `
        + `(n=${group.length})${flag}`;
    });
}

/** The lines this drive prints. */
export function formatMarchWallClock(result: MarchWallClockResult): readonly string[] {
  const fastest = Math.min(...result.played.map((step) => sweepsFor(step.stepHi)));
  return [
    `sweep ${SWEEP_INSTRUCTIONS} instructions = ${(1000 / SWEEP_HZ).toFixed(2)} ms; `
      + `ladder STEP_HI_MAX ${symbol('STEP_HI_MAX')}, STEP_HI_MIN ${symbol('STEP_HI_MIN')}, `
      + `STEP_SKILL ${symbol('STEP_SKILL')}`,
    `the floor the constants document: ${DOCUMENTED_FLOOR_SWEEPS} sweeps, `
      + `${((DOCUMENTED_FLOOR_SWEEPS / SWEEP_HZ) * 1000).toFixed(0)} ms nominal`,
    `the fastest rung a played game reached: ${fastest} sweeps, `
      + `${((fastest / SWEEP_HZ) * 1000).toFixed(0)} ms nominal`,
    'idle, nothing pressed:',
    ...rows(result.idle),
    'played, lever swept and fire tapped:',
    ...rows(result.played),
  ];
}

if (isEntryPoint(import.meta.url)) {
  for (const text of formatMarchWallClock(runMarchWallClock())) console.log(text);
}
