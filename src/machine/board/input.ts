// The case controls, as positions rather than as pins.
//
// A lever with three detents, a three-position skill slide and a momentary fire
// button. That is a fact about the moulding, and it does not move when the chip
// behind it does: the types, the defaults and the `--input` vocabulary here
// outlived the v2 machine's strobe matrix and are shared by every layer that
// names a control.
//
// Which pin each contact returns on is a fact about the chip, and it lives in
// ./tms1370-input.ts - two strobe columns on R9 and R10, three returns on
// K1/K2/K4, and fire on K8 past the columns entirely.
//
// Pure data and parsing: no DOM, no timers, no Web APIs, no state.

/** Lane the three-position lever selects: 0 = top, 2 = bottom. */
export type LeverPosition = 0 | 1 | 2;

/** Skill dial setting, as printed on the case. */
export type SkillLevel = 1 | 2 | 3;

/** Names accepted by `setControl` - the probe's `--input SPEC` vocabulary (V7). */
export type ControlName = 'fire' | 'lever' | 'skill';

/** Lever position the game starts in - centre lane, per the v1 rules. */
export const DEFAULT_LEVER: LeverPosition = 1;

/** Skill the dial rests at until the player moves it. */
export const DEFAULT_SKILL: SkillLevel = 1;

/** Position of every case control at an instant. */
export interface ControlState {
  /** True while the fire button is held down. */
  readonly fire: boolean;
  /** Lane the lever selects. */
  readonly lever: LeverPosition;
  /** Skill the dial selects. */
  readonly skill: SkillLevel;
}

/**
 * Read a fire-button value.
 *
 * `down`/`up`, `on`/`off`, `true`/`false`, `1`/`0`, or nothing at all - a bare
 * `--input fire@N` presses the button, which is the useful default and the only
 * control that has one.
 */
export function parseFire(value?: string): boolean {
  if (value === undefined || value === '') {
    return true;
  }
  switch (value) {
    case 'down':
    case 'on':
    case 'true':
    case '1':
      return true;
    case 'up':
    case 'off':
    case 'false':
    case '0':
      return false;
    default:
      throw new RangeError(`unknown fire value: ${value} (expected down/up, on/off or 1/0)`);
  }
}

/** Read a lever lane: `up`/`centre`/`down`, their synonyms, or `0`/`1`/`2`. */
export function parseLever(value?: string): LeverPosition {
  switch (value) {
    case 'up':
    case 'top':
    case '0':
      return 0;
    case 'centre':
    case 'center':
    case 'middle':
    case '1':
      return 1;
    case 'down':
    case 'bottom':
    case '2':
      return 2;
    default:
      throw new RangeError(`unknown lever value: ${value} (expected up, centre or down)`);
  }
}

/** Read a skill setting: `1`, `2` or `3`, as printed on the case. */
export function parseSkill(value?: string): SkillLevel {
  switch (value) {
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    default:
      throw new RangeError(`unknown skill value: ${value} (expected 1, 2 or 3)`);
  }
}
