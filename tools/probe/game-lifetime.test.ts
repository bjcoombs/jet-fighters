// How long the machine keeps running, and why it stops when it stops.
//
// ## Why this file exists
//
// A long probe run of this ROM looks alarming. Drive 24,000,000 cycles - sixty
// seconds - with no controls touched and the speaker falls silent partway
// through and stays silent for the rest of the run. The lit-segment output is
// byte-identical from there to 40 s, and a fire contact closed at any point
// afterwards changes neither. Sampling the program counter after that point
// lands on the inner arm of `dwell` almost every time.
//
// All of that is true and none of it is a fault. The reading it invites - that
// the ROM has wedged in a delay loop that never terminates - is wrong, and this
// file is here so the next person to run that probe does not spend a night
// chasing it.
//
// What is actually happening: the ROM plays a whole game and loses. Jets enter,
// march one column at a time, and reach the G line; each arrival costs the
// player a launcher, and the third one ends the game (PRD v1 rule 6, as
// amended - see that rule for why a capture costs a launcher rather than the
// game). `game_lost` writes ST_OVER into NIB_STATE and calls the loss sound.
// From the next sweep on, `tick` reads NIB_STATE, fails its `ALEI ST_PLAY`, and
// returns - so the sweep keeps running, the tube keeps being refreshed with a
// picture that no longer changes, and nothing ever touches the speaker again.
// That is the documented behaviour of the unit: the endings are terminal and
// the power switch is the only reset. The program counter camps in `dwell`
// afterwards for the same reason it does before - the sweep spends the great
// majority of every frame holding a grid lit.
//
// So the tests below pin the three claims that separate "ended" from "wedged":
//
//   1. after the sound stops the machine is still sweeping the tube, still
//      executing, and has decoded no illegal opcode;
//   2. a machine whose controls are actually being worked keeps sounding and
//      keeps redrawing far beyond the unattended machine's silence - the game
//      is playable, and its length is a function of play, not of a timer
//      running out;
//   3. throwing the power switch on a finished game starts a new one.
//
// (2) is the load-bearing one. It fails for a ROM that has genuinely stopped
// executing, and passes for one that merely reached an ending, which is the
// distinction the probe run on its own cannot make.
//
// Everything is read off the board's observation surface - `takeSpeakerEdges()`,
// `getLitSegments()`, `display.frameCount` - and every control movement goes
// through `setControl`, as a player's hand does. Nothing here reads the ROM's
// RAM; a test that asserted on NIB_STATE would prove the ROM computed the right
// number and say nothing about whether the machine was alive.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { assemble } from "../hmasm/assembler.js";
import { romImage } from "../hmasm/output.js";
import { Board } from "../../src/machine/board/board.js";
import type { SpeakerEdge } from "../../src/machine/board/speaker.js";
import { CYCLE_HZ } from "../../src/machine/cpu/cpu.js";

const ASM_PATH = resolve(__dirname, "../../asm/jetfighter.asm");

/** Assemble the game ROM once and share the image across the runs below. */
const ROM = romImage(assemble(readFileSync(ASM_PATH, "utf8"), ASM_PATH));

/** Seconds of emulated time, in machine cycles. */
function seconds(count: number): number {
  return Math.round(count * CYCLE_HZ);
}

/**
 * The moment the unattended machine falls silent, in seconds.
 *
 * Not a target: it is where the capture rule and the provisional cadence
 * constants happen to land today, and it moves whenever those constants do.
 * It is named because it is the figure that started the misdiagnosis, and the
 * horizons below are stated as multiples of it.
 *
 * It was 5.66 s while a single capture ended the game. Three captures are now
 * survivable (see launcher-lives.test.ts), so an unattended machine has to lose
 * three launchers before it stops, which takes roughly twice as long.
 */
const UNATTENDED_SILENCE_S = 10.92;

/** Every control this ROM reads, in the order a blind player works them. */
const LEVER_POSITIONS = ["up", "centre", "down"] as const;

/**
 * Machine cycles between control movements for the blind player below.
 *
 * The lever advances one lane and the fire contact changes state every slice, so
 * a full sweep of the three lanes takes six. At 3,000 cycles - about a fifth of
 * a sweep - the player works the case faster than a human but slower than the
 * ROM's own input scan, which samples each strobe line once per sweep. Nothing
 * about the argument below depends on the exact figure; it decides how well the
 * blind player plays, and therefore how long the game it is playing lasts.
 */
const PLAYER_SLICE_CYCLES = 3_000;

/**
 * Wall-clock allowance for the runs below.
 *
 * Sixty seconds of emulated time is around twenty million instructions, which
 * takes several wall-clock seconds - comfortably over Vitest's five-second
 * default. The horizon is the point of these tests, so the timeout moves rather
 * than the horizon.
 */
const LONG_RUN_TIMEOUT_MS = 60_000;

/**
 * Run the machine, draining the speaker as it goes.
 *
 * The speaker buffer is finite, so a long run has to be drained periodically or
 * it discards edges - which would make a live machine look silent, the exact
 * misreading this file exists to rule out.
 *
 * @param board the machine to advance.
 * @param cycles emulated cycles to run for.
 * @param onSlice called before each slice; where a player moves the controls.
 * @returns every speaker edge produced during the run.
 */
function run(
  board: Board,
  cycles: number,
  onSlice?: (board: Board, slice: number) => void,
): SpeakerEdge[] {
  const edges: SpeakerEdge[] = [];
  const target = board.cycles + cycles;
  let slice = 0;
  while (board.cycles < target) {
    onSlice?.(board, slice);
    board.step(PLAYER_SLICE_CYCLES);
    edges.push(...board.takeSpeakerEdges());
    slice += 1;
  }
  return edges;
}

/**
 * A player who cannot see the tube.
 *
 * It walks the lever through the three lanes and works the fire contact, which
 * is enough to shoot down jets: the missile launches in whichever lane the lever
 * is standing in, so cycling the lever while pressing fire eventually puts a
 * shot under every jet. It plays badly - it aims at nothing - and it still keeps
 * the game alive well past the unattended machine's own silence, which is
 * the whole point. A player that read the tube would prove less, because its
 * skill rather than the ROM's liveness would be carrying the result.
 */
function blindPlayer(board: Board, slice: number): void {
  board.setControl(
    "lever",
    LEVER_POSITIONS[Math.floor(slice / 2) % LEVER_POSITIONS.length],
  );
  board.setControl("fire", slice % 2 === 0 ? "up" : "down");
}

/**
 * A stable, comparable rendering of what the ROM last drew on the tube.
 *
 * The last *completed* sweep, not what a viewer sees at this instant: these runs
 * are read at arbitrary cycles, and an arbitrary cycle lands inside a sound's
 * blanking often enough to matter - the ROM parks the sweep while it bit-bangs
 * the speaker and the tube really is dark then (vfd-appearance.md D1). "The tube
 * changed" is a question about what the ROM drew.
 */
function tubeSignature(board: Board): string {
  return board
    .getFrame()
    .segments
    .map((segment) => `${segment.grid}.${segment.plate}`)
    .sort()
    .join(" ");
}

/** Split edges into `count` equal buckets spanning `cycles`, by edge cycle. */
function bucketByCycle(
  edges: readonly SpeakerEdge[],
  cycles: number,
  count: number,
): number[] {
  const buckets = new Array<number>(count).fill(0);
  const width = cycles / count;
  for (const { cycle } of edges) {
    const bucket = Math.min(count - 1, Math.floor(cycle / width));
    if (bucket >= 0) {
      buckets[bucket] += 1;
    }
  }
  return buckets;
}

describe("the unattended machine reaches an ending rather than wedging", () => {
  it(
    "keeps sweeping the tube and executing long after the speaker falls silent",
    () => {
      const board = new Board(ROM);

      const edges = run(board, seconds(60));

      // The symptom, reproduced: the speaker stops early and stays stopped.
      expect(edges.length).toBeGreaterThan(0);
      const lastEdgeSeconds = edges[edges.length - 1].cycle / CYCLE_HZ;
      expect(lastEdgeSeconds).toBeLessThan(UNATTENDED_SILENCE_S * 2);

      // And the diagnosis it does *not* support. The core is still fetching, it
      // has not fallen into standby, and it has not decoded a word it could not
      // execute - which a corrupted return address would eventually produce.
      expect(board.running).toBe(true);
      expect(board.cpu.standby).toBe(false);
      expect(board.cpu.illegalOpcodes).toBe(0);
      expect(board.cycles).toBeGreaterThanOrEqual(seconds(60));

      // The clinching one: whole display sweeps are still being run, measured
      // over a window that begins *after* the machine went quiet.
      //
      // Both `getStrobedGrids()` and `frameCount` count from the display's last
      // `clear()`, which nothing but the power switch calls - so read straight
      // off a sixty-second board they answer "at some point since power-on",
      // and a ROM that wedged mid-game in a loop touching one grid would still
      // report all ten from the gameplay that preceded it. Clearing here is
      // what makes the next five seconds the thing being observed. It resets
      // the display's own bookkeeping and blanks its grid and plate masks;
      // it does not touch the CPU, and the next grid the ROM raises restores
      // the masks.
      board.display.clear(board.cycles);
      expect(board.display.frameCount).toBe(0);
      expect(board.getStrobedGrids()).toEqual([]);

      run(board, seconds(5));

      // All ten grids inside that window, so it is the whole sweep running and
      // not a fragment of it - and enough completed PWM frames to be sweeps
      // rather than one stalled grid. Five seconds is around 320 frames at the
      // sweep period the ROM's header derives; a hundred is a floor with room
      // for the cadence constants to move.
      expect(board.getStrobedGrids()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(board.display.frameCount).toBeGreaterThan(100);
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it(
    "freezes its picture, which is what the played machine is measured against",
    () => {
      // The negative control for the liveness assertion in the next block, and
      // the reason that assertion is not vacuous: the same measurement, on the
      // same helper, over the same window, must come out the other way here.
      //
      // The unattended machine is *not* wedged - the test above proves it is
      // still running whole sweeps - so what distinguishes it is that its
      // picture stops changing. A liveness check that this machine also passes
      // is measuring nothing.
      const board = new Board(ROM);
      const horizon = seconds(20);
      const { samples } = sampleRun(board, horizon);

      expect(new Set(lastThird(board, horizon, samples)).size, "frozen picture").toBe(1);
      // And frozen while still sweeping, so the two properties are independent
      // and the played machine has to satisfy both.
      expect(board.display.frameCount).toBeGreaterThan(100);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});

/**
 * Run a board and sample what the tube shows, with the samples timestamped.
 *
 * Timestamps are the point: a liveness question about the *end* of a run has to
 * be asked of a window that begins near the end of it. Both `getStrobedGrids()`
 * and `frameCount` answer "at some point since the display was last cleared",
 * so read straight off a finished board they are satisfied by a machine that
 * worked for six seconds and then wedged - which is the machine these tests
 * exist to exclude.
 */
function sampleRun(
  board: Board,
  horizon: number,
  onSlice?: (board: Board, slice: number) => void,
): { edges: SpeakerEdge[]; samples: { cycle: number; picture: string }[] } {
  const samples: { cycle: number; picture: string }[] = [];
  const edges = run(board, horizon, (playing, slice) => {
    onSlice?.(playing, slice);
    if (slice % 100 === 0) {
      samples.push({ cycle: playing.cycles, picture: tubeSignature(playing) });
    }
  });
  return { edges, samples };
}

/** The samples taken in the last third of a run of `horizon` cycles. */
function lastThird(
  board: Board,
  horizon: number,
  samples: readonly { cycle: number; picture: string }[],
): string[] {
  const from = board.cycles - Math.floor(horizon / 3);
  return samples.filter((sample) => sample.cycle >= from).map((sample) => sample.picture);
}

describe("a machine whose controls are worked keeps playing", () => {
  it(
    "sounds and redraws throughout a run far longer than the unattended machine",
    () => {
      const board = new Board(ROM);
      const horizon = seconds(20);

      let framesAtTwoThirds = -1;
      const twoThirds = board.cycles + Math.floor((horizon * 2) / 3);
      const { edges, samples } = sampleRun(board, horizon, (playing, slice) => {
        blindPlayer(playing, slice);
        if (framesAtTwoThirds < 0 && playing.cycles >= twoThirds) {
          framesAtTwoThirds = playing.display.frameCount;
        }
      });

      // Sound across the run, not just its first six seconds. Ten buckets of
      // two seconds each.
      //
      // The bug this guards is a machine that stops *dead* partway in - the
      // unattended one, whose picture is byte-identical from six seconds on. A
      // blind player being destroyed is not that: the game ends, correctly, and
      // the tube goes on being swept and redrawn. This used to require all ten
      // buckets, which also required the blind player to survive the whole
      // twenty seconds, and that is not a property of the machine - it depends
      // on the sampled counter the game takes its randomness from, so any change
      // that moves the cycle stream by a few cycles a sweep moves it.
      //
      // So the assertion is on the shape of the sound, not on its last bucket:
      // no silent gap anywhere inside the sounding part of the run, and the
      // sound reaching well past the point the bug stopped at.
      const buckets = bucketByCycle(edges, horizon, 10);
      const lastHeard = buckets.reduce((last, count, i) => (count > 0 ? i : last), -1);
      expect(lastHeard, "sound reached past 16 s").toBeGreaterThanOrEqual(7);
      expect(
        buckets.slice(0, lastHeard + 1).filter((count) => count > 0),
        "no silent stretch before the game ends",
      ).toHaveLength(lastHeard + 1);

      // And a tube still being swept and still changing *at the end of the
      // run*, which is the half of this the bucket count no longer carries.
      //
      // Every assertion here is anchored on the horizon rather than on
      // power-on, and that is the whole point. `getStrobedGrids()` and the
      // signature-against-signatures[0] comparisons both count from the
      // display's last clear, so a machine that swept normally for six seconds
      // and then wedged solid satisfies all of them - they are true of exactly
      // the machine this test exists to exclude. That hole was fixed once
      // before on this project, in #54, and it came back the same way.
      const late = lastThird(board, horizon, samples);
      expect(late.length, "enough late samples to mean anything").toBeGreaterThan(3);
      expect(
        new Set(late).size,
        "the picture was still changing in the last third of the run",
      ).toBeGreaterThan(1);
      // And frames were still being completed after the two-thirds mark: a
      // wedged sweep stops closing PWM frames, however many it closed earlier.
      expect(framesAtTwoThirds).toBeGreaterThan(0);
      expect(
        board.display.frameCount,
        "the sweep was still completing frames at the horizon",
      ).toBeGreaterThan(framesAtTwoThirds);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});

describe("the power switch is the way back", () => {
  it(
    "starts a new game on a machine that has already ended one",
    () => {
      const board = new Board(ROM);

      run(board, seconds(15));
      expect(run(board, seconds(3))).toHaveLength(0); // ended, and silent

      board.powerOff();
      board.powerOn();

      // A fresh game: the sound comes back and the tube starts moving again.
      const signature = tubeSignature(board);
      const edges = run(board, seconds(3));
      expect(edges.length).toBeGreaterThan(0);
      expect(tubeSignature(board)).not.toEqual(signature);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});
