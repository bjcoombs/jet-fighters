/**
 * Input intent layer for Jet Fighters (PRD R5).
 *
 * This module is the single source of truth that translates every input path -
 * physical keyboard, the on-case controls, and mobile screen taps - into the
 * {@link GameInput} intents the pure game reducer consumes. The game core stays
 * deterministic; the ONLY place randomness enters is the seed attached to a
 * `POWER_ON` intent (see {@link InputOptions.makeSeed}).
 *
 * The pure mapping helpers (key classification, spring-lever lane resolution,
 * touch-thirds math) are exported and unit-tested without a DOM. The DOM
 * listener wiring is intentionally thin.
 */

import type { GameInput, Lane, SkillLevel } from '../game/types.js';
import type { ControlsConfig } from '../ui/controls.js';

/** Consumer of translated game intents (typically the game reducer dispatch). */
export type InputCallback = (input: GameInput) => void;

/** Handle returned by {@link createInputSystem}; tears down all listeners. */
export interface InputSystem {
  destroy(): void;
}

// --- Pure mapping logic (no DOM; unit-tested) ------------------------------

/**
 * A held lane direction. The physical lever is spring-loaded and snaps back to
 * centre when released, so "no direction held" always resolves to the centre
 * lane.
 */
export type LaneDirection = 'up' | 'down';

/** The semantic meaning of a key, or `null` when the key is not bound. */
export type KeyAction =
  | { readonly type: 'lane'; readonly dir: LaneDirection }
  | { readonly type: 'fire' }
  | { readonly type: 'power' }
  | { readonly type: 'skill'; readonly level: SkillLevel }
  | null;

/**
 * Classify a `KeyboardEvent.key` value into a semantic action.
 *
 * - ArrowUp / W -> lane up (top)
 * - ArrowDown / S -> lane down (bottom)
 * - Space / Enter -> fire
 * - P -> power toggle
 * - 1 / 2 / 3 -> skill level
 *
 * `M` is deliberately unbound - it is reserved for mute (task 8).
 */
export function classifyKey(key: string): KeyAction {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return { type: 'lane', dir: 'up' };
    case 'ArrowDown':
    case 's':
    case 'S':
      return { type: 'lane', dir: 'down' };
    case ' ':
    case 'Spacebar': // legacy key name for the space bar
    case 'Enter':
      return { type: 'fire' };
    case 'p':
    case 'P':
      return { type: 'power' };
    case '1':
      return { type: 'skill', level: 1 };
    case '2':
      return { type: 'skill', level: 2 };
    case '3':
      return { type: 'skill', level: 3 };
    default:
      return null;
  }
}

/**
 * Resolve the launcher lane from the ordered stack of currently-held lane
 * directions (spring-lever semantics).
 *
 * An empty stack means nothing is held, so the lever springs back to the centre
 * lane (1). When several direction keys are held at once the most-recently
 * pressed one wins - it sits on top of the stack.
 */
export function resolveLane(held: readonly LaneDirection[]): Lane {
  if (held.length === 0) return 1;
  return held[held.length - 1] === 'up' ? 0 : 2;
}

/**
 * Push a direction onto the held-stack, moving it to the top if it was already
 * present (so key-repeat noise is idempotent and "latest wins" holds).
 */
export function pushDirection(
  held: readonly LaneDirection[],
  dir: LaneDirection,
): LaneDirection[] {
  return [...held.filter((d) => d !== dir), dir];
}

/** Remove a released direction from the held-stack. */
export function removeDirection(
  held: readonly LaneDirection[],
  dir: LaneDirection,
): LaneDirection[] {
  return held.filter((d) => d !== dir);
}

/**
 * Map a vertical tap to a lane by screen thirds: the top third is lane 0, the
 * middle third lane 1, the bottom third lane 2. `offsetY` is the tap's distance
 * from the top of the element; `height` is the element's height.
 */
export function laneFromThirds(offsetY: number, height: number): Lane {
  if (height <= 0) return 1;
  const fraction = offsetY / height;
  if (fraction < 1 / 3) return 0;
  if (fraction < 2 / 3) return 1;
  return 2;
}

/**
 * Translate a boolean power state into the matching `GameInput`. Powering on
 * carries a fresh seed - the single entry point for randomness into the
 * otherwise-deterministic game core.
 */
export function powerInput(on: boolean, makeSeed: () => number): GameInput {
  return on ? { type: 'POWER_ON', seed: makeSeed() } : { type: 'POWER_OFF' };
}

// --- Runtime wiring --------------------------------------------------------

/** Default seed source. Randomness is confined to this one call. */
function defaultSeed(): number {
  return Date.now();
}

export interface InputOptions {
  /** Target for keyboard listeners. Defaults to the global `window`. */
  readonly keyboardTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Screen/canvas element to wire tap-to-move + double-tap-to-fire touch. */
  readonly screenElement?: HTMLElement;
  /** Seed source for `POWER_ON`. Injectable for tests; defaults to `Date.now()`. */
  readonly makeSeed?: () => number;
  /** Max gap (ms) between taps to count as a double-tap fire. Defaults to 300. */
  readonly doubleTapMs?: number;
}

/** Elements whose own keyboard behaviour should not be hijacked by the game. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Create the input system: attaches keyboard handling (spring-lever lane hold,
 * fire, power toggle, skill select) and, when a `screenElement` is supplied,
 * mobile touch controls. Returns a handle whose `destroy()` removes every
 * listener it added.
 */
export function createInputSystem(
  callback: InputCallback,
  options: InputOptions = {},
): InputSystem {
  const target = options.keyboardTarget ?? window;
  const makeSeed = options.makeSeed ?? defaultSeed;

  let held: LaneDirection[] = [];
  let currentLane: Lane = 1;
  let powerOn = false;

  const emitLane = (): void => {
    const lane = resolveLane(held);
    if (lane !== currentLane) {
      currentLane = lane;
      callback({ type: 'MOVE_LANE', lane });
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    const action = classifyKey(event.key);
    if (!action) return;
    event.preventDefault();

    switch (action.type) {
      case 'lane':
        // Key-repeat re-fires keydown; pushDirection dedupes so the stack and
        // the resolved lane are stable while a key is held.
        held = pushDirection(held, action.dir);
        emitLane();
        break;
      case 'fire':
        if (event.repeat) return; // fire is edge-triggered, no auto-repeat
        callback({ type: 'FIRE' });
        break;
      case 'power':
        if (event.repeat) return;
        powerOn = !powerOn;
        callback(powerInput(powerOn, makeSeed));
        break;
      case 'skill':
        if (event.repeat) return;
        callback({ type: 'SET_SKILL', level: action.level });
        break;
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const action = classifyKey(event.key);
    if (!action || action.type !== 'lane') return;
    held = removeDirection(held, action.dir);
    emitLane();
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);

  const detachTouch = options.screenElement
    ? attachScreenTouch(options.screenElement, callback, {
        doubleTapMs: options.doubleTapMs,
      })
    : null;

  return {
    destroy(): void {
      target.removeEventListener('keydown', onKeyDown as EventListener);
      target.removeEventListener('keyup', onKeyUp as EventListener);
      detachTouch?.();
    },
  };
}

/**
 * Adapter bridging the on-case controls to the same intent callback. Task 8
 * wires the DOM with `setupControls(container, createControlsAdapter(callback))`.
 * The physical power switch is authoritative about on/off, so its boolean is
 * translated directly (with a fresh seed on power-on).
 */
export function createControlsAdapter(
  callback: InputCallback,
  options: Pick<InputOptions, 'makeSeed'> = {},
): ControlsConfig {
  const makeSeed = options.makeSeed ?? defaultSeed;
  return {
    onFire: () => callback({ type: 'FIRE' }),
    onLaneChange: (lane) => callback({ type: 'MOVE_LANE', lane }),
    onSkillChange: (level) => callback({ type: 'SET_SKILL', level }),
    onPowerToggle: (on) => callback(powerInput(on, makeSeed)),
  };
}

/** Options for {@link attachScreenTouch}. */
export interface ScreenTouchOptions {
  /** Max gap (ms) between taps to count as a double-tap fire. Defaults to 300. */
  readonly doubleTapMs?: number;
}

/**
 * Wire mobile screen-area touch on `element` (canvas / screen window):
 *
 * - A single tap sets the launcher lane by vertical third: top -> lane 0,
 *   middle -> lane 1, bottom -> lane 2.
 * - A double-tap (two taps within `doubleTapMs`) fires.
 *
 * Uses `event.timeStamp` for double-tap timing, so no clock/randomness leaks
 * in. Returns a detach function that removes the listener.
 */
export function attachScreenTouch(
  element: HTMLElement,
  callback: InputCallback,
  options: ScreenTouchOptions = {},
): () => void {
  const doubleTapMs = options.doubleTapMs ?? 300;
  let lastTapAt = Number.NEGATIVE_INFINITY;

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const lane = laneFromThirds(event.clientY - rect.top, rect.height);
    callback({ type: 'MOVE_LANE', lane });

    if (event.timeStamp - lastTapAt <= doubleTapMs) {
      callback({ type: 'FIRE' });
      lastTapAt = Number.NEGATIVE_INFINITY; // consume, so a third tap restarts
    } else {
      lastTapAt = event.timeStamp;
    }
  };

  element.addEventListener('pointerdown', onPointerDown as EventListener);
  return () => element.removeEventListener('pointerdown', onPointerDown as EventListener);
}

/** Keyboard control reference, shared by the help overlay. */
const HELP_ROWS: ReadonlyArray<readonly [keys: string, action: string]> = [
  ['↑ / W', 'Move up (hold)'],
  ['↓ / S', 'Move down (hold)'],
  ['Space / Enter', 'Fire missile'],
  ['P', 'Power on / off'],
  ['1 / 2 / 3', 'Skill level'],
];

/**
 * Build a small, dismissable help overlay: a floating "?" toggle that reveals a
 * panel listing the keyboard controls. Returns the root element for task 8 to
 * mount (typically over a corner of the case); nothing is auto-attached to the
 * document. Styling is inline so it stays self-contained and does not disturb
 * the case aesthetic.
 */
export function createHelpOverlay(doc: Document = document): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'jf-help';
  root.style.cssText =
    'position:absolute;top:8px;right:8px;z-index:10;font-family:system-ui,sans-serif;';

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '?';
  toggle.setAttribute('aria-label', 'Keyboard controls');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.style.cssText =
    'width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,0.4);' +
    'background:rgba(0,0,0,0.55);color:#eee;font-size:15px;line-height:1;cursor:pointer;';

  const panel = doc.createElement('div');
  panel.hidden = true;
  panel.style.cssText =
    'position:absolute;top:34px;right:0;min-width:200px;padding:10px 12px;border-radius:8px;' +
    'background:rgba(0,0,0,0.85);color:#eee;font-size:12px;line-height:1.6;' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.5);';

  const title = doc.createElement('div');
  title.textContent = 'Controls';
  title.style.cssText = 'font-weight:600;margin-bottom:6px;';
  panel.appendChild(title);

  for (const [keys, action] of HELP_ROWS) {
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;';
    const k = doc.createElement('span');
    k.textContent = keys;
    k.style.cssText = 'opacity:0.85;';
    const a = doc.createElement('span');
    a.textContent = action;
    row.append(k, a);
    panel.appendChild(row);
  }

  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!open));

  root.append(toggle, panel);
  return root;
}
