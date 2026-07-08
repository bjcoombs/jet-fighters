import { describe, it, expect } from 'vitest';
import {
  classifyKey,
  resolveLane,
  pushDirection,
  removeDirection,
  laneFromThirds,
  powerInput,
  createControlsAdapter,
  type LaneDirection,
} from './input.js';
import type { GameInput } from '../game/types.js';

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

  it('leaves M unbound (reserved for mute in task 8)', () => {
    expect(classifyKey('m')).toBeNull();
    expect(classifyKey('M')).toBeNull();
  });

  it('returns null for unrelated keys', () => {
    for (const key of ['a', '4', 'Escape', 'Tab', 'ArrowLeft']) {
      expect(classifyKey(key)).toBeNull();
    }
  });
});

describe('resolveLane (spring-lever semantics)', () => {
  it('springs to the centre lane when nothing is held', () => {
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
    held = removeDirection(held, 'up'); // release up -> spring to centre
    expect(resolveLane(held)).toBe(1);
  });
});

describe('laneFromThirds', () => {
  it('maps the top third to lane 0', () => {
    expect(laneFromThirds(0, 300)).toBe(0);
    expect(laneFromThirds(99, 300)).toBe(0);
  });

  it('maps the middle third to lane 1', () => {
    expect(laneFromThirds(100, 300)).toBe(1);
    expect(laneFromThirds(150, 300)).toBe(1);
    expect(laneFromThirds(199, 300)).toBe(1);
  });

  it('maps the bottom third to lane 2', () => {
    expect(laneFromThirds(200, 300)).toBe(2);
    expect(laneFromThirds(300, 300)).toBe(2);
  });

  it('falls back to the centre lane for a zero-height element', () => {
    expect(laneFromThirds(0, 0)).toBe(1);
  });
});

describe('powerInput', () => {
  it('emits POWER_ON with a fresh seed when turning on', () => {
    expect(powerInput(true, () => 42)).toEqual({ type: 'POWER_ON', seed: 42 });
  });

  it('emits POWER_OFF (no seed) when turning off', () => {
    expect(powerInput(false, () => 42)).toEqual({ type: 'POWER_OFF' });
  });

  it('only calls the seed source when powering on', () => {
    let calls = 0;
    const seed = () => (calls++, 7);
    powerInput(false, seed);
    expect(calls).toBe(0);
    powerInput(true, seed);
    expect(calls).toBe(1);
  });
});

describe('createControlsAdapter', () => {
  it('bridges on-case controls to matching GameInputs', () => {
    const emitted: GameInput[] = [];
    const adapter = createControlsAdapter((i) => emitted.push(i), { makeSeed: () => 99 });

    adapter.onFire();
    adapter.onLaneChange(2);
    adapter.onSkillChange(3);
    adapter.onPowerToggle(true);
    adapter.onPowerToggle(false);

    expect(emitted).toEqual([
      { type: 'FIRE' },
      { type: 'MOVE_LANE', lane: 2 },
      { type: 'SET_SKILL', level: 3 },
      { type: 'POWER_ON', seed: 99 },
      { type: 'POWER_OFF' },
    ]);
  });
});
