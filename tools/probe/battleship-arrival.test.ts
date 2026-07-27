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
//   - **It was not announced.** The buzz was one 70 ms note per lane step. A
//     68 ms blip is the same length and envelope as a jet-march step; three of
//     them are three more march-like blips, not the "distinctly lower,
//     sustained buzz" audio-reference.md records. That is what "no sound when
//     the boat arrives" was.
//
// ## The second correction, and why the first one went the wrong way
//
// The first fix kept the three blips and shortened the crossing so they would
// bunch together and read as one sound - `BSHIP_SWEEPS` 9 to 4, a 400 ms
// crossing. The owner then described the real unit: the battleship "moves slowly
// down the the slots which gives you time to shoot at it". So that fix worked
// against the behaviour and treated the symptom. Two things are true at once and
// the ROM now says both:
//
//   - the buzz is **one sustained note of ~380 ms**, which is what
//     `battleshipBuzz.durationMs` measures and what v1 synthesized, sounded once
//     at the arrival; and
//   - the crossing is **seconds long**, ~2.5 s a lane, which is what
//     `assets/reference/sprites/README.md` measures over 17 episodes of
//     IMG_6113.mov.
//
// They are not in lockstep and were never meant to be. The buzz announces the
// arrival; the descent that follows is silent and, more to the point, *visible* -
// `note_loop` does not sweep the tube, so a buzz at every lane would blank the
// display for a fifth of the crossing the player has to watch in order to shoot
// at the boat.
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

// --- how long a run has to be, taken from the ROM rather than guessed --------
//
// The battleship's cadence has moved three times in a day and every literal
// horizon written against it has had to move with it - the failure mode CLAUDE.md
// names as one of the two that have turned main red here. So nothing below is a
// wall-clock figure: the run length is derived from the ROM's own constants
// through the assembler's symbol table, and a constant change moves no number in
// this file at all.
//
// The one measured input is `SWEEP_MS`, and it is measured rather than taken
// from the nominal 13.46 ms because a sweep during a crossing is stretched by the
// march and missile notes that land in it: 8202 ms of measured crossing over
// 3 * 172 sweeps is 15.9 ms a sweep.

const ASM = assembly();

/** Measured ms per sweep during play, off the probe. See above. */
const SWEEP_MS = 16;

/** Sweeps the boat holds one lane. */
const LANE_STEP_SWEEPS = symbol(ASM, 'BSHIP_STEP_HI') * 16 + symbol(ASM, 'BSHIP_STEP_LO');

/** Sweeps a whole descent takes: one step per lane. */
const CROSSING_SWEEPS = LANE_STEP_SWEEPS * (symbol(ASM, 'LANE_LAST') + 1);

/**
 * Worst-case sweeps between one crossing ending and the next beginning.
 *
 * `bship_wait` reloads the countdown with `BSHIP_GAP_HI` in the high nibble and
 * the sampled `NIB_RAND` in the low one, so the longest it can be is
 * `BSHIP_GAP_HI * 16 + 15`.
 */
const GAP_SWEEPS_MAX = symbol(ASM, 'BSHIP_GAP_HI') * 16 + 15;

/** Seconds one arrival-to-arrival cycle can take at worst. */
const CROSSING_CYCLE_S = ((CROSSING_SWEEPS + GAP_SWEEPS_MAX) * SWEEP_MS) / 1000;

/** Crossings a run is sized to contain, with a whole cycle of slack on top. */
const CROSSINGS_WANTED = 2;

/** Seconds of wall clock to run. */
const RUN_SECONDS = Math.ceil((CROSSINGS_WANTED + 1) * CROSSING_CYCLE_S);

/** The lever's three positions, in lane order. */
const LEVER_POSITIONS = ['up', 'centre', 'down'] as const;

/** Machine cycles between control movements - about a fifth of a sweep. */
const PLAYER_SLICE_CYCLES = 3_000;

/**
 * A player who works the case but never shoots at the boat.
 *
 * Both runs below need a game that is still being played when the second
 * crossing arrives, and an unattended machine is not: it loses three launchers
 * and stops, and `tick` returns at its first test from then on, so the
 * battleship's turn never comes round again. Working the lever and the fire
 * contact keeps the game alive, which is what game-lifetime.test.ts measures.
 *
 * The fire contact is held open for as long as `NIB_BSLANE` holds a lane. That
 * is not a nicety: a player who fires blindly *shoots the battleship down*,
 * almost every time and usually in its first lane - measured, and a fair
 * description of the boat now being slow enough to hit, which is the point of
 * the change this file covers. A crossing that ends in a hit says nothing about
 * how long a crossing lasts, so this player declines to take the shot.
 *
 * It reads RAM to decide when to hold fire, which a probe may do - the rule is
 * that game state is never *written* from outside, and this player still reaches
 * the ROM only through `setControl`, as a hand does. A sighted human has the
 * same information: the boat is lit on the tube.
 */
function playerControls(board: Board, slice: number, bshipLaneAddress: number, noCrossing: number): void {
  board.setControl('lever', LEVER_POSITIONS[Math.floor(slice / 2) % LEVER_POSITIONS.length] as string);
  const crossing = board.cpu.memory.readRam(bshipLaneAddress) !== noCrossing;
  board.setControl('fire', !crossing && slice % 2 === 0 ? 'down' : 'up');
}

/** Where `NIB_BSLANE` lives, and the value that means no crossing. */
const BSLANE_ADDRESS = symbol(ASM, 'FILE_STATE') * 16 + symbol(ASM, 'NIB_BSLANE');
const BS_NONE = symbol(ASM, 'BS_NONE');

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
 * How far two consecutive periods may differ and still count as one note. Same
 * figure and same reasoning as speaker-bands.test.ts.
 */
const RUN_TOLERANCE = 0.06;

/**
 * Square-wave periods per burst of the battleship note.
 *
 * `PAT_SND_B` entry 2 is `$090`, whose high nibble is the periods-per-burst minus
 * one. Pattern data is not in the symbol table, so it is transcribed here with
 * its citation rather than read; the burst *count* beside it is a symbol and is.
 */
const BUZZ_PERIODS_PER_BURST = 10;

/** Square-wave periods in the ROM's battleship note. */
const BUZZ_PERIODS = (symbol(ASM, 'BURSTS_BSHIP') + 1) * BUZZ_PERIODS_PER_BURST;

/**
 * Periods a run needs before it counts as the battleship's note.
 *
 * It used to be a flat fifteen, enough to tell a note from the join between two.
 * That is no longer enough to tell it from the *loss* sound: `loss 3` is the
 * rasp body at 239 Hz, which is inside `battleshipBuzz.dominantHzRange`, and
 * every run below now plays a game long enough to lose one. The loss rasp is
 * 4 bursts of 11 periods; the buzz is eleven bursts of ten, so length separates
 * them cleanly and the floor is taken from the ROM rather than chosen.
 *
 * A regression that shortened the buzz would take it below this floor and be
 * counted as no buzz at all, which is a failure of the assertions that count
 * crossings - not a way for one to slip through.
 */
const MIN_BUZZ_PERIODS = BUZZ_PERIODS - 10;

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
  let slice = 0;
  let lastFrameMs: number | null = null;
  const frame = (nowMs: number): void => {
    const elapsedMs = lastFrameMs === null ? 0 : Math.min(nowMs - lastFrameMs, MAX_FRAME_MS);
    lastFrameMs = nowMs;
    if (board.power.state === 'on' && board.running) {
      owed += (elapsedMs / 1000) * cyclesPerSecond;
      let budget = Math.floor(owed);
      // The controls are worked in slices inside the frame's budget, not once a
      // frame: see `playerControls`. A frame is about a sweep and a half, and a
      // player who only touched the case that often would never close two
      // different contacts inside one sweep.
      while (budget > 0) {
        playerControls(board, slice, BSLANE_ADDRESS, BS_NONE);
        slice += 1;
        const executed = board.step(Math.min(budget, PLAYER_SLICE_CYCLES));
        if (executed === 0) {
          owed = 0;
          break;
        }
        owed -= executed;
        budget -= executed;
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
    // One buzz per crossing now, not one per lane step, so this counts
    // crossings directly.
    expect(romBuzzes.length).toBeGreaterThanOrEqual(CROSSINGS_WANTED);
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
    // The ROM plays the buzz as `BURSTS_BSHIP + 1` bursts of ten periods, two
    // transitions to a period, and every one of them has to still be in the
    // window the first crossing fixed. Taken from the ROM so that changing the
    // note's length does not turn this into a transcription error: the tail is
    // where a drifting offset shows first, so the floor sits just under the
    // whole count rather than at a fraction of it.
    expect(transitions).toBeGreaterThanOrEqual(2 * BUZZ_PERIODS - 4);
  });
});

// --- the crossing, as the player hears it -----------------------------------

/** One crossing: the boat entering the far zone and leaving it, and the lanes it held. */
interface Crossing {
  readonly fromCycle: number;
  readonly toCycle: number;
  readonly lanes: readonly number[];
}

/**
 * Every crossing and every buzz in a headless run of a game being played.
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
  let open: { fromCycle: number; lanes: number[] } | null = null;
  const until = board.cycles + RUN_SECONDS * CYCLE_HZ;
  let slice = 0;
  while (board.cycles < until) {
    playerControls(board, slice, address, noCrossing);
    slice += 1;
    board.step(PLAYER_SLICE_CYCLES);
    for (const edge of board.takeSpeakerEdges()) {
      edges.push({ cycle: edge.cycle, level: edge.level });
    }
    const lane = board.cpu.memory.readRam(address);
    if (lane !== previous) {
      // Only BS_NONE -> a lane is an arrival, and only a lane -> BS_NONE is a
      // departure. Lane to lane is the boat stepping down, which is neither.
      if (previous === noCrossing && lane <= laneLast) {
        open = { fromCycle: board.cycles, lanes: [lane] };
      } else if (previous <= laneLast && lane === noCrossing && open !== null) {
        found.push({ fromCycle: open.fromCycle, toCycle: board.cycles, lanes: open.lanes });
        open = null;
      } else if (open !== null && lane <= laneLast) {
        open.lanes.push(lane);
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
  const laneCount = symbol(ASM, 'LANE_LAST') + 1;

  /**
   * Crossings the boat completed.
   *
   * A crossing that ends before it has held every lane is one the player shot
   * down, which `bship_kill` ends by writing BS_NONE. Nothing about the descent
   * can be measured on one of those, so the shape assertions run on the whole
   * ones - and there being any at all is asserted first, because a run in which
   * every boat was shot would satisfy them vacuously.
   */
  const whole = found.filter((crossing) => crossing.lanes.length === laneCount);

  /** Buzzes inside a crossing. The arrival buzz runs on the sweep that opens it. */
  function buzzesIn(crossing: Crossing): Note[] {
    return buzzes.filter(
      (buzz) => buzz.firstCycle >= crossing.fromCycle - 2000 && buzz.firstCycle <= crossing.toCycle,
    );
  }

  it('crossed the far zone several times, and finished some of them', () => {
    expect(found.length).toBeGreaterThanOrEqual(CROSSINGS_WANTED);
    expect(whole.length).toBeGreaterThanOrEqual(1);
  });

  it('sounds the buzz on the sweep the boat arrives on', () => {
    // `bship_enter` writes LANE_TOP and calls play_sound in the same pass, so
    // the buzz and the lane nibble move together. If the arrival ever went
    // silent - the first thing the report was checked against - this is where
    // it would show.
    for (const crossing of found) {
      const first = buzzesIn(crossing)[0];
      expect(first).toBeDefined();
      expect(ms((first as Note).firstCycle - crossing.fromCycle)).toBeLessThan(2);
    }
  });

  it('announces the arrival with one sustained note, not a run of blips', () => {
    // `battleshipBuzz.durationMs` is 380 ms and the reference calls the sound
    // "sustained". The ROM plays it as 11 bursts of 10 periods at 1393 cycles,
    // which is 379.9 ms from first rise to last - see the sound table. One note,
    // because three 70 ms blips are not a 380 ms buzz however close together
    // they sit, and because `note_loop` does not sweep the tube: a note at every
    // lane would blank the display for a fifth of a descent the player has to
    // see in order to shoot at the boat.
    for (const crossing of found) {
      const inside = buzzesIn(crossing);
      expect(inside.length).toBe(1);
      const note = inside[0] as Note;
      expect(ms(note.lastCycle - note.firstCycle)).toBeGreaterThan(340);
      expect(ms(note.lastCycle - note.firstCycle)).toBeLessThan(420);
    }
  });

  it('holds each lane for seconds, so there is time to shoot at it', () => {
    // The owner, against his own unit: it "moves slowly down the the slots which
    // gives you time to shoot at it". `assets/reference/sprites/README.md`
    // measures the same thing over 17 episodes of IMG_6113.mov - median 2.5 s in
    // a lane, longest 5.9 s - and one traced descent runs 9.3 s end to end.
    //
    // The bounds are the ROM's own arithmetic with slack for the sweeps a note
    // lands in, not a transcription of those figures: a crossing is
    // CROSSING_SWEEPS long and a sweep costs at least its nominal 13.46 ms.
    const nominalMs = (CROSSING_SWEEPS * 13.46);
    for (const crossing of whole) {
      const span = ms(crossing.toCycle - crossing.fromCycle);
      expect(span).toBeGreaterThan(nominalMs);
      expect(span).toBeLessThan(nominalMs * 1.6);
    }
  });

  it('descends the lanes, top to bottom, without leaving its column', () => {
    // The claim the video could not settle on its own: it traced the succession
    // lane 0 -> lane 1 -> lane 2 and recorded that "the video cannot separate one
    // battleship moving from three in succession". The owner's "moves slowly
    // down the the slots" is the missing half. This asserts the ROM does what
    // both describe - one boat, walking down the lanes in order.
    //
    // The column is not asserted here because it is not a variable: `draw_bship`
    // draws at COL_BSHIP unconditionally and rom-atlas-conformance.test.ts covers
    // the three segments it can light.
    for (const crossing of whole) {
      expect(crossing.lanes).toEqual([...Array(laneCount).keys()]);
    }
  });
});
