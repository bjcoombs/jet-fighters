// The modelled controls, live.
//
// Two halves. The pure half maps between the machine's control state and the
// pose of the four control parts, and between a pointer on the model and the
// input it means; it is tested headlessly. The other half attaches to the
// canvas and turns pointer events into `MachineInput`, the same messages the
// flat page's controls and the keyboard produce. Nothing here writes machine
// state: a click closes a contact through `apply`, and the pose the parts take
// is read back from the board's input matrix each frame, so the keyboard moves
// the modelled controls too.
//
// Frames: a part's local units are millimetres (it sits under the root's metre
// scale), with +Y out of the face, +X across the case to the right, and +Z down
// the face toward the player's end - glTF's frame, Blender's Y negated. A pin
// that moves toward the top of the case moves toward -Z.

import { Vector3 } from 'three';

import dimensions from '../../tools/model/dimensions.json';
import type { MachineInput } from '../input/index.js';

const D = dimensions.dimensions;

/** The parts a pointer can operate. */
export type ControlName = 'fire_cap' | 'power_thumb' | 'lever_pin' | 'skill_flag';

export const CONTROL_NAMES: readonly ControlName[] = ['fire_cap', 'power_thumb', 'lever_pin', 'skill_flag'];

export function isControl(name: string): name is ControlName {
  return (CONTROL_NAMES as readonly string[]).includes(name);
}

/** What the board's input matrix and power switch say, as the pose reads it. */
export interface ControlState {
  readonly fire: boolean;
  readonly power: boolean;
  readonly lever: 0 | 1 | 2;
  readonly skill: 1 | 2 | 3;
}

/** A part's pose: a local offset from its exploded place, mm, and a turn about its up axis. */
export interface Pose {
  readonly offset: Vector3;
  readonly rotationY: number;
}

const CASE_W = D['case.width'].value;
const CASE_H = D['case.module_height'].value;

/** Face mm (x right, y down from the module top) -> a part's local X, Z. */
export function faceToLocal(xMm: number, yMm: number): readonly [number, number] {
  return [xMm - CASE_W / 2, yMm - CASE_H / 2];
}

/** The pin's three positions down the slot, mm, relative to the middle one it was built at. */
const PIN_Y = D['controls.lever.pin_y_positions'].value;
export const LANE_OFFSETS_MM: readonly [number, number, number] = [PIN_Y[0] - PIN_Y[1], 0, PIN_Y[2] - PIN_Y[1]];

/** How far the power thumb travels from OFF (built) to ON, toward the case top. */
const TRAVEL = D['controls.power.travel_y'].value;
export const POWER_TRAVEL_MM = TRAVEL[1] - TRAVEL[0];

/** How far the fire cap sinks while pressed. */
export const FIRE_PRESS_MM = 2.5;

/**
 * The skill flag's handle angle for each level, in the face's plane. The moulded
 * 1/2/3 marks sit at 150, 90 and 30 degrees round the hub (counter-clockwise from
 * +X, case-top up), and the handle points the opposite way from the mark it
 * selects: src/ui/case.ts, "the level it indicates is the direction opposite the
 * handle". The Blender script builds the flag at -40 degrees, near level 1.
 */
export const FLAG_REST_DEG = -40;
export const FLAG_HANDLE_DEG: Readonly<Record<1 | 2 | 3, number>> = { 1: -30, 2: -90, 3: -150 };

/** The four parts' poses for a control state. */
export function poseFor(state: ControlState): Readonly<Record<ControlName, Pose>> {
  const none = new Vector3();
  return {
    fire_cap: { offset: state.fire ? new Vector3(0, -FIRE_PRESS_MM, 0) : none, rotationY: 0 },
    // Toward the case top is -Z.
    power_thumb: { offset: state.power ? new Vector3(0, 0, -POWER_TRAVEL_MM) : none, rotationY: 0 },
    lever_pin: { offset: new Vector3(0, 0, LANE_OFFSETS_MM[state.lever]), rotationY: 0 },
    // A counter-clockwise turn in the face's plane is a positive turn about +Y.
    skill_flag: { offset: none, rotationY: ((FLAG_HANDLE_DEG[state.skill] - FLAG_REST_DEG) * Math.PI) / 180 },
  };
}

/** The lane nearest a pin offset down the slot, mm from the middle position. */
export function laneFromSlotOffset(offsetMm: number): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 1;
  let bestDist = Infinity;
  for (const lane of [0, 1, 2] as const) {
    const d = Math.abs(offsetMm - LANE_OFFSETS_MM[lane]);
    if (d < bestDist) {
      bestDist = d;
      best = lane;
    }
  }
  return best;
}

/**
 * Which control a hit on the front shell's face is on, if any: the wells around
 * the small parts count, and `slackMm` widens them further - a finger needs
 * more than a pointer does.
 */
export function controlAtFacePoint(localX: number, localZ: number, slackMm = 0): ControlName | null {
  const [lx, lz] = faceToLocal(D['controls.lever.well_centre'].value[0], D['controls.lever.well_centre'].value[1]);
  if (Math.hypot(localX - lx, localZ - lz) <= D['controls.lever.well_radius'].value + slackMm) return 'lever_pin';
  const [fx, fz] = faceToLocal(D['controls.fire.centre'].value[0], D['controls.fire.centre'].value[1]);
  if (Math.hypot(localX - fx, localZ - fz) <= D['controls.fire.ring_radius'].value + slackMm) return 'fire_cap';
  const [sx, sz] = faceToLocal(D['controls.skill.hub_centre'].value[0], D['controls.skill.hub_centre'].value[1]);
  if (Math.hypot(localX - sx, localZ - sz) <= D['controls.skill.mark_radius'].value + 4 + slackMm) return 'skill_flag';
  const [px, pz] = faceToLocal(D['controls.power.thumb_centre'].value[0], D['controls.power.thumb_centre'].value[1]);
  if (Math.abs(localX - px) <= 8 + slackMm && Math.abs(localZ - pz) <= 14 + slackMm) return 'power_thumb';
  return null;
}

/** The input a press on a control produces, given the current state. Null where a press alone means nothing (the lever is dragged). */
export function inputForPress(control: ControlName, state: ControlState): MachineInput | null {
  switch (control) {
    case 'fire_cap':
      return { type: 'FIRE', pressed: true };
    case 'power_thumb':
      return { type: 'POWER', on: !state.power };
    case 'skill_flag':
      return { type: 'SKILL', level: state.skill === 3 ? 1 : ((state.skill + 1) as 2 | 3) };
    case 'lever_pin':
      return null;
  }
}

/**
 * The internal part each control sits over. A pointer aimed at a control often
 * lands on what shows through the opening round it - the switch body in the
 * slot, the hub in its hole - and that is the same control.
 */
export const CONTROL_UNDER: Readonly<Record<string, ControlName>> = {
  power_switch: 'power_thumb',
  skill_hub: 'skill_flag',
  lever_disc: 'lever_pin',
  fire_switch: 'fire_cap',
};

/** The skill flag turns about its hub; the part's origin is the case centre, so the pivot is set at load. */
export const SKILL_HUB_LOCAL: readonly [number, number] = faceToLocal(D['controls.skill.hub_centre'].value[0], D['controls.skill.hub_centre'].value[1]);

/** The pin's rest position down the face, local Z, for turning a pointer hit into a slot offset. */
export const PIN_REST_LOCAL_Z = faceToLocal(0, PIN_Y[1])[1];
