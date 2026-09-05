/**
 * Input layer: every way a hand reaches the machine, expressed as a movement of
 * a case control.
 *
 * There are only four controls on the real unit - the fire button, the
 * three-position lane lever, the skill dial and the power switch - and this
 * module translates the keyboard and screen taps into movements of exactly
 * those. It emits no game concepts, because there are none outside the ROM: a
 * {@link MachineInput} is "a contact moved", and what the game makes of it is
 * the ROM's business, discovered on its next strobe of the input matrix.
 *
 * Fire is a *held* contact rather than an edge, so every path that presses it
 * also releases it. The ROM samples the matrix on its own sweep; a press that
 * was never released would read as a jammed button.
 *
 * The pure mapping helpers (key classification, spring-lever lane resolution,
 * touch-thirds math) are exported and unit-tested without a DOM. The DOM
 * listener wiring is intentionally thin.
 */

import type { ControlsConfig, Lane, SkillLevel } from '../ui/controls.js';

/**
 * A movement of one case control.
 *
 * `FIRE` carries the contact's new state rather than an event: the button is
 * down, or it is up.
 */
export type MachineInput =
  | { readonly type: 'FIRE'; readonly pressed: boolean }
  | { readonly type: 'LANE'; readonly lane: Lane }
  | { readonly type: 'SKILL'; readonly level: SkillLevel }
  | { readonly type: 'POWER'; readonly on: boolean };

/** Consumer of control movements (the frame driver in main.ts). */
export type InputCallback = (input: MachineInput) => void;

/** Handle returned by {@link createInputSystem}; tears down all listeners. */
export interface InputSystem {
  destroy(): void;
}

// --- Pure mapping logic (no DOM; unit-tested) ------------------------------

/**
 * A held lane direction. The keyboard stands in for a lever the player holds,
 * so "no direction held" resolves to the centre lane.
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
 * - P -> power switch
 * - 1 / 2 / 3 -> skill dial
 *
 * `M` is deliberately unbound here: it toggles mute in main.ts, which is a
 * property of the browser's speaker rather than of the machine.
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
 * directions.
 *
 * An empty stack means nothing is held, so the lane returns to centre (1). When
 * several direction keys are held at once the most-recently pressed one wins -
 * it sits on top of the stack.
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

/** Translate a boolean power-switch position into its control movement. */
export function powerInput(on: boolean): MachineInput {
  return { type: 'POWER', on };
}

// --- Runtime wiring --------------------------------------------------------

export interface InputOptions {
  /** Target for keyboard listeners. Defaults to the global `window`. */
  readonly keyboardTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Screen/canvas element to wire tap-to-move + double-tap-to-fire touch. */
  readonly screenElement?: HTMLElement;
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
 * Create the input system: attaches keyboard handling (lane hold, fire
 * press/release, power switch, skill dial) and, when a `screenElement` is
 * supplied, mobile touch controls. Returns a handle whose `destroy()` removes
 * every listener it added.
 */
export function createInputSystem(
  callback: InputCallback,
  options: InputOptions = {},
): InputSystem {
  const target = options.keyboardTarget ?? window;

  let held: LaneDirection[] = [];
  let currentLane: Lane = 1;
  let powerOn = false;
  let firing = false;

  const emitLane = (): void => {
    const lane = resolveLane(held);
    if (lane !== currentLane) {
      currentLane = lane;
      callback({ type: 'LANE', lane });
    }
  };

  const setFiring = (pressed: boolean): void => {
    // Key-repeat re-fires keydown, and a keyup can arrive with nothing held.
    if (pressed === firing) return;
    firing = pressed;
    callback({ type: 'FIRE', pressed });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    const action = classifyKey(event.key);
    if (!action) return;
    event.preventDefault();

    switch (action.type) {
      case 'lane':
        // pushDirection dedupes, so the stack and the resolved lane are stable
        // while a key is held down.
        held = pushDirection(held, action.dir);
        emitLane();
        break;
      case 'fire':
        setFiring(true);
        break;
      case 'power':
        if (event.repeat) return;
        powerOn = !powerOn;
        callback(powerInput(powerOn));
        break;
      case 'skill':
        if (event.repeat) return;
        callback({ type: 'SKILL', level: action.level });
        break;
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const action = classifyKey(event.key);
    if (!action) return;
    if (action.type === 'lane') {
      held = removeDirection(held, action.dir);
      emitLane();
    } else if (action.type === 'fire') {
      setFiring(false);
    }
  };

  // A window that loses focus never delivers the keyup, so without this the
  // contact would stay closed while the player is looking elsewhere.
  const onBlur = (): void => {
    held = [];
    emitLane();
    setFiring(false);
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);
  target.addEventListener('blur', onBlur);

  const detachTouch = options.screenElement
    ? attachScreenTouch(options.screenElement, callback, {
        doubleTapMs: options.doubleTapMs,
      })
    : null;

  return {
    destroy(): void {
      target.removeEventListener('keydown', onKeyDown as EventListener);
      target.removeEventListener('keyup', onKeyUp as EventListener);
      target.removeEventListener('blur', onBlur);
      detachTouch?.();
    },
  };
}

/**
 * Adapter bridging the on-case controls to the same callback, so a pointer on
 * the drawn fire button and the space bar reach the machine by one path.
 */
export function createControlsAdapter(callback: InputCallback): ControlsConfig {
  return {
    onFire: (pressed) => callback({ type: 'FIRE', pressed }),
    onLaneChange: (lane) => callback({ type: 'LANE', lane }),
    onSkillChange: (level) => callback({ type: 'SKILL', level }),
    onPowerToggle: (on) => callback(powerInput(on)),
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
 * - A double-tap (two taps within `doubleTapMs`) presses fire; lifting the
 *   finger releases it.
 *
 * Uses `event.timeStamp` for double-tap timing, so no clock leaks in. Returns a
 * detach function that removes the listeners.
 */
export function attachScreenTouch(
  element: HTMLElement,
  callback: InputCallback,
  options: ScreenTouchOptions = {},
): () => void {
  const doubleTapMs = options.doubleTapMs ?? 300;
  let lastTapAt = Number.NEGATIVE_INFINITY;
  let firing = false;

  const release = (): void => {
    if (!firing) return;
    firing = false;
    callback({ type: 'FIRE', pressed: false });
  };

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const lane = laneFromThirds(event.clientY - rect.top, rect.height);
    callback({ type: 'LANE', lane });

    if (event.timeStamp - lastTapAt <= doubleTapMs) {
      firing = true;
      callback({ type: 'FIRE', pressed: true });
      lastTapAt = Number.NEGATIVE_INFINITY; // consume, so a third tap restarts
    } else {
      lastTapAt = event.timeStamp;
    }
  };

  element.addEventListener('pointerdown', onPointerDown as EventListener);
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  return () => {
    element.removeEventListener('pointerdown', onPointerDown as EventListener);
    element.removeEventListener('pointerup', release);
    element.removeEventListener('pointercancel', release);
  };
}

/** Keyboard control reference, shared by the help overlay. */
const HELP_ROWS: ReadonlyArray<readonly [keys: string, action: string]> = [
  ['↑ / W', 'Lane lever up (hold)'],
  ['↓ / S', 'Lane lever down (hold)'],
  ['Space / Enter', 'Fire button (hold)'],
  ['P', 'Power switch'],
  ['1 / 2 / 3', 'Skill dial'],
  ['M', 'Mute'],
];

/**
 * Build a small, dismissable help overlay: a floating "?" toggle that reveals a
 * panel listing the keyboard controls. Returns the root element for main.ts to
 * mount (typically over a corner of the case); nothing is auto-attached to the
 * document. Styling is inline so it stays self-contained and does not disturb
 * the case aesthetic.
 */
export interface HelpOptions {
  /** Rows a page adds under the machine's: the 3D page's view and dock keys. */
  readonly extraRows?: ReadonlyArray<readonly [keys: string, action: string]>;
  /** The link at the foot: the flat page points at the 3D one, and the 3D page back. */
  readonly link?: { readonly href: string; readonly text: string };
}

export function createHelpOverlay(doc: Document = document, options: HelpOptions = {}): HTMLElement {
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

  for (const [keys, action] of [...HELP_ROWS, ...(options.extraRows ?? [])]) {
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

  // The same unit in three dimensions, on its own page. A relative link, so it
  // resolves under the deployed base path as well as the dev server's.
  const link = doc.createElement('a');
  link.href = options.link?.href ?? '3d.html';
  link.textContent = options.link?.text ?? 'See the unit in 3D';
  link.style.cssText = 'display:block;margin-top:8px;color:#8fc7ff;';
  panel.appendChild(link);

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
