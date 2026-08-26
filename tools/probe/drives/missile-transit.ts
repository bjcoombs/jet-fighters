// How fast does a shot cross the real tube?
//
// This is the only drive here that measures the *device* rather than the
// emulated machine. It reads `assets/reference/skill3-video-cells.csv` - the
// owner's skill-3 recording reduced to one brightness number per playfield cell
// per frame by `tools/video/cells.py` - and links lit cells into tracks.
//
// The question it answers is the owner's third gameplay complaint: *the speed of
// the bullets that I fire is currently slow*. `asm/jetfighter.asm` flies a shot
// one column per `MISSILE_LO`/`MISSILE_HI` reload, which is 32 sweeps, which is
// 500 ms. **The recording says 133 ms, and no shot in it is slower than 208 ms.**
//
// ## Why tracks and not steps
//
// Four earlier attempts on this recording produced artefacts, and all four
// failed the same way: they timed a *single step*. The tube is PWM-refreshed at
// around 70 Hz and the camera samples at 30, so any per-step measure beats
// between the two and lands on an exact frame multiple - 0.133 s, 0.167 s - that
// looks like a reading and is not one. Timing a whole traverse instead puts
// twenty-odd frames between the endpoints, where one frame of aliasing is 4% and
// not 25%.
//
// ## Why there is a negative control in a measurement drive
//
// Linking is the dangerous step. Give a linker a loose enough gate and it will
// find a track in anything, because with 200 lit runs across 7 columns some
// chain of three always exists. So the drive re-runs its own linker on the same
// runs with their start times randomised - same count, same durations, same
// cell - and reports both. A direction whose real count does not stand clear of
// its shuffled count has not been measured.
//
// **Leftward - a shot leaving the G line: 21 tracks against 2.5 +- 1.5 shuffled,
// z = +12.0.** Measured, and it agrees to the millisecond with a wholly separate
// extraction that timed 51 column steps in 20 flights.
//
// ## What this drive cannot see, and why its silence is not evidence
//
// **The jets are red. The tracer that feeds this drive isolates cyan.** So this
// instrument is blind to the squadron by construction, and its rightward count -
// 1 track against 2.3 +- 1.2 shuffled - says nothing whatever about whether jets
// crossed the recording. They did: the same clip yields 12 rightward handoffs and
// step intervals of 267, 300 and 467 ms once the red channel is read.
//
// An earlier version of this header reported that rightward count as a finding,
// and an earlier version of the test asserted it. Both were wrong in the way this
// project keeps having to relearn - a negative from an instrument that cannot
// resolve the signal is a fact about the instrument. The drive still runs the
// rightward control, because it is the honest denominator for the leftward one,
// but no conclusion is drawn from it here.
//
// **A second reason, which matters to whoever fixes the first.** Reading the red
// channel is necessary and not sufficient: {@link LINK_GATE_FRAMES} is 12 frames,
// 400 ms, and the squadron's measured step intervals are 267, 300 and **467 ms**.
// The longest of the three is already outside the gate, and the chain rule
// compounds it - one handoff refused ends the whole track. So a future version
// that feeds red runs into this linker unchanged would produce another negative,
// and it would look exactly like this one. The gate is sized for a shot crossing
// a column in 133 ms; a march is three to four times slower and needs its own.
//
// `missile-transit.test.ts` holds this drive's floors.
//
// Paths in this file are relative to the repository root.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from './entry-point.js';

const CELLS_CSV = fileURLToPath(
  new URL('../../../assets/reference/skill3-video-cells.csv', import.meta.url),
);

/** The recording's frame rate. Every duration here is frames / this. */
export const FRAMES_PER_SECOND = 30;

/** Columns of the printed overlay. c0 is the battleship zone, c6 the G line. */
const COLUMNS = 7;
const ROWS = 3;
/** The jet fighter flying zone: the cells a shot crosses and a jet marches down. */
const FLYING_ZONE = { first: 1, last: 5 } as const;

/**
 * Brightness above which a cell counts as lit.
 *
 * The CSV is scaled per cell to its own [p20, p99], so this is a fraction of
 * that cell's own range rather than an absolute. Measured leftward track counts
 * at 0.20 and 0.12 differ by two and three; the figure is not delicate.
 */
const LIT = 0.32;

/** Frames a cell must stay lit to be a run rather than a flicker. */
const MIN_RUN_FRAMES = 2;

/**
 * Frames allowed between one cell lighting and the next.
 *
 * 12 frames is 0.4 s, nearly three times the measured 133 ms step, so a real
 * shot never outruns it. It is also the gate that keeps the control clean: at
 * 90 frames both directions collapse into their shuffled counts.
 */
const LINK_GATE_FRAMES = 12;

/** Columns a chain must span to be a track. Three means two steps to average. */
const MIN_TRACK_COLUMNS = 3;

/** Shuffles behind the negative control. */
const CONTROL_TRIALS = 40;

export type Direction = 'leftward' | 'rightward';

export interface Track {
  readonly direction: Direction;
  readonly row: number;
  readonly columns: readonly number[];
  readonly startFrame: number;
  readonly endFrame: number;
  /** Seconds per column, averaged over this track's steps. */
  readonly secondsPerColumn: number;
}

export interface DirectionResult {
  readonly direction: Direction;
  readonly tracks: readonly Track[];
  readonly shuffledMean: number;
  readonly shuffledDeviation: number;
  /** How many deviations the real count stands above the shuffled one. */
  readonly z: number;
}

export interface MissileTransitResult {
  readonly frames: number;
  readonly usableFrames: number;
  readonly runs: number;
  readonly leftward: DirectionResult;
  readonly rightward: DirectionResult;
  readonly medianSecondsPerColumn: number;
  readonly fullTraverses: readonly Track[];
}

interface Run {
  readonly column: number;
  readonly row: number;
  readonly start: number;
  readonly length: number;
}

interface Sample {
  readonly usable: boolean[];
  readonly cells: number[][][];
}

const readSamples = (): Sample => {
  const lines = readFileSync(CELLS_CSV, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const header = lines[0].split(',');
  if (header[0] !== 'frame' || header[1] !== 'registered') {
    throw new Error(`${CELLS_CSV} does not start with frame,registered - regenerate it`);
  }
  const usable: boolean[] = [];
  const cells: number[][][] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(',');
    if (fields.length !== 2 + COLUMNS * ROWS) {
      throw new Error(`${CELLS_CSV} row has ${fields.length} fields, expected ${2 + COLUMNS * ROWS}`);
    }
    usable.push(fields[1] === '1');
    const frame: number[][] = [];
    for (let column = 0; column < COLUMNS; column += 1) {
      const row: number[] = [];
      for (let r = 0; r < ROWS; r += 1) row.push(Number(fields[2 + column * ROWS + r]));
      frame.push(row);
    }
    cells.push(frame);
  }
  return { usable, cells };
};

/** Contiguous stretches in which one cell is lit. An unusable frame ends a run. */
const runsOf = (sample: Sample): Run[] => {
  const found: Run[] = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      let start: number | null = null;
      const close = (end: number): void => {
        if (start !== null && end - start >= MIN_RUN_FRAMES) {
          found.push({ column, row, start, length: end - start });
        }
        start = null;
      };
      for (let frame = 0; frame < sample.usable.length; frame += 1) {
        if (!sample.usable[frame]) close(frame);
        else if (sample.cells[frame][column][row] > LIT) start ??= frame;
        else close(frame);
      }
      close(sample.usable.length);
    }
  }
  return found.sort((a, b) => a.start - b.start);
};

/**
 * Chain runs into tracks moving one column at a time in `step`'s direction.
 *
 * A run is claimed by at most one track, and the earliest continuation wins, so
 * two shots crossing the same row cannot be spliced into one.
 */
const link = (runs: readonly Run[], step: 1 | -1, gate: number): Track[] => {
  const claimed = new Set<number>();
  const tracks: Track[] = [];
  for (let seed = 0; seed < runs.length; seed += 1) {
    if (claimed.has(seed)) continue;
    const origin = runs[seed];
    if (step > 0 && origin.column === COLUMNS - 1) continue;
    if (step < 0 && origin.column === 0) continue;
    const chain = [seed];
    let column = origin.column;
    let frame = origin.start;
    for (;;) {
      let next: number | null = null;
      for (let candidate = 0; candidate < runs.length; candidate += 1) {
        if (claimed.has(candidate) || chain.includes(candidate)) continue;
        const run = runs[candidate];
        if (run.column !== column + step || run.row !== origin.row) continue;
        const gap = run.start - frame;
        if (gap < 1 || gap > gate) continue;
        if (next === null || run.start < runs[next].start) next = candidate;
      }
      if (next === null) break;
      chain.push(next);
      column = runs[next].column;
      frame = runs[next].start;
    }
    if (chain.length < MIN_TRACK_COLUMNS) continue;
    for (const index of chain) claimed.add(index);
    const startFrame = runs[chain[0]].start;
    const endFrame = runs[chain[chain.length - 1]].start;
    tracks.push({
      direction: step < 0 ? 'leftward' : 'rightward',
      row: origin.row,
      columns: chain.map((index) => runs[index].column),
      startFrame,
      endFrame,
      secondsPerColumn: (endFrame - startFrame) / FRAMES_PER_SECOND / (chain.length - 1),
    });
  }
  return tracks.sort((a, b) => a.startFrame - b.startFrame);
};

/** A reproducible generator: a drive that shuffles differently each run is not one. */
const generator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = (runs: readonly Run[], frames: number, random: () => number): Run[] =>
  runs.map((run) => ({
    ...run,
    start: Math.floor(random() * Math.max(1, frames - run.length)),
  }));

const control = (
  runs: readonly Run[],
  frames: number,
  step: 1 | -1,
  real: number,
): Omit<DirectionResult, 'direction' | 'tracks'> => {
  const random = generator(0x5eed);
  const counts: number[] = [];
  for (let trial = 0; trial < CONTROL_TRIALS; trial += 1) {
    counts.push(link(shuffle(runs, frames, random).sort((a, b) => a.start - b.start), step, LINK_GATE_FRAMES).length);
  }
  const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
  const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length;
  const deviation = Math.sqrt(variance);
  return { shuffledMean: mean, shuffledDeviation: deviation, z: (real - mean) / (deviation + 1e-9) };
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const runMissileTransit = (): MissileTransitResult => {
  const sample = readSamples();
  const frames = sample.usable.length;
  const runs = runsOf(sample);

  const leftwardTracks = link(runs, -1, LINK_GATE_FRAMES);
  const rightwardTracks = link(runs, 1, LINK_GATE_FRAMES);

  const leftward: DirectionResult = {
    direction: 'leftward',
    tracks: leftwardTracks,
    ...control(runs, frames, -1, leftwardTracks.length),
  };
  const rightward: DirectionResult = {
    direction: 'rightward',
    tracks: rightwardTracks,
    ...control(runs, frames, 1, rightwardTracks.length),
  };

  const spans = leftwardTracks.map((track) => track.secondsPerColumn);
  const fullTraverses = leftwardTracks.filter(
    (track) =>
      Math.max(...track.columns) >= FLYING_ZONE.last &&
      Math.min(...track.columns) <= FLYING_ZONE.first,
  );

  return {
    frames,
    usableFrames: sample.usable.filter(Boolean).length,
    runs: runs.length,
    leftward,
    rightward,
    medianSecondsPerColumn: median(spans),
    fullTraverses,
  };
};

const report = (result: MissileTransitResult): void => {
  const seconds = (frames: number): string => (frames / FRAMES_PER_SECOND).toFixed(2);
  console.log(
    `${result.frames} frames, ${result.usableFrames} usable (${((100 * result.usableFrames) / result.frames).toFixed(0)}%), ${result.runs} lit runs\n`,
  );

  for (const direction of [result.leftward, result.rightward] as const) {
    const what = direction.direction === 'leftward' ? 'a shot leaving the G line' : 'a jet marching toward the G line';
    const verdict = direction.z > 3 ? 'MEASURED' : direction.z > 1.5 ? 'marginal' : 'indistinguishable from chance';
    console.log(
      `${direction.direction} - ${what}\n` +
        `  ${direction.tracks.length} tracks, shuffled control ${direction.shuffledMean.toFixed(1)} +- ${direction.shuffledDeviation.toFixed(1)}, z = ${direction.z >= 0 ? '+' : ''}${direction.z.toFixed(1)}  -> ${verdict}`,
    );
  }

  console.log('\nshot tracks, earliest first:');
  for (const track of result.leftward.tracks) {
    console.log(
      `  t=${seconds(track.startFrame)}s row${track.row} cols ${track.columns.join('')}  ` +
        `${track.columns.length - 1} steps in ${seconds(track.endFrame - track.startFrame)}s  ` +
        `-> ${track.secondsPerColumn.toFixed(3)} s/column`,
    );
  }

  console.log(
    `\nmedian ${result.medianSecondsPerColumn.toFixed(3)} s per column over ${result.leftward.tracks.length} shots.`,
  );
  for (const track of result.fullTraverses) {
    console.log(
      `  full traverse of the flying zone at t=${seconds(track.startFrame)}s: ` +
        `${seconds(track.endFrame - track.startFrame)}s`,
    );
  }
  console.log(
    '\nasm/jetfighter.asm flies a shot one column per 32 sweeps = 0.500 s/column.\n' +
      `The recording says ${result.medianSecondsPerColumn.toFixed(3)} s/column - ` +
      `${(0.5 / result.medianSecondsPerColumn).toFixed(1)}x faster than the ROM.`,
  );
};

if (isEntryPoint(import.meta.url)) report(runMissileTransit());
