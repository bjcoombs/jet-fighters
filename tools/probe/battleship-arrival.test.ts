// The boat's arrival, from the ROM writing the lane nibble to samples in the
// audio output buffer.
//
// ## The report this exists to settle
//
// The owner, playing beside his physical CGL unit: "when the boat arrives there
// is no sound, not just the wrong sound." Every layer measured clean on its own,
// so the question a per-layer test cannot answer is whether the thing the ROM
// emitted is still there at the far end, and whether what the player hears at
// the arrival is a crossing being *announced*. Both halves are asserted here,
// because the answers differed:
//
//   - **It arrives.** Everything the ROM emits reaches the output buffer at full
//     amplitude and in band. Nothing in `src/machine/audio/` drops it, and no
//     fix was ever needed there. This half is the assertion that would have
//     stopped the search at the ROM instead of at the transport.
//   - **It was not announced.** The buzz was one 70 ms note per lane step - the
//     same length and envelope as a jet-march step. That is what "no sound when
//     the boat arrives" was.
//
// ## Three revisions that got better at the wrong answer
//
// Each fix made the note a better note. Three 70 ms blips became three blips
// bunched closer together by shortening the crossing; that was undone when the
// owner said the boat "moves slowly down the the slots which gives you time to
// shoot at it", and became one 383 ms note at the arrival, matched to the 380 ms
// `battleshipBuzz.durationMs` in audio-reference.md.
//
// **The owner's isolated recording ended that line rather than continuing it.**
// `assets/reference/battleship-arrival.m4a` and `battleship-interval.m4a`
// measure a sound that is 4.0 s long and *continuous*, at a repetition rate of
// 93.4 Hz. It was never a note length. The 380 ms it had been matched against
// was a v1 synthesis that three revisions read as a measurement.
//
// ## What that forces, and what this file therefore asserts
//
// A four-second sound cannot be a note on this machine: `note_loop` does not
// sweep the tube, so four seconds of it would blank the display for the whole of
// a crossing the player has to see in order to shoot at the boat. So the buzz is
// clocked by the display sweep instead - `dwell` toggles D14 every fourth grid
// while `NIB_BUZZ` is set - and the tube keeps scanning throughout.
//
// That changes what can be asserted, in three ways worth knowing before reading
// the tests:
//
//   - **The buzz is not a note and has no burst count.** Its length comes from
//     how long the boat is up, so the assertions are over the *crossing*, not
//     over a note.
//   - **Its period wanders**, because a sweep is however long the ROM's
//     between-sweep work took - which is exactly what the recording measures
//     (79-111 Hz within one arrival). So a "run of like periods" is two or three
//     periods long, far too short a window to resolve 86 Hz, and the spectral
//     assertions are made over the whole crossing.
//   - **It shares a band with the loss sound.** `gameOver`'s collapse stage is
//     96 Hz. `NIB_BSLANE` is what separates them, and it separates them exactly:
//     the ROM stops the buzz before it starts the loss sound.
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
const BUZZ_MIN_HZ = 79;
const BUZZ_MAX_HZ = 111;

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

/**
 * Measured ms per sweep during play, off the probe. See above.
 *
 * INSTRUCTION-RATE PROVISIONAL: measured off the HMCS44 core's oscillator, not
 * the TMS1370's. See docs/research/mp2110-timing-measurement.md.
 */
const SWEEP_MS = 16;

/** Sweeps the boat holds one lane. */
const LANE_STEP_SWEEPS = symbol(ASM, 'BSHIP_STEP_HI') * 16 + symbol(ASM, 'BSHIP_STEP_LO');

/** Sweeps a whole descent takes: one step per lane. */
const CROSSING_SWEEPS = LANE_STEP_SWEEPS * (symbol(ASM, 'LANE_LAST') + 1);

/**
 * Sweeps per step of the gap countdown.
 *
 * `tick_bship` steps it only on the sweep `NIB_TICK` reads zero, and `NIB_TICK`
 * is a nibble incremented once a sweep, so the countdown runs at a sixteenth of
 * the sweep rate. Sixteen is the width of a nibble and not a constant the ROM
 * names, which is why it is written here rather than read.
 */
const GAP_PRESCALE = 16;

/**
 * Worst-case sweeps from one crossing ending to the next beginning.
 *
 * `bship_wait` reloads the countdown with `BSHIP_GAP_HI` in the high nibble and
 * the sampled `NIB_RAND` in the low one, so the longest it can be is
 * `(BSHIP_GAP_HI * 16 + 15)` prescaled units.
 */
const GAP_SWEEPS_MAX = (symbol(ASM, 'BSHIP_GAP_HI') * 16 + 15) * GAP_PRESCALE;

/** Sweeps from power-on to the first arrival: reset seeds `BSHIP_GAP_OPEN`. */
const OPENING_GAP_SWEEPS = symbol(ASM, 'BSHIP_GAP_OPEN') * 16 * GAP_PRESCALE;

/**
 * Crossings a run is sized to contain.
 *
 * **One, and the reason is not the battleship.** A crossing arrives about every
 * 19.8 s - the interval measured off the owner's isolated recording - and a game
 * currently ends in 20 to 45 s (see `docs/evidence/open-questions.md` section 6,
 * the capture rule). The two are now the same order, where the old 51 s interval
 * was well past any game, but a run still cannot be *relied* on to contain two
 * crossings: when the game stops, `tick` returns at its first test from then on
 * and the battleship's turn never comes round again.
 *
 * That is why the opening crossing exists and why this file leans on it. When
 * the capture rule settles and games run to minutes, this becomes two and the
 * horizon below follows it without another edit.
 */
const CROSSINGS_WANTED = 1;

/**
 * Seconds of wall clock to run: the opening gap, the crossings wanted and the
 * gaps between them, then one crossing of slack.
 */
const RUN_SWEEPS =
  OPENING_GAP_SWEEPS +
  (CROSSINGS_WANTED + 1) * CROSSING_SWEEPS +
  (CROSSINGS_WANTED - 1) * GAP_SWEEPS_MAX;
const RUN_SECONDS = Math.ceil((RUN_SWEEPS * SWEEP_MS) / 1000);

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
  // Fire is held over the crossing *and* over the last few units of the
  // countdown to one. Holding it only over the crossing is not enough and was
  // not enough here: a missile launched just before the boat arrives is still in
  // flight when it does, and it shoots it down in its first lane. Measured with
  // the crossing-only guard, the boat survived 42 ms of a 4 s descent.
  const due =
    board.cpu.memory.readRam(BS_HI_ADDRESS) * 16 + board.cpu.memory.readRam(BS_LO_ADDRESS);
  const nearlyDue = due < GAP_UNITS_HELD_FIRE;
  board.setControl('fire', !crossing && !nearlyDue && slice % 2 === 0 ? 'down' : 'up');
}

/**
 * Units of the battleship's countdown over which the probe stops firing.
 *
 * A missile crosses the board in `MISSILE_SWEEPS` per column over seven columns;
 * the countdown ticks once every sixteen sweeps. Six units is about a hundred
 * sweeps, comfortably longer than a missile's flight, so nothing the probe
 * launched is still airborne when the boat appears.
 */
const GAP_UNITS_HELD_FIRE = 6;

/** Where `NIB_BSLANE` lives, and the value that means no crossing. */
const BSLANE_ADDRESS = symbol(ASM, 'FILE_STATE') * 16 + symbol(ASM, 'NIB_BSLANE');
const BS_NONE = symbol(ASM, 'BS_NONE');
const BS_LO_ADDRESS = symbol(ASM, 'FILE_TIME') * 16 + symbol(ASM, 'NIB_BS_LO');
const BS_HI_ADDRESS = symbol(ASM, 'FILE_TIME') * 16 + symbol(ASM, 'NIB_BS_HI');

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
 * Runs shorter than this are the join between two sounds, not a buzz.
 *
 * The buzz is no longer a note and has no burst count to derive a floor from. It
 * is toggled once every four grid dwells, so its period is a sweep-and-a-bit and
 * *wanders* with the sweep - measured, the longest stretch of periods matching to
 * within RUN_TOLERANCE is about three. So this is a floor on a run being real
 * rather than on the sound being complete; what makes the sound complete is
 * asserted over the crossing as a whole, below.
 */
const MIN_BUZZ_PERIODS = 2;

/**
 * The buzz's nominal frequency: one toggle every four grid dwells, ten dwells to
 * a sweep, so a period is eight dwells - four fifths of a sweep. Used only to put
 * a floor under how many transitions four seconds of buzz should make.
 *
 * INSTRUCTION-RATE PROVISIONAL: derived from the HMCS44 core's sweep rate, not
 * the TMS1370's. See docs/research/mp2110-timing-measurement.md.
 */
const BUZZ_NOMINAL_HZ = 86;

/**
 * The longest silence allowed inside a crossing before the buzz counts as having
 * stopped.
 *
 * A march note is ~70 ms and stops the sweep for its whole length, and the
 * missile blip and the warning beeps do the same for less. 150 ms is the longest
 * of those with room for the run either side of it to be recognised.
 */
const MAX_BUZZ_HOLE_MS = 150;

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

/**
 * The runs that are battleship buzz: in band, long enough to be real, and inside
 * a crossing.
 *
 * The crossing window is not decoration. `gameOver`'s collapse stage is 96 Hz,
 * which is inside this band, so band alone no longer separates the buzz from the
 * loss sound - and every run here plays a game long enough to lose one.
 * `NIB_BSLANE` separates them exactly: the ROM stops the buzz before it starts
 * the loss sound, so the two can never share a window.
 */
function buzzesAmong(
  notes: readonly Note[],
  crossings: ReadonlyArray<readonly [number, number]>,
): Note[] {
  const inCrossing = (cycle: number): boolean =>
    crossings.some(([from, to]) => cycle >= from && cycle <= to);
  return notes.filter(
    (note) =>
      note.hz >= BUZZ_MIN_HZ &&
      note.hz <= BUZZ_MAX_HZ &&
      note.periods >= MIN_BUZZ_PERIODS &&
      inCrossing(note.firstCycle),
  );
}

interface PageRun {
  /** Every sample the transport played, in order. */
  readonly out: Float32Array;
  /** The notes the ROM played, in the order it played them. */
  readonly notes: readonly Note[];
  /** Intervals during which the boat was on the tube, in cycle order. */
  readonly crossings: ReadonlyArray<readonly [number, number]>;
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
  const crossings: Array<readonly [number, number]> = [];
  let crossingFrom: number | null = null;
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
        const crossing = board.cpu.memory.readRam(BSLANE_ADDRESS) !== BS_NONE;
        if (crossing && crossingFrom === null) crossingFrom = board.cycles;
        if (!crossing && crossingFrom !== null) {
          crossings.push([crossingFrom, board.cycles]);
          crossingFrom = null;
        }
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

  if (crossingFrom !== null) crossings.push([crossingFrom, board.cycles]);
  return {
    out,
    notes: notesIn(drained),
    crossings,
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
const romBuzzes = buzzesAmong(run.notes, run.crossings);

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

/**
 * The output window a whole crossing landed in, clamped to what was rendered.
 *
 * The clamp is not slack. A crossing still in progress when the run ends is
 * closed at `board.cycles` - the machine's last cycle, which is past the last
 * *rendered* sample, because the transport renders in whole quanta and the
 * machine does not stop on one. So the last crossing of a run can name samples
 * that do not exist, and how far past the end it reaches is a property of where
 * the run happened to be cut rather than of the sound.
 *
 * Reading past the end used to yield `undefined`, and the two assertions below
 * disagreed about it: `dominantFrequency` takes a `subarray`, which clamps, so
 * the band check quietly measured the rendered part while the RMS check summed
 * `undefined * undefined` and returned NaN. Clamping here gives both the same
 * window, and the half-second floor each applies then correctly skips a crossing
 * that was cut too short to say anything about.
 */
function windowOfCrossing(crossing: readonly [number, number]): { from: number; to: number } {
  const at = (cycle: number): number =>
    Math.round((cycle / CYCLE_HZ) * SAMPLE_RATE + offsetSamples);
  return {
    from: Math.max(0, at(crossing[0])),
    to: Math.min(run.out.length, at(crossing[1])),
  };
}

/** Rail-to-rail transitions in an output window. */
function transitionsIn(from: number, to: number): number {
  let rail = 0;
  let transitions = 0;
  for (let i = Math.max(from, 0); i < Math.min(to, run.out.length); i += 1) {
    const next = run.out[i] > RAIL ? 1 : run.out[i] < -RAIL ? -1 : rail;
    if (rail !== 0 && next !== rail) transitions += 1;
    rail = next;
  }
  return transitions;
}

describe('the arrival buzz reaches the audio output buffer', () => {
  it('crossed at least once, so there is something to assert about', () => {
    expect(run.crossings.length).toBeGreaterThanOrEqual(CROSSINGS_WANTED);
    expect(romBuzzes.length).toBeGreaterThan(0);
    // The control: a run whose transport never played anything would satisfy
    // every "is it in band" assertion below vacuously.
    expect(firstTransition(run.out)).toBeGreaterThanOrEqual(0);
  });

  it('puts the buzz into the output at 79-111 Hz, measured over the crossing', () => {
    // **The window is the crossing, not the run.** A run here is a stretch of
    // periods matching to within RUN_TOLERANCE, and the buzz's period wanders
    // with the sweep, so a run is two or three periods - 25 to 35 ms. That is not
    // enough signal to resolve an 86 Hz fundamental at all: measured, the per-run
    // readings came back at 141 Hz and worse, on a waveform that is perfectly
    // correct. Asking the question over the whole four seconds is asking it of a
    // window that can answer it.
    const strays: string[] = [];
    for (const crossing of run.crossings) {
      const { from, to } = windowOfCrossing(crossing);
      if (to - from < SAMPLE_RATE * 0.5) continue;
      const hz = dominantFrequency(run.out.subarray(from, to), SAMPLE_RATE, { minHz: 50 });
      if (!(hz >= BUZZ_MIN_HZ && hz <= BUZZ_MAX_HZ)) {
        strays.push(`${ms(crossing[0]).toFixed(0)} ms: ${hz.toFixed(0)} Hz`);
      }
    }
    expect(strays).toEqual([]);
  });

  it('plays it at the rail, not as a held level', () => {
    // A held level - silence on a 1-bit speaker - reads as an RMS of exactly the
    // amplitude with no transitions. This asserts the waveform is moving: a
    // full-amplitude square band-limited to 48 kHz sits near 0.5 RMS, and
    // anything that swallowed the sound leaves a fraction of that.
    for (const crossing of run.crossings) {
      const { from, to } = windowOfCrossing(crossing);
      if (to - from < SAMPLE_RATE * 0.5) continue;
      expect(rms(run.out, from, to)).toBeGreaterThan(0.4);
    }
  });

  it('holds the machine and the output at one offset for the whole run', () => {
    // The failure this catches is the one that produced "no sound" twice before:
    // the timeline slipping so edges land behind the playhead and are folded into
    // the held level. If the offset held at the start of the run and not at the
    // end, the windows above would drift off and the band assertions would fail -
    // but only after enough drift, so the offset is checked directly.
    //
    // The subject is the **last note of the run that is not a buzz**. The march
    // goes on to the end of the game and is what puts this assertion where the
    // drift would be; a buzz run is two or three periods and far too short a
    // window to count transitions in. Its period count comes off the note itself,
    // so nothing here is transcribed.
    //
    // Notes whose window is wholly inside the recorded output, too: the machine
    // runs until the game ends and the transport is pumped for a fixed number of
    // quanta, so the very last notes of a run can fall past the end of the buffer
    // - a window off the end would count zero transitions and read as total drift
    // when nothing had drifted.
    const buzzCycles = new Set(romBuzzes.map((buzz) => buzz.firstCycle));
    const notes = run.notes.filter((note) => {
      if (buzzCycles.has(note.firstCycle) || note.periods < 8) return false;
      const { from, to } = windowOf(note);
      return from >= 0 && to < run.out.length;
    });
    expect(notes.length).toBeGreaterThan(0);
    const last = notes[notes.length - 1] as Note;
    const { from, to } = windowOf(last);
    expect(transitionsIn(from, to)).toBeGreaterThanOrEqual(2 * last.periods - 4);
  });

  it('puts the whole of the buzz into the output, not the start of it', () => {
    // Counted rather than sampled: a transport that swallowed the back half of a
    // four-second sound would still pass the band and rail assertions above on
    // what survived. The floor is derived from the crossing's own length and the
    // buzz's own period rather than from a burst count, because the buzz has no
    // burst count - it is toggled by the sweep for as long as the boat is up.
    //
    // Two thirds, not all: the march and missile notes that land inside a
    // crossing stop the sweep, and the buzz stops with it for as long as each one
    // lasts. That is the machine working - one pin, one core - and it is measured
    // at about a sixth of the crossing.
    for (const crossing of run.crossings) {
      const { from, to } = windowOfCrossing(crossing);
      const seconds = (to - from) / SAMPLE_RATE;
      if (seconds < 0.5) continue;
      const expected = seconds * BUZZ_NOMINAL_HZ * 2;
      expect(transitionsIn(from, to)).toBeGreaterThan(expected * 0.66);
    }
  });
});

// --- the crossing, as the player hears it -----------------------------------

/**
 * One lane the boat held, and for how long.
 *
 * `toCycle` is null when the hold was still running at the end of the run - the
 * boat was shot, or the game ended under it. This is the unit the reference
 * material measures in: `assets/reference/sprites/README.md` calls it an
 * *episode*, counts 17 of them and gives their median and longest, and the
 * traced descent's three are 1.3 / 2.1 / 5.8 s.
 */
interface LaneHold {
  readonly lane: number;
  readonly fromCycle: number;
  toCycle: number | null;
}

/** One crossing: the boat entering the far zone, and every lane it held on the way down. */
interface Crossing {
  readonly fromCycle: number;
  /** Null when the crossing had not ended by the end of the run. */
  toCycle: number | null;
  readonly holds: LaneHold[];
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
  let open: Crossing | null = null;
  const until = board.cycles + RUN_SECONDS * CYCLE_HZ;
  // Stepped finely, worked coarsely. The lane nibble is only ever seen to within
  // one step, and the assertions below place a note against the sweep the nibble
  // changed on - which needs a step much shorter than a sweep. The controls
  // still move on the slice a hand would work them at.
  const STEP_CYCLES = 200;
  const STEPS_PER_SLICE = Math.round(PLAYER_SLICE_CYCLES / STEP_CYCLES);
  let step = 0;
  while (board.cycles < until) {
    if (step % STEPS_PER_SLICE === 0) {
      playerControls(board, step / STEPS_PER_SLICE, address, noCrossing);
    }
    step += 1;
    board.step(STEP_CYCLES);
    for (const edge of board.takeSpeakerEdges()) {
      edges.push({ cycle: edge.cycle, level: edge.level });
    }
    const lane = board.cpu.memory.readRam(address);
    if (lane !== previous) {
      const closing = open?.holds[open.holds.length - 1];
      if (closing !== undefined) closing.toCycle = board.cycles;
      // Only BS_NONE -> a lane is an arrival, and only a lane -> BS_NONE is a
      // departure. Lane to lane is the boat stepping down, which is neither.
      if (previous === noCrossing && lane <= laneLast) {
        open = {
          fromCycle: board.cycles,
          toCycle: null,
          holds: [{ lane, fromCycle: board.cycles, toCycle: null }],
        };
        found.push(open);
      } else if (previous <= laneLast && lane === noCrossing && open !== null) {
        open.toCycle = board.cycles;
        open = null;
      } else if (open !== null && lane <= laneLast) {
        open.holds.push({ lane, fromCycle: board.cycles, toCycle: null });
      }
      previous = lane;
    }
  }
  return {
    crossings: found,
    buzzes: buzzesAmong(
      notesIn(edges),
      found.map(
        (crossing) => [crossing.fromCycle, crossing.toCycle ?? Number.POSITIVE_INFINITY] as const,
      ),
    ),
  };
}

describe('the crossing is announced by a sustained buzz', () => {
  const { crossings: found, buzzes } = crossings();
  const laneCount = symbol(ASM, 'LANE_LAST') + 1;

  /**
   * Lane holds that ran to their end, across every crossing.
   *
   * The unit of measurement is the **lane hold**, not the whole crossing, and
   * that is deliberate on two counts. It is the unit the reference material
   * reports in - `assets/reference/sprites/README.md` gives a median and a
   * longest per episode, and an episode is a contiguous run of sightings in one
   * lane. And it is the unit that survives a crossing being cut short: the boat
   * is now slow enough to shoot, `bship_kill` ends the crossing when it is hit,
   * and a game that ends mid-descent freezes the boat where it stands. Every
   * lane the boat *finished* is still a measurement of how slowly it moves.
   */
  const holds = found.flatMap((crossing) =>
    crossing.holds.filter((hold) => hold.toCycle !== null),
  );

  /** Buzzes inside a crossing. The arrival buzz runs on the sweep that opens it. */
  function buzzesIn(crossing: Crossing): Note[] {
    const end = crossing.toCycle ?? Number.POSITIVE_INFINITY;
    return buzzes.filter(
      (buzz) => buzz.firstCycle >= crossing.fromCycle - 2000 && buzz.firstCycle <= end,
    );
  }

  it('crossed the far zone, and finished some lanes on the way down', () => {
    expect(found.length).toBeGreaterThanOrEqual(CROSSINGS_WANTED);
    // More than one, so the assertions below are about a boat that moved rather
    // than one that arrived and was shot where it stood.
    expect(holds.length).toBeGreaterThanOrEqual(2);
  });

  it('sounds the buzz on the sweep the boat arrives on', () => {
    // `bship_enter` writes LANE_TOP and starts the buzz in the same pass, so
    // the sound and the lane nibble move together. If the arrival ever went
    // silent - the first thing the report was checked against - this is where
    // it would show.
    for (const crossing of found) {
      const first = buzzesIn(crossing)[0];
      expect(first).toBeDefined();
      // A run cannot exist until two periods have gone by, so the tolerance is a
      // buzz period rather than the two milliseconds a note_loop note allowed.
      // The pin moves on the arrival sweep; it is the measurement that needs a
      // period to see it.
      expect(ms((first as Note).firstCycle - crossing.fromCycle)).toBeLessThan(
        1.5 * (1000 / BUZZ_NOMINAL_HZ),
      );
    }
  });

  it('sustains the buzz across the whole crossing, not one note at the arrival', () => {
    // **This is the assertion the owner's recording forced.** The buzz used to be
    // one 380 ms note at the arrival and then silence; the recording measures a
    // sound that is continuous for the whole four seconds the boat is up - 3 of
    // 162 twenty-five millisecond windows fall more than 20 dB below the peak.
    // See docs/evidence/audio-reference.md, battleshipBuzz.
    //
    // Continuity is asserted as "no long silence inside the crossing" rather than
    // as one note, because it is no longer a note: it is many short runs whose
    // period wanders with the sweep. The longest hole allowed is a march note's
    // length, since a march note stops the sweep and the buzz stops with it -
    // that is one core and one pin, not a gap in the sound.
    for (const crossing of found) {
      const end = crossing.toCycle;
      if (end === null || ms(end - crossing.fromCycle) < 1000) continue;
      const inside = buzzesIn(crossing);
      expect(inside.length).toBeGreaterThan(10);
      let previous = crossing.fromCycle;
      let longestHoleMs = 0;
      for (const buzz of inside) {
        longestHoleMs = Math.max(longestHoleMs, ms(buzz.firstCycle - previous));
        previous = buzz.lastCycle;
      }
      longestHoleMs = Math.max(longestHoleMs, ms(end - previous));
      expect(longestHoleMs).toBeLessThan(MAX_BUZZ_HOLE_MS);
    }
  });

  it('holds each lane for seconds, so there is time to shoot at it', () => {
    // The owner, against his own unit: it "moves slowly down the the slots which
    // gives you time to shoot at it". `assets/reference/sprites/README.md`
    // measures the same thing over 17 episodes of IMG_6113.mov - median 2.5 s in
    // a lane, longest 5.9 s - and one traced descent runs 1.3 / 2.1 / 5.8 s a
    // lane. Against the 133 ms a lane this ROM used to give, and the 126 ms it
    // was cut to.
    //
    // The bounds are the ROM's own arithmetic with slack for the sweeps a note
    // lands in, not a transcription of those figures: a lane hold is
    // LANE_STEP_SWEEPS long and a sweep costs at least its nominal 13.46 ms.
    const nominalMs = LANE_STEP_SWEEPS * 13.46;
    for (const hold of holds) {
      const span = ms((hold.toCycle as number) - hold.fromCycle);
      expect(span).toBeGreaterThan(nominalMs);
      expect(span).toBeLessThan(nominalMs * 1.6);
    }
  });

  it('descends the lanes, top to bottom, without leaving its column', () => {
    // The claim the video could not settle on its own: it traced the succession
    // lane 0 -> lane 1 -> lane 2 and recorded that "the video cannot separate one
    // battleship moving from three in succession". The owner's "moves slowly
    // down the the slots" is the missing half. This asserts the ROM does what
    // both describe - one boat, walking down the lanes in order from the top.
    //
    // A crossing cut short by a hit or by the end of the game gives a prefix of
    // that walk, which is still a statement about direction, so the assertion is
    // on the prefix rather than on there being three of them.
    //
    // The *column* is the other half of "down the slots, not across them", and
    // it is not asserted here because it is not a variable: `draw_bship` takes
    // COL_BSHIP with no path that varies it, and there is nowhere for the boat
    // to go - the video found it outside cell 0 in none of 17 episodes, and the
    // tube carries a battleship segment for that cell only.
    for (const crossing of found) {
      const lanes = crossing.holds.map((hold) => hold.lane);
      expect(lanes.length).toBeLessThanOrEqual(laneCount);
      expect(lanes).toEqual([...Array(lanes.length).keys()]);
    }
  });
});
