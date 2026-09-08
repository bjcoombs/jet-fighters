// Taking the unit apart.
//
// Every part carries an `explode` vector in its glTF extras: where it goes,
// relative to its assembled place, when the unit is opened. A part's position
// is its rest position plus that vector times a factor in 0..1, and a child
// rides on its parent, so the window's small move adds to the front shell's
// large one. Nothing else about a part changes: the assembled position is
// exactly the exported one, at factor 0.
//
// One slider is the state, in four bands. Its first half lifts the lid - the
// front shell and what is mounted on it; the next spreads the body - the board,
// its parts and the back shell; then the battery door comes off; then the cells
// come out. So the three detents are the three arrangements - 0 assembled, 1/2
// lid off, 1 exploded - and between them the unit comes apart in the order a
// hand would take it. A preset is a detent. Targets are eased over a short time
// so a preset reads as the unit coming apart rather than jumping.

import { Vector3 } from 'three';

import type { Part } from './scene.js';

/** A named arrangement: which parts move, and how far along their vectors. */
export type Preset = 'assembled' | 'lid-off' | 'exploded';

export const PRESETS: readonly Preset[] = ['assembled', 'lid-off', 'exploded'];

/** Parts that move for `lid-off`: the front shell and what is mounted on it. */
const LID = new Set(['front_shell', 'window', 'scope_mask', 'sticker', 'fire_cap', 'power_thumb', 'lever_pin', 'skill_flag']);

/** The slider's bands: which part moves over which stretch of its travel. */
export type Band = 'lid' | 'body' | 'door' | 'cell';

export const BAND_RANGE: Readonly<Record<Band, readonly [number, number]>> = {
  lid: [0, 0.5],
  body: [0.5, 0.8],
  door: [0.8, 0.9],
  cell: [0.9, 1],
};

/** The band a part moves in. Cells are `battery_1` to `battery_4`. */
export function bandOf(partName: string): Band {
  if (LID.has(partName)) return 'lid';
  if (partName === 'battery_door') return 'door';
  if (/^battery_\d+$/.test(partName)) return 'cell';
  return 'body';
}

/** Which cell a part is, 0-based, or -1 if it is not one. */
export function cellIndex(partName: string): number {
  const m = /^battery_(\d+)$/.exec(partName);
  return m ? Number(m[1]) - 1 : -1;
}

/** The slider value each preset sits at. */
export const PRESET_AMOUNT: Readonly<Record<Preset, number>> = { assembled: 0, 'lid-off': 0.5, exploded: 1 };

/** The factor a preset gives a part. */
export function presetFactor(preset: Preset, partName: string): number {
  return sliderFactor(PRESET_AMOUNT[preset], partName);
}

/** The factor a slider value gives a part: 0 below its band, 1 above, linear across. Pure. */
export function sliderFactor(amount: number, partName: string): number {
  const a = Math.min(1, Math.max(0, amount));
  const [lo, hi] = BAND_RANGE[bandOf(partName)];
  return Math.min(1, Math.max(0, (a - lo) / (hi - lo)));
}

/** The preset a slider value is sitting on, if it is on one. */
export function presetAt(amount: number): Preset | null {
  for (const preset of PRESETS) {
    if (Math.abs(amount - PRESET_AMOUNT[preset]) < 1e-6) return preset;
  }
  return null;
}

/** The preset after `amount`, round the three: the E key's cycle. */
export function nextPreset(amount: number): Preset {
  const at = presetAt(amount);
  if (at === null) {
    // Between detents: on to the next one up, or round to the start from the top.
    const up = PRESETS.find((p) => PRESET_AMOUNT[p] > amount);
    return up ?? 'assembled';
  }
  return PRESETS[(PRESETS.indexOf(at) + 1) % PRESETS.length];
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
  /**
   * A further local offset for a part, on top of its explode position: the
   * modelled controls move this way. Applied every frame until cleared.
   */
  setOffset(name: string, offset: Vector3 | null): void;
  /** The slider to `amount`, 0..1, every part to its factor for it, over `EASE_MS`. */
  setAmount(amount: number): void;
  /** The slider to `amount` at once, no easing: the opening sequence drives it frame by frame. */
  jump(amount: number): void;
  /**
   * Every part to its own factor at once, from `factorFor`, off the slider:
   * the opening moves the cells and the door after the lid has seated, which is
   * not an order the slider has. The slider reads as the mean afterwards.
   */
  jumpParts(factorFor: (partName: string) => number): void;
  /** A named arrangement: the slider to its detent. */
  setPreset(preset: Preset): void;
  /** The slider's value. */
  readonly amount: number;
  /** Called after the amount changes. */
  onChange(listener: () => void): void;
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
  let amount = 0;
  const offsets = new Map<string, Vector3>();
  const listeners: (() => void)[] = [];

  const setAmount = (next: number): void => {
    const clamped = Math.min(1, Math.max(0, next));
    if (clamped === amount) return;
    amount = clamped;
    for (const m of motions) {
      const to = sliderFactor(amount, m.part.name);
      if (to === m.to) continue;
      m.from = m.current;
      m.to = to;
      m.startMs = lastNow;
    }
    for (const l of listeners) l();
  };

  const jump = (next: number): void => {
    const clamped = Math.min(1, Math.max(0, next));
    const changed = clamped !== amount;
    amount = clamped;
    for (const m of motions) {
      m.from = m.current;
      m.to = sliderFactor(amount, m.part.name);
      m.startMs = -Infinity;
    }
    if (changed) for (const l of listeners) l();
  };

  const jumpParts = (factorFor: (partName: string) => number): void => {
    let sum = 0;
    let n = 0;
    for (const m of motions) {
      m.from = m.current;
      m.to = Math.min(1, Math.max(0, factorFor(m.part.name)));
      m.startMs = -Infinity;
      if (m.part.explodeLocal.lengthSq() > 0) {
        sum += m.to;
        n += 1;
      }
    }
    const next = n === 0 ? 0 : sum / n;
    if (next !== amount) {
      amount = next;
      for (const l of listeners) l();
    }
  };

  const update = (nowMs: number): void => {
    lastNow = nowMs;
    for (const m of motions) {
      const t = m.startMs === -Infinity ? 1 : (nowMs - m.startMs) / EASE_MS;
      const next = m.from + (m.to - m.from) * ease(t);
      const offset = offsets.get(m.part.name);
      if (next === m.current && t >= 1 && !offset) continue;
      m.current = next;
      const position = positionAt(m.part.restPosition, m.part.explodeLocal, m.current);
      if (offset) position.add(offset);
      m.part.object.position.copy(position);
    }
  };

  return {
    setOffset: (name, offset) => {
      if (offset) offsets.set(name, offset);
      else offsets.delete(name);
    },
    setAmount,
    jump,
    jumpParts,
    setPreset: (preset) => setAmount(PRESET_AMOUNT[preset]),
    get amount() {
      return amount;
    },
    onChange(listener) {
      listeners.push(listener);
    },
    update,
  };
}
