import { describe, it, expect } from 'vitest';
import {
  laneFromFraction,
  laneToFraction,
  cycleSkill,
  skillToAngle,
  clampLane,
  type Lane,
  type SkillLevel,
} from './controls.js';

describe('laneFromFraction', () => {
  it('maps the top third to lane 0', () => {
    expect(laneFromFraction(0)).toBe(0);
    expect(laneFromFraction(0.33)).toBe(0);
  });

  it('maps the middle third to lane 1', () => {
    expect(laneFromFraction(1 / 3)).toBe(1);
    expect(laneFromFraction(0.5)).toBe(1);
    expect(laneFromFraction(0.66)).toBe(1);
  });

  it('maps the bottom third to lane 2', () => {
    expect(laneFromFraction(2 / 3)).toBe(2);
    expect(laneFromFraction(1)).toBe(2);
  });

  it('clamps out-of-range input', () => {
    expect(laneFromFraction(-5)).toBe(0);
    expect(laneFromFraction(5)).toBe(2);
  });
});

describe('laneToFraction', () => {
  it('returns the centre of each lane band', () => {
    expect(laneToFraction(0)).toBeCloseTo(1 / 6);
    expect(laneToFraction(1)).toBeCloseTo(3 / 6);
    expect(laneToFraction(2)).toBeCloseTo(5 / 6);
  });

  it('round-trips through laneFromFraction', () => {
    ([0, 1, 2] as Lane[]).forEach((lane) => {
      expect(laneFromFraction(laneToFraction(lane))).toBe(lane);
    });
  });
});

describe('cycleSkill', () => {
  it('advances 1 -> 2 -> 3 -> 1', () => {
    expect(cycleSkill(1)).toBe(2);
    expect(cycleSkill(2)).toBe(3);
    expect(cycleSkill(3)).toBe(1);
  });

  it('cycles back to the start after three steps', () => {
    let level: SkillLevel = 1;
    level = cycleSkill(cycleSkill(cycleSkill(level)));
    expect(level).toBe(1);
  });
});

describe('skillToAngle', () => {
  it('sweeps a symmetric arc centred on level 2', () => {
    expect(skillToAngle(1)).toBe(-50);
    expect(skillToAngle(2)).toBe(0);
    expect(skillToAngle(3)).toBe(50);
  });
});

describe('clampLane', () => {
  it('clamps to the valid lane range', () => {
    expect(clampLane(-1)).toBe(0);
    expect(clampLane(0)).toBe(0);
    expect(clampLane(1)).toBe(1);
    expect(clampLane(2)).toBe(2);
    expect(clampLane(9)).toBe(2);
  });

  it('rounds fractional values to the nearest lane', () => {
    expect(clampLane(0.4)).toBe(0);
    expect(clampLane(1.5)).toBe(2);
  });
});
