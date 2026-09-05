import { describe, it, expect } from 'vitest';
import {
  classifyKey,
  resolveLane,
  pushDirection,
  removeDirection,
  powerInput,
  type LaneDirection,
} from './input.js';

describe('classifyKey', () => {
  it('maps up-lane keys', () => {
    for (const key of ['ArrowUp', 'w', 'W']) {
      expect(classifyKey(key)).toEqual({ type: 'lane', dir: 'up' });
    }
  });

  it('maps down-lane keys', () => {
    for (const key of ['ArrowDown', 's', 'S']) {
      expect(classifyKey(key)).toEqual({ type: 'lane', dir: 'down' });
    }
  });

  it('maps fire keys', () => {
    for (const key of [' ', 'Spacebar', 'Enter']) {
      expect(classifyKey(key)).toEqual({ type: 'fire' });
    }
  });

  it('maps the power key (both cases)', () => {
    expect(classifyKey('p')).toEqual({ type: 'power' });
    expect(classifyKey('P')).toEqual({ type: 'power' });
  });

  it('maps skill keys 1/2/3', () => {
    expect(classifyKey('1')).toEqual({ type: 'skill', level: 1 });
    expect(classifyKey('2')).toEqual({ type: 'skill', level: 2 });
    expect(classifyKey('3')).toEqual({ type: 'skill', level: 3 });
  });

  it('leaves M unbound (mute is a browser control, not a machine one)', () => {
    expect(classifyKey('m')).toBeNull();
    expect(classifyKey('M')).toBeNull();
  });

  it('returns null for unrelated keys', () => {
    for (const key of ['a', '4', 'Escape', 'Tab', 'ArrowLeft']) {
      expect(classifyKey(key)).toBeNull();
    }
  });
});

describe('resolveLane (held-key semantics)', () => {
  it('returns to the centre lane when nothing is held', () => {
    expect(resolveLane([])).toBe(1);
  });

  it('holds the top lane while up is held', () => {
    expect(resolveLane(['up'])).toBe(0);
  });

  it('holds the bottom lane while down is held', () => {
    expect(resolveLane(['down'])).toBe(2);
  });

  it('lets the latest-pressed direction win when both are held', () => {
    expect(resolveLane(['up', 'down'])).toBe(2);
    expect(resolveLane(['down', 'up'])).toBe(0);
  });
});

describe('pushDirection / removeDirection', () => {
  it('adds a direction to the top of the stack', () => {
    expect(pushDirection([], 'up')).toEqual(['up']);
    expect(pushDirection(['up'], 'down')).toEqual(['up', 'down']);
  });

  it('is idempotent under key-repeat (moves existing entry to the top)', () => {
    expect(pushDirection(['up'], 'up')).toEqual(['up']);
    expect(pushDirection(['up', 'down'], 'up')).toEqual(['down', 'up']);
  });

  it('removes a released direction', () => {
    expect(removeDirection(['up', 'down'], 'down')).toEqual(['up']);
    expect(removeDirection(['up'], 'up')).toEqual([]);
  });

  it('drives a realistic hold/release sequence to the right lanes', () => {
    let held: LaneDirection[] = [];
    held = pushDirection(held, 'up'); // hold up
    expect(resolveLane(held)).toBe(0);
    held = pushDirection(held, 'down'); // also hold down -> latest wins
    expect(resolveLane(held)).toBe(2);
    held = pushDirection(held, 'down'); // key-repeat noise on down
    expect(resolveLane(held)).toBe(2);
    held = removeDirection(held, 'down'); // release down -> back to up
    expect(resolveLane(held)).toBe(0);
    held = removeDirection(held, 'up'); // release up -> back to centre
    expect(resolveLane(held)).toBe(1);
  });
});

describe('powerInput', () => {
  it('carries the switch position, with no other state attached', () => {
    expect(powerInput(true)).toEqual({ type: 'POWER', on: true });
    expect(powerInput(false)).toEqual({ type: 'POWER', on: false });
  });
});
