// The frame driver: the browser end of the machine, and the only clock in the
// program.
//
// Everything below this file is a device. `Board` is the CPU, the tube, the
// speaker and the case contacts wired together, and it advances only when it is
// stepped; `createTubeRenderer` paints whatever PWM duty the tube reached;
// `SpeakerDriver` plays whatever the ROM did to pin D14. None of them owns a
// timer. This file supplies the one thing they lack - elapsed wall-clock time -
// and does nothing else:
//
//   1. read how long the last frame took;
//   2. run the board for that many machine cycles;
//   3. draw the tube's PWM state, with the same elapsed time for the phosphor;
//   4. hand the drained D14 edges to the speaker.
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

import { highestAddress, ramHighWater, rom, symbols } from '../asm/jetfighter.asm';
import { SpeakerDriver, type AudioContextLike } from './machine/audio/driver.js';
import { Board } from './machine/board/board.js';
import { createTubeRenderer, type TubeRenderer } from './machine/tube/renderer.js';
import {
  attachScreenTouch,
  createControlsAdapter,
  createHelpOverlay,
  createInputSystem,
  type MachineInput,
} from './input/index.js';
import { buildCase } from './ui/case.js';
import { setupControls } from './ui/controls.js';

/**
 * Longest frame the driver will simulate in one go.
 *
 * A backgrounded tab delivers one enormous frame when it returns. Simulating it
 * honestly would run the machine for minutes inside a single rAF callback and
 * hang the page; the machine simply loses that time, as an unpowered device
 * does.
 */
const MAX_FRAME_MS = 100;

/**
 * Ceiling on the effective device pixel ratio.
 *
 * The backing store costs memory as the square of this, and a pinched-in phone
 * can ask for a lot of it. Eight is past the point where any of the tube's
 * structure is still gaining detail.
 *
 * Declared up here with the rest of the module's constants because `start` runs
 * on the line below: a `const` further down the file is still in its temporal
 * dead zone by the time the first `resize` reaches for it.
 */
const MAX_PIXEL_RATIO = 8;

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  start(app);
}

function start(mount: HTMLElement): void {
  const { root, canvas } = buildCase(mount);
  const renderer = createTubeRenderer(canvas);
  attachCanvasSizing(canvas, renderer);

  // The machine, dark. A real unit on a shelf is switched off, and the power
  // switch is the only thing that starts it.
  const board = new Board(rom, { power: 'off' });
  const cyclesPerSecond = board.cpu.getCyclesPerSecond();

  // Audio is built on the first deliberate input, because a browser will not
  // let an AudioContext produce sound before a user gesture. Until then the
  // board still buffers its D14 edges; nothing is lost, it is merely unheard.
  let speaker: SpeakerDriver | null = null;
  let muted = false;

  const ensureSpeaker = (): SpeakerDriver | null => {
    if (speaker) return speaker;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    // The driver declares the slice of Web Audio it uses so it can be tested
    // without a browser. `ScriptProcessorNode.onaudioprocess` is a property and
    // therefore invariant, so a real `AudioContext` does not structurally
    // satisfy that slice even though it does everything the slice asks for;
    // the cast asserts what the driver's own interface documents.
    speaker = new SpeakerDriver({
      context: new Ctor() as unknown as AudioContextLike,
      source: board,
      cyclesPerSecond,
      muted,
    });
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

  /** Apply one control movement to the machine. The ROM reads it on its next strobe. */
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

  // Three paths to the same four contacts: the drawn case controls, the
  // keyboard, and a tap on the scope glass for touch devices.
  setupControls(root, createControlsAdapter(apply));
  createInputSystem(apply, { screenElement: canvas });
  attachScreenTouch(canvas, apply);

  root.appendChild(createHelpOverlay());
  root.appendChild(
    buildMuteToggle({
      isMuted: () => muted,
      setMuted: (next) => {
        muted = next;
        ensureSpeaker()?.setMuted(next);
      },
    }),
  );

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

    // Drain D14 before drawing, so a burst produced this frame is queued at the
    // cycle stamps it actually happened at.
    speaker?.pump();
    renderer.draw(board.getLitSegments(), elapsedMs);

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // A console handle on the machine: step it, read its RAM, name an address
    // from the assembler's symbol table. The debugging surface a contributor
    // editing the ROM needs, and dev-only so it is not part of the product.
    (globalThis as { jetFighters?: unknown }).jetFighters = {
      board,
      renderer,
      // Null until the first input builds it. `speaker.stats` is how a silent
      // machine is told apart from a silenced one: edges consumed says the ROM
      // is toggling the pin, realignments and underruns say what the transport
      // then did with them.
      get speaker() {
        return speaker;
      },
      rom: { words: rom.length, highestAddress, ramHighWater, symbols },
    };
  }
}

/**
 * The resolution the tube should be drawn at, in backing-store pixels per CSS
 * pixel.
 *
 * `devicePixelRatio` covers the display's own density and browser zoom - a zoom
 * step raises it, which is why zooming the page already hands the renderer more
 * real pixels. It does **not** cover pinch zoom: the visual viewport magnifies
 * pixels that have already been drawn, so on a phone a pinch makes the tube
 * bigger and blurrier and nothing tells the canvas about it. `visualViewport
 * .scale` is that missing factor, and folding it in is what makes magnifying the
 * display on a touch device resolve the tube's structure rather than its
 * pixels.
 */
function effectivePixelRatio(): number {
  const base = window.devicePixelRatio || 1;
  const pinch = window.visualViewport?.scale ?? 1;
  const combined = base * (Number.isFinite(pinch) && pinch > 0 ? pinch : 1);
  return Math.min(MAX_PIXEL_RATIO, combined);
}

/**
 * Keep the canvas backing store matched to its CSS box.
 *
 * Sized to the box x {@link effectivePixelRatio}, now and on every viewport
 * resize, devicePixelRatio change (dragging the window between monitors, browser
 * zoom) or pinch, so the tube stays crisp and uniformly scaled.
 */
function attachCanvasSizing(canvas: HTMLCanvasElement, renderer: TubeRenderer): void {
  let lastRatio = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  const applyCanvasSize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ratio = effectivePixelRatio();
    // Re-sizing a canvas clears it and rebuilds the mesh tile, and the visual
    // viewport fires continuously through a pinch. Only act on a real change.
    if (ratio === lastRatio && rect.width === lastWidth && rect.height === lastHeight) return;
    lastRatio = ratio;
    lastWidth = rect.width;
    lastHeight = rect.height;
    renderer.resize(rect.width, rect.height, ratio);
  };

  applyCanvasSize();
  window.addEventListener('resize', applyCanvasSize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applyCanvasSize).observe(canvas);
  }
  window.visualViewport?.addEventListener('resize', applyCanvasSize);
  watchDevicePixelRatio(applyCanvasSize);
}

/**
 * Invoke `onChange` whenever the devicePixelRatio changes. `matchMedia` fires
 * once per transition, so the listener re-arms itself against the new ratio -
 * this catches monitor-to-monitor drags and browser-zoom steps that the
 * `resize` event alone can miss.
 */
function watchDevicePixelRatio(onChange: () => void): void {
  if (typeof window.matchMedia !== 'function') return;
  const arm = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const media = window.matchMedia(`(resolution: ${dpr}dppx)`);
    media.addEventListener(
      'change',
      () => {
        onChange();
        arm();
      },
      { once: true },
    );
  };
  arm();
}

/** The mute control's state, as the toggle button sees it. */
interface MuteControl {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

/**
 * A small mute toggle mounted at the case's top-left, and the M key beside it.
 *
 * It silences the browser's output, not the machine: the ROM keeps toggling the
 * pin and the board keeps recording the edges, exactly as a real unit with its
 * piezo disconnected would.
 */
function buildMuteToggle(control: MuteControl): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jf-mute';
  btn.style.cssText =
    'position:absolute;top:8px;left:8px;z-index:10;width:28px;height:28px;' +
    'border-radius:50%;border:1px solid rgba(255,255,255,0.4);' +
    'background:rgba(0,0,0,0.55);color:#eee;font-size:15px;line-height:1;cursor:pointer;' +
    'font-family:system-ui,sans-serif;';

  const sync = (): void => {
    const muted = control.isMuted();
    btn.textContent = muted ? '\u{1F507}' : '\u{1F50A}'; // muted / speaker
    btn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    btn.setAttribute('aria-pressed', String(muted));
  };

  const toggle = (): void => {
    control.setMuted(!control.isMuted());
    sync();
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggle();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggle();
    }
  });

  sync();
  return btn;
}
