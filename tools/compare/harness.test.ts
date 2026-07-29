// The comparison harness's recorder, sweep splitter, score decode and
// comparator.
//
// Paths in this file are relative to the repository root.
//
// The load-bearing test here is `agrees with the probe's own driver` below.
// This module runs the same core over the same ROM as
// `tools/probe/tms1370-probe.ts` and differs from it in exactly one way - it is
// generalised over *which* machine image is running, which the probe
// deliberately is not. Asserting the two produce an identical strobe and edge
// stream is what keeps that generalisation from becoming a second, quietly
// divergent answer about what our machine does.

import { describe, expect, it } from 'vitest';
import { runGame, sweepPeriods } from '../probe/tms1370-probe.js';
import {
  DEFAULT_CYCLES,
  DEFAULT_SWEEPS,
  INPUT_RESPONSE_TOLERANCE_CYCLES,
  Mode,
  SPEAKER_EDGE_TOLERANCE_CYCLES,
  compare,
  cyclesToMillisecondRange,
  framesFrom,
  ourMachineImage,
  readScore,
  record,
  runHarness,
  sameCells,
  validateImage,
  type MachineImage,
} from './harness.js';
import { GRID_COUNT } from '../../src/machine/cpu/tms1370/ports.js';
import { O_PLA_ENTRY_COUNT } from '../../src/machine/cpu/tms1370/opla.js';
import { ROM_WORD_COUNT } from '../../src/machine/cpu/tms1370/registers.js';
import { CYCLE_HZ_MAX, CYCLE_HZ_MIN } from '../../src/machine/cpu/tms1370/timing.js';
import { SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';
import {
  DIGIT_COUNT,
  GRID_SCORE_TENS,
  GRID_SCORE_UNITS,
  digitMask,
} from '../../src/machine/board/o-pla.js';

/**
 * A run long enough to hold several sweeps and short enough to run many times.
 *
 * Twenty sweeps rather than {@link DEFAULT_SWEEPS}: stated in sweeps for the
 * same reason the default is, so that a cadence change moves the wall-clock
 * cost of this file and nothing about what it asserts.
 */
const TEST_SWEEPS = 20;
const TEST_CYCLES = TEST_SWEEPS * SWEEP_INSTRUCTIONS;

const ours = ourMachineImage();

describe('the machine image', () => {
  it('is our own assembled ROM and our own output PLA', () => {
    expect(ours.rom.length).toBe(ROM_WORD_COUNT);
    expect(ours.opla.length).toBeLessThanOrEqual(O_PLA_ENTRY_COUNT);
    expect(ours.provenance).toContain('asm/jetfighter.asm');
    // Slot 0 is darkness, which is what reset writes. A romset-free run that
    // did not hold this would flash at power-on.
    expect(ours.opla[0]).toBe(0);
  });

  it('rejects a program image larger than the ROM the chip addresses', () => {
    const oversized: MachineImage = {
      ...ours,
      name: 'oversized',
      rom: new Uint8Array(ROM_WORD_COUNT + 1),
    };
    expect(() => validateImage(oversized)).toThrow(/2048/);
  });

  it('rejects an output PLA with more entries than a five-bit index reaches', () => {
    const oversized: MachineImage = {
      ...ours,
      name: 'oversized-pla',
      opla: new Uint8Array(O_PLA_ENTRY_COUNT + 1),
    };
    expect(() => validateImage(oversized)).toThrow(/32/);
  });
});

describe('recording a machine image', () => {
  const recording = record(ours, { cycles: TEST_CYCLES });

  it('agrees with the probe’s own driver, strobe for strobe and edge for edge', () => {
    const probed = runGame({ cycles: TEST_CYCLES, keepStrobes: true });
    expect(recording.cycles).toBe(probed.cycles);
    expect(recording.gridsStrobed).toEqual(probed.gridsStrobed);
    expect(recording.firstLitCycle).toBe(probed.firstLitCycle);
    expect(recording.speakerEdges).toEqual(probed.speakerEdges);
    expect(recording.strobes).toEqual(probed.strobes);
    expect(recording.superimposedStrobes).toEqual(probed.superimposedStrobes);
  });

  it('drives every display grid and never superimposes the input columns', () => {
    expect(recording.gridsStrobed).toEqual(
      Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
    );
    expect(recording.superimposedStrobes).toEqual([]);
  });

  it('lights the glass, and lights it inside the matrix the tube defines', () => {
    const frame = recording.frames[0];
    expect(frame).toBeDefined();
    expect(frame?.litCells.size).toBeGreaterThan(0);
    for (const cell of frame?.litCells ?? []) {
      const [grid, plate] = cell.split(':').map(Number);
      expect(grid).toBeGreaterThanOrEqual(0);
      expect(grid).toBeLessThan(GRID_COUNT);
      expect(plate).toBeGreaterThanOrEqual(0);
      expect(plate).toBeLessThan(12);
    }
  });

  it('records a run of complete sweeps, cut at both ends', () => {
    expect(recording.frames.length).toBeGreaterThan(1);
    // Every frame starts where the previous one ended: the boundaries are one
    // sequence, not per-frame guesses.
    for (let at = 1; at < recording.frames.length; at += 1) {
      expect(recording.frames[at]?.fromCycle).toBe(recording.frames[at - 1]?.toCycle);
    }
    // The first sweep begins after power-on rather than at cycle 0: the ROM
    // clears 128 nibbles of RAM before it strobes anything.
    expect(recording.frames[0]?.fromCycle).toBeGreaterThan(0);
  });

  it('splits sweeps on the boundary the probe measures its period between', () => {
    const frames = framesFrom(recording.strobes);
    const periods = sweepPeriods(recording.strobes);
    expect(frames.length).toBe(periods.length);
    expect(frames.map((frame) => frame.toCycle - frame.fromCycle)).toEqual([...periods]);
  });

  it('defaults to a run of whole sweeps', () => {
    expect(DEFAULT_CYCLES).toBe(DEFAULT_SWEEPS * SWEEP_INSTRUCTIONS);
  });
});

describe('reading the score off the glass', () => {
  it('decodes both digits and the two indicators', () => {
    const readout = readScore(digitMask(4) | 0x80, digitMask(2) | 0x80);
    expect(readout.tens).toBe(4);
    expect(readout.units).toBe(2);
    expect(readout.hundreds).toBe(true);
    expect(readout.label).toBe(true);
    expect(readout.value).toBe(142);
  });

  it('reads a blank tens digit as leading-zero suppression, not as unknown', () => {
    const readout = readScore(0, digitMask(7));
    expect(readout.tens).toBeUndefined();
    expect(readout.value).toBe(7);
  });

  it('refuses to round an unreadable pattern to the nearest digit', () => {
    // Segments a and g alone are no numeral. A machine under validation that
    // drew this has a finding, and a nearest-match decode would bury it.
    const readout = readScore(0b1000001, digitMask(3));
    expect(readout.tens).toBeUndefined();
    expect(readout.value).toBeUndefined();
    expect(readout.digitPlates[0]).toBe(0b1000001);
  });

  it('decodes every digit the tube can show', () => {
    for (let digit = 0; digit < DIGIT_COUNT; digit += 1) {
      expect(readScore(0, digitMask(digit)).units).toBe(digit);
    }
  });

  it('is addressed on the two grids the atlas puts the score on', () => {
    const recording = record(ours, { cycles: TEST_CYCLES });
    const cells = recording.frames[0]?.litCells ?? new Set<string>();
    const scoreCells = [...cells].filter((cell) => {
      const grid = Number(cell.split(':')[0]);
      return grid === GRID_SCORE_TENS || grid === GRID_SCORE_UNITS;
    });
    expect(scoreCells.length).toBeGreaterThan(0);
  });
});

describe('comparing two recordings', () => {
  it('matches a machine image against itself', () => {
    const comparison = compare(
      record(ours, { cycles: TEST_CYCLES }),
      record(ours, { cycles: TEST_CYCLES }),
    );
    expect(comparison.matched).toBe(true);
    expect(comparison.frameMismatches).toEqual([]);
    expect(comparison.framesMatched).toBe(comparison.framesCompared);
    expect(comparison.speaker.matched).toBe(true);
    expect(comparison.scoreProgressionAgrees).toBe(true);
  });

  it('is armed: one altered output PLA slot fails the comparison', () => {
    // The mutation case. Without it "matched" is a statement about the
    // comparator having run, not about the two machines agreeing - the same
    // reason `rom-atlas-conformance` carries one.
    //
    // The slot is found rather than named: only a handful of the 32 are reached
    // in an idle run, and a hard-coded index would turn this from a mutation
    // test into a test that a particular slot is still spent where it was.
    const baseline = record(ours, { cycles: TEST_CYCLES });
    const drivenMasks = new Set(baseline.strobes.map((strobe) => strobe.plates & 0xff));
    const slot = [...ours.opla].findIndex((mask) => mask !== 0 && drivenMasks.has(mask));
    expect(slot).toBeGreaterThanOrEqual(0);

    const mutated = new Uint8Array(ours.opla);
    // Flipping the lowest plate changes what reaches the glass without changing
    // an instruction of the program.
    mutated[slot] = (mutated[slot] ?? 0) ^ 0b1;
    const comparison = compare(
      baseline,
      record({ ...ours, name: 'mutated', opla: mutated }, { cycles: TEST_CYCLES }),
    );
    expect(comparison.matched).toBe(false);
    expect(comparison.frameMismatches.length).toBeGreaterThan(0);
    const mismatch = comparison.frameMismatches[0];
    expect((mismatch?.onlyInLeft.length ?? 0) + (mismatch?.onlyInRight.length ?? 0)).toBeGreaterThan(
      0,
    );
  });

  it('reports a different program as a mismatch rather than throwing', () => {
    // An all-zero program is `MNEA` everywhere: it runs, strobes nothing, and
    // is the shape a truncated or wrongly-loaded dump would take. The harness
    // must report that, not crash on it.
    const silent: MachineImage = {
      name: 'blank',
      rom: new Uint8Array(ROM_WORD_COUNT),
      opla: new Uint8Array(O_PLA_ENTRY_COUNT),
      provenance: 'a synthetic all-dark image, this test only',
    };
    const comparison = compare(
      record(ours, { cycles: TEST_CYCLES }),
      record(silent, { cycles: TEST_CYCLES }),
    );
    expect(comparison.matched).toBe(false);
    expect(comparison.frameCountsAgree).toBe(false);
    expect(comparison.right.frames).toEqual([]);
  });

  it('pairs speaker edges within a tolerance derived from the sweep', () => {
    expect(SPEAKER_EDGE_TOLERANCE_CYCLES).toBeGreaterThan(0);
    expect(SPEAKER_EDGE_TOLERANCE_CYCLES).toBeLessThan(SWEEP_INSTRUCTIONS);
    expect(INPUT_RESPONSE_TOLERANCE_CYCLES).toBe(SWEEP_INSTRUCTIONS);
  });

  it('compares sets of cells by content', () => {
    expect(sameCells(new Set(['0:1']), new Set(['0:1']))).toBe(true);
    expect(sameCells(new Set(['0:1']), new Set(['0:2']))).toBe(false);
    expect(sameCells(new Set(['0:1']), new Set(['0:1', '0:2']))).toBe(false);
  });
});

describe('input response timing', () => {
  it('measures each injected contact to the sweep that shows it', () => {
    const at = 5 * SWEEP_INSTRUCTIONS;
    const recording = record(ours, {
      cycles: TEST_CYCLES,
      input: [{ cycle: at, change: { fire: true } }],
    });
    expect(recording.inputResponses).toHaveLength(1);
    const response = recording.inputResponses[0];
    expect(response?.event.cycle).toBe(at);
    // Either it reached the glass or the run was too short to show it; both are
    // reportable, and neither is an error.
    if (response?.litResponseCycles !== undefined) {
      expect(response.litResponseCycles).toBeGreaterThan(0);
    }
  });

  it('pairs the two machines’ responses to the same schedule', () => {
    const input = [{ cycle: 5 * SWEEP_INSTRUCTIONS, change: { lane: 0 } }];
    const comparison = compare(
      record(ours, { cycles: TEST_CYCLES, input }),
      record(ours, { cycles: TEST_CYCLES, input }),
    );
    expect(comparison.inputs).toHaveLength(1);
    expect(comparison.inputs[0]?.matched).toBe(true);
    expect(comparison.inputs[0]?.skewCycles ?? 0).toBe(0);
  });
});

describe('quoting cycles as a duration', () => {
  it('gives a range, because the instruction rate is one', () => {
    const [low, high] = cyclesToMillisecondRange(SWEEP_INSTRUCTIONS);
    expect(low).toBeLessThan(high);
    expect(low).toBeCloseTo((SWEEP_INSTRUCTIONS / CYCLE_HZ_MAX) * 1000, 6);
    expect(high).toBeCloseTo((SWEEP_INSTRUCTIONS / CYCLE_HZ_MIN) * 1000, 6);
  });
});

describe('the two modes', () => {
  it('runs against our own machine image with no romset present', () => {
    const result = runHarness({ cycles: TEST_CYCLES });
    expect(result.mode).toBe(Mode.selfConsistency);
    expect(result.comparison.matched).toBe(true);
    expect(result.comparison.left.image.name).toBe('ours');
    expect(result.comparison.framesCompared).toBeGreaterThan(0);
  });

  it('takes an alternative machine image plus its own output PLA as the target', () => {
    const alternative: MachineImage = {
      ...ours,
      name: 'alternative',
      provenance: 'a copy of our own image standing in for a dump, this test only',
    };
    const result = runHarness({ cycles: TEST_CYCLES, against: alternative });
    expect(result.mode).toBe(Mode.original);
    expect(result.comparison.right.image.name).toBe('alternative');
    expect(result.comparison.matched).toBe(true);
  });
});
