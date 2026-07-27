// The boat's arrival, from the ROM writing the lane nibble to samples in the
// audio output buffer.
//
// ## The report this exists to settle
//
// The owner, playing beside his physical CGL unit: "when the boat arrives there
// is no sound, not just the wrong sound." Every layer measured clean on its own.
// The ROM emits the buzz at the arrival - `bship_enter` calls `play_sound` on
// the same sweep it writes LANE_TOP - at 287 Hz, inside
// `battleshipBuzz.dominantHzRange` and below the march, and speaker-bands.test.ts
// was green on both. So the question a per-layer test cannot answer is whether
// the thing the ROM emitted is still there at the far end, and whether what the
// player hears at the arrival is a crossing being *announced*.
//
// Both halves are asserted here, because the answers turned out to differ:
//
//   - **It arrives.** Every buzz the ROM plays reaches the output buffer at
//     full amplitude with 230-300 Hz dominant. Nothing in `src/machine/audio/`
//     drops it, and no fix was needed there. This half passed before the fix
//     and is here so that it goes on passing - it is the assertion that would
//     have stopped the search at the ROM instead of the transport.
//   - **It was not announced.** BSHIP_SWEEPS was sized by dividing v1's 400 ms
//     crossing by the sweep alone, and `note_loop` does not scan the tube while
//     it runs, so the buzz's own 67.9 ms is part of the lane step rather than
//     something happening beside it. Nine sweeps bought ~198 ms a step, so the
//     three 68 ms buzzes ended up 142 ms of silence apart. A 68 ms blip is the
//     same length and envelope as a jet-march step; three of them that far
//     apart are three more march-like blips, not the "distinctly lower,
//     sustained buzz" audio-reference.md records. That is what "no sound when
//     the boat arrives" was.
//
// Against the ROM as it stood the second describe fails on both of its
// measurements: crossings of 698 ms against v1's 400 ms, and the buzz sounding
// for 28% of one.
//
// Node-side test: no DOM, no browser globals, no AudioContext.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble, type AssemblyResult } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';
import { dominantFrequency } from '../../src/machine/audio/spectrum.js';
import {
  SpeakerDriver,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type AudioWorkletNodeLike,
  type GainNodeLike,
  type MessagePortLike,
} from '../../src/machine/audio/driver.js';

const SAMPLE_RATE = 48_000;

/** The Web Audio render quantum - what the hardware asks for at a time. */
const QUANTUM = 128;

/** One display frame at 60 Hz, the interval `requestAnimationFrame` runs at. */
const FRAME_MS = 1000 / 60;

/** `MAX_FRAME_MS` from src/main.ts, copied not imported - importing main.ts starts a page. */
const MAX_FRAME_MS = 100;

/**
 * Seconds of wall clock to run.
 *
 * Six, for the reason transport-loop.test.ts gives at length: with no input the
 * ROM's last D14 transition is at 5.66 s and nothing measured here exists past
 * it. Long enough for three crossings.
 */
const RUN_SECONDS = 6;

/** Silence that separates two sounds, in cycles - 20 ms. Same figure as speaker-bands.test.ts. */
const BURST_GAP_CYCLES = 8000;

/** `battleshipBuzz.dominantHzRange`, docs/evidence/audio-reference.md. */
const BUZZ_MIN_HZ = 230;
const BUZZ_MAX_HZ = 300;

/**
 * Peak the rendered square has to pass to count as a rail.
 *
 * Full scale is `DEFAULT_AMPLITUDE`, 0.5 either side of zero. Half of that is
 * clear of the polyBLEP overshoot and nowhere near a held level, which is what
 * every "no sound" report has actually measured as.
 */
const RAIL = 0.25;

const ms = (cycles: number): number => (cycles / CYCLE_HZ) * 1000;

function assembly(): AssemblyResult {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  return assemble(readFileSync(path, 'utf8'), path);
}

/** A symbol's value out of the assembler's table, so no address is transcribed here. */
function symbol(asm: AssemblyResult, name: string): number {
  const found = asm.symbols.find((definition) => definition.name === name);
  if (found === undefined) {
    throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  }
  return found.value;
}

// --- the Web Audio slice, as transport-loop.test.ts fakes it ----------------

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

/** The worklet processor on the test's side of the port - a transcription of it. */
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

  process(frames: number): Float32Array {
    const channel = new Float32Array(frames);
    let written = 0;
    while (written < frames && this._blocks.length > 0) {
      const block = this._blocks[0] as Float32Array;
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
  readonly audioWorklet = { addModule: async (): Promise<void> => {} };
  createGain(): GainNodeLike {
    return new FakeGain();
  }
  async resume(): Promise<void> {}
}

// --- what the run produces --------------------------------------------------

/**
 * How far two consecutive periods may differ and still count as one note, and
 * how many periods a run needs before it is a note rather than the join between
 * two. Same figures and same reasoning as speaker-bands.test.ts.
 */
const RUN_TOLERANCE = 0.06;
const MIN_BUZZ_PERIODS = 15;

/** One stretch of like periods: a note the ROM played. */
interface Note {
  readonly firstCycle: number;
  readonly lastCycle: number;
  /** Median rise-to-rise frequency, so the stretched burst-boundary period cannot move it. */
  readonly hz: number;
  readonly periods: number;
}

/**
 * Break an edge stream into notes.
 *
 * Two passes, and the second is not optional. Splitting on 20 ms of silence
 * alone groups two notes the ROM played back to back into one - a missile blip
 * running straight into the arrival buzz is 15 ms apart - and one frequency
 * taken over that group belongs to neither note. It reads as a crossing that
 * was never announced when the buzz is right there in the second half of it.
 * So each gap-separated sound is broken into runs of like periods and every run
 * is measured on its own, which is how speaker-bands.test.ts reads the same
 * stream and for the same reason.
 */
function notesIn(edges: readonly { cycle: number; level: number }[]): Note[] {
  const groups: { cycle: number; level: number }[][] = [];
  let group: { cycle: number; level: number }[] = [];
  for (const edge of edges) {
    const previous = group[group.length - 1];
    if (previous !== undefined && edge.cycle - previous.cycle > BURST_GAP_CYCLES) {
      groups.push(group);
      group = [];
    }
    group.push(edge);
  }
  if (group.length > 0) groups.push(group);

  const notes: Note[] = [];
  for (const grouped of groups) {
    const rising = grouped.filter((edge) => edge.level === 1).map((edge) => edge.cycle);
    const periods = rising.slice(1).map((cycle, index) => cycle - (rising[index] as number));
    let run: number[] = [];
    let startIndex = 0;
    const close = (endIndex: number): void => {
      if (run.length === 0) return;
      const sorted = [...run].sort((left, right) => left - right);
      notes.push({
        firstCycle: rising[startIndex] as number,
        lastCycle: rising[endIndex] as number,
        hz: CYCLE_HZ / (sorted[Math.floor(sorted.length / 2)] as number),
        periods: run.length,
      });
      run = [];
      startIndex = endIndex;
    };
    for (let i = 0; i < periods.length; i += 1) {
      const period = periods[i] as number;
      const previous = run[run.length - 1];
      if (previous !== undefined && Math.abs(period - previous) / previous >= RUN_TOLERANCE) {
        close(i);
      }
      run.push(period);
    }
    close(periods.length);
  }
  return notes;
}

/** The notes that are battleship buzzes: in band, and long enough to be a note. */
function buzzesAmong(notes: readonly Note[]): Note[] {
  return notes.filter(
    (note) => note.hz >= BUZZ_MIN_HZ && note.hz <= BUZZ_MAX_HZ && note.periods >= MIN_BUZZ_PERIODS,
  );
}

interface PageRun {
  /** Every sample the transport played, in order. */
  readonly out: Float32Array;
  /** The notes the ROM played, in the order it played them. */
  readonly notes: readonly Note[];
  /** Cycle of the very first D14 transition of the run. */
  readonly firstEdgeCycle: number;
}

/**
 * Run src/main.ts's frame loop against the audio hardware's pull and keep
 * everything the transport played.
 *
 * Both clocks advance against one virtual wall clock, so the run is
 * deterministic: the audio side consumes a quantum per 128/48000 s and the
 * frame loop fires whenever that clock passes its next due time.
 */
async function runPage(): Promise<PageRun> {
  const board = new Board(romImage(assembly()), { power: 'off' });
  const cyclesPerSecond = board.cpu.getCyclesPerSecond();
  const context = new FakeContext();

  const drained: { cycle: number; level: number }[] = [];
  const source = {
    takeSpeakerEdges: () => {
      const edges = board.takeSpeakerEdges();
      for (const edge of edges) drained.push({ cycle: edge.cycle, level: edge.level });
      return edges;
    },
  };

  // The driver builds the node; this test has to hold it to pump quanta out.
  let node: FakeWorkletNode | null = null;
  const remember = (created: FakeWorkletNode): void => {
    node = created;
  };
  const driver = new SpeakerDriver({
    context,
    source,
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
  // then throw the power switch inside the same handler.
  const starting = driver.start();
  board.powerOn();
  driver.reset();
  await starting;

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

  const quanta = Math.floor((RUN_SECONDS * SAMPLE_RATE) / QUANTUM);
  const msPerQuantum = (QUANTUM / SAMPLE_RATE) * 1000;
  const out = new Float32Array(quanta * QUANTUM);
  let nowMs = 0;
  let nextFrameMs = 0;

  for (let q = 0; q < quanta; q += 1) {
    while (nextFrameMs <= nowMs) {
      frame(nextFrameMs);
      nextFrameMs += FRAME_MS;
    }
    out.set((node as unknown as FakeWorkletNode).process(QUANTUM), q * QUANTUM);
    nowMs += msPerQuantum;
    context.currentTime = nowMs / 1000;
  }

  return {
    out,
    notes: notesIn(drained),
    firstEdgeCycle: (drained[0] as { cycle: number }).cycle,
  };
}

/** Sample index of the first rail-to-rail transition in the played signal. */
function firstTransition(out: Float32Array): number {
  let rail = 0;
  for (let i = 0; i < out.length; i += 1) {
    const next = out[i] > RAIL ? 1 : out[i] < -RAIL ? -1 : rail;
    if (rail !== 0 && next !== rail) return i;
    rail = next;
  }
  return -1;
}

function rms(out: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += out[i] * out[i];
  return Math.sqrt(sum / Math.max(to - from, 1));
}

const run = await runPage();
const romBuzzes = buzzesAmong(run.notes);

/**
 * Samples the transport ran ahead of the machine.
 *
 * The two clocks start unrelated - `EdgeBuffer` anchors on the first edge it is
 * handed, the playhead has been advancing since the graph was connected - and
 * `SpeakerDriver.realign` introduces them once, at the first sound, at the cost
 * of one latency of held level. Everything after that is at a fixed offset, so
 * it is measured from the first transition rather than assumed, and the fact
 * that it *stays* fixed is itself asserted below.
 */
const offsetSamples =
  firstTransition(run.out) - (run.firstEdgeCycle / CYCLE_HZ) * SAMPLE_RATE;

/** The output window a ROM note landed in. */
function windowOf(note: Note): { from: number; to: number } {
  const from = Math.round((note.firstCycle / CYCLE_HZ) * SAMPLE_RATE + offsetSamples);
  const to = Math.round((note.lastCycle / CYCLE_HZ) * SAMPLE_RATE + offsetSamples);
  return { from, to };
}

describe('the arrival buzz reaches the audio output buffer', () => {
  it('played several crossings, so there is something to assert about', () => {
    expect(romBuzzes.length).toBeGreaterThanOrEqual(6);
    // The control: a run whose transport never played anything would satisfy
    // every "is it in band" assertion below vacuously.
    expect(firstTransition(run.out)).toBeGreaterThanOrEqual(0);
  });

  it('puts every buzz the ROM played into the output at 230-300 Hz', () => {
    const strays: string[] = [];
    for (const buzz of romBuzzes) {
      const { from, to } = windowOf(buzz);
      const hz = dominantFrequency(run.out.subarray(from, to), SAMPLE_RATE, { minHz: 100 });
      if (!(hz >= BUZZ_MIN_HZ && hz <= BUZZ_MAX_HZ)) {
        strays.push(`${ms(buzz.firstCycle).toFixed(0)} ms: ${hz.toFixed(0)} Hz`);
      }
    }
    expect(strays).toEqual([]);
  });

  it('plays each of them at the rail, not as a held level', () => {
    // A held level - silence on a 1-bit speaker - reads as an RMS of exactly
    // the amplitude with no transitions. This asserts the waveform is moving:
    // a full-amplitude square band-limited to 48 kHz sits near 0.5 RMS, and
    // anything that swallowed the note leaves a fraction of that.
    for (const buzz of romBuzzes) {
      const { from, to } = windowOf(buzz);
      expect(rms(run.out, from, to)).toBeGreaterThan(0.4);
    }
  });

  it('holds the machine and the output at one offset for the whole run', () => {
    // The failure this catches is the one that produced "no sound" twice
    // before: the timeline slipping so edges land behind the playhead and are
    // folded into the held level. If the offset held for the first crossing and
    // not the last, the windows above would drift off their notes and the band
    // assertions would fail - but only after enough drift, so the offset is
    // checked directly.
    const last = romBuzzes[romBuzzes.length - 1] as Note;
    const { from, to } = windowOf(last);
    let rail = 0;
    let transitions = 0;
    for (let i = from; i < to; i += 1) {
      const next = run.out[i] > RAIL ? 1 : run.out[i] < -RAIL ? -1 : rail;
      if (rail !== 0 && next !== rail) transitions += 1;
      rail = next;
    }
    // The ROM plays the buzz as 2 bursts of 10 periods: 40 transitions, and
    // every one of them still in the window the first crossing fixed.
    expect(transitions).toBeGreaterThanOrEqual(38);
  });
});

// --- the crossing, as the player hears it -----------------------------------

/** One crossing: the boat entering the far zone and leaving it. */
interface Crossing {
  readonly fromCycle: number;
  readonly toCycle: number;
}

/**
 * Every crossing and every buzz in a plain headless run.
 *
 * The crossing is read off `NIB_BSLANE` rather than off the tube because the
 * tube is blank for the whole of every sound (`Display.getObservedFrame`, D1),
 * so a lit-segment signal toggles once per sound rather than once per crossing.
 * The nibble is the ROM's own state, and its address comes from the assembler's
 * symbol table so this file transcribes no addresses.
 */
function crossings(): { crossings: Crossing[]; buzzes: Note[] } {
  const asm = assembly();
  const address = symbol(asm, 'FILE_STATE') * 16 + symbol(asm, 'NIB_BSLANE');
  const laneLast = symbol(asm, 'LANE_LAST');
  const noCrossing = symbol(asm, 'BS_NONE');
  const board = new Board(romImage(asm));

  // Past the reset and RAM-clear passes before watching the nibble. RAM comes
  // up filled with RAM_POWER_ON_FILL and the ROM clears it to zero, and zero is
  // LANE_TOP: a watcher armed before that reads the clear as an arrival.
  board.runFrames(5);

  const edges: { cycle: number; level: number }[] = [];
  const found: Crossing[] = [];
  let previous = board.cpu.memory.readRam(address);
  let fromCycle: number | null = null;
  const until = board.cycles + RUN_SECONDS * CYCLE_HZ;
  while (board.cycles < until) {
    board.step(200);
    for (const edge of board.takeSpeakerEdges()) {
      edges.push({ cycle: edge.cycle, level: edge.level });
    }
    const lane = board.cpu.memory.readRam(address);
    if (lane !== previous) {
      // Only BS_NONE -> a lane is an arrival, and only a lane -> BS_NONE is a
      // departure. Lane to lane is the boat stepping across, which is neither.
      if (previous === noCrossing && lane <= laneLast) {
        fromCycle = board.cycles;
      } else if (previous <= laneLast && lane === noCrossing && fromCycle !== null) {
        found.push({ fromCycle, toCycle: board.cycles });
        fromCycle = null;
      }
      previous = lane;
    }
  }
  return {
    crossings: found,
    buzzes: buzzesAmong(notesIn(edges)),
  };
}

describe('the crossing is announced by a sustained buzz', () => {
  const { crossings: found, buzzes } = crossings();

  /** Buzzes inside a crossing. The arrival buzz runs on the sweep that opens it. */
  function buzzesIn(crossing: Crossing): Note[] {
    return buzzes.filter(
      (buzz) => buzz.firstCycle >= crossing.fromCycle - 2000 && buzz.firstCycle <= crossing.toCycle,
    );
  }

  it('crossed the far zone several times', () => {
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('sounds the buzz on the sweep the boat arrives on', () => {
    // `bship_enter` writes LANE_TOP and calls play_sound in the same pass, so
    // the buzz and the lane nibble move together. If the arrival ever went
    // silent while the lane steps kept sounding - the first thing the report
    // was checked against - this is where it would show.
    for (const crossing of found) {
      const first = buzzesIn(crossing)[0];
      expect(first).toBeDefined();
      expect(ms((first as Note).firstCycle - crossing.fromCycle)).toBeLessThan(2);
    }
  });

  it('crosses in about the 400 ms v1 measured, with the buzz counted', () => {
    // The defect. BSHIP_SWEEPS was v1's 400 ms divided by the sweep alone,
    // leaving out the 67.9 ms the buzz itself costs the lane step, and the
    // crossing came out at 593 ms. The ceiling is above the nominal 378 ms by
    // enough for the march and missile notes that land inside a crossing and
    // stretch the sweeps they fall in.
    for (const crossing of found) {
      expect(ms(crossing.toCycle - crossing.fromCycle)).toBeLessThan(560);
    }
  });

  it('sounds for most of the crossing rather than blipping three times', () => {
    // `battleshipBuzz` is "a distinctly lower, sustained buzz". Three 68 ms
    // notes are what the machine can play without freezing the tube for the
    // whole crossing, so "sustained" here is a coverage floor: at 26% - the
    // figure before the fix - they are three isolated blips the same length as
    // a march step, which is exactly what was reported as no sound at all.
    for (const crossing of found) {
      const sounding = buzzesIn(crossing).reduce(
        (total, buzz) => total + ms(buzz.lastCycle - buzz.firstCycle),
        0,
      );
      const span = ms(crossing.toCycle - crossing.fromCycle);
      expect(sounding / span).toBeGreaterThan(0.4);
    }
  });

  it('buzzes three times inside every crossing, one to a lane', () => {
    // The coverage floor is a ratio, so a crossing that ran short would satisfy
    // it on one note. There are three lanes and `bship_enter` and `bm_store`
    // between them sound one buzz each, so three is what a whole crossing is.
    for (const crossing of found) {
      expect(buzzesIn(crossing).length).toBe(3);
    }
  });
});
