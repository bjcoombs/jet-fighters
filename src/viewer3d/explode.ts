// Taking the unit apart.
//
// Every part carries an `explode` vector in its glTF extras: where it goes,
// relative to its assembled place, when the unit is opened. A part's position
// is its rest position plus that vector times a factor in 0..1, and a child
// rides on its parent, so the window's small move adds to the front shell's
// large one. Nothing else about a part changes: the assembled position is
// exactly the exported one, at factor 0.
//
// Presets give each part a target factor; the slider gives every part the same
// one. Targets are eased over a short time so a preset reads as the unit coming
// apart rather than jumping.

import { Vector3 } from 'three';

import type { Part } from './scene.js';

/** A named arrangement: which parts move, and how far along their vectors. */
export type Preset = 'assembled' | 'lid-off' | 'exploded';

export const PRESETS: readonly Preset[] = ['assembled', 'lid-off', 'exploded'];

/** Parts that move for `lid-off`: the front shell and what is mounted on it. */
const LID = new Set(['front_shell', 'window', 'scope_mask', 'sticker', 'fire_cap', 'power_thumb', 'lever_pin', 'skill_flag']);

/** The factor a preset gives a part. */
export function presetFactor(preset: Preset, partName: string): number {
  switch (preset) {
    case 'assembled':
      return 0;
    case 'lid-off':
      return LID.has(partName) ? 1 : 0;
    case 'exploded':
      return 1;
  }
}

/** Where a part sits at a factor: rest plus its local explode vector times factor. Pure. */
export function positionAt(rest: Vector3, explodeLocal: Vector3, factor: number): Vector3 {
  return rest.clone().addScaledVector(explodeLocal, factor);
}

/** Ease-out cubic, 0..1 -> 0..1. */
export function ease(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/** How long a preset or slider move takes to settle. */
export const EASE_MS = 650;

export interface Exploder {
  /** Every part to the same factor, over `EASE_MS`. */
  setAmount(factor: number): void;
  /** A named arrangement. */
  setPreset(preset: Preset): void;
  /** The factor the slider shows: the mean of the current targets. */
  readonly amount: number;
  /** Advance the easing and apply positions. Called every rendered frame. */
  update(nowMs: number): void;
}

interface Motion {
  readonly part: Part;
  from: number;
  to: number;
  current: number;
  startMs: number;
}

export function createExploder(parts: ReadonlyMap<string, Part>): Exploder {
  const motions: Motion[] = [];
  for (const part of parts.values()) {
    motions.push({ part, from: 0, to: 0, current: 0, startMs: -Infinity });
  }
  let lastNow = 0;

  const retarget = (targetFor: (name: string) => number): void => {
    for (const m of motions) {
      const to = targetFor(m.part.name);
      if (to === m.to) continue;
      m.from = m.current;
      m.to = to;
      m.startMs = lastNow;
    }
  };

  const update = (nowMs: number): void => {
    lastNow = nowMs;
    for (const m of motions) {
      const t = m.startMs === -Infinity ? 1 : (nowMs - m.startMs) / EASE_MS;
      const next = m.from + (m.to - m.from) * ease(t);
      if (next === m.current && t >= 1) continue;
      m.current = next;
      m.part.object.position.copy(positionAt(m.part.restPosition, m.part.explodeLocal, m.current));
    }
  };

  return {
    setAmount: (factor) => retarget(() => Math.min(1, Math.max(0, factor))),
    setPreset: (preset) => retarget((name) => presetFactor(preset, name)),
    get amount() {
      const moving = motions.filter((m) => m.part.explodeLocal.lengthSq() > 0);
      if (moving.length === 0) return 0;
      return moving.reduce((sum, m) => sum + m.to, 0) / moving.length;
    },
    update,
  };
}
