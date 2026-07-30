// Behavioural tests for the TMS1370 game ROM, `asm/jetfighter.asm`.
//
// Paths in this file are relative to the repository root.
//
// Every one of these drives the real core with the real machine image and reads
// the pins. Nothing here pokes RAM to set up a scenario and nothing asserts on
// a symbol's value where the behaviour is observable instead: a control reaches
// the game by closing a contact on the K matrix, which is the only way it
// reaches it on the real unit either.
//
// The runs are seconds of emulated time and the core executes one instruction
// per call, so they are not cheap. Each `describe` shares one run where it can.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BURST_GAP_CYCLES,
  CAPTURE_WINDOW_CYCLES,
  PLAYER_SLICE_CYCLES,
  SWEEP_INSTRUCTIONS,
  WARNING_CLUSTER_CYCLES,
} from '../../src/machine/board/tms1370-cadence.js';
import {
  GRID_COUNT,
  O_PLATE_COUNT,
  PLATE_COUNT,
} from '../../src/machine/cpu/tms1370/ports.js';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import {
  O_PLA_TABLE,
  unreachablePlateMasks,
} from '../../src/machine/board/o-pla.js';
import {
  assembleGame,
  cellKey,
  combPeriodicityHz,
  runGame,
  soundHz,
  splitSounds,
  sweepPeriods,
  Tms1370Machine,
  type InputEvent,
  type Contacts,
  type RunResult,
} from './tms1370-probe.js';

/** `FILE_STATE` and its two rocket nibbles, from the RAM map in the ROM source. */
const FILE_STATE = 4;
const NIB_RCOL = 7;
const NIB_RLANE = 8;

/** `FILE_JETS`, whose first three nibbles are the squadron's one jet per lane. */
const FILE_JETS = 6;

/** Seconds of emulated time, as the cycle count the probe takes. */
const seconds = (value: number): number => Math.round(value * CYCLE_HZ);

/**
 * A drive that plays the game *and defends it*: the lever stands in the lane of
 * whichever jet is deepest, steps out of a live rocket's lane, and taps fire.
 *
 * The machine falls silent unattended - a squadron that is never shot at takes
 * all three launchers - so a run that needs the game *alive* has to play it.
 *
 * **It now has to play it well.** This was a fixed schedule walking the three
 * lanes, and that was survivable only while a capture cost a launcher in the
 * lever's own lane alone: the player kept that lane clear by firing and the
 * other two were free. With the rule the owner settled - a capture costs a
 * launcher in any lane, `open-questions.md` section 6 - an open-loop lever loses
 * all three in 19-37 s, and every run below that needs a battleship crossing, a
 * rocket down all three lanes or a three-digit score stopped reaching it.
 *
 * A longer `cycles` cannot rescue those: the *game* ends rather than the clock.
 * Defending is the least this drive can do and still observe what it asserts on.
 */
function defending(): (machine: Tms1370Machine) => Contacts | undefined {
  let releaseAt = -1;
  let fireAt = -1;
  return (machine) => {
    if (releaseAt > 0 && machine.cycles >= releaseAt) {
      releaseAt = -1;
      return { fire: false };
    }
    if (releaseAt > 0) return undefined;
    // **The lever has to be read before the fire edge.** The ROM samples both in
    // one sweep and `tick_fire` is edge triggered, so moving and firing in the
    // same instant launches the shot down whichever lane the lever held last.
    // Aiming and firing are staged a sweep apart for that reason; doing both at
    // once scored one point in forty-five seconds.
    if (fireAt > 0 && machine.cycles >= fireAt) {
      fireAt = -1;
      releaseAt = machine.cycles + 3_000;
      return { fire: true };
    }
    if (fireAt > 0) return undefined;
    const ram = machine.ram;
    const rocketColumn = ram[FILE_STATE * 16 + NIB_RCOL] as number;
    const rocketLane = ram[FILE_STATE * 16 + NIB_RLANE] as number;
    let best = -1;
    let lane = 0;
    for (let candidate = 0; candidate < 3; candidate += 1) {
      // A rocket takes the launcher only where it arrives, so standing out of
      // its lane is the whole defence - `rm_arrived` compares the two lanes.
      if (rocketColumn !== 0 && candidate === rocketLane) continue;
      const grid = ram[FILE_JETS * 16 + candidate] as number;
      if (grid > best) {
        best = grid;
        lane = candidate;
      }
    }
    fireAt = machine.cycles + SWEEP_INSTRUCTIONS;
    return { skill: 1, lane };
  };
}

/** A drive that only works the lever, with the fire button never pressed. */
function leverOnly(cycles: number, lane?: number, skill = 1): InputEvent[] {
  const events: InputEvent[] = [{ cycle: 0, change: { skill } }];
  for (let at = 0, walk = 0; at < cycles; at += 40_000, walk = (walk + 1) % 3) {
    events.push({ cycle: at, change: { lane: lane ?? walk } });
  }
  return events;
}

/**
 * The sustained pitches inside a stretch of edge stream, as runs of like periods.
 *
 * The same method `launcher-lives.test.ts` uses and for the same reason: one
 * figure over a whole sound averages a march note running into a warning and
 * reports a pitch neither of them has.
 */
function warningRunsIn(
  edges: readonly { cycle: number; level: 0 | 1 }[],
  from: number,
  to: number,
): { hz: number; from: number; to: number }[] {
  // Rising edges only: a period is rise to rise, and counting both levels would
  // report every half-period and put a 467 Hz beep at 934.
  const rising = edges
    .filter((edge) => edge.level === 1 && edge.cycle >= from && edge.cycle <= to)
    .map((edge) => edge.cycle);
  const periods = rising.slice(1).map((cycle, index) => cycle - (rising[index] as number));
  // Each run carries the cycles it spans as well as its pitch, so a caller can
  // measure the *warning* rather than the analyser group that contains it.
  const found: { hz: number; from: number; to: number }[] = [];
  let current: number[] = [];
  let startIndex = 0;
  const close = (endIndex: number): void => {
    if (current.length >= 3) {
      const sorted = [...current].sort((left, right) => left - right);
      const hz = CYCLE_HZ / (sorted[sorted.length >> 1] as number);
      if (hz >= 455 && hz <= 545) {
        found.push({
          hz,
          from: rising[startIndex] as number,
          to: rising[Math.min(endIndex + 1, rising.length - 1)] as number,
        });
      }
    }
    current = [];
  };
  for (const [index, period] of periods.entries()) {
    const previous = current[current.length - 1];
    if (previous !== undefined && Math.abs(period - previous) / previous >= 0.06) {
      close(index);
      startIndex = index;
    }
    if (current.length === 0) startIndex = index;
    current.push(period);
  }
  close(periods.length - 1);
  return found;
}

/** The three detents of the skill dial. */
const SKILLS = [1, 2, 3] as const;

/**
 * Nine parked-lever games is about 26 million emulated cycles, which is past
 * Vitest's 5 s default. Named rather than inlined for the reason every horizon
 * in these suites is: it moves when the drive does, not when a rule does.
 */
const ROTOR_SWEEP_TIMEOUT_MS = 30_000;

/**
 * Fail loudly when a comparison has nothing left to compare.
 *
 * A guard rather than an assertion about the machine, and **house style already**
 * - `tools/probe/tms1370-timing.test.ts:144` asserts `blanks.length > 0` with the
 * message "no sound stopped the sweep in this window" before taking
 * `Math.min(...blanks)`, precisely because `Math.min(...[])` is `Infinity` and
 * would satisfy any lower bound. Its sibling at :135 does the same for
 * `sweeping.length`. This is that discipline, named so it can be reused.
 *
 * Three suites on this ROM have now been found green on the very defect they
 * policed. Two were **wrong assertions**: one satisfied by phantom pixels a
 * render bug overflowed into the far group, one built on a lane whose captures
 * were being drawn elsewhere. This one was different and is the reason the
 * helper exists rather than an inline check - **a correct assertion applied to
 * an empty list.** The prefix comparison it guards was sound; its window came
 * from `Math.min` over the runs themselves, so a run that produced nothing
 * shrank the window to zero and three empty strings compared equal.
 *
 * That difference matters to whoever reads this next. The first two are visible
 * by reading the assertion. **The third is not** - the assertion is right, and
 * you have to know the data can be empty to see it. Reading harder does not find
 * it; only counting the subject does.
 *
 * So: anywhere a window, a threshold or a sample count is computed *from the
 * data it is about to judge*, it can collapse to a size that judges nothing.
 * Put this under it.
 *
 * ## A fourth route, and counting the subject does not find this one either
 *
 * The three above all concern what the assertion did with the data. The fourth
 * concerns whether the machine was ever asked the question: **the drive never
 * delivered the stimulus.** Two instances outside this file, both green:
 *
 * - A missile assertion whose drive held `fire: false` throughout. It passed
 *   against a ROM broken on purpose.
 * - The battleship hunt in `scoring-ruler.test.ts`, which closed the fire
 *   contact for 5 ms against a 13.7 ms sweep. K is read once per sweep, so the
 *   press opened and closed between two reads and launched a missile on 0 of 24
 *   attempts, while reporting truthfully that no battleship was shot down.
 *
 * `requireNonVacuous` does not catch these, because the list is not empty - it
 * is full of correct observations of a machine that was never poked. What
 * catches them is an assertion on the *precondition*: that a shot was fired,
 * that the state was entered, that the drive ended for the reason assumed. See
 * `ends by playing the game out, not by running out of clock` in
 * `scoring-ruler.test.ts`, and section 12 of docs/evidence/open-questions.md.
 */
function requireNonVacuous(count: number, what: string): void {
  expect(count, `nothing to compare: ${what}`).toBeGreaterThan(0);
}

/** One rocket launch: the lane it flew, and which lanes held a jet at the time. */
interface Launch {
  readonly lane: number;
  readonly occupied: readonly number[];
}

/**
 * One parked-lever game: every rocket launched, and what the run lit.
 *
 * `NIB_RCOL` going from zero to non-zero is a launch - the ROM holds one rocket,
 * so there is no ambiguity about which one - and `NIB_RLANE` beside it is the
 * lane it flies down. Sampled at 5 ms against a flight of about 100 ms a column,
 * so no launch can fall between two samples. Both halves come off the same drive
 * because running it twice is the whole cost of this test.
 *
 * The squadron's three lane nibbles are read at the same instant, because which
 * lanes hold a jet is what `rocket_fire` actually chooses from and it is the
 * only timing-independent thing there is to assert about the choice.
 */
function parkedGame(
  skill: number,
  lever: number,
  forSeconds = 45,
  dodge = false,
): { launches: Launch[]; lanes: number[]; litCells: ReadonlySet<string> } {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane: lever, fire: false });
  const launches: Launch[] = [];
  let flying = false;
  let lane = lever;
  while (machine.cycles < seconds(forSeconds)) {
    machine.step(CYCLE_HZ / 200);
    const ram = machine.ram;
    // Dodging keeps the game alive without ever pressing fire, which is what
    // the rotor needs to be sampled past its second rung - see the union below.
    if (dodge) {
      let worst = -1;
      let nearest = lane;
      for (const candidate of [0, 1, 2]) {
        const grid = ram[FILE_JETS * 16 + candidate] as number;
        if (grid > worst) {
          worst = grid;
          nearest = candidate;
        }
      }
      if (nearest === lane) {
        lane = (lane + 1) % 3;
        machine.setContacts({ lane });
      }
    }
    const column = ram[FILE_STATE * 16 + NIB_RCOL] as number;
    if (column !== 0 && !flying) {
      launches.push({
        lane: ram[FILE_STATE * 16 + NIB_RLANE] as number,
        occupied: [0, 1, 2].filter((lane) => (ram[FILE_JETS * 16 + lane] as number) !== 0),
      });
    }
    flying = column !== 0;
  }
  return { launches, lanes: launches.map((launch) => launch.lane), litCells: machine.litCells };
}

describe('the machine comes up', () => {
  const cycles = seconds(3);
  const run = runGame({ cycles, policy: defending(), keepStrobes: true });

  it('strobes every one of the nine display grids', () => {
    expect(run.gridsStrobed).toEqual(
      Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
    );
  });

  it('lights nothing until its own RAM clear has finished', () => {
    // RAM is not cleared by hardware reset on this part, so the ROM clears 112
    // nibbles before it draws anything. If the first strobe came before that
    // finished, the tube would show one frame of whatever the RAM powered up
    // holding - a power-on garbage flash no other assertion here can see.
    // Seven files of sixteen nibbles at five instructions each is the floor.
    const clearCost = 7 * 16 * 5;
    expect(run.firstLitCycle).toBeGreaterThanOrEqual(clearCost);
  });

  it('never drives both input strobe columns at once', () => {
    // `read_inputs` is a wired-OR over the driven columns, so with R9 and R10
    // both high the skill dial and the lever arrive superimposed on the same
    // three K lines and cannot be told apart. The hardware returns the OR and
    // carries on, which is why this has to be the program's rule.
    expect(run.superimposedStrobes).toEqual([]);
  });

  it('holds the sweep period near the length the source records', () => {
    const periods = [...sweepPeriods(run.strobes)].sort((left, right) => left - right);
    const median = periods[periods.length >> 1] as number;
    // Within 10%: the sweep is not frequency-stable by design - the
    // between-sweep work varies with what is on the glass - so this pins the
    // constant against drift rather than asserting a rate.
    expect(median).toBeGreaterThan(SWEEP_INSTRUCTIONS * 0.9);
    expect(median).toBeLessThan(SWEEP_INSTRUCTIONS * 1.1);
  });
});

describe('the source and the cadence module agree on the sweep length', () => {
  it('states the same figure in both places', () => {
    const symbols = assembleGame().symbols;
    const valueOf = (name: string): number | undefined =>
      symbols.find((symbol) => symbol.name === name)?.value;
    const low = valueOf('SWEEP_INSTRUCTIONS_LO');
    const high = valueOf('SWEEP_INSTRUCTIONS_HI');
    expect(low, 'asm/jetfighter.asm no longer defines SWEEP_INSTRUCTIONS_LO').toBeDefined();
    expect(high, 'asm/jetfighter.asm no longer defines SWEEP_INSTRUCTIONS_HI').toBeDefined();
    expect((high as number) * 16 + (low as number)).toBe(SWEEP_INSTRUCTIONS);
  });
});

describe('the display', () => {
  const cycles = seconds(40);
  const run = runGame({ cycles, policy: defending() });

  it('drives only plate masks the output PLA holds', () => {
    // The left-hand side of contract V4's closure, run over the masks the ROM
    // actually drives rather than over the masks a plan permits, through the
    // same `unreachablePlateMasks` the design-side suite uses.
    expect(unreachablePlateMasks(O_PLA_TABLE, run.oMasks)).toEqual([]);
  });

  it('has that closure armed rather than vacuous', () => {
    // Contract V4 asks for a mutation case, and it has to pick its slot with
    // care: several masks in this table are produced twice over - digit 7 and
    // the full near triple are both %00000111 - so zeroing one of those would
    // leave closure green and prove nothing. This picks a slot the ROM actually
    // drove *and* that nothing else in the table produces, and proves the slot
    // is unique before it uses it.
    const produces = (mask: number): number =>
      O_PLA_TABLE.filter((slot) => slot === mask).length;
    const unique = [...run.oMasks].find((mask) => mask !== 0 && produces(mask) === 1);
    expect(unique, 'no uniquely-produced mask was driven to mutate').toBeDefined();
    const mutated = O_PLA_TABLE.map((slot) => (slot === unique ? 0 : slot));
    expect(unreachablePlateMasks(mutated, run.oMasks)).toEqual([unique]);
  });

  it('lights no (grid, plate) the atlas has no segment at', () => {
    const atlas = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', '..', 'src', 'machine', 'tube', 'atlas.json'), 'utf8'),
    ) as { segments: { id: string; grid: number; plate: number }[] };
    const known = new Set(atlas.segments.map((segment) => cellKey(segment.grid, segment.plate)));
    const stray = [...run.litCells].filter((cell) => !known.has(cell));
    expect(stray).toEqual([]);
  });

  it('drives the high four plates from R11-R14 and the low eight from O', () => {
    // Every mask the O port emitted fits in eight bits, and the plates above
    // seven were reached anyway - so they came from the R latch. A build that
    // widened the O port to twelve lines fails the first half.
    for (const mask of run.oMasks) {
      expect(mask).toBeLessThan(1 << O_PLATE_COUNT);
    }
    const highPlates = [...run.litCells].filter(
      (cell) => Number(cell.split(':')[1]) >= O_PLATE_COUNT,
    );
    expect(highPlates.length).toBeGreaterThan(0);
    for (const cell of highPlates) {
      expect(Number(cell.split(':')[1])).toBeLessThan(PLATE_COUNT);
    }
  });

  it('never puts the pair family through segment g of a score digit', () => {
    // The one exception in the whole layout: on grids 7 and 8 plate 6 is the
    // digit's own segment g, so the pair pass may light lane 1 there and must
    // never light lane 0. A stray bar through the numeral at half brightness
    // would read as a renderer fault rather than a ROM one.
    for (const grid of [7, 8]) {
      const digitLit = [0, 1, 2, 3, 4, 5].some((plate) => run.litCells.has(cellKey(grid, plate)));
      expect(digitLit, `grid ${grid} never drew a digit at all`).toBe(true);
    }
  });
});

describe('the input matrix', () => {
  it('responds to the fire button with both strobe columns low', () => {
    // K8 is ORed into every K read whatever R9 and R10 are doing, and the ROM
    // takes its fire sample with neither column driven. A build that routed
    // fire through a strobe column would see nothing here, because this drive
    // closes only the unstrobed contact.
    const cycles = seconds(4);
    const quiet = runGame({ cycles, input: [{ cycle: 0, change: { skill: 1 } }] });
    const fired = runGame({
      cycles,
      input: [
        { cycle: 0, change: { skill: 1 } },
        { cycle: seconds(1), change: { fire: true } },
        { cycle: seconds(1) + PLAYER_SLICE_CYCLES * 20, change: { fire: false } },
      ],
    });
    const blip = splitSounds(fired.speakerEdges, BURST_GAP_CYCLES).length;
    expect(blip).toBeGreaterThan(splitSounds(quiet.speakerEdges, BURST_GAP_CYCLES).length);
  });

  it('moves the launcher when the lever moves, and nowhere else', () => {
    const cycles = seconds(3);
    const lanes = [0, 1, 2].map(
      (lane) => runGame({ cycles, input: leverOnly(cycles, lane) }).litCells,
    );
    // Grid 6's pair plates are the launcher: lane 0 is plate 6, lane 1 plate 7,
    // lane 2 plate 8 - which is R11 and not on the O port at all.
    expect(lanes[0]?.has(cellKey(6, 6))).toBe(true);
    expect(lanes[1]?.has(cellKey(6, 7))).toBe(true);
    expect(lanes[2]?.has(cellKey(6, 8))).toBe(true);
  });
});

describe('a rocket can reach the launcher in any of the three lanes', () => {
  // Contract criterion V7, and the v2 defect PRD R5 forbids inheriting.
  // v2 drew the rocket's lane from the free-running timer as it stood the last
  // time the *player* pressed fire, so a player who never fires never moved it
  // and two of the three lanes were permanently safe. Parking the lever in each
  // lane in turn is what exposes that: with the defect, two of these three runs
  // hear no warning at all.
  const cycles = seconds(50);

  it(
    'flies a rocket down every one of the three lanes',
    () => {
    // The sharper half of the same criterion, and the one that actually
    // falsifies the v2 defect. A warning burst alone does not: a jet crossing
    // the G line in the lever's own lane costs a launcher and warns too, so a
    // parked-lever run can hear all three warnings with the rocket never
    // leaving one lane. What the defect *is* - a lane drawn from a nibble the
    // player's own keypress sets - is what the occupancy check below rules out:
    // such a lane knows nothing about the squadron and fires into empty lanes,
    // and the rotor cannot, because it only stops on a lane holding a jet.
    //
    // ## Why this reads NIB_RLANE and not the lit cells
    //
    // It used to union `litCells` over one 50 s run and require all three of
    // `rocket_lane{0,1,2}_col*`, and it passed for a ROM in which **exactly one
    // rocket ever flew**. `rd_jets` left `NIB_RBIT` uninitialised, so the near
    // pass's jet bitmap was offset by the lever's lane and overflowed the NEAR
    // group into the FAR one, and the near pass emitted far masks - lighting the
    // attackers' rocket segments in cells no rocket was in. The assertion was
    // reading those phantoms as evidence of the behaviour it was asserting.
    //
    // A lit cell cannot tell a rocket from anything else that reaches the same
    // plate, so the count comes from the one place that can: `NIB_RCOL` and
    // `NIB_RLANE` are a nibble each, so a rocket is exactly one column and one
    // lane, and a launch is that column going from zero to non-zero. The pins
    // are still asserted, underneath, against the lanes actually flown.
    //
    // ## Why the lanes are pooled across the skill dial
    //
    // The rotor steps 1, 2, 0, and the first interval after power-on is the one
    // `reset` writes rather than one the dial sets, so a parked-lever game ends
    // after its second launch and no single run reaches the third rung. Skill
    // shortens the *later* intervals and the march together, which samples the
    // rotor at a different phase - which is why lane 0 shows up at skill 3. The
    // union over the dial is the whole rotor, and nothing here depends on which
    // run contributes which lane.
      const games = SKILLS.flatMap((skill) =>
        [0, 1, 2].map((lever) => ({ skill, lever, ...parkedGame(skill, lever) })),
      );

      // ## Why the union comes from a dodging run and not from the parked ones
      //
      // **The parked union was a lifetime accident, and a correctness fix took
      // it away.** A parked game spends its launchers on jets it never avoids,
      // so how far the rotor gets is decided by how long the game survives. That
      // union reached lane 0 only because one particular parked run at skill 3
      // happened to live long enough to see a third launch. Charging a launcher
      // for the crossings that used to go uncharged shortened that run by 9 s -
      // 28.0 s to 18.6 s, measured either side - and the third launch went with
      // it. The rotor had not changed at all: it is four sites in `rocket_fire`
      // and nothing on the input path touches it.
      //
      // A drive that dodges but still never fires survives long enough to reach
      // every rung, and reaches [1, 2, 0] in all nine runs at every skill and
      // every starting lane rather than in one lucky one. It falsifies the v2
      // defect exactly as well, because what v2 sampled was the *fire* press:
      // a lever that moves without firing never moved `NIB_RAND`.
      //
      // This is section 11a of docs/evidence/open-questions.md in its purest
      // form. The assertion did not break; its drive stopped reaching the case.
      // One dodging run per skill rather than one per lever: all three levers
      // produce the identical lane sequence at a given skill, because dodging
      // makes the starting lane irrelevant within a second. Nine of these cost
      // more than the 30 s budget allows on CI and buy nothing.
      const dodged = SKILLS.map((skill) => ({
        skill,
        lever: 0,
        ...parkedGame(skill, 0, 45, true),
      }));

      const flown = [...new Set(dodged.flatMap((game) => game.lanes))].sort();
      expect(flown, 'the rotor did not reach every lane').toEqual([0, 1, 2]);

      // The falsifier proper: every rocket flew down a lane that had a jet
      // airborne in it at the moment it launched.
      //
      // ## Why this, and not the lane *sequence* across lever positions
      //
      // This used to require the lane sequence to be identical for all three
      // lever positions at a given skill, truncated to the shortest run. That
      // premise is not implied by R5, and the check was vacuous where it was not
      // wrong. Measured across the three levers at skill 3, launch counts were
      // 1 / 0 / 1 - one lever fired no rocket at all inside the window, `shortest`
      // collapsed to zero, and the comparison was between three empty strings.
      // It has been passing without asserting anything. See
      // {@link requireNonVacuous}, which is now under it.
      //
      // Once the counts were 2 / 2 / 2 and it had content, it failed - and it
      // failed on a machine that satisfies R5. `NIB_ROTOR` is referenced at
      // exactly four sites in the whole ROM, all of them inside `rocket_fire`,
      // and `rocket_fire` never reads `NIB_LANE` or `NIB_LANEB`. The lane is a
      // function of rotor phase and of which lanes are occupied: `rf_look` fires
      // only where `MNEZ` finds a jet, and `rf_empty` advances the rotor and
      // retries. The lever legitimately moves occupancy, because an arrival in
      // the lever's own lane is a capture while an arrival elsewhere flies past.
      // The header above already concedes exactly this effect for the skill dial
      // - "samples the rotor at a different phase" - and the lever is subject to
      // the same one.
      //
      // Decisive: at skill 3 with the lever in lane 2, the first launch had only
      // lane 0 occupied and fired down lane 0. Occupancy forced it. A lane drawn
      // from the player's keypress could not have produced that.
      //
      // What replaces it is what the v2 defect would actually violate. A lane
      // taken from a free-running timer nibble knows nothing about the squadron,
      // so it fires into empty lanes; a lane taken from the rotor cannot, because
      // the rotor only stops on a lane holding a jet. This is asserted on every
      // launch of every run rather than on a prefix, and it does not depend on
      // when anything happened.
      const allLaunches = [...games, ...dodged].flatMap((game) =>
        game.launches.map((launch) => ({ skill: game.skill, lever: game.lever, ...launch })),
      );
      requireNonVacuous(allLaunches.length, 'no rocket launched in any run, at any skill');
      for (const launch of allLaunches) {
        expect(
          launch.occupied,
          `skill ${launch.skill}, lever ${launch.lever}: a rocket flew down lane ${launch.lane} with no jet in it`,
        ).toContain(launch.lane);
      }

      // And the same discipline applied to the assertion just made, because it
      // is the kind that can go quietly trivial. If every launch happened to
      // find all three lanes occupied, "flew down an occupied lane" would be
      // satisfied by any lane at all and would be asserting nothing again.
      // Measured, it bites: at skill 3 with the lever in lane 2 the first launch
      // had exactly one lane occupied, so the rotor had no choice to make.
      requireNonVacuous(
        allLaunches.filter((launch) => launch.occupied.length < 3).length,
        'every launch found all three lanes occupied, so the occupancy check constrained nothing',
      );

      // And not vacuously: a ROM that pinned the rocket to one lane would
      // satisfy the sequence check trivially, so more than one lane has to be
      // reached, and no run may be empty of launches at every skill.
      expect(flown.length, 'every rocket flew in the same lane').toBeGreaterThan(1);

      // Finally the pins, now that the lanes they should show are known
      // independently: a lane that flew must have lit its own rocket segments,
      // and this is the direction the old lit-cell union could not assert -
      // it could only ever say a segment lit, never that a rocket lit it.
      for (const { skill, lever, lanes, litCells } of games) {
        for (const lane of new Set(lanes)) {
          expect(
            [1, 2, 3, 4, 5].some((grid) => litCells.has(cellKey(grid, 3 + lane))),
            `skill ${skill}, lever ${lever}: a rocket flew in lane ${lane} and lit nothing`,
          ).toBe(true);
        }
      }
    },
    ROTOR_SWEEP_TIMEOUT_MS,
  );

  for (const lane of [0, 1, 2]) {
    it(`warns in lane ${lane} with the lever parked there`, () => {
      // **A warning is found by the pitch runs inside a sound, not by the
      // sound's own pitch.** A capture is claimed at the end of the squadron's
      // lane walk, directly after `jm_beep`'s march note, so the warning and the
      // march note arrive inside one `BURST_GAP_CYCLES` group. Measuring the
      // group gives ~450 Hz - the two tones averaged - and finds no warning,
      // though the machine sounded one perfectly well.
      //
      // Counting runs in the band instead is `launcher-lives.test.ts`'s method,
      // and it is here because a lead-in silence was briefly added to the ROM to
      // separate the two sounds for this assertion's benefit. That was the wrong
      // place to fix it: the fusing is a property of the analyser, and the ROM is
      // not changed to make a test read. The silence also parked the sweep for
      // 54.6 ms and measurably slowed a running battleship buzz.
      const run = runGame({ cycles, input: leverOnly(cycles, lane) });
      const sounds = splitSounds(run.speakerEdges, BURST_GAP_CYCLES);
      const warnings = sounds.filter(
        (sound) => warningRunsIn(run.speakerEdges, sound.from, sound.to).length > 0,
      );
      expect(
        warnings.length,
        `no 455-545 Hz warning beep with the lever parked in lane ${lane}`,
      ).toBeGreaterThan(0);
      // The beeps of one hit fall inside one cluster, which is what the
      // 25-28 ms measured gap makes them.
      //
      // **Measured over the warning's own runs, not over the `splitSounds`
      // group that contains them.** A group is an analyser construct bounded by
      // `BURST_GAP_CYCLES`, so how far it extends depends on how densely the ROM
      // happens to be sounding - and the comment above already records that a
      // march note lands inside the same group as the warning. Speeding the
      // march up put more march notes in that group and the span grew to 214590
      // cycles against this 29167 limit, while the warning itself was unchanged:
      // two beeps, 455-545 Hz, 25-28 ms apart. The group was never the thing
      // this assertion is about.
      const runs = warningRunsIn(run.speakerEdges, warnings[0]!.from, warnings[0]!.to);
      const span = (runs[runs.length - 1]?.to ?? 0) - (runs[0]?.from ?? 0);
      expect(span).toBeLessThan(WARNING_CLUSTER_CYCLES);
    });
  }
});

describe('the sounds', () => {
  it('puts the fire blip in the measured band, over its own burst', () => {
    // Measured over the *isolated* burst, split on the named gap constant, and
    // never as first-to-last edge across the capture: that method, and not the
    // 150 ms bound it produced, is what open-questions.md section 3b records as
    // v2's fault.
    const cycles = seconds(5);
    const run = runGame({
      cycles,
      input: [
        { cycle: 0, change: { skill: 1, lane: 1 } },
        { cycle: seconds(2), change: { fire: true } },
        { cycle: seconds(2) + 3_000, change: { fire: false } },
      ],
    });
    const sounds = splitSounds(run.speakerEdges, BURST_GAP_CYCLES);
    const blips = sounds
      .map((sound) => ({
        sound,
        hz: soundHz(run.speakerEdges, sound.from, sound.to, CYCLE_HZ),
      }))
      .filter((entry) => entry.hz > 1_000);
    expect(blips.length, 'no high blip at all').toBeGreaterThan(0);
    const blip = blips[0] as { sound: { from: number; to: number }; hz: number };
    expect(blip.hz).toBeGreaterThanOrEqual(1480);
    expect(blip.hz).toBeLessThanOrEqual(1632);
    expect((blip.sound.to - blip.sound.from) / CYCLE_HZ).toBeLessThan(0.15);
  });

  it('puts the march beep in the measured band', () => {
    const cycles = seconds(12);
    const run = runGame({ cycles, input: leverOnly(cycles) });
    const sounds = splitSounds(run.speakerEdges, BURST_GAP_CYCLES);
    const march = sounds
      .map((sound) => soundHz(run.speakerEdges, sound.from, sound.to, CYCLE_HZ))
      .filter((hz) => hz >= 600 && hz <= 650);
    expect(march.length, 'the squadron never sounded a step').toBeGreaterThan(0);
  });

  it('sounds the battleship as a continuous buzz in the measured band', () => {
    // audio-reference.md, battleshipBuzz: 3.5-4.5 s (4.05 and 3.80 across two
    // arrivals) at a 79-111 Hz repetition rate, continuous rather than a
    // sequence of beeps. Read by harmonic-comb periodicity and not by a median
    // period, because the buzz is clocked off the display sweep and its edges
    // are not evenly spaced - which is the evidence for that mechanism rather
    // than noise on top of it.
    const cycles = seconds(20);
    const run = runGame({ cycles, policy: defending() });
    const arrivals = splitSounds(run.speakerEdges, BURST_GAP_CYCLES).filter(
      (sound) => (sound.to - sound.from) / CYCLE_HZ > 3,
    );
    expect(arrivals.length, 'no arrival in the window').toBeGreaterThan(0);
    const arrival = arrivals[0] as { from: number; to: number };
    const durationSec = (arrival.to - arrival.from) / CYCLE_HZ;
    expect(durationSec).toBeGreaterThanOrEqual(3.5);
    expect(durationSec).toBeLessThanOrEqual(4.5);
    const hz = combPeriodicityHz(run.speakerEdges, arrival.from, arrival.to, CYCLE_HZ);
    expect(hz).toBeGreaterThanOrEqual(79);
    expect(hz).toBeLessThanOrEqual(111);
  });

  it('never drives the speaker from anything but R15', () => {
    // There is no D port on this part. The probe only ever records an edge from
    // an R-latch write, so a non-empty edge stream is itself the assertion -
    // what this pins is that the stream is not empty for the wrong reason.
    const cycles = seconds(8);
    const run = runGame({ cycles, policy: defending() });
    expect(run.speakerEdges.length).toBeGreaterThan(0);
    for (const edge of run.speakerEdges) {
      expect(edge.level === 0 || edge.level === 1).toBe(true);
    }
  });
});

describe('the game', () => {
  const cycles = seconds(45);
  const run: RunResult = runGame({ cycles, policy: defending() });

  it('keeps playing while the player plays', () => {
    const last = run.speakerEdges.at(-1);
    expect(last, 'the machine fell silent immediately').toBeDefined();
    expect((last as { cycle: number }).cycle).toBeGreaterThan(cycles - CAPTURE_WINDOW_CYCLES);
  });

  it('scores', () => {
    const units = run.ram[5 * 16 + 10] as number;
    const tens = run.ram[5 * 16 + 11] as number;
    const hundreds = run.ram[5 * 16 + 12] as number;
    expect(hundreds * 100 + tens * 10 + units).toBeGreaterThan(0);
    // BCD, so no digit may exceed nine whatever the carry did.
    expect(Math.max(units, tens, hundreds)).toBeLessThanOrEqual(9);
  });

  it('flies a squadron, a rocket and a battleship over the same window', () => {
    // Jets are the near family on grids 1-5, the rocket the far family there,
    // and the boat the near family on grid 0. All three in one run is the
    // assertion that the game is running rather than that one actor is.
    const jets = [1, 2, 3, 4, 5].some((grid) =>
      [0, 1, 2].some((plate) => run.litCells.has(cellKey(grid, plate))),
    );
    const rockets = [1, 2, 3, 4, 5].some((grid) =>
      [3, 4, 5].some((plate) => run.litCells.has(cellKey(grid, plate))),
    );
    const boat = [0, 1, 2].some((plate) => run.litCells.has(cellKey(0, plate)));
    expect({ jets, rockets, boat }).toEqual({ jets: true, rockets: true, boat: true });
  });

  it('leaves the player missile visible on its way out', () => {
    const missile = [1, 2, 3, 4, 5].some((grid) =>
      [6, 7, 8].some((plate) => run.litCells.has(cellKey(grid, plate))),
    );
    expect(missile).toBe(true);
  });
});
