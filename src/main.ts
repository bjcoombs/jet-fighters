// Game loop integration and state machine (PRD R7).
//
// This is the thin DOM/timing shell that wires the four pure subsystems -
// game logic, renderer, audio, input - into a playable unit. It owns only:
//   - a single GameState, mutated through `commit` (which diffs audio events);
//   - the fixed-timestep rAF loop (accumulator math lives in ./integration/loop);
//   - the DOM elements (case, canvas, help hint, mute toggle) and their listeners.
// Every rule, sound recipe, sprite, and input mapping lives in its module; nothing
// game-specific is reinvented here.

import { createAudioSystem, type AudioSystem } from './audio/index.js';
import {
  applyInput,
  createOffState,
  tick,
  type GameInput,
  type GameState,
} from './game/index.js';
import {
  attachScreenTouch,
  createControlsAdapter,
  createHelpOverlay,
  createInputSystem,
} from './input/index.js';
import { createRenderer } from './render/index.js';
import { buildCase } from './ui/case.js';
import { setupControls } from './ui/controls.js';
import { diffAudioEvents, playAudioEvents } from './integration/audio-events.js';
import { drainAccumulator } from './integration/loop.js';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void start(app);
}

async function start(mount: HTMLElement): Promise<void> {
  const { root, canvas } = buildCase(mount);
  const render = createRenderer({ canvas, width: canvas.width, height: canvas.height });
  const audio = await createAudioSystem();

  // The single source of truth. Start powered off: the screen shows only the
  // printed silkscreen until the power switch (or P) turns it on.
  let state: GameState = createOffState(1);

  /**
   * The only path that changes state. Diffs the transition for audio events and
   * plays them, so every sound (fire, kill, march, buzz, launcher hit, win,
   * game over) is driven purely by the before/after GameState.
   */
  const commit = (next: GameState): void => {
    const events = diffAudioEvents(state, next);
    state = next;
    if (events.length > 0) {
      playAudioEvents(audio, events);
      if (import.meta.env.DEV) {
        // Console assertion surface for end-to-end verification.
        console.debug(
          `[jf-audio] ${events.map((e) => e.type).join(',')} ` +
            `(phase=${next.phase} score=${next.score} lives=${next.launcher.lives})`,
        );
      }
    }
  };

  const dispatch = (input: GameInput): void => {
    commit(applyInput(state, input));
  };

  // Input: on-case controls, keyboard (+ spring-lever hold), and screen touch.
  setupControls(root, createControlsAdapter(dispatch));
  createInputSystem(dispatch, { screenElement: canvas });
  // The on-case controls own their own pointer handling; also let a tap directly
  // on the scope glass move/fire on touch devices.
  attachScreenTouch(canvas, dispatch);

  // Help hint (keyboard reference) and the audio mute toggle, mounted on the case.
  root.appendChild(createHelpOverlay());
  root.appendChild(buildMuteToggle(audio));

  // Fixed-timestep loop: rAF drives rendering; the accumulator drives logic ticks
  // at a fixed rate so gameplay speed is frame-rate independent.
  let accumulator = 0;
  let lastFrame: number | null = null;

  const frame = (now: number): void => {
    const frameMs = lastFrame === null ? 0 : now - lastFrame;
    lastFrame = now;

    if (state.phase === 'PLAYING') {
      const drained = drainAccumulator(accumulator, frameMs);
      accumulator = drained.accumulator;
      for (let i = 0; i < drained.ticks; i += 1) {
        commit(tick(state));
        if (state.phase !== 'PLAYING') break; // reached WIN / GAME_OVER
      }
    } else {
      // Nothing simulates while OFF / WIN / GAME_OVER; don't bank catch-up time.
      accumulator = 0;
    }

    render(state);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

/**
 * A small mute toggle button mounted at the case's top-left, mirroring the audio
 * system's state. The M key toggles the same control.
 */
function buildMuteToggle(audio: AudioSystem): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jf-mute';
  btn.style.cssText =
    'position:absolute;top:8px;left:8px;z-index:10;width:28px;height:28px;' +
    'border-radius:50%;border:1px solid rgba(255,255,255,0.4);' +
    'background:rgba(0,0,0,0.55);color:#eee;font-size:15px;line-height:1;cursor:pointer;' +
    'font-family:system-ui,sans-serif;';

  const sync = (): void => {
    const muted = audio.isMuted();
    btn.textContent = muted ? '\u{1F507}' : '\u{1F50A}'; // muted / speaker
    btn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    btn.setAttribute('aria-pressed', String(muted));
  };

  const toggle = (): void => {
    audio.setMuted(!audio.isMuted());
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
