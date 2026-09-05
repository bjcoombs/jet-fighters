// The whole speaker path, driven the way the browser drives it.
//
// ## Why this file exists
//
// Every other test in this directory holds one link of the chain still and
// exercises the next. `edge-buffer.test.ts` hands the buffer edges directly,
// `driver.test.ts` pulls the driver by hand, `spectral.test.ts` reconstructs a
// synthetic edge list. All of them passed while the build was reported silent,
// twice, because none of them ran the two clocks the real page has against each
// other:
//
//   - the machine's, which is `requestAnimationFrame` - bursty, ~16.7 ms apart,
//     and never quite real time; and
//   - the output's, which is the audio hardware pulling a 128-frame quantum
//     every 2.67 ms whatever the main thread is doing.
//
// Both faults fixed so far were in how those two are related, not in the
// waveform, and neither was visible to a test that drove one of them by hand.
// So this file runs `src/main.ts`'s frame loop against the real ROM and the
// real `Board`, through the real `SpeakerDriver` and a transport that copies
// the worklet processor's ring buffer, and asserts on the samples that come out
// of the far end - the same place an `AnalyserNode` in front of the destination
// would read.
//
// ## The six-second cap is not arbitrary
//
// Every run here is six seconds because an unattended machine plays a whole
// game and reaches an ending, after which the ROM never touches R15 again -
// so past that point this file would be measuring silence, not the transport.
// The exact moment moves whenever a game rule or a cadence constant does: it
// was 5.66 s while a single capture ended the game and is around 10.9 s now
// that three captures are survivable. Six seconds is inside both, which is why
// it is the cap rather than the ending itself.
//
// That the sound stops is not an audio fault and is not fixed here. Reproduce
// the ending with:
//
//   npx vite-node tools/probe/machine-probe.ts --cycles 24000000 --emit-edges
//
// Extending any run below past the ending fails on the held level, and the
// fault it would be reporting lives in the program, not in this directory.
// tools/probe/game-lifetime.test.ts is where that argument is held down.
//
// Node-side test: no DOM, no browser globals, no AudioContext.

import { describe, it, expect } from 'vitest';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../../../tools/tmsasm/assembler.js';
import { oplaImage, romImage } from '../../../tools/tmsasm/output.js';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { Board } from '../board/board.js';
import {
  SPEAKER_WORKLET_SOURCE,
  SpeakerDriver,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type AudioWorkletNodeLike,
  type GainNodeLike,
  type MessagePortLike,
  type SpeakerDriverStats,
} from './driver.js';

const SAMPLE_RATE = 48_000;

/** The Web Audio render quantum - what the hardware asks for at a time. */
const QUANTUM = 128;

/** One display frame at 60 Hz, the interval `requestAnimationFrame` runs at. */
const FRAME_MS = 1000 / 60;

/** `MAX_FRAME_MS` from src/app/driver.ts, copied not imported - the driver is the page's clock, and this loop is a transcription of it. */
const MAX_FRAME_MS = 100;

/** Seconds per run. See "The six-second cap is not arbitrary" above. */
const RUN_SECONDS = 6;

/**
 * Held level a run's realignments can cost, in milliseconds of output.
 *
 * The driver holds the last level for up to a buffer latency while it re-anchors
 * on the machine's cycle stamps, so any ceiling on a flat stretch has to allow
 * for those on top of whatever the ROM was going to be quiet for anyway. It is
 * wall-clock slack on the *output* side and does not move with the machine's
 * cycle rate, which is why it is a figure rather than a derivation.
 */
const REALIGN_SLACK_MS = 500;

class FakeNode implements AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike {
    return destination;
  }
  disconnect(): void {}
}

class FakeParam implements AudioParamLike {
  value = 1;
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

/**
 * The worklet processor, on the test's side of the port.
 *
 * `process()` is a transcription of the processor in `SPEAKER_WORKLET_SOURCE`:
 * same ring of posted blocks, same read offset, same zero fill on underrun,
 * same `pull` when the queue drops below target. The port protocol the two
 * agree on is asserted against the real source below, so renaming a message
 * breaks this file rather than quietly making it measure nothing.
 */
class FakeWorkletNode extends FakeNode implements AudioWorkletNodeLike {
  readonly port: MessagePortLike;
  readonly targetFrames: number;

  private _blocks: Float32Array[] = [];
  private _offset = 0;
  private _depth = 0;

  constructor(
    _context: AudioContextLike,
    _name: string,
    options?: { processorOptions?: Record<string, unknown> },
  ) {
    super();
    this.targetFrames = Number(options?.processorOptions?.targetFrames ?? 1440);
    this.port = {
      onmessage: null,
      // Arrow, so the port's inbound half reaches this node's ring buffer.
      postMessage: (message: unknown): void => {
        const parsed = message as { type?: string; samples?: Float32Array } | null;
        if (!parsed) return;
        if (parsed.type === 'samples' && parsed.samples && parsed.samples.length > 0) {
          this._blocks.push(parsed.samples);
          this._depth += parsed.samples.length;
        } else if (parsed.type === 'flush') {
          this._blocks.length = 0;
          this._offset = 0;
          this._depth = 0;
        }
      },
    };
  }

  /** One render quantum, exactly as the worklet's `process()` produces it. */
  process(frames: number): Float32Array {
    const channel = new Float32Array(frames);
    let written = 0;
    while (written < frames && this._blocks.length > 0) {
      const block = this._blocks[0]!;
      const take = Math.min(frames - written, block.length - this._offset);
      channel.set(block.subarray(this._offset, this._offset + take), written);
      written += take;
      this._offset += take;
      this._depth -= take;
      if (this._offset >= block.length) {
        this._blocks.shift();
        this._offset = 0;
      }
    }
    for (let i = written; i < frames; i += 1) channel[i] = 0;

    if (this._depth < this.targetFrames) {
      this.port.onmessage?.({ data: { type: 'pull', frames: this.targetFrames - this._depth } });
    }
    return channel;
  }
}

class FakeContext implements AudioContextLike {
  readonly sampleRate = SAMPLE_RATE;
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly audioWorklet = {
    addModule: async (): Promise<void> => {},
  };
  createGain(): GainNodeLike {
    return new FakeGain();
  }
  async resume(): Promise<void> {}
}

/** A board holding the real game ROM, powered off. */
function romBoard(): Board {
  const path = resolve(import.meta.dirname, '..', '..', '..', 'asm', 'jetfighter.asm');
  const assembly = assemble(readFileSync(path, 'utf8'), path, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });
  return new Board({ rom: romImage(assembly), opla: oplaImage(assembly) }, { power: 'off' });
}

/** What a run of the page produced, at the far end of the transport. */
interface RunResult {
  /** Peak-to-peak of everything the transport played. */
  readonly peakToPeak: number;
  /**
   * Times the played signal crossed between the high and low rails.
   *
   * One per pin transition that survived the whole path, so comparing it with
   * `stats.edgesConsumed` says what fraction of the ROM's sound was actually
   * heard - the measure that separates "arrived intact" from "moved once".
   */
  readonly crossings: number;
  /** Longest unbroken stretch of one constant value, in milliseconds. */
  readonly longestFlatMs: number;
  readonly stats: SpeakerDriverStats;
}

interface RunOptions {
  /** Seconds of wall clock to simulate. */
  readonly seconds: number;
  /**
   * Fraction of real time the animation frame loop actually delivers.
   *
   * 1 is a page whose frames land on the 60 Hz beat. Below 1 is a page whose
   * frames are late - a busy tab, a slow machine - so the machine falls behind
   * the audio clock at that rate and every burst of edges arrives behind the
   * playhead. That is the condition the realign path exists to survive, and the
   * condition under which a transport that re-arms its hold faster than the
   * hold drains goes silent and stays silent.
   */
  readonly frameRate?: number;
  /** Milliseconds at which the fire contact closes; it opens 100 ms later. */
  readonly fireAtMs?: readonly number[];
  /** [startMs, endMs] during which no animation frame is delivered at all. */
  readonly blackoutMs?: readonly [number, number];
}

/**
 * Run `src/main.ts`'s frame loop against the audio hardware's pull, and measure
 * every sample the transport plays.
 *
 * Both clocks advance against one virtual wall clock, so the test is
 * deterministic: the audio side consumes a quantum per 128/48000 s, and the
 * frame loop fires whenever that clock passes its next due time.
 */
async function runPage(options: RunOptions): Promise<RunResult> {
  const { seconds, frameRate = 1, blackoutMs } = options;
  const fireAt = [...(options.fireAtMs ?? [])];

  const board = romBoard();
  const cyclesPerSecond = CYCLE_HZ;
  const context = new FakeContext();

  // The driver builds the node; this test has to hold it to pump quanta out.
  let node: FakeWorkletNode | null = null;
  const remember = (created: FakeWorkletNode): void => {
    node = created;
  };
  const driver = new SpeakerDriver({
    context,
    source: board,
    cyclesPerSecond,
    mode: 'worklet',
    audioWorkletNodeCtor: class extends FakeWorkletNode {
      constructor(
        ctx: AudioContextLike,
        name: string,
        opts?: { processorOptions?: Record<string, unknown> },
      ) {
        super(ctx, name, opts);
        remember(this);
      }
    },
    createModuleUrl: () => 'blob:test',
    revokeModuleUrl: () => {},
  });

  // src/main.ts's order on the first input: build the speaker and kick start(),
  // then throw the power switch inside the same handler. start() has not
  // resolved by then, so the machine is already running when the graph appears
  // and the playhead is already past the ROM's first transition.
  const starting = driver.start();
  board.powerOn();
  driver.reset();
  await starting;

  // The frame loop, transcribed from src/main.ts.
  let owed = 0;
  let lastFrameMs: number | null = null;
  const frame = (nowMs: number): void => {
    const elapsedMs = lastFrameMs === null ? 0 : Math.min(nowMs - lastFrameMs, MAX_FRAME_MS);
    lastFrameMs = nowMs;
    if (board.power.state === 'on' && board.running) {
      owed += (elapsedMs / 1000) * cyclesPerSecond;
      const budget = Math.floor(owed);
      if (budget > 0) {
        const executed = board.step(budget);
        owed = executed === 0 ? 0 : owed - executed;
      }
    } else {
      owed = 0;
    }
    driver.pump();
  };

  const quanta = Math.floor((seconds * SAMPLE_RATE) / QUANTUM);
  const msPerQuantum = (QUANTUM / SAMPLE_RATE) * 1000;
  let nowMs = 0;
  let nextFrameMs = 0;
  let fireOpensAtMs: number | null = null;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let flat = 0;
  let longestFlat = 0;
  let crossings = 0;
  let rail = 0;
  let previous: number | null = null;

  for (let q = 0; q < quanta; q += 1) {
    // A tab the compositor is not drawing gets no animation frame at all, so
    // the machine stops dead while the audio hardware keeps pulling.
    const dark = blackoutMs !== undefined && nowMs >= blackoutMs[0] && nowMs < blackoutMs[1];
    if (dark) {
      nextFrameMs = Math.max(nextFrameMs, blackoutMs[1]);
      lastFrameMs = null;
    }
    while (nextFrameMs <= nowMs) {
      if (fireAt.length > 0 && fireAt[0]! <= nowMs) {
        fireAt.shift();
        board.setFire(true);
        fireOpensAtMs = nowMs + 100;
      }
      if (fireOpensAtMs !== null && fireOpensAtMs <= nowMs) {
        board.setFire(false);
        fireOpensAtMs = null;
      }
      frame(nextFrameMs);
      nextFrameMs += FRAME_MS / frameRate;
    }

    for (const sample of node!.process(QUANTUM)) {
      if (sample < min) min = sample;
      if (sample > max) max = sample;
      if (previous !== null && sample !== previous) {
        if (flat > longestFlat) longestFlat = flat;
        flat = 0;
      } else {
        flat += 1;
      }
      previous = sample;
      // Rails, not zero crossings: the pin rests at -amplitude, so a threshold
      // either side of the middle counts each transition once instead of
      // counting the polyBLEP overshoot around it as well.
      const nextRail = sample > 0.25 ? 1 : sample < -0.25 ? -1 : rail;
      if (rail !== 0 && nextRail !== rail) crossings += 1;
      rail = nextRail;
    }
    nowMs += msPerQuantum;
    context.currentTime = nowMs / 1000;
  }
  if (flat > longestFlat) longestFlat = flat;

  return {
    peakToPeak: max - min,
    crossings,
    longestFlatMs: (longestFlat / SAMPLE_RATE) * 1000,
    stats: driver.stats,
  };
}

describe('the worklet port protocol the fake transport copies', () => {
  it('still speaks samples, flush and pull', () => {
    expect(SPEAKER_WORKLET_SOURCE).toContain("'samples'");
    expect(SPEAKER_WORKLET_SOURCE).toContain("'flush'");
    expect(SPEAKER_WORKLET_SOURCE).toContain("type: 'pull'");
    expect(SPEAKER_WORKLET_SOURCE).toContain('processorOptions');
  });
});

describe('the speaker path under the page frame loop', () => {
  it('plays the ROM through the worklet transport when frames land on the beat', async () => {
    const result = await runPage({ seconds: RUN_SECONDS });

    expect(result.stats.edgesConsumed).toBeGreaterThan(0);
    // Full scale is 2 x DEFAULT_AMPLITUDE. A held level - which is what every
    // report of "no sound" has measured as - gives 0.
    expect(result.peakToPeak).toBeGreaterThan(0.9);
    // Most of what the ROM produced has to reach the far end, not just enough
    // of it to move the peak once.
    expect(result.crossings).toBeGreaterThan(result.stats.edgesConsumed * 0.8);
  }, 30_000);

  it('keeps playing when the frame loop runs slower than real time', async () => {
    const control = await runPage({ seconds: RUN_SECONDS });
    const result = await runPage({ seconds: RUN_SECONDS, frameRate: 0.75 });

    expect(result.peakToPeak).toBeGreaterThan(0.9);
    expect(result.crossings).toBeGreaterThan(result.stats.edgesConsumed * 0.8);
    // The realign path costs one latency of held level each time it runs. If it
    // re-armed faster than it drained, this is where that shows up.
    //
    // Measured against the same run at full frame rate rather than against a
    // figure. This used to be a flat 2000 ms, which was a bound on the v2 ROM's
    // own quiet stretches with a realign's worth of slack on top - and the
    // moment the game program changed it was measuring the ROM's cadence rather
    // than the transport's behaviour. The control run is the ROM's silence; what
    // this asserts is that running the frame loop slow adds no more than one
    // realign to it.
    expect(result.longestFlatMs).toBeLessThan(control.longestFlatMs + REALIGN_SLACK_MS);
  }, 30_000);

  it('comes back after the tab stops being drawn', async () => {
    // The machine stops dead while the audio hardware keeps pulling, so on
    // return every edge is seconds behind the playhead - the shape of the fault
    // #41 fixed, arrived at from a running machine rather than a cold one.
    //
    // The dark stretch is one second now and used to be two, starting at two.
    // The ceiling below has to sit under what a machine that never resumed would
    // produce - flat from the start of the blackout to the end of the run - and
    // over what a machine that did resume produces, which is the blackout plus
    // however long the ROM was going to be quiet for anyway. Those two used to
    // be far apart because the battleship buzzed 51 times a minute and nothing
    // was quiet for long; with the boat crossing about once a minute the ROM's
    // own quiet stretches run to a march step, and a 2 s blackout put the two
    // bounds on top of each other. Halving the blackout and moving it earlier
    // separates them again without changing what is asserted.
    const BLACKOUT_MS = 1000;
    const control = await runPage({ seconds: RUN_SECONDS });
    const result = await runPage({
      seconds: RUN_SECONDS,
      blackoutMs: [1000, 1000 + BLACKOUT_MS],
    });

    expect(result.peakToPeak).toBeGreaterThan(0.9);
    expect(result.stats.realignments).toBeGreaterThan(0);
    // Sound after the blackout, not only before it. The ceiling is the ROM's own
    // longest quiet stretch, measured on the same run without a blackout, plus
    // the blackout and one realign's worth of held level - so a cadence change
    // moves the control rather than this figure.
    const ceilingMs = control.longestFlatMs + BLACKOUT_MS + REALIGN_SLACK_MS;
    // And the ceiling only means anything while it stays under what never
    // resuming would look like: flat from the blackout to the end of the run.
    expect(ceilingMs).toBeLessThan(RUN_SECONDS * 1000 - 1000);
    expect(result.longestFlatMs).toBeLessThan(ceilingMs);
  }, 30_000);

  it('plays the fire blip when the contact closes', async () => {
    const quiet = await runPage({ seconds: RUN_SECONDS });
    const fired = await runPage({ seconds: RUN_SECONDS, fireAtMs: [1500, 3000, 4500] });

    // Firing adds sound the idle machine does not make. This is what tells a
    // transport that plays the ROM apart from one that plays a fixed loop.
    expect(fired.stats.edgesConsumed).toBeGreaterThan(quiet.stats.edgesConsumed);
    expect(fired.crossings).toBeGreaterThan(quiet.crossings);
  }, 30_000);
});
