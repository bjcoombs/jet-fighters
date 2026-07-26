// How long the machine keeps running, and why it stops when it stops.
//
// ## Why this file exists
//
// A long probe run of this ROM looks alarming. Drive 24,000,000 cycles - sixty
// seconds - with no controls touched and the speaker produces 1238 edges, the
// last of them at 5.66 s, then nothing for the remaining fifty-four seconds. The
// lit-segment output is byte-identical at 6 s, 8 s, 12 s, 20 s and 40 s, and a
// fire contact closed at 10 s changes neither. Sampling the program counter
// after that point lands on the inner arm of `dwell` almost every time.
//
// All of that is true and none of it is a fault. The reading it invites - that
// the ROM has wedged in a delay loop that never terminates - is wrong, and this
// file is here so the next person to run that probe does not spend a night
// chasing it.
//
// What is actually happening: the ROM plays a whole game and loses. A jet
// entered on the first sweep, marched one column at a time, and reached the G
// line at 5.03 s, which PRD v1 rule 6 makes an instant game over. `game_capture`
// writes ST_OVER into NIB_STATE and calls the loss sound, which runs to 5.66 s.
// From the next sweep on, `tick` reads NIB_STATE, fails its `ALEI ST_PLAY`, and
// returns - so the sweep keeps running, the tube keeps being refreshed with a
// picture that no longer changes, and nothing ever touches the speaker again.
// That is the documented behaviour of the unit: the three endings are terminal
// and the power switch is the only reset. The program counter camps in `dwell`
// afterwards for the same reason it does before - the sweep spends the great
// majority of every frame holding a grid lit.
//
// So the tests below pin the three claims that separate "ended" from "wedged":
//
//   1. after the sound stops the machine is still sweeping the tube, still
//      executing, and has decoded no illegal opcode;
//   2. a machine whose controls are actually being worked keeps sounding and
//      keeps redrawing far beyond 5.66 s - the game is playable, and its length
//      is a function of play, not of a timer running out;
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
 */
const UNATTENDED_SILENCE_S = 5.66;

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
 * the game alive several times past the unattended machine's 5.66 s, which is
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

/** A stable, comparable rendering of what is lit on the tube. */
function tubeSignature(board: Board): string {
  return board
    .getLitSegments()
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
      // and a ROM that wedged at 5.66 s in a loop touching one grid would still
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
});

describe("a machine whose controls are worked keeps playing", () => {
  it(
    "sounds and redraws throughout a run several times longer than 5.66 s",
    () => {
      const board = new Board(ROM);
      const horizon = seconds(20);

      const signatures: string[] = [];
      const edges = run(board, horizon, (playing, slice) => {
        blindPlayer(playing, slice);
        if (slice % 400 === 0) {
          signatures.push(tubeSignature(playing));
        }
      });

      // Sound across the whole run, not just its first six seconds. Ten buckets of
      // two seconds each: an ending anywhere inside the run empties every bucket
      // after it, so this fails for a machine that stopped at 5.66 s.
      const buckets = bucketByCycle(edges, horizon, 10);
      expect(buckets.filter((count) => count > 0)).toHaveLength(buckets.length);

      // And a tube that keeps changing. The unattended machine's picture is
      // byte-identical from 6 s onwards; this one must not be.
      expect(new Set(signatures).size).toBeGreaterThan(1);
      expect(signatures[signatures.length - 1]).not.toEqual(signatures[0]);
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
