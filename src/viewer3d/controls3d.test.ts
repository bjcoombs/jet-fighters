import { describe, expect, it } from 'vitest';

import dimensions from '../../tools/model/dimensions.json';
import {
  FIRE_PRESS_MM,
  LANE_OFFSETS_MM,
  POWER_TRAVEL_MM,
  controlAtFacePoint,
  faceToLocal,
  inputForPress,
  laneFromSlotOffset,
  poseFor,
} from './controls3d.js';

const D = dimensions.dimensions;
const rest = { fire: false, power: false, lever: 1 as const, skill: 1 as const };

describe('poseFor', () => {
  it('is the built pose at rest: nothing moved, the flag near level 1', () => {
    const pose = poseFor(rest);
    expect(pose.fire_cap.offset.length()).toBe(0);
    expect(pose.power_thumb.offset.length()).toBe(0);
    expect(pose.lever_pin.offset.length()).toBe(0);
    // Built at -40 degrees, level 1 is -30: a small positive turn.
    expect(pose.skill_flag.rotationY).toBeCloseTo((10 * Math.PI) / 180, 9);
  });

  it('sinks the cap while fire is held', () => {
    expect(poseFor({ ...rest, fire: true }).fire_cap.offset.y).toBe(-FIRE_PRESS_MM);
  });

  it('slides the thumb toward the case top for ON', () => {
    const on = poseFor({ ...rest, power: true }).power_thumb.offset;
    expect(on.z).toBeCloseTo(-POWER_TRAVEL_MM, 9);
    expect(POWER_TRAVEL_MM).toBeGreaterThan(5);
  });

  it('puts the pin at the measured positions, lane 0 toward the case top', () => {
    expect(poseFor({ ...rest, lever: 0 }).lever_pin.offset.z).toBeLessThan(0);
    expect(poseFor({ ...rest, lever: 2 }).lever_pin.offset.z).toBeGreaterThan(0);
    const pins = D['controls.lever.pin_y_positions'].value;
    expect(LANE_OFFSETS_MM[0]).toBeCloseTo(pins[0] - pins[1], 9);
    expect(LANE_OFFSETS_MM[2]).toBeCloseTo(pins[2] - pins[1], 9);
  });

  it('turns the flag clockwise through the three levels', () => {
    const a1 = poseFor({ ...rest, skill: 1 }).skill_flag.rotationY;
    const a2 = poseFor({ ...rest, skill: 2 }).skill_flag.rotationY;
    const a3 = poseFor({ ...rest, skill: 3 }).skill_flag.rotationY;
    expect(a2).toBeLessThan(a1);
    expect(a3).toBeLessThan(a2);
    expect(a1 - a3).toBeCloseTo((120 * Math.PI) / 180, 9);
  });
});

describe('laneFromSlotOffset', () => {
  it('snaps to the nearest of the three positions', () => {
    expect(laneFromSlotOffset(0)).toBe(1);
    expect(laneFromSlotOffset(LANE_OFFSETS_MM[0])).toBe(0);
    expect(laneFromSlotOffset(LANE_OFFSETS_MM[2])).toBe(2);
    expect(laneFromSlotOffset(-40)).toBe(0);
    expect(laneFromSlotOffset(40)).toBe(2);
    expect(laneFromSlotOffset(LANE_OFFSETS_MM[0] / 2 + 0.5)).toBe(1);
    expect(laneFromSlotOffset(LANE_OFFSETS_MM[0] / 2 - 0.5)).toBe(0);
  });
});

describe('controlAtFacePoint', () => {
  it('finds each control at its measured centre and nothing in the middle of the scope', () => {
    const at = (name: string) => {
      const c = D[`controls.${name}` as keyof typeof D].value as [number, number];
      return controlAtFacePoint(...faceToLocal(c[0], c[1]));
    };
    expect(at('lever.well_centre')).toBe('lever_pin');
    expect(at('fire.centre')).toBe('fire_cap');
    expect(at('skill.hub_centre')).toBe('skill_flag');
    expect(at('power.thumb_centre')).toBe('power_thumb');
    const scope = D['scope.circle_centre'].value;
    expect(controlAtFacePoint(...faceToLocal(scope[0], scope[1]))).toBeNull();
  });

  it('widens every control by the slack a finger needs', () => {
    const f = D['controls.fire.centre'].value;
    const r = D['controls.fire.ring_radius'].value;
    const [x, z] = faceToLocal(f[0] + r + 4, f[1]);
    expect(controlAtFacePoint(x, z)).toBeNull();
    expect(controlAtFacePoint(x, z, 6)).toBe('fire_cap');
  });
});

describe('inputForPress', () => {
  it('presses fire, toggles power, cycles skill, and leaves the lever to a drag', () => {
    expect(inputForPress('fire_cap', rest)).toEqual({ type: 'FIRE', pressed: true });
    expect(inputForPress('power_thumb', rest)).toEqual({ type: 'POWER', on: true });
    expect(inputForPress('power_thumb', { ...rest, power: true })).toEqual({ type: 'POWER', on: false });
    expect(inputForPress('skill_flag', rest)).toEqual({ type: 'SKILL', level: 2 });
    expect(inputForPress('skill_flag', { ...rest, skill: 3 })).toEqual({ type: 'SKILL', level: 1 });
    expect(inputForPress('lever_pin', rest)).toBeNull();
  });
});
