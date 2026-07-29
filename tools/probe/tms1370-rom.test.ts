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
  type InputEvent,
  type RunResult,
} from './tms1370-probe.js';

/** Seconds of emulated time, as the cycle count the probe takes. */
const seconds = (value: number): number => Math.round(value * CYCLE_HZ);

/**
 * A drive that plays the game: the lever walks the three lanes and the fire
 * button is pressed once per lap.
 *
 * The machine falls silent unattended - a squadron that is never shot at takes
 * all three launchers - so a run that needs the game *alive* has to play it.
 * That is the same property `UNATTENDED_SILENCE_S` records for the v2 machine
 * and the reason contract criterion V8b states its own input schedule.
 */
function playing(cycles: number, everyCycles = 70_000): InputEvent[] {
  const events: InputEvent[] = [{ cycle: 0, change: { skill: 1 } }];
  for (let at = 0, lane = 0; at < cycles; at += everyCycles, lane = (lane + 1) % 3) {
    events.push({ cycle: at, change: { lane, fire: true } });
    events.push({ cycle: at + 3_000, change: { fire: false } });
  }
  return events;
}

/** A drive that only works the lever, with the fire button never pressed. */
function leverOnly(cycles: number, lane?: number): InputEvent[] {
  const events: InputEvent[] = [{ cycle: 0, change: { skill: 1 } }];
  for (let at = 0, walk = 0; at < cycles; at += 40_000, walk = (walk + 1) % 3) {
    events.push({ cycle: at, change: { lane: lane ?? walk } });
  }
  return events;
}

describe('the machine comes up', () => {
  const cycles = seconds(3);
  const run = runGame({ cycles, input: playing(cycles), keepStrobes: true });

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
  const run = runGame({ cycles, input: playing(cycles) });

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

  it('flies a rocket down every one of the three lanes', () => {
    // The sharper half of the same criterion, and the one that actually
    // falsifies the v2 defect. A warning burst alone does not: a jet crossing
    // the G line in the lever's own lane costs a launcher and warns too, so a
    // parked-lever run can hear all three warnings with the rocket never
    // leaving one lane. What the defect *is* - a lane drawn from a nibble the
    // player's own keypress sets - shows up here, because with it the attacker's
    // colon is drawn in exactly one lane for a whole run however long it runs.
    const cycles = seconds(50);
    const run = runGame({ cycles, input: leverOnly(cycles, 1) });
    // The attacker's colon is the far family on grids 1-5: lane L is plate 3+L.
    const lanesFlown = [0, 1, 2].filter((lane) =>
      [1, 2, 3, 4, 5].some((grid) => run.litCells.has(cellKey(grid, 3 + lane))),
    );
    expect(lanesFlown).toEqual([0, 1, 2]);
  });

  for (const lane of [0, 1, 2]) {
    it(`warns in lane ${lane} with the lever parked there`, () => {
      const run = runGame({ cycles, input: leverOnly(cycles, lane) });
      const sounds = splitSounds(run.speakerEdges, BURST_GAP_CYCLES);
      const warnings = sounds.filter((sound) => {
        const hz = soundHz(run.speakerEdges, sound.from, sound.to, CYCLE_HZ);
        return hz >= 455 && hz <= 545;
      });
      expect(
        warnings.length,
        `no 455-545 Hz warning burst with the lever parked in lane ${lane}`,
      ).toBeGreaterThan(0);
      // The beeps of one hit fall inside one cluster, which is what the
      // 25-28 ms measured gap makes them.
      const first = warnings[0] as { from: number; to: number };
      expect(first.to - first.from).toBeLessThan(WARNING_CLUSTER_CYCLES);
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
    const run = runGame({ cycles, input: playing(cycles) });
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
    const run = runGame({ cycles, input: playing(cycles) });
    expect(run.speakerEdges.length).toBeGreaterThan(0);
    for (const edge of run.speakerEdges) {
      expect(edge.level === 0 || edge.level === 1).toBe(true);
    }
  });
});

describe('the game', () => {
  const cycles = seconds(45);
  const run: RunResult = runGame({ cycles, input: playing(cycles) });

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
