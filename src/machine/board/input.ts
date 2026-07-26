// The case controls, wired as a strobe matrix.
//
// Sources: the sibling device MAME emulates (Gakken Heiankyo Alien, HD38800)
// strobes its inputs on D0-D6 and reads them back on D15 - docs/prd/
// jet-fighters-v2.md (Technical Context, R4). Those are the same D0-D6 that
// drive the first seven display grids, which is how these machines get an input
// matrix for free: the display sweep is the strobe.
//
// What is *not* known: which strobe line each of Jet Fighter's switches sits on.
// Jet Fighter's ROM was never dumped, so there is no wiring to recover. The
// machine has exactly seven switch contacts - fire, three lever positions, three
// skill positions - and D0-D6 is exactly seven strobe lines, so this model gives
// each contact its own line in the order below. That is this repo's stated
// convention, adopted because the counts match; asm/jetfighter.asm (R3) is
// authored against it and the two must move together.
//
// Read polarity follows the sibling: a strobed line with a closed contact reads
// back 1 on D15, and 0 otherwise. The real open-drain wiring is active-low, but
// ports.ts models resolved pin state rather than voltages and the board drives
// D15's external level directly, so the logical polarity is the board's to
// choose and it chooses the one MAME documents.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the board reads this matrix when the ROM strobes it.

import { D_INPUT } from '../cpu/ports.js';

/** Lowest input strobe line. */
export const STROBE_FIRST = 0;

/** Highest input strobe line - seven lines, D0-D6. */
export const STROBE_LAST = 6;

/** D0-D6 as a bit mask. */
export const STROBE_MASK = 0x7f;

/** The line the matrix is read back on: D15. */
export const INPUT_READ_PIN = D_INPUT;

/** Lane the three-position lever selects: 0 = top, 2 = bottom. */
export type LeverPosition = 0 | 1 | 2;

/** Skill dial setting, as printed on the case. */
export type SkillLevel = 1 | 2 | 3;

/** Every switch contact in the case. */
export type SwitchName =
  | 'fire'
  | 'lever_up'
  | 'lever_centre'
  | 'lever_down'
  | 'skill_1'
  | 'skill_2'
  | 'skill_3';

/** Names accepted by `setControl` - the probe's `--input SPEC` vocabulary (V4). */
export type ControlName = 'fire' | 'lever' | 'skill';

/** One switch contact and the strobe line it sits on. */
export interface InputSwitch {
  readonly name: SwitchName;
  /** D pin, 0-6, that selects this contact. */
  readonly strobePin: number;
}

/**
 * The matrix wiring: one contact per strobe line, in case-control order.
 *
 * Fire first because the ROM samples it every sweep; the lever and dial follow
 * in the order they read on the case.
 */
export const INPUT_SWITCHES: readonly InputSwitch[] = [
  { name: 'fire', strobePin: 0 },
  { name: 'lever_up', strobePin: 1 },
  { name: 'lever_centre', strobePin: 2 },
  { name: 'lever_down', strobePin: 3 },
  { name: 'skill_1', strobePin: 4 },
  { name: 'skill_2', strobePin: 5 },
  { name: 'skill_3', strobePin: 6 },
];

/** Strobe line each lever position closes, indexed by lane. */
const LEVER_STROBE_PIN: readonly number[] = [1, 2, 3];

/** Strobe line each skill setting closes, indexed by `skill - 1`. */
const SKILL_STROBE_PIN: readonly number[] = [4, 5, 6];

/** The fire button's strobe line. */
const FIRE_STROBE_PIN = 0;

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
 * The input matrix and the case controls behind it.
 *
 * The lever and the dial are position switches: exactly one contact of each is
 * closed at all times, because a physical lever is always somewhere. Only the
 * fire button is momentary, and it rests open.
 *
 * The board drives the read line from `read()` whenever the strobe changes or a
 * control moves, so input reaches the ROM the same way it reaches the real chip
 * - through the matrix, on the sweep, never by writing game state.
 */
export class InputMatrix {
  private _fire = false;
  private _lever: LeverPosition = DEFAULT_LEVER;
  private _skill: SkillLevel = DEFAULT_SKILL;

  /** True while the fire button is held down. */
  get fire(): boolean {
    return this._fire;
  }

  /** Lane the lever selects. */
  get lever(): LeverPosition {
    return this._lever;
  }

  /** Skill the dial selects. */
  get skill(): SkillLevel {
    return this._skill;
  }

  /** Press or release the fire button. */
  setFire(pressed: boolean): void {
    this._fire = pressed;
  }

  /** Move the three-position lever to a lane. */
  setLever(position: LeverPosition): void {
    if (position !== 0 && position !== 1 && position !== 2) {
      throw new RangeError(`lever position out of range: ${position} (expected 0..2)`);
    }
    this._lever = position;
  }

  /** Turn the skill dial. */
  setSkill(level: SkillLevel): void {
    if (level !== 1 && level !== 2 && level !== 3) {
      throw new RangeError(`skill level out of range: ${level} (expected 1..3)`);
    }
    this._skill = level;
  }

  /**
   * Move a control by name, as the probe's `--input name=value` does (V4).
   *
   * @param name `fire`, `lever` or `skill`.
   * @param value `lever` takes `up`/`centre`/`down` or `0`/`1`/`2`; `skill`
   *   takes `1`/`2`/`3`; `fire` takes `down`/`up`, `on`/`off`, `true`/`false`,
   *   or nothing at all, which presses it.
   */
  setControl(name: string, value?: string): void {
    switch (name) {
      case 'fire':
        this.setFire(parseFire(value));
        return;
      case 'lever':
        this.setLever(parseLever(value));
        return;
      case 'skill':
        this.setSkill(parseSkill(value));
        return;
      default:
        throw new RangeError(`unknown control: ${name} (expected fire, lever or skill)`);
    }
  }

  /** True when the contact on `strobePin` is closed. */
  isSwitchClosed(strobePin: number): boolean {
    if (strobePin === FIRE_STROBE_PIN) {
      return this._fire;
    }
    if (strobePin === LEVER_STROBE_PIN[this._lever]) {
      return true;
    }
    return strobePin === SKILL_STROBE_PIN[this._skill - 1];
  }

  /** Closed contacts as a bit mask over the strobe lines. */
  closedMask(): number {
    let mask = this._fire ? 1 << FIRE_STROBE_PIN : 0;
    mask |= 1 << LEVER_STROBE_PIN[this._lever];
    mask |= 1 << SKILL_STROBE_PIN[this._skill - 1];
    return mask;
  }

  /**
   * Level the ROM reads back on D15 while `strobeMask` is driven.
   *
   * 1 when any strobed line has a closed contact - several lines may be strobed
   * at once and the read is their OR, exactly as a diode matrix behaves.
   */
  read(strobeMask: number): 0 | 1 {
    return (strobeMask & STROBE_MASK & this.closedMask()) !== 0 ? 1 : 0;
  }

  /** Position of every control, for tests, the probe and debug UIs. */
  getState(): ControlState {
    return { fire: this._fire, lever: this._lever, skill: this._skill };
  }

  /**
   * Return the controls to their resting positions.
   *
   * Note this is *not* what the power switch does: throwing the power off does
   * not move the lever or the dial, so power.ts leaves the matrix alone.
   */
  reset(): void {
    this._fire = false;
    this._lever = DEFAULT_LEVER;
    this._skill = DEFAULT_SKILL;
  }
}

function parseFire(value?: string): boolean {
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

function parseLever(value?: string): LeverPosition {
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

function parseSkill(value?: string): SkillLevel {
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
