// The boat's arrival, from the ROM writing the lane nibble to samples in the
// audio output buffer.
//
// Paths in this file are relative to the repository root.
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
// clocked by the display sweep instead - `strobe` ticks `NIB_BUZZ` once per O
// strobe and toggles R15 every `BUZZ_DIV` of them - and the tube keeps scanning
// throughout.
//
// That changes what can be asserted, in three ways worth knowing before reading
// the tests:
//
//   - **The buzz is not a note and has no burst count.** Its length comes from
//     how long the boat is up, so the assertions are over the *crossing*, not
//     over a note.
//   - **Its period wanders**, because a sweep is however long the ROM's
//     between-sweep work took - which is exactly what the recording measures
//     (79-111 Hz within one arrival). So its rate is read by harmonic-comb
//     periodicity over a window wide enough to resolve it, never off one period.
//   - **It shares a band with the loss sound.** `gameOver`'s collapse stage is
//     91.6 Hz. `NIB_BSLANE` is what separates them, and it separates them
//     exactly: the ROM stops the buzz before it starts the loss sound.
//
// ## What the TMS1370 changed, and what it did not
//
// The audio layer is machine-independent and carried over untouched: the same
// `SpeakerDriver`, the same transport fake, the same rail and offset assertions.
// What moved is underneath it.
//
//   - **Every horizon is now a multiple of a named constant in
//     `src/machine/board/tms1370-cadence.ts`.** The v2 file carried
//     `BURST_GAP_CYCLES = 8000`, `PLAYER_SLICE_CYCLES = 3000`, `STEP_CYCLES = 200`
//     and a 13.46 ms sweep as literals, and every one of them silently meant "at
//     400 kHz". At this part's ~58.3 kHz instruction rate they are wrong by a
//     factor of seven, and nothing about a literal says so.
//   - **Nine grids in twenty-four strobes, not ten dwells.** The v2
//     `BUZZ_NOMINAL_HZ = 86` was `10 dwells / 4 per toggle` at the old sweep
//     rate. `BUZZ_NOMINAL_HZ` is now imported, where it is derived from this
//     machine's own sweep as `(STROBES_PER_SWEEP * SWEEP_HZ) / (2 * BUZZ_DIV)`.
//   - **A "run of like periods" no longer finds the buzz at all**, and this is a
//     property of the new sweep rather than a fault. Three buzz periods span two
//     sweeps (24 strobes a sweep, 16 strobes a period), so each period contains a
//     different share of the sweep's long between-sweep tail and consecutive
//     rise-to-rise intervals differ by up to 40%. Measured over a crossing, the
//     per-period readings run 57-114 Hz on a waveform whose comb rate is a steady
//     102 Hz. The buzz is therefore identified by `combPeriodicityHz` over a
//     window, which is `docs/evidence/audio-reference.md`'s own detector and the
//     tool `tools/probe/tms1370-probe.ts` documents at length for this signal.
//     `notesIn` survives for the *notes* - the march, whose period really is
//     steady - because the offset assertion needs one.
//
// Node-side test: no DOM, no browser globals, no AudioContext.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import {
  BURST_GAP_CYCLES,
  BUZZ_NOMINAL_HZ,
  PLAYER_SLICE_CYCLES,
  STEP_CYCLES,
  SWEEP_HZ,
} from '../../src/machine/board/tms1370-cadence.js';
import {
  SpeakerDriver,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type AudioWorkletNodeLike,
  type GainNodeLike,
  type MessagePortLike,
} from '../../src/machine/audio/driver.js';
import {
  assembleGame,
  combPeriodicityHz,
  Tms1370Machine,
  type SpeakerEdge,
} from './tms1370-probe.js';

const SAMPLE_RATE = 48_000;

/** The Web Audio render quantum - what the hardware asks for at a time. */
const QUANTUM = 128;

/** One display frame at 60 Hz, the interval `requestAnimationFrame` runs at. */
const FRAME_MS = 1000 / 60;

/** `MAX_FRAME_MS` from src/main.ts, copied not imported - importing main.ts starts a page. */
const MAX_FRAME_MS = 100;

/** `battleshipBuzz.repetitionRangeHz`, docs/evidence/audio-reference.md. */
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

type Assembly = ReturnType<typeof assembleGame>;

/** A symbol's value out of the assembler's table, so no address is transcribed here. */
function symbol(asm: Assembly, name: string): number {
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
// through the assembler's symbol table and from the cadence module's sweep
// length, and a constant change moves no number in this file at all.

const ASM = assembleGame();

/**
 * One idle sweep, in milliseconds.
 *
 * The figure the v2 file spelled `13.46`, re-derived rather than transcribed.
 * That literal was ten grid dwells at the v2 core's 400 kHz; this is
 * `SWEEP_INSTRUCTIONS / CYCLE_HZ`, which is what `SWEEP_HZ` already is the
 * reciprocal of, so the sweep length is stated in exactly one place - the
 * cadence module - and this file only converts its units. 15.24 ms at the
 * midpoint instruction rate.
 */
const SWEEP_NOMINAL_MS = 1000 / SWEEP_HZ;

/**
 * How much longer a sweep costs during a played game than an idle one.
 *
 * **MEASURED off this machine**, not estimated: 3936 sweeps in 70 s of a game
 * being played by `playerControls` below is 17.8 ms a sweep against the 15.24 ms
 * `SWEEP_NOMINAL_MS` gives, and the same run at skill 2 and skill 3 gives 17.9
 * and 18.1 ms. Two things stretch it - the buzz ticks in every strobe while the
 * boat is up, and every note blanks the sweep for its whole length - so a run
 * sized on the idle sweep would come up short of the crossing it was sized for.
 * 1.2 is the measured 1.17 rounded away from zero, because this figure only ever
 * sets how long a run is and running long costs a second.
 */
const SWEEP_PLAY_STRETCH = 1.2;

/** Milliseconds a sweep costs during play. */
const SWEEP_PLAY_MS = SWEEP_NOMINAL_MS * SWEEP_PLAY_STRETCH;

/**
 * Sweeps the boat holds one lane.
 *
 * `bship_enter` loads NIB_BS_HI:NIB_BS_LO with BSHIP_STEP_HI:BSHIP_STEP_LO and
 * `bs_crossing` steps the boat on the sweep the pair reaches zero, so a hold is
 * one more sweep than the pair counts. 65, and confirmed against the running
 * machine: the lane nibble changed on sweeps 543, 608, 673 and 738.
 */
const LANE_STEP_SWEEPS =
  symbol(ASM, 'BSHIP_STEP_HI') * 16 + symbol(ASM, 'BSHIP_STEP_LO') + 1;

/** Lanes the boat walks down, which is also the lanes the lever has. */
const LANE_COUNT = symbol(ASM, 'LANE_COUNT');

/** Sweeps a whole descent takes: one step per lane. */
const CROSSING_SWEEPS = LANE_STEP_SWEEPS * LANE_COUNT;

/**
 * Sweeps per step of the gap countdown.
 *
 * `bs_waiting` steps it only on the sweep `NIB_TICK` reads zero, and `NIB_TICK`
 * is a nibble incremented once a sweep, so the countdown runs at a sixteenth of
 * the sweep rate. Sixteen is the width of a nibble and not a constant the ROM
 * names, which is why it is written here rather than read.
 */
const GAP_PRESCALE = 16;

/**
 * Sweeps from one crossing ending to the next beginning.
 *
 * `bs_leave` reloads the countdown with BSHIP_GAP_HI:BSHIP_GAP_LO, so unlike v2
 * - which sampled `NIB_RAND` into the low nibble - this is a fixed interval
 * rather than a worst case. Measured off the running machine at 989 and 1005
 * sweeps between crossings against this arithmetic's 992.
 */
const GAP_SWEEPS =
  (symbol(ASM, 'BSHIP_GAP_HI') * 16 + symbol(ASM, 'BSHIP_GAP_LO') + 1) * GAP_PRESCALE;

/**
 * Sweeps from power-on to the first arrival: reset seeds BSHIP_OPEN_HI:_LO.
 *
 * Stated with the same +1 the two countdowns above carry, which makes it 544
 * against the 528 the machine actually runs - the reset path loads the pair one
 * unit differently from `bs_leave`. Erring one unit long is the safe direction
 * for a figure whose only job is to size a run, and the run below carries a
 * whole crossing of slack on top.
 */
const OPENING_GAP_SWEEPS =
  (symbol(ASM, 'BSHIP_OPEN_HI') * 16 + symbol(ASM, 'BSHIP_OPEN_LO') + 1) * GAP_PRESCALE;

/**
 * Crossings a run is sized to contain.
 *
 * **One, and the reason is not the battleship.** A crossing arrives about every
 * 19.8 s - the interval measured off the owner's isolated recording, and 21.0 s
 * measured off this machine - and a game currently ends in tens of seconds. The
 * two are the same order, so a run cannot be *relied* on to contain two
 * crossings: when the game stops, `tick` returns at its first test from then on
 * and the battleship's turn never comes round again.
 *
 * That is why the opening crossing exists and why this file leans on it. When
 * games run to minutes, this becomes two and the horizon below follows it
 * without another edit.
 */
const CROSSINGS_WANTED = 1;

/**
 * Seconds of emulated time to run: the opening gap, the crossings wanted and the
 * gaps between them, then one crossing of slack.
 */
const RUN_SWEEPS =
  OPENING_GAP_SWEEPS +
  (CROSSINGS_WANTED + 1) * CROSSING_SWEEPS +
  (CROSSINGS_WANTED - 1) * GAP_SWEEPS;
const RUN_SECONDS = Math.ceil((RUN_SWEEPS * SWEEP_PLAY_MS) / 1000);

/** The lever's three positions, which on this part are the K columns' lane codes. */
const LANES = [0, 1, 2] as const;

/**
 * Player slices between lever movements: one sweep's worth.
 *
 * `PLAYER_SLICE_CYCLES` is a fifth of a sweep, and the ROM samples the lever
 * once a sweep, so moving it every fifth slice is as often as the program can
 * possibly notice - a hand that moved it faster would be working a control the
 * machine cannot read.
 */
const SLICES_PER_LEVER_MOVE = Math.round(CYCLE_HZ / SWEEP_HZ / PLAYER_SLICE_CYCLES);

/**
 * A player who works the case but never shoots at the boat.
 *
 * Both runs below need a game that is still being played when the crossing
 * arrives, and an unattended machine is not: it loses three launchers and stops,
 * and `tick` returns at its first test from then on, so the battleship's turn
 * never comes round again. Working the lever and the fire contact keeps the game
 * alive, which is what game-lifetime.test.ts measures.
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
 * the ROM only through `setContacts`, closing a contact on the K matrix as a
 * hand does. A sighted human has the same information: the boat is lit on the
 * tube.
 */
function playerControls(machine: Tms1370Machine, slice: number): void {
  const ram = machine.ram;
  const crossing = (ram[BSLANE_ADDRESS] as number) < LANE_COUNT;
  // Fire is held over the crossing *and* over the last few units of the
  // countdown to one. Holding it only over the crossing is not enough and was
  // not enough here: a missile launched just before the boat arrives is still in
  // flight when it does, and it shoots it down in its first lane.
  const due = (ram[BS_HI_ADDRESS] as number) * 16 + (ram[BS_LO_ADDRESS] as number);
  const nearlyDue = due < GAP_UNITS_HELD_FIRE;
  machine.setContacts({
    // The dial is a physical detent and is always closed somewhere, so it is
    // held rather than left open. Skill 1 is the setting the march ladder's
    // slowest rung is measured at, and the setting the reference recordings were
    // made at as far as anything records.
    skill: SKILL_DIAL,
    lane: LANES[Math.floor(slice / SLICES_PER_LEVER_MOVE) % LANES.length] as 0 | 1 | 2,
    fire: !crossing && !nearlyDue && slice % 2 === 0,
  });
}

/** Where the skill dial is left for the whole of both runs. */
const SKILL_DIAL = 1;

/**
 * Units of the battleship's countdown over which the probe stops firing.
 *
 * A missile crosses the board in `MISSILE_SWEEPS` per column over five columns;
 * the countdown ticks once every sixteen sweeps. Six units is about a hundred
 * sweeps, comfortably longer than a missile's flight, so nothing the probe
 * launched is still airborne when the boat appears.
 */
const GAP_UNITS_HELD_FIRE = 6;

/**
 * Where `NIB_BSLANE` lives, and how to read it.
 *
 * The nibble holds a lane, 0 to `LANE_COUNT - 1`, while the boat is up and
 * `BS_NONE` while it is not. It is read as "below `LANE_COUNT`" rather than
 * "not `BS_NONE`" because `bc_step` increments it past the last lane and only
 * then calls `bs_leave`, so a probe sampling faster than a sweep catches the
 * out-of-range value in between - measured, once per crossing at the
 * `STEP_CYCLES` resolution the second half samples at.
 */
const BSLANE_ADDRESS = symbol(ASM, 'FILE_STATE') * 16 + symbol(ASM, 'NIB_BSLANE');
const BS_LO_ADDRESS = symbol(ASM, 'FILE_TIME') * 16 + symbol(ASM, 'NIB_BS_LO');
const BS_HI_ADDRESS = symbol(ASM, 'FILE_TIME') * 16 + symbol(ASM, 'NIB_BS_HI');

/** Sweeps to run past reset before the lane nibble means anything. */
const SETTLE_SWEEPS = 5;

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
 * Periods a note has to hold its period over to be one of `notesIn`'s notes.
 *
 * Only the *notes* are read this way now - the march, the missile blip, the
 * warning beeps, all of which `note_loop` builds out of a fixed half-period and
 * whose runs are therefore tens of periods long. Eight is comfortably above the
 * one-period fragments the sweep-clocked buzz decomposes into and comfortably
 * below the 45 periods a march step makes.
 */
const MIN_NOTE_PERIODS = 8;

/**
 * The window a repetition rate is scored over, in cycles.
 *
 * `docs/evidence/audio-reference.md` scores the buzz's f0 over 0.34 s windows,
 * which at the 93.4 Hz it measured is 32 periods of the buzz. Stated in periods
 * of `BUZZ_NOMINAL_HZ` rather than in seconds so that it stays the same
 * *measurement* - enough periods to resolve the comb - on a machine whose sweep
 * rate, and therefore whose buzz rate, is set by an oscillator with a +/-14%
 * stated spread.
 */
const BUZZ_WINDOW_PERIODS = 32;
const BUZZ_WINDOW_CYCLES = Math.round((BUZZ_WINDOW_PERIODS / BUZZ_NOMINAL_HZ) * CYCLE_HZ);

/**
 * The longest silence allowed inside a crossing before the buzz counts as having
 * stopped.
 *
 * A march note is ~72 ms and stops the sweep for its whole length, and the
 * missile blip and the warning beeps do the same for less. 150 ms is the longest
 * of those with room for the sound either side of it to be recognised. Measured,
 * the longest interval between two speaker edges inside a crossing is 16.6 ms
 * over nine crossings, because the note that stops the buzz is itself making
 * edges while it holds the sweep.
 */
const MAX_BUZZ_HOLE_MS = 150;

/**
 * How late the buzz's first edge may be against the arrival, in buzz periods.
 *
 * `bship_enter` writes the lane nibble and arms `NIB_BUZZ` in the same pass, but
 * the first edge cannot come until `BUZZ_DIV` further O strobes have gone by -
 * a third of a sweep - and `bship_enter` runs in the between-sweep work, after
 * the sweep it belongs to has finished strobing. So the pin moves a sweep's tail
 * plus a third of a sweep after the nibble does. Measured across nine crossings
 * at three skill settings: 12.1 to 12.8 ms, against the 20.3 ms two periods of
 * `BUZZ_NOMINAL_HZ` allow.
 */
const ARRIVAL_LAG_PERIODS = 2;

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
 * Two passes, and the second is not optional. Splitting on `BURST_GAP_CYCLES` of
 * silence alone groups two notes the ROM played back to back into one - a
 * missile blip running straight into the arrival buzz is well under a sweep
 * apart - and one frequency taken over that group belongs to neither note. So
 * each gap-separated sound is broken into runs of like periods and every run is
 * measured on its own, which is how speaker-bands.test.ts reads the same stream
 * and for the same reason.
 *
 * On this machine that second pass no longer finds the *buzz*, and is not asked
 * to: three buzz periods span two sweeps, so consecutive periods differ by far
 * more than `RUN_TOLERANCE` and the buzz decomposes into single-period
 * fragments. See the header. What it still finds, and what it is used for here,
 * are the notes `note_loop` plays.
 */
function notesIn(edges: readonly SpeakerEdge[]): Note[] {
  const groups: SpeakerEdge[][] = [];
  let group: SpeakerEdge[] = [];
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
 * The buzz's repetition rate over a window of the pin's own edge stream.
 *
 * `combPeriodicityHz` and not `soundHz`, and `tools/probe/tms1370-probe.ts`
 * gives the reason in full: the buzz's edges are not evenly spaced, so a median
 * period reads the jitter, and a march beep sharing the window contributes
 * nothing at 100 Hz while the buzz contributes everything.
 */
function buzzHz(edges: readonly SpeakerEdge[], from: number, to: number): number {
  return combPeriodicityHz(edges, from, to, CYCLE_HZ);
}

/**
 * The rate read over each successive window of a crossing, at half-window hops.
 *
 * The unit `battleshipBuzz.continuity` is reported in: a sound that stops half
 * way through a crossing shows up as windows that fall out of band, where one
 * reading over the whole four seconds would still be dominated by the half that
 * sounded.
 */
function buzzWindowsIn(
  edges: readonly SpeakerEdge[],
  from: number,
  to: number,
): number[] {
  const readings: number[] = [];
  const hop = Math.round(BUZZ_WINDOW_CYCLES / 2);
  for (let at = from; at + BUZZ_WINDOW_CYCLES <= to; at += hop) {
    readings.push(buzzHz(edges, at, at + BUZZ_WINDOW_CYCLES));
  }
  return readings;
}

/** The longest interval the speaker held still for, inside a window. */
function longestSilenceMs(edges: readonly SpeakerEdge[], from: number, to: number): number {
  const within = edges.filter((edge) => edge.cycle >= from && edge.cycle <= to);
  let previous = from;
  let longest = 0;
  for (const edge of within) {
    longest = Math.max(longest, ms(edge.cycle - previous));
    previous = edge.cycle;
  }
  return Math.max(longest, ms(to - previous));
}

interface PageRun {
  /** Every sample the transport played, in order. */
  readonly out: Float32Array;
  /** Every R15 transition of the run, in cycle order. */
  readonly edges: readonly SpeakerEdge[];
  /** The notes the ROM played, in the order it played them. */
  readonly notes: readonly Note[];
  /** Intervals during which the boat was on the tube, in cycle order. */
  readonly crossings: ReadonlyArray<readonly [number, number]>;
  /** Cycle of the very first R15 transition of the run. */
  readonly firstEdgeCycle: number;
}

/**
 * Run src/main.ts's frame loop against the audio hardware's pull and keep
 * everything the transport played.
 *
 * Both clocks advance against one virtual wall clock, so the run is
 * deterministic: the audio side consumes a quantum per 128/48000 s and the
 * frame loop fires whenever that clock passes its next due time.
 *
 * There is no power switch here. `Board` had one and this harness does not:
 * `Tms1370Machine` resets the core in its constructor and the ROM clears its own
 * RAM, which is the reset this part actually has.
 */
async function runPage(): Promise<PageRun> {
  const machine = new Tms1370Machine();
  const context = new FakeContext();

  const drained: SpeakerEdge[] = [];
  const crossings: Array<readonly [number, number]> = [];
  let crossingFrom: number | null = null;
  const source = {
    takeSpeakerEdges: () => {
      const edges = machine.takeSpeakerEdges();
      drained.push(...edges);
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
    cyclesPerSecond: CYCLE_HZ,
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
  // then let the machine run inside the same handler.
  const starting = driver.start();
  driver.reset();
  await starting;

  let owed = 0;
  let slice = 0;
  let lastFrameMs: number | null = null;
  const frame = (nowMs: number): void => {
    const elapsedMs = lastFrameMs === null ? 0 : Math.min(nowMs - lastFrameMs, MAX_FRAME_MS);
    lastFrameMs = nowMs;
    owed += (elapsedMs / 1000) * CYCLE_HZ;
    let budget = Math.floor(owed);
    // The controls are worked in slices inside the frame's budget, not once a
    // frame: see `playerControls`. A frame is about a sweep, and a player who
    // only touched the case that often would never close two different contacts
    // inside one sweep.
    while (budget > 0) {
      playerControls(machine, slice);
      slice += 1;
      // Armed only once the ROM's own RAM clear has finished. RAM is not cleared
      // by hardware reset on this part and the ROM zeroes it, and zero is lane 0:
      // a watcher armed before `reset` writes BS_NONE reads the clear as an
      // arrival, and would open a crossing on the first cycle of every run.
      const crossing =
        machine.sweepCount >= SETTLE_SWEEPS &&
        (machine.ram[BSLANE_ADDRESS] as number) < LANE_COUNT;
      if (crossing && crossingFrom === null) crossingFrom = machine.cycles;
      if (!crossing && crossingFrom !== null) {
        crossings.push([crossingFrom, machine.cycles]);
        crossingFrom = null;
      }
      const executed = machine.step(Math.min(budget, PLAYER_SLICE_CYCLES));
      if (executed === 0) {
        owed = 0;
        break;
      }
      owed -= executed;
      budget -= executed;
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

  if (crossingFrom !== null) crossings.push([crossingFrom, machine.cycles]);
  return {
    out,
    edges: drained,
    notes: notesIn(drained),
    crossings,
    firstEdgeCycle: (drained[0] as SpeakerEdge).cycle,
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

/** The rate the *pin* ran at over each crossing, before the audio layer sees it. */
const romBuzzHz = run.crossings.map(([from, to]) => buzzHz(run.edges, from, to));

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
 * closed at `machine.cycles` - the machine's last cycle, which is past the last
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

/**
 * The pin, read back out of the samples the transport played.
 *
 * Every rail-to-rail transition in an output window, restamped onto the
 * machine's cycle timeline so it can be measured with the same tools the pin's
 * own stream is. This is contract criterion V5's shape - compare *reconstructed
 * pin edges*, not spectra - and here it is what makes "did the sound survive the
 * transport" answerable in the units the sound is specified in.
 */
function renderedEdges(from: number, to: number): SpeakerEdge[] {
  const edges: SpeakerEdge[] = [];
  let rail = 0;
  for (let i = Math.max(from, 0); i < Math.min(to, run.out.length); i += 1) {
    const next = run.out[i] > RAIL ? 1 : run.out[i] < -RAIL ? -1 : rail;
    if (rail !== 0 && next !== rail) {
      edges.push({ cycle: (i / SAMPLE_RATE) * CYCLE_HZ, level: next > 0 ? 1 : 0 });
    }
    rail = next;
  }
  return edges;
}

/** Rail-to-rail transitions in an output window. */
function transitionsIn(from: number, to: number): number {
  return renderedEdges(from, to).length;
}

describe('the arrival buzz reaches the audio output buffer', () => {
  it('crossed at least once, so there is something to assert about', () => {
    expect(run.crossings.length).toBeGreaterThanOrEqual(CROSSINGS_WANTED);
    // The ROM emitted a buzz, read off the pin before the audio layer touches
    // it. Under v2 this was a count of in-band runs of like periods; on this
    // machine a run is one period long and reads anywhere from 57 to 114 Hz, so
    // the rate is taken by the comb over the crossing - the same measurement,
    // by the tool that can make it here.
    expect(romBuzzHz.length).toBeGreaterThan(0);
    for (const hz of romBuzzHz) {
      expect(hz).toBeGreaterThanOrEqual(BUZZ_MIN_HZ);
      expect(hz).toBeLessThanOrEqual(BUZZ_MAX_HZ);
    }
    // The control: a run whose transport never played anything would satisfy
    // every "is it in band" assertion below vacuously.
    expect(firstTransition(run.out)).toBeGreaterThanOrEqual(0);
  });

  it('puts the buzz into the output at 79-111 Hz, measured over the crossing', () => {
    // **The window is the crossing, not a note.** The buzz's period wanders with
    // the sweep, so any window short enough to be one note is far too short to
    // resolve a ~100 Hz fundamental: measured under v2, the per-note readings
    // came back at 141 Hz and worse on a waveform that was perfectly correct.
    // Asking the question over the whole four seconds is asking it of a window
    // that can answer it.
    //
    // **And by the comb, not by a spectral peak.** v2 read this with
    // `dominantFrequency`, which is the method
    // `docs/evidence/audio-reference.md` records as failing on exactly this
    // sound - and it fails here too rather than in theory: run against the
    // rendered crossing it returns 77 Hz, out of band, on samples whose
    // repetition rate is a steady 103 Hz. Three buzz periods span two sweeps, so
    // the waveform's true fundamental is the sweep *pair* at about 24 Hz and the
    // peak lands on whichever of its harmonics the notes inside the crossing
    // happen to feed. The repetition rate is the third one. So the transitions
    // are read back out of the played samples and combed, which is the
    // measurement the sound is specified in and the one the pin is checked with
    // above - and the two agreeing is the whole claim of this half of the file.
    const strays: string[] = [];
    for (const crossing of run.crossings) {
      const { from, to } = windowOfCrossing(crossing);
      if (to - from < SAMPLE_RATE * 0.5) continue;
      const played = renderedEdges(from, to);
      const hz = buzzHz(played, -Infinity, Infinity);
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
    // drift would be. A buzz fragment is one period long and far too short a
    // window to count transitions in, and it is excluded twice over: by
    // `MIN_NOTE_PERIODS`, which no sweep-clocked fragment reaches, and by taking
    // only notes above the buzz's own band. Both bounds come off the note
    // itself, so nothing here is transcribed.
    //
    // Notes whose window is wholly inside the recorded output, too: the machine
    // runs until the game ends and the transport is pumped for a fixed number of
    // quanta, so the very last notes of a run can fall past the end of the buffer
    // - a window off the end would count zero transitions and read as total drift
    // when nothing had drifted.
    const notes = run.notes.filter((note) => {
      if (note.periods < MIN_NOTE_PERIODS || note.hz <= BUZZ_MAX_HZ) return false;
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
    // lasts. That is the machine working - one pin, one core. Measured on this
    // part, a crossing carries 172 to 208 transitions a second against the 197
    // `BUZZ_NOMINAL_HZ` doubled predicts, so the shortfall is about a sixth.
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
 * Every crossing, and the speaker edges beside them, in a headless run of a game
 * being played.
 *
 * The crossing is read off `NIB_BSLANE` rather than off the tube because the
 * tube is blank for the whole of every sound (`Tms1370Machine.getObservedFrame`,
 * D1), so a lit-segment signal toggles once per sound rather than once per
 * crossing. The nibble is the ROM's own state, and its address comes from the
 * assembler's symbol table so this file transcribes no addresses.
 */
function crossings(): { crossings: Crossing[]; edges: SpeakerEdge[] } {
  const machine = new Tms1370Machine();

  // Past the reset and RAM-clear passes before watching the nibble. RAM is not
  // cleared by hardware reset on this part and the ROM clears it to zero, and
  // zero is lane 0: a watcher armed before that reads the clear as an arrival.
  machine.runSweeps(SETTLE_SWEEPS, RUN_SECONDS * CYCLE_HZ);

  const edges: SpeakerEdge[] = [];
  const found: Crossing[] = [];
  let previous = machine.ram[BSLANE_ADDRESS] as number;
  let open: Crossing | null = null;
  const until = machine.cycles + RUN_SECONDS * CYCLE_HZ;
  // Stepped finely, worked coarsely. The lane nibble is only ever seen to within
  // one step, and the assertions below place the buzz's first edge against the
  // sweep the nibble changed on - which needs a step much shorter than a sweep.
  // `STEP_CYCLES` is one grid strobe, which is the finest step that still tells
  // the caller about the game rather than about `strobe`. The controls still
  // move on the slice a hand would work them at.
  const stepsPerSlice = Math.round(PLAYER_SLICE_CYCLES / STEP_CYCLES);
  let step = 0;
  while (machine.cycles < until) {
    if (step % stepsPerSlice === 0) {
      playerControls(machine, step / stepsPerSlice);
    }
    step += 1;
    machine.step(STEP_CYCLES);
    edges.push(...machine.takeSpeakerEdges());
    const lane = machine.ram[BSLANE_ADDRESS] as number;
    if (lane !== previous) {
      const wasCrossing = previous < LANE_COUNT;
      const isCrossing = lane < LANE_COUNT;
      const closing = open?.holds[open.holds.length - 1];
      if (closing !== undefined && closing.toCycle === null) closing.toCycle = machine.cycles;
      // Only "no boat" -> a lane is an arrival, and only a lane -> "no boat" is a
      // departure. Lane to lane is the boat stepping down, which is neither.
      if (!wasCrossing && isCrossing) {
        open = {
          fromCycle: machine.cycles,
          toCycle: null,
          holds: [{ lane, fromCycle: machine.cycles, toCycle: null }],
        };
        found.push(open);
      } else if (wasCrossing && !isCrossing && open !== null) {
        open.toCycle = machine.cycles;
        open = null;
      } else if (open !== null && isCrossing) {
        open.holds.push({ lane, fromCycle: machine.cycles, toCycle: null });
      }
      previous = lane;
    }
  }
  return { crossings: found, edges };
}

describe('the crossing is announced by a sustained buzz', () => {
  const { crossings: found, edges } = crossings();

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

  it('crossed the far zone, and finished some lanes on the way down', () => {
    expect(found.length).toBeGreaterThanOrEqual(CROSSINGS_WANTED);
    // More than one, so the assertions below are about a boat that moved rather
    // than one that arrived and was shot where it stood.
    expect(holds.length).toBeGreaterThanOrEqual(2);
  });

  it('sounds the buzz on the sweep the boat arrives on', () => {
    // `bship_enter` writes lane 0 and arms the buzz in the same pass, so the
    // sound and the lane nibble move together. If the arrival ever went silent -
    // the first thing the report was checked against - this is where it would
    // show.
    //
    // Two assertions, because the pin moving is not the same claim as the buzz
    // sounding: the first edge lands within `ARRIVAL_LAG_PERIODS` of the nibble
    // changing, and the rate over the first window of the crossing is the buzz's
    // rather than some other sound's.
    for (const crossing of found) {
      const first = edges.find((edge) => edge.cycle >= crossing.fromCycle);
      expect(first, 'the speaker never moved after the boat arrived').toBeDefined();
      expect(ms((first as SpeakerEdge).cycle - crossing.fromCycle)).toBeLessThan(
        ARRIVAL_LAG_PERIODS * (1000 / BUZZ_NOMINAL_HZ),
      );
      const hz = buzzHz(edges, crossing.fromCycle, crossing.fromCycle + BUZZ_WINDOW_CYCLES);
      expect(hz).toBeGreaterThanOrEqual(BUZZ_MIN_HZ);
      expect(hz).toBeLessThanOrEqual(BUZZ_MAX_HZ);
    }
  });

  it('sustains the buzz across the whole crossing, not one note at the arrival', () => {
    // **This is the assertion the owner's recording forced.** The buzz used to be
    // one 380 ms note at the arrival and then silence; the recording measures a
    // sound that is continuous for the whole four seconds the boat is up - 3 of
    // 162 twenty-five millisecond windows fall more than 20 dB below the peak.
    // See docs/evidence/audio-reference.md, battleshipBuzz.
    //
    // Continuity is asserted two ways, because on this machine either alone
    // would pass on a broken sound. Every window of the crossing has to read the
    // buzz's rate - a buzz that stopped half way would leave the back half's
    // windows out of band while a single reading over the crossing stayed in it.
    // And the speaker may not hold still for longer than a note, since a note
    // stops the sweep and the buzz stops with it - that is one core and one pin,
    // not a gap in the sound.
    for (const crossing of found) {
      const end = crossing.toCycle;
      if (end === null || ms(end - crossing.fromCycle) < 1000) continue;
      const readings = buzzWindowsIn(edges, crossing.fromCycle, end);
      expect(readings.length).toBeGreaterThan(10);
      const strays = readings.filter((hz) => hz < BUZZ_MIN_HZ || hz > BUZZ_MAX_HZ);
      expect(strays).toEqual([]);
      expect(longestSilenceMs(edges, crossing.fromCycle, end)).toBeLessThan(MAX_BUZZ_HOLE_MS);
    }
  });

  it('holds each lane for seconds, so there is time to shoot at it', () => {
    // The owner, against his own unit: it "moves slowly down the the slots which
    // gives you time to shoot at it". `assets/reference/sprites/README.md`
    // measures the same thing over 17 episodes of IMG_6113.mov - median 2.5 s in
    // a lane, longest 5.9 s - and one traced descent runs 1.3 / 2.1 / 5.8 s a
    // lane. Against the 133 ms a lane the v1 ROM used to give.
    //
    // The bounds are the ROM's own arithmetic with slack for the sweeps a note
    // lands in, not a transcription of those figures: a lane hold is
    // `LANE_STEP_SWEEPS` long and a sweep costs at least `SWEEP_NOMINAL_MS`.
    // The ceiling is `SWEEP_PLAY_STRETCH` again with margin - measured, the holds
    // in nine crossings at three skill settings ran 1257 to 1420 ms against a
    // nominal 991, a stretch of 1.27 to 1.43, and a march note landing inside a
    // hold is what moves it.
    const nominalMs = LANE_STEP_SWEEPS * SWEEP_NOMINAL_MS;
    for (const hold of holds) {
      const span = ms((hold.toCycle as number) - hold.fromCycle);
      expect(span).toBeGreaterThan(nominalMs);
      expect(span).toBeLessThan(nominalMs * 1.75);
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
    // it is not asserted here because it is not a variable: the boat is drawn on
    // GRID_BSHIP with no path that varies it, and there is nowhere for it to go -
    // the video found it outside cell 0 in none of 17 episodes, and the output
    // PLA carries the battleship's three lanes on that grid only.
    for (const crossing of found) {
      const lanes = crossing.holds.map((hold) => hold.lane);
      expect(lanes.length).toBeLessThanOrEqual(LANE_COUNT);
      expect(lanes).toEqual([...Array(lanes.length).keys()]);
    }
  });
});
