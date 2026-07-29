import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEVER,
  DEFAULT_SKILL,
  parseFire,
  parseLever,
  parseSkill,
  type LeverPosition,
} from './input.js';

describe('case controls - resting positions', () => {
  it('rests with the lever centred and the dial at skill 1', () => {
    expect(DEFAULT_LEVER).toBe(1);
    expect(DEFAULT_SKILL).toBe(1);
  });
});

describe('case controls - parsing the probe vocabulary', () => {
  it('presses fire with no value at all', () => {
    // `--input fire@N` is a press. Fire is the only momentary control, so it is
    // the only one with a useful default, and the bare form is what a caller
    // reaches for.
    expect(parseFire()).toBe(true);
    expect(parseFire('')).toBe(true);
  });

  it.each(['down', 'on', 'true', '1'])('presses fire for %s', (value) => {
    expect(parseFire(value)).toBe(true);
  });

  it.each(['up', 'off', 'false', '0'])('releases fire for %s', (value) => {
    expect(parseFire(value)).toBe(false);
  });

  it.each([
    ['up', 0],
    ['top', 0],
    ['centre', 1],
    ['center', 1],
    ['middle', 1],
    ['down', 2],
    ['bottom', 2],
    ['0', 0],
    ['1', 1],
    ['2', 2],
  ])('reads lever %s as lane %i', (value, lane) => {
    expect(parseLever(value)).toBe(lane as LeverPosition);
  });

  it.each(['1', '2', '3'])('reads skill %s as printed on the case', (value) => {
    expect(parseSkill(value)).toBe(Number(value));
  });

  it('rejects a position the case does not have', () => {
    expect(() => parseLever('sideways')).toThrow(RangeError);
    expect(() => parseLever(undefined)).toThrow(RangeError);
    expect(() => parseLever('3')).toThrow(RangeError);
    expect(() => parseSkill('4')).toThrow(RangeError);
    expect(() => parseSkill('0')).toThrow(RangeError);
    expect(() => parseFire('maybe')).toThrow(RangeError);
  });
});
