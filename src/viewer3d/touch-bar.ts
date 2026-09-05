// A row of buttons for fingers.
//
// The modelled controls are a few millimetres across and a finger is not, and
// on a phone the same finger has to orbit the model. So on a coarse-pointer
// device the page also offers the four controls as buttons along the bottom:
// lane up and down, fire held while touched, power and skill. Each produces the
// same `MachineInput` as everything else; there is no other path into the
// machine.

import type { MachineInput } from '../input/index.js';
import type { ControlState } from './controls3d.js';

/** Whether the device's main pointer is a finger. */
export function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** Height reserved for the bar, so the panels sit above it. */
export const TOUCH_BAR_HEIGHT_PX = 64;

export interface TouchBarOptions {
  readonly apply: (input: MachineInput) => void;
  readonly state: () => ControlState;
}

export function buildTouchBar({ apply, state }: TouchBarOptions): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Touch controls');
  bar.className = 'jf-touch-bar';
  bar.style.height = `${TOUCH_BAR_HEIGHT_PX}px`;

  const button = (label: string, flex: number, aria: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.className = 'jf-btn';
    b.style.flex = String(flex);
    return b;
  };

  const up = button('▲', 1, 'Launcher up');
  const down = button('▼', 1, 'Launcher down');
  const fire = button('FIRE', 2, 'Fire missile (hold)');
  const power = button('PWR', 1, 'Power');
  const skill = button('SKILL', 1, 'Skill level');

  const tap = (b: HTMLButtonElement, handler: () => void): void => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handler();
    });
  };
  tap(up, () => apply({ type: 'LANE', lane: Math.max(0, state().lever - 1) as 0 | 1 | 2 }));
  tap(down, () => apply({ type: 'LANE', lane: Math.min(2, state().lever + 1) as 0 | 1 | 2 }));
  tap(power, () => apply({ type: 'POWER', on: !state().power }));
  tap(skill, () => apply({ type: 'SKILL', level: state().skill === 3 ? 1 : ((state().skill + 1) as 2 | 3) }));

  // Fire is a held contact: down on the button, up anywhere - a finger that
  // slides off still lets go.
  let firing = false;
  const release = (): void => {
    if (!firing) return;
    firing = false;
    fire.classList.remove('on');
    apply({ type: 'FIRE', pressed: false });
  };
  fire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    firing = true;
    fire.classList.add('on');
    apply({ type: 'FIRE', pressed: true });
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, release);
  }

  bar.append(up, down, fire, power, skill);
  return bar;
}
