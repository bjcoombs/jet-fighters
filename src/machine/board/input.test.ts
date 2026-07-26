import { describe, it, expect } from 'vitest';
import { D_INPUT } from '../cpu/ports.js';
import {
  DEFAULT_LEVER,
  DEFAULT_SKILL,
  InputMatrix,
  INPUT_READ_PIN,
  INPUT_SWITCHES,
  STROBE_FIRST,
  STROBE_LAST,
  STROBE_MASK,
  type LeverPosition,
} from './input.js';

/** Strobe every line in turn and collect the ones that read back high. */
function strobedHigh(input: InputMatrix): number[] {
  const high: number[] = [];
  for (let pin = STROBE_FIRST; pin <= STROBE_LAST; pin += 1) {
    if (input.read(1 << pin) === 1) {
      high.push(pin);
    }
  }
  return high;
}

describe('InputMatrix - wiring', () => {
  it('strobes on D0-D6 and reads on D15, per the sibling hardware', () => {
    expect(STROBE_FIRST).toBe(0);
    expect(STROBE_LAST).toBe(6);
    expect(STROBE_MASK).toBe(0x7f);
    expect(INPUT_READ_PIN).toBe(D_INPUT);
    expect(INPUT_READ_PIN).toBe(15);
  });

  it('gives each of the seven contacts its own strobe line', () => {
    expect(INPUT_SWITCHES).toHaveLength(7);
    const pins = INPUT_SWITCHES.map((s) => s.strobePin);
    expect(new Set(pins).size).toBe(7);
    expect(Math.min(...pins)).toBe(STROBE_FIRST);
    expect(Math.max(...pins)).toBe(STROBE_LAST);
  });
});

describe('InputMatrix - resting state', () => {
  it('rests with the lever centred, skill 1 and fire released', () => {
    const input = new InputMatrix();
    expect(input.getState()).toEqual({ fire: false, lever: DEFAULT_LEVER, skill: DEFAULT_SKILL });
    expect(DEFAULT_LEVER).toBe(1);
    expect(DEFAULT_SKILL).toBe(1);
  });

  it('holds one lever contact and one dial contact closed at rest', () => {
    expect(strobedHigh(new InputMatrix())).toEqual([2, 4]);
  });

  it('reads 0 when no line is strobed', () => {
    expect(new InputMatrix().read(0)).toBe(0);
  });
});

describe('InputMatrix - the fire button', () => {
  it('reads high on its own line only while held', () => {
    const input = new InputMatrix();
    expect(input.read(1 << 0)).toBe(0);

    input.setFire(true);
    expect(input.read(1 << 0)).toBe(1);

    input.setFire(false);
    expect(input.read(1 << 0)).toBe(0);
  });

  it('does not disturb the other lines', () => {
    const input = new InputMatrix();
    input.setFire(true);
    expect(strobedHigh(input)).toEqual([0, 2, 4]);
  });
});

describe('InputMatrix - the three-position lever', () => {
  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ])('closes exactly one contact in lane %i', (lane, pin) => {
    const input = new InputMatrix();
    input.setLever(lane as LeverPosition);

    expect(input.read(1 << pin)).toBe(1);
    for (const other of [1, 2, 3].filter((p) => p !== pin)) {
      expect(input.read(1 << other)).toBe(0);
    }
  });

  it('is always somewhere - moving it never opens every contact', () => {
    const input = new InputMatrix();
    for (const lane of [0, 1, 2] as LeverPosition[]) {
      input.setLever(lane);
      expect(input.read(0b1110)).toBe(1);
    }
  });

  it('changes what the ROM reads on the lane lines (contract V4)', () => {
    const input = new InputMatrix();
    const before = strobedHigh(input);
    input.setLever(0);
    expect(strobedHigh(input)).not.toEqual(before);
  });

  it('rejects a lane that does not exist', () => {
    const input = new InputMatrix();
    expect(() => input.setLever(3 as LeverPosition)).toThrow(RangeError);
  });
});

describe('InputMatrix - the skill dial', () => {
  it.each([
    [1, 4],
    [2, 5],
    [3, 6],
  ])('closes exactly one contact at skill %i', (skill, pin) => {
    const input = new InputMatrix();
    input.setSkill(skill as 1 | 2 | 3);

    expect(input.read(1 << pin)).toBe(1);
    for (const other of [4, 5, 6].filter((p) => p !== pin)) {
      expect(input.read(1 << other)).toBe(0);
    }
  });

  it('rejects a setting the case does not have', () => {
    const input = new InputMatrix();
    expect(() => input.setSkill(0 as 1)).toThrow(RangeError);
    expect(() => input.setSkill(4 as 1)).toThrow(RangeError);
  });
});

describe('InputMatrix - reading the matrix', () => {
  it('ORs several strobed lines, as a diode matrix does', () => {
    const input = new InputMatrix();
    input.setLever(0);
    expect(input.read(0b0000010)).toBe(1);
    expect(input.read(0b0000110)).toBe(1);
    expect(input.read(0b0001000)).toBe(0);
  });

  it('ignores strobe bits above D6 - those grids carry no contacts', () => {
    const input = new InputMatrix();
    input.setLever(0);
    expect(input.read(0xff80)).toBe(0);
    expect(input.read(0x3ff & ~0b10)).toBe(1); // D2 (lever centre is open, D4 skill 1 closed)
  });

  it('reports the closed contacts as a mask', () => {
    const input = new InputMatrix();
    input.setFire(true);
    input.setLever(2);
    input.setSkill(3);
    expect(input.closedMask()).toBe((1 << 0) | (1 << 3) | (1 << 6));
  });

  it('agrees with isSwitchClosed line by line', () => {
    const input = new InputMatrix();
    input.setFire(true);
    input.setLever(0);
    for (let pin = STROBE_FIRST; pin <= STROBE_LAST; pin += 1) {
      expect(input.read(1 << pin) === 1).toBe(input.isSwitchClosed(pin));
    }
  });
});

describe('InputMatrix - setControl', () => {
  it('presses fire with no value', () => {
    const input = new InputMatrix();
    input.setControl('fire');
    expect(input.fire).toBe(true);
  });

  it.each(['down', 'on', 'true', '1'])('presses fire for %s', (value) => {
    const input = new InputMatrix();
    input.setControl('fire', value);
    expect(input.fire).toBe(true);
  });

  it.each(['up', 'off', 'false', '0'])('releases fire for %s', (value) => {
    const input = new InputMatrix();
    input.setFire(true);
    input.setControl('fire', value);
    expect(input.fire).toBe(false);
  });

  it.each([
    ['up', 0],
    ['top', 0],
    ['centre', 1],
    ['center', 1],
    ['down', 2],
    ['bottom', 2],
    ['2', 2],
  ])('moves the lever for %s', (value, lane) => {
    const input = new InputMatrix();
    input.setControl('lever', value);
    expect(input.lever).toBe(lane);
  });

  it.each(['1', '2', '3'])('turns the dial to %s', (value) => {
    const input = new InputMatrix();
    input.setControl('skill', value);
    expect(input.skill).toBe(Number(value));
  });

  it('rejects an unknown control', () => {
    const input = new InputMatrix();
    expect(() => input.setControl('turbo')).toThrow(RangeError);
  });

  it('rejects an unknown value', () => {
    const input = new InputMatrix();
    expect(() => input.setControl('lever', 'sideways')).toThrow(RangeError);
    expect(() => input.setControl('skill', '4')).toThrow(RangeError);
    expect(() => input.setControl('fire', 'maybe')).toThrow(RangeError);
  });
});

describe('InputMatrix - reset', () => {
  it('returns every control to rest', () => {
    const input = new InputMatrix();
    input.setFire(true);
    input.setLever(2);
    input.setSkill(3);
    input.reset();

    expect(input.getState()).toEqual({ fire: false, lever: DEFAULT_LEVER, skill: DEFAULT_SKILL });
  });
});
