// Hiding parts: playing the machine bare, or looking past one thing at another.
//
// A hidden part is invisible along with everything mounted on it - hide the
// front shell and its window, print and controls go too - and it cannot be
// picked. The machine does not care: the contacts the modelled controls close
// are still closed by the keyboard, the touch bar, or the switch bodies on the
// board, which stay in view.

import type { Part } from './scene.js';

/** The parts that come off for `bare`: the case and what is on it, leaving the board. */
export const CASE_PARTS: readonly string[] = ['front_shell', 'back_shell', 'battery_door', 'scope_mask'];

export interface Visibility {
  hide(name: string): void;
  show(name: string): void;
  showAll(): void;
  /** The case off: both shells, the door and the mask hidden, everything else shown. */
  bare(): void;
  isHidden(name: string): boolean;
  /** Names of the hidden parts, in a stable order. */
  readonly hidden: readonly string[];
  /** Called after any change. */
  onChange(listener: () => void): void;
}

export function createVisibility(parts: ReadonlyMap<string, Part>): Visibility {
  const hidden = new Set<string>();
  const listeners: (() => void)[] = [];

  const apply = (): void => {
    for (const part of parts.values()) {
      part.object.visible = !hidden.has(part.name);
    }
    for (const l of listeners) l();
  };

  return {
    hide(name) {
      if (!parts.has(name) || hidden.has(name)) return;
      hidden.add(name);
      apply();
    },
    show(name) {
      if (!hidden.delete(name)) return;
      apply();
    },
    showAll() {
      if (hidden.size === 0) return;
      hidden.clear();
      apply();
    },
    bare() {
      hidden.clear();
      for (const name of CASE_PARTS) if (parts.has(name)) hidden.add(name);
      apply();
    },
    isHidden: (name) => hidden.has(name),
    get hidden() {
      return [...parts.keys()].filter((n) => hidden.has(n));
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
