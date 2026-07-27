// Tests for the machine probe.
//
// Two kinds of test live here and they are not interchangeable.
//
// The argument-parsing tests are ordinary unit tests. The rest are the
// acceptance contract's tier-1 criteria V3, V4 and V5 written as assertions:
// they run the real ROM on the real board through the real probe and check the
// properties the contract checks. They exist so that a regression in the ROM, in
// the CPU, in the PWM accumulator or in the probe fails here rather than at the
// end of a marathon run, and they are deliberately written against the same
// invocations the contract quotes.
//
// They are also written to be falsifiable by something that merely looks
// finished. "The two snapshots differ" is satisfied by any drifting animation,
// so criterion V4's test names the launcher segment and asserts it moved lane;
// "the speaker made a noise" is satisfied by any toggling, so criterion V5's
// test measures the period and the burst length.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';
import {
  DEFAULT_CYCLES,
  EXIT,
  formatReport,
  parseArguments,
  parseInputSpec,
  runCli,
  runProbe,
  UsageError,
  type ProbeReport,
  type ProbeStreams,
  type Snapshot,
} from './machine-probe.js';

/**
 * The launcher's grid, and the plates its three lanes sit on.
 *
 * From the segment atlas (src/machine/tube/atlas.json, `launcher_lane0..2`),
 * which is also where jetfighter.asm's GRID_LAUNCH and PAT_LANE take them from.
 */
const LAUNCH_GRID = 5;
const LANE_PLATES = [6, 7, 8];

/** The band contract V5 measures the missile-fire blip against, in hertz. */
const BLIP_HZ_MIN = 1480;
const BLIP_HZ_MAX = 1632;

/** Longest a blip may last, in seconds (contract V5). */
const BLIP_MAX_SECONDS = 0.15;

/**
 * Silence long enough to separate two sounds, in machine cycles.
 *
 * The slowest note the ROM plays is the loss sound's 96 Hz collapse, whose
 * period is ~4150 cycles, and the shortest silence between two sounds is the
 * ~11000-cycle warning-beep gap. 8000 sits between them, so this splits sounds
 * without splitting a note in half.
 */
const BURST_GAP_CYCLES = 8000;

/**
 * Blips in the missile band one held press may account for.
 *
 * One for the launch itself, and the rest for missiles that go on to hit
 * something: a hit makes the same sound (audio-reference.md, missileFire). A
 * level-triggered ROM would emit one per sweep, i.e. thirty or more.
 */
const MAX_BLIPS_PER_HELD_PRESS = 4;

/** Split an edge stream into the individual sounds that produced it. */
function splitBursts(edges: ProbeReport['speakerEdges']): ProbeReport['speakerEdges'][] {
  const bursts: (readonly [number, number])[][] = [];
  let current: (readonly [number, number])[] = [];
  for (const edge of edges) {
    const previous = current[current.length - 1];
    if (previous !== undefined && edge[0] - previous[0] > BURST_GAP_CYCLES) {
      bursts.push(current);
      current = [];
    }
    current.push(edge);
  }
  if (current.length > 0) {
    bursts.push(current);
  }
  return bursts;
}

/** Run the CLI, capturing what it wrote to each stream. */
function run(args: readonly string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const streams: ProbeStreams = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  return { code: runCli(args, streams), out, err };
}

/** Which plates lit under one grid in a snapshot. */
function platesUnder(snapshot: Snapshot, grid: number): number[] {
  return snapshot.litSegments.filter(([g]) => g === grid).map(([, plate]) => plate);
}

describe('parseInputSpec', () => {
  it('reads name=value@cycle', () => {
    expect(parseInputSpec('lever=up@200000')).toEqual({
      control: 'lever',
      value: 'up',
      cycle: 200000,
      spec: 'lever=up@200000',
    });
  });

  it('reads a bare name@cycle, which presses the control', () => {
    expect(parseInputSpec('fire@200000')).toEqual({
      control: 'fire',
      cycle: 200000,
      spec: 'fire@200000',
    });
  });

  it('splits the cycle off at the last @, so a value may contain one', () => {
    expect(parseInputSpec('skill=2@0').cycle).toBe(0);
  });

  it('rejects a spec with no cycle', () => {
    expect(() => parseInputSpec('lever=up')).toThrow(UsageError);
  });

  it('rejects a cycle that is not a whole number', () => {
    expect(() => parseInputSpec('lever=up@1e5')).toThrow(/bad cycle/);
    expect(() => parseInputSpec('lever=up@-1')).toThrow(/bad cycle/);
    expect(() => parseInputSpec('lever=up@2.5')).toThrow(/bad cycle/);
  });

  it('rejects a spec that names no control', () => {
    expect(() => parseInputSpec('@100')).toThrow(/names no control/);
  });
});

describe('parseArguments', () => {
  it('defaults to the contract cycle count, no inputs and no edge stream', () => {
    const options = parseArguments([]);
    expect(options.cycles).toBe(DEFAULT_CYCLES);
    expect(options.inputs).toEqual([]);
    expect(options.emitEdges).toBe(false);
  });

  it('defaults the ROM to asm/jetfighter.asm, independent of the working directory', () => {
    expect(parseArguments([]).romSource).toBe(
      resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm'),
    );
  });

  it('accepts --flag value and --flag=value alike', () => {
    expect(parseArguments(['--cycles', '1000']).cycles).toBe(1000);
    expect(parseArguments(['--cycles=1000']).cycles).toBe(1000);
  });

  it('collects every --input, and keeps the order they were written in', () => {
    const options = parseArguments(['--input', 'fire@100', '--input=lever=down@200']);
    expect(options.inputs.map((event) => event.spec)).toEqual(['fire@100', 'lever=down@200']);
  });

  it('turns the edge stream on with --emit-edges', () => {
    expect(parseArguments(['--emit-edges']).emitEdges).toBe(true);
  });

  it('rejects a cycle count that is not a positive whole number', () => {
    expect(() => parseArguments(['--cycles', '0'])).toThrow(UsageError);
    expect(() => parseArguments(['--cycles', 'lots'])).toThrow(UsageError);
  });

  it('rejects an unknown option and a stray positional argument', () => {
    expect(() => parseArguments(['--frames', '2'])).toThrow(/unknown option/);
    expect(() => parseArguments(['rom.asm'])).toThrow(/takes options only/);
  });

  it('rejects a flag with nothing after it', () => {
    expect(() => parseArguments(['--input'])).toThrow(/needs a value/);
  });
});

describe('the report', () => {
  it('is one line of JSON with exactly the six contract keys', () => {
    const report = runProbe(parseArguments(['--cycles', '60000']));
    const text = formatReport(report);
    expect(text.trimEnd()).not.toContain('\n');
    expect(Object.keys(JSON.parse(text) as ProbeReport).sort()).toEqual([
      'gridsStrobed',
      'ramNibbles',
      'romWords',
      'snapshots',
      'speakerEdges',
      'strobeCycles',
    ]);
  });

  it('keeps speakerEdges present but empty without --emit-edges', () => {
    const report = runProbe(parseArguments(['--cycles', '60000', '--input', 'fire@10000']));
    expect(report.speakerEdges).toEqual([]);
  });

  it("reports the assembler's own figures for the ROM it ran", () => {
    const report = runProbe(parseArguments(['--cycles', '20000']));
    // The two hardware ceilings, as contract V1 reads them out of the listing.
    expect(report.romWords).toBeGreaterThanOrEqual(200);
    expect(report.ramNibbles).toBeLessThanOrEqual(160);
  });

  it('exits 0 and writes the object to stdout', () => {
    const { code, out, err } = run(['--cycles', '20000']);
    expect(code).toBe(EXIT.ok);
    expect(err).toBe('');
    expect(() => JSON.parse(out) as ProbeReport).not.toThrow();
  });

  it('exits 2 with usage on a bad command line, writing nothing to stdout', () => {
    const { code, out, err } = run(['--cycles', 'soon']);
    expect(code).toBe(EXIT.usage);
    expect(out).toBe('');
    expect(err).toContain('Usage:');
  });

  it('exits 2 when an input names a control the case does not have', () => {
    const { code, err } = run(['--cycles', '20000', '--input', 'throttle=up@100']);
    expect(code).toBe(EXIT.usage);
    expect(err).toContain('throttle=up@100');
  });
});

describe('snapshot cadence', () => {
  it('yields exactly one snapshot with no input - the baseline', () => {
    expect(runProbe(parseArguments(['--cycles', '60000'])).snapshots).toHaveLength(1);
  });

  it('yields exactly two with one input, the second after the first', () => {
    const report = runProbe(
      parseArguments(['--cycles', '60000', '--input', 'lever=down@20000']),
    );
    expect(report.snapshots).toHaveLength(2);
    expect(report.snapshots[1]!.atCycle).toBeGreaterThan(report.snapshots[0]!.atCycle);
  });

  it('takes the baseline before any input reaches the machine', () => {
    const report = runProbe(
      parseArguments(['--cycles', '60000', '--input', 'lever=up@20000']),
    );
    expect(report.snapshots[0]!.atCycle).toBeLessThan(20000);
    // The lever rests in the centre lane until the probe moves it (input.ts).
    expect(platesUnder(report.snapshots[0]!, LAUNCH_GRID)).toContain(LANE_PLATES[1]);
  });

  it('applies events in cycle order however the command line was written', () => {
    const report = runProbe(
      parseArguments([
        '--cycles',
        '80000',
        '--input',
        'lever=down@40000',
        '--input',
        'lever=up@20000',
      ]),
    );
    expect(report.snapshots).toHaveLength(3);
    expect(platesUnder(report.snapshots[1]!, LAUNCH_GRID)).toContain(LANE_PLATES[0]);
    expect(platesUnder(report.snapshots[2]!, LAUNCH_GRID)).toContain(LANE_PLATES[2]);
  });
});

// --- The acceptance contract, as assertions --------------------------------

describe('contract V3: the CPU executes our ROM and drives the tube', () => {
  const report = runProbe(parseArguments(['--cycles', '400000']));

  it('executed machine cycles', () => {
    expect(report.strobeCycles).toBeGreaterThan(0);
  });

  it('strobed every grid from 0 to 9 - the full display sweep', () => {
    expect(report.gridsStrobed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('lit segments in the baseline snapshot', () => {
    expect(report.snapshots[0]!.litSegments.length).toBeGreaterThan(0);
  });

  it('gives at least one segment a duty strictly between 0 and 1', () => {
    // The falsifier: a ROM that wrote the plate bus once and left it would
    // report duty 1, and a dark tube would report no segments at all. A real
    // ten-grid sweep puts every lit segment near 0.1.
    const fractional = report.snapshots[0]!.litSegments.filter(
      ([, , duty]) => duty > 0 && duty < 1,
    );
    expect(fractional.length).toBeGreaterThan(0);
  });
});

describe('contract V4: the launcher moves lanes when the lever does', () => {
  const report = runProbe(parseArguments(['--cycles', '400000', '--input', 'lever=up@200000']));

  it('produced both snapshots', () => {
    expect(report.snapshots).toHaveLength(2);
  });

  it('changed what the tube showed', () => {
    expect(report.snapshots[1]!.litSegments).not.toEqual(report.snapshots[0]!.litSegments);
  });

  it('moved the launcher itself, not merely something on the screen', () => {
    // Named explicitly because the enemy jet walks across the tube on its own:
    // "the snapshots differ" would pass with the lever disconnected entirely.
    const before = platesUnder(report.snapshots[0]!, LAUNCH_GRID);
    const after = platesUnder(report.snapshots[1]!, LAUNCH_GRID);
    expect(before).toContain(LANE_PLATES[1]);
    expect(after).toContain(LANE_PLATES[0]);
    expect(after).not.toContain(LANE_PLATES[1]);
  });
});

describe('contract V5: pressing fire produces the missile blip on D14', () => {
  const report = runProbe(
    parseArguments(['--cycles', '400000', '--input', 'fire@200000', '--emit-edges']),
  );
  const edges = report.speakerEdges;
  const bursts = splitBursts(edges);
  const blip = bursts[0] ?? [];

  it('emitted an edge stream', () => {
    expect(edges.length).toBeGreaterThan(0);
  });

  it('put every transition after the press, and none before it', () => {
    expect(edges.every(([cycle]) => cycle > 200000)).toBe(true);
  });

  it('alternates levels, starting from the resting level', () => {
    expect(edges[0]![1]).toBe(1);
    edges.forEach(([, level], index) => {
      expect(level).toBe(index % 2 === 0 ? 1 : 0);
    });
  });

  it('holds a period inside the 1480-1632 Hz band measured from the real unit', () => {
    // Period, not an FFT: the contract's verifier reconstructs and transforms
    // the waveform, and the property that survives that is the spacing of the
    // rising edges. Measuring it directly says the same thing without a
    // thousand-line dependency-free FFT in a unit test.
    //
    // The first burst is the launch, because the press is the first thing that
    // makes any noise. Later bursts in the same run are other game sounds - the
    // jet march, the battleship, a launcher-hit warning - and are measured
    // against their own bands in the ROM's sound table, not against this one.
    const risingCycles = blip.filter(([, level]) => level === 1).map(([cycle]) => cycle);
    const periods = risingCycles.slice(1).map((cycle, index) => cycle - risingCycles[index]!);
    expect(periods.length).toBeGreaterThan(8);
    for (const period of periods) {
      const hz = CYCLE_HZ / period;
      expect(hz).toBeGreaterThanOrEqual(BLIP_HZ_MIN);
      expect(hz).toBeLessThanOrEqual(BLIP_HZ_MAX);
    }
  });

  it('keeps the burst shorter than 150 ms', () => {
    const span = blip[blip.length - 1]![0] - blip[0]![0];
    expect(span / CYCLE_HZ).toBeLessThan(BLIP_MAX_SECONDS);
  });

  it('blips once for a press, not once per sweep it is held for', () => {
    // The button is held from cycle 200000 to the end of the run - some thirty
    // display sweeps. A ROM that retriggered on the level rather than the edge
    // would launch on every one of them, so the count of bursts in the missile
    // band is the property under test, not the count of edges: the ROM also
    // beeps on a hit (the same sound, owner-confirmed) and makes other noises.
    const blipsInBand = bursts.filter((burst) => {
      const rising = burst.filter(([, level]) => level === 1).map(([cycle]) => cycle);
      if (rising.length < 2) {
        return false;
      }
      const hz = CYCLE_HZ / (rising[1]! - rising[0]!);
      return hz >= BLIP_HZ_MIN && hz <= BLIP_HZ_MAX;
    });
    expect(blipsInBand.length).toBeGreaterThan(0);
    expect(blipsInBand.length).toBeLessThanOrEqual(MAX_BLIPS_PER_HELD_PRESS);
    // Each one is the same fixed shape: four bursts of sixteen periods.
    for (const inBand of blipsInBand) {
      expect(inBand).toHaveLength(128);
    }
  });
});
