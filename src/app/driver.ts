// The frame driver: the browser end of the machine, and the only clock in the
// program.
//
// Everything below this file is a device. `Board` is the CPU, the tube, the
// speaker and the case contacts wired together, and it advances only when it is
// stepped; the tube renderer paints whatever PWM duty the tube reached;
// `SpeakerDriver` plays whatever the ROM did to pin R15. None of them owns a
// timer. This module supplies the one thing they lack - elapsed wall-clock time -
// and does nothing else:
//
//   1. read how long the last frame took;
//   2. run the board for that many machine cycles;
//   3. draw the tube's PWM state, with the same elapsed time for the phosphor;
//   4. hand the drained R15 edges to the speaker.
//
// There is no game state here, and there is nowhere for any to hide. The score,
// the jets, the lives and the skill level exist only as nibbles in the emulated
// RAM, put there by the ROM in `asm/jetfighter.asm`. A control movement reaches
// the game the way a player's hand does: it closes a contact on the input
// matrix, and the ROM finds out on its next strobe.
//
// The power switch is the whole reset story. Powering on resets the core and
// leaves RAM undefined until the ROM's own clear loop runs; powering off halts
// the core and invalidates RAM. The real unit has no reset button, so neither
// does this.
//
// The page (`src/viewer3d/`) builds its canvas and controls and hands the
// driver the renderer; the driver owns the board, the speaker and the loop. It
// lives here rather than in the page so that nothing about the machine's clock
// depends on how the machine is shown.

import { SpeakerDriver, type AudioContextLike } from '../machine/audio/driver.js';
import { Board, type MachineImage } from '../machine/board/board.js';
import { CYCLE_HZ } from '../machine/cpu/tms1370/timing.js';
import type { TubeRenderer } from '../machine/tube/renderer.js';
import type { MachineInput } from '../input/index.js';

/**
 * Longest frame the driver will simulate in one go.
 *
 * A backgrounded tab delivers one enormous frame when it returns. Simulating it
 * honestly would run the machine for minutes inside a single callback and hang
 * the page; the machine simply loses that time, as an unpowered device does.
 */
export const MAX_FRAME_MS = 100;

/** How the driver is built. */
export interface DriverOptions {
  /** The program ROM and output PLA the board runs. */
  readonly image: MachineImage;
  /** Paints the tube. The page built it around its own canvas. */
  readonly renderer: TubeRenderer;
  /** Machine cycles per second. Defaults to the core's `CYCLE_HZ`. */
  readonly cyclesPerSecond?: number;
  /**
   * Builds the Web Audio context on first use, or returns null where there is
   * none. Defaults to `window.AudioContext`. Injectable so a test can run the
   * driver without a browser.
   */
  readonly audioContext?: () => AudioContextLike | null;
  /**
   * Schedules the next frame. Defaults to `requestAnimationFrame`. Injectable
   * for the same reason; a test drives `frame` by hand.
   */
  readonly schedule?: (callback: (now: number) => void) => void;
}

/** The running machine, as a page sees it. */
export interface MachineDriver {
  readonly board: Board;
  readonly renderer: TubeRenderer;
  /**
   * Null until the first input builds it: a browser will not let an
   * AudioContext produce sound before a user gesture. Until then the board
   * still buffers its R15 edges; nothing is lost, it is merely unheard.
   */
  readonly speaker: SpeakerDriver | null;
  /** Apply one control movement to the machine. The ROM reads it on its next strobe. */
  apply(input: MachineInput): void;
  /** Whether the browser's output is silenced. The machine keeps toggling the pin regardless. */
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** Begin the frame loop. Idempotent. */
  start(): void;
  /**
   * Advance one frame at wall-clock `now` (ms). The loop calls this; a test or
   * a page with its own loop may call it directly instead of `start`.
   */
  frame(now: number): void;
}

/**
 * Build the driver. The board starts dark: a real unit on a shelf is switched
 * off, and the power switch is the only thing that starts it.
 */
export function createDriver(options: DriverOptions): MachineDriver {
  const { image, renderer } = options;
  const cyclesPerSecond = options.cyclesPerSecond ?? CYCLE_HZ;
  const audioContext = options.audioContext ?? defaultAudioContext;
  const schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));

  const board = new Board(image, { power: 'off' });

  let speaker: SpeakerDriver | null = null;
  let muted = false;

  const ensureSpeaker = (): SpeakerDriver | null => {
    if (speaker) return speaker;
    const context = audioContext();
    if (!context) return null;
    speaker = new SpeakerDriver({ context, source: board, cyclesPerSecond, muted });
    void speaker.start();
    return speaker;
  };

  /**
   * Throw the power switch.
   *
   * Power-on rewinds the cycle counter, so the speaker's timeline - which is
   * anchored on cycle stamps - has to be dropped with it, and the phosphor is
   * blanked rather than faded because the supply has gone.
   */
  const setPower = (on: boolean): void => {
    if (on) {
      board.powerOn();
    } else {
      board.powerOff();
    }
    renderer.blank();
    speaker?.reset();
  };

  const apply = (input: MachineInput): void => {
    // Every one of these arrives inside a pointer or key handler, which is the
    // user gesture the audio context has been waiting for.
    ensureSpeaker();
    switch (input.type) {
      case 'FIRE':
        board.setFire(input.pressed);
        break;
      case 'LANE':
        board.setLever(input.lane);
        break;
      case 'SKILL':
        board.setSkill(input.level);
        break;
      case 'POWER':
        setPower(input.on);
        break;
    }
  };

  // Cycles owed to the machine, carried across frames as a fraction. The board
  // executes whole instructions, so a frame overshoots its budget slightly and
  // the overshoot is repaid out of the next one rather than accumulating.
  let owed = 0;
  let lastFrame: number | null = null;

  const frame = (now: number): void => {
    const elapsedMs = lastFrame === null ? 0 : Math.min(now - lastFrame, MAX_FRAME_MS);
    lastFrame = now;

    if (board.power.state === 'on' && board.running) {
      owed += (elapsedMs / 1000) * cyclesPerSecond;
      const budget = Math.floor(owed);
      if (budget > 0) {
        const executed = board.step(budget);
        // A halted core executes nothing; banking the debt would make it sprint
        // when it came back.
        owed = executed === 0 ? 0 : owed - executed;
      }
    } else {
      owed = 0;
    }

    // Drain R15 before drawing, so a burst produced this frame is queued at the
    // cycle stamps it actually happened at.
    speaker?.pump();
    renderer.draw(board.getLitSegments(), elapsedMs);
  };

  let started = false;
  const loop = (now: number): void => {
    frame(now);
    schedule(loop);
  };

  return {
    board,
    renderer,
    get speaker() {
      return speaker;
    },
    apply,
    isMuted: () => muted,
    setMuted: (next) => {
      muted = next;
      ensureSpeaker()?.setMuted(next);
    },
    start: () => {
      if (started) return;
      started = true;
      schedule(loop);
    },
    frame,
  };
}

function defaultAudioContext(): AudioContextLike | null {
  const Ctor = globalThis.AudioContext;
  if (!Ctor) return null;
  // The driver declares the slice of Web Audio it uses so it can be tested
  // without a browser. `ScriptProcessorNode.onaudioprocess` is a property and
  // therefore invariant, so a real `AudioContext` does not structurally
  // satisfy that slice even though it does everything the slice asks for;
  // the cast asserts what the driver's own interface documents.
  return new Ctor() as unknown as AudioContextLike;
}
