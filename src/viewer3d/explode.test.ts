import { Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { EASE_MS, createExploder, ease, positionAt, presetFactor } from './explode.js';
import type { Part } from './scene.js';

function part(name: string, explode?: readonly [number, number, number], rest = new Vector3(0.01, 0.02, 0.03)): Part {
  const object = new Group();
  object.name = name;
  object.position.copy(rest);
  const explodeLocal = explode ? new Vector3(...explode) : new Vector3();
  return { name, object, extras: explode ? { label: name, explode } : { label: name }, restPosition: rest.clone(), explodeLocal };
}

describe('positionAt', () => {
  it('is the rest position at zero and rest plus the vector at one', () => {
    const rest = new Vector3(1, 2, 3);
    const v = new Vector3(0, 0.12, 0);
    expect(positionAt(rest, v, 0).toArray()).toEqual([1, 2, 3]);
    expect(positionAt(rest, v, 1).toArray()).toEqual([1, 2.12, 3]);
    expect(positionAt(rest, v, 0.5).toArray()).toEqual([1, 2.06, 3]);
  });

  it('leaves a part without a vector where it is', () => {
    const rest = new Vector3(1, 2, 3);
    expect(positionAt(rest, new Vector3(), 1).toArray()).toEqual([1, 2, 3]);
  });
});

describe('presets', () => {
  it('lid-off moves the front shell and its fittings and nothing on the board', () => {
    expect(presetFactor('lid-off', 'front_shell')).toBe(1);
    expect(presetFactor('lid-off', 'window')).toBe(1);
    expect(presetFactor('lid-off', 'fire_cap')).toBe(1);
    expect(presetFactor('lid-off', 'tms1370')).toBe(0);
    expect(presetFactor('lid-off', 'back_shell')).toBe(0);
  });

  it('assembled is zero everywhere and exploded is one everywhere', () => {
    for (const name of ['front_shell', 'pcb', 'tms1370', 'battery_door']) {
      expect(presetFactor('assembled', name)).toBe(0);
      expect(presetFactor('exploded', name)).toBe(1);
    }
  });
});

describe('createExploder', () => {
  it('eases every part to the slider amount and lands exactly on it', () => {
    const shell = part('front_shell', [0, 0.12, 0]);
    const chip = part('tms1370', [0, 0.03, 0]);
    const board = part('pcb');
    const ex = createExploder(new Map([['front_shell', shell], ['tms1370', chip], ['pcb', board]]));

    ex.update(0);
    ex.setAmount(1);
    ex.update(EASE_MS / 2);
    const mid = shell.object.position.y;
    expect(mid).toBeGreaterThan(0.02);
    expect(mid).toBeLessThan(0.14);
    ex.update(EASE_MS + 1);
    expect(shell.object.position.y).toBeCloseTo(0.14, 9);
    expect(chip.object.position.y).toBeCloseTo(0.05, 9);
    expect(board.object.position.y).toBeCloseTo(0.02, 9);
    expect(ex.amount).toBe(1);
  });

  it('returns to the exported position at zero', () => {
    const shell = part('front_shell', [0, 0.12, 0]);
    const ex = createExploder(new Map([['front_shell', shell]]));
    ex.update(0);
    ex.setAmount(1);
    ex.update(2 * EASE_MS);
    ex.setAmount(0);
    ex.update(4 * EASE_MS);
    expect(shell.object.position.toArray()).toEqual(shell.restPosition.toArray());
  });

  it('a preset moves only the parts it names', () => {
    const shell = part('front_shell', [0, 0.12, 0]);
    const chip = part('tms1370', [0, 0.03, 0]);
    const ex = createExploder(new Map([['front_shell', shell], ['tms1370', chip]]));
    ex.update(0);
    ex.setPreset('lid-off');
    ex.update(2 * EASE_MS);
    expect(shell.object.position.y).toBeCloseTo(0.14, 9);
    expect(chip.object.position.y).toBeCloseTo(0.02, 9);
    expect(ex.amount).toBe(0.5);
  });

  it('ease starts at zero, ends at one, and is monotonic', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      expect(ease(t)).toBeGreaterThanOrEqual(last);
      last = ease(t);
    }
  });
});
