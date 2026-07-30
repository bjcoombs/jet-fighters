// Drive the real machine into the real tube renderer, headlessly.
//
// Paths in this file are relative to the repository root.
//
// ## Why this exists
//
// `tools/probe/tms1370-probe.ts` reaches the pins, and that is enough for every
// question about what the ROM does. It is not enough for a question about what
// a player *sees*: between the pins and the glass sit the PWM accumulator, the
// phosphor's rise and decay, and the renderer's layers. Two defect reports -
// the battleship's departure lighting every row, and the screen flashing after
// an ending - live in exactly that gap, and nothing in the tree could drive it.
//
// This closes that gap in about twenty lines of setup. It is deliberately thin:
// it owns no assertions and no policy, only the wiring, so a caller can ask
// "how bright was `battleship_lane1` on the frame the boat left?" and get a
// number off the same code path the browser runs.
//
// ## The one thing it is strict about
//
// **It draws what `src/main.ts` draws.** The application calls
// `board.getLitSegments()`, which is `Display.getObservedFrame` - the accessor
// that reports the tube *dark* while the ROM has stopped strobing to bit-bang
// the speaker. `Display.getFrame()` is the other one, and it reports the last
// completed sweep for as long as the stall lasts. Both are public, both are
// reasonable, and picking the wrong one models a machine the player never sees:
// during a 637 ms loss sequence one says lit and the other says dark.
//
// A drive that picks its own accessor is a drive that can silently disagree
// with the application. `frame()` does not offer the choice - see
// `docs/evidence/playability-audit.md` section 8 for the afternoon that
// established why.

import { CYCLE_HZ } from '../../../src/machine/cpu/tms1370/timing.js';
import { createFakeContext } from '../../../src/machine/tube/fake-canvas.js';
import { createTubeRenderer, type TubeRenderer } from '../../../src/machine/tube/renderer.js';
import type { SegmentId } from '../../../src/machine/tube/atlas-schema.js';
import { Tms1370Machine, type Contacts } from '../tms1370-probe.js';

/** A 60 Hz animation frame, in milliseconds - what a browser hands `main.ts`. */
export const ANIMATION_FRAME_MS = 1000 / 60;

export interface RenderDriveOptions {
  /** Skill dial, 1-3. Applied at power-on like any other contact. */
  readonly skill?: number;
  /** Milliseconds of wall time per drawn frame. */
  readonly frameMs?: number;
  /** CSS pixel size of the canvas the renderer is fitted to. */
  readonly cssWidth?: number;
  readonly cssHeight?: number;
}

export interface RenderDrive {
  /** The machine being driven. Contacts and RAM are read through this. */
  readonly machine: Tms1370Machine;
  /** The renderer, for `brightnessOf`. */
  readonly renderer: TubeRenderer;
  /**
   * Advance one animation frame: step the machine by `frameMs` of emulated
   * time, then draw what the application would draw.
   */
  frame(): void;
  /** Phosphor brightness of a segment, 0..1, as of the last `frame()`. */
  brightnessOf(id: SegmentId): number;
  /** Close one or more case contacts, leaving the rest as they are. */
  setContacts(change: Contacts): void;
  /** Emulated seconds since power-on. */
  readonly seconds: number;
  /** Animation frames drawn so far. */
  readonly frames: number;
}

/**
 * Wire a machine to a renderer and hand back the pair.
 *
 * The context does not record its calls: a drive wants phosphor state, and a
 * retained call log is what exhausted the heap the first time this was
 * attempted (see `fake-canvas.ts`).
 */
export function createRenderDrive(options: RenderDriveOptions = {}): RenderDrive {
  const frameMs = options.frameMs ?? ANIMATION_FRAME_MS;
  const cyclesPerFrame = Math.round((CYCLE_HZ * frameMs) / 1000);

  const { ctx } = createFakeContext({ recordCalls: false });
  const renderer = createTubeRenderer(ctx);
  renderer.resize(options.cssWidth ?? 726, options.cssHeight ?? 600);

  const machine = new Tms1370Machine();
  machine.setContacts({ skill: options.skill ?? 1, lane: 0, fire: false });

  let frames = 0;
  const drive: RenderDrive = {
    machine,
    renderer,
    frame(): void {
      machine.step(cyclesPerFrame);
      // getLitSegments, not getFrame - see the header.
      renderer.draw(machine.getLitSegments(), frameMs);
      frames += 1;
    },
    brightnessOf: (id) => renderer.brightnessOf(id),
    setContacts: (change) => machine.setContacts(change),
    get seconds() {
      return machine.cycles / CYCLE_HZ;
    },
    get frames() {
      return frames;
    },
  };
  return drive;
}
