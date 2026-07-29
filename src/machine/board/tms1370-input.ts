// The case controls on the TMS1370's K port: two strobe columns and one line
// that bypasses them.
//
// Sources: MAME's `ginv` input ports, quoted in docs/research/tms1370-io.md
// section 1. The v2 machine's strobe assignment was this repository's own
// convention, adopted because seven contacts happened to match seven spare pins;
// the shape below is read off the driver for our own ROM mask:
//
//   PORT_START("IN.0") // R9   skill, one-hot on K1/K2/K4
//   PORT_START("IN.1") // R10  lever, up/centre/down on K1/K2/K4
//   PORT_START("IN.2") // K8   fire
//
// Three things follow, and they are the reason this is a separate model rather
// than the old matrix with different pin numbers:
//
// 1. **The skill switch is one-hot, not a binary code.** A three-position slide
//    switch closes exactly one of three contacts, so an intermediate or
//    bad-contact position reads as *no* skill bit set rather than as some other
//    skill. That is the answer to open question 2d, from the driver rather than
//    from a photograph of the lever.
// 2. **Centre is a real contact.** MAME asserts the lever's centre position
//    explicitly (`IPT_CUSTOM ... // joystick centered`) rather than leaving the
//    program to infer it from the absence of up and down. The driver header's
//    note that the stick is sticky and does not autocentre is the same fact from
//    the other side: the program is *told* centre.
// 3. **Fire is not on a column at all.** It is ORed into every K read, so it is
//    live whatever the scan loop is doing.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the board reads this matrix when the ROM samples K.

import {
  K1,
  K2,
  K4,
  K8,
  K_STROBED_MASK,
  STROBE_COLUMN_COUNT,
  type KInputSource,
} from '../cpu/tms1370/ports.js';
import type { ControlState, LeverPosition, SkillLevel } from './input.js';
import { DEFAULT_LEVER, DEFAULT_SKILL, parseFire, parseLever, parseSkill } from './input.js';

/** Strobe column carrying the skill switch: R9, column 0. */
export const SKILL_COLUMN = 0;

/** Strobe column carrying the lever: R10, column 1. */
export const LEVER_COLUMN = 1;

/** K line each lever position closes, indexed by lane: 0 = up, 2 = down. */
export const LEVER_K_LINE: readonly number[] = [K1, K2, K4];

/** K line each skill setting closes, indexed by `skill - 1`. */
export const SKILL_K_LINE: readonly number[] = [K1, K2, K4];

/** The fire button's K line, which no column selects. */
export const FIRE_K_LINE = K8;

/**
 * The case controls as the TMS1370 reads them.
 *
 * The lever and the dial are position switches: exactly one contact of each is
 * closed at all times, because a physical lever is always somewhere. Only the
 * fire button is momentary, and it rests open.
 *
 * Control positions are the same values ./input.ts uses, deliberately - the
 * `LeverPosition` and `SkillLevel` types, their defaults, and the probe's
 * `--input` vocabulary are properties of the case, not of the chip behind it,
 * and they do not move when the chip does.
 */
export class KInputMatrix implements KInputSource {
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
   * Move a control by name, as the probe's `--input name=value` does (V7).
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

  /**
   * K lines closed on one strobe column.
   *
   * Exactly one bit in each column, always: both controls are position switches
   * and a position switch is never between positions as far as this model is
   * concerned. K8 is never returned here - it is not on a column.
   */
  readColumn(column: number): number {
    if (!Number.isInteger(column) || column < 0 || column >= STROBE_COLUMN_COUNT) {
      throw new RangeError(
        `strobe column out of range: ${column} (expected 0..${STROBE_COLUMN_COUNT - 1})`,
      );
    }
    if (column === SKILL_COLUMN) {
      return SKILL_K_LINE[this._skill - 1]! & K_STROBED_MASK;
    }
    return LEVER_K_LINE[this._lever]! & K_STROBED_MASK;
  }

  /**
   * K lines closed regardless of the strobe: K8 while fire is held.
   *
   * This is the whole of the difference the unstrobed line makes. Everything
   * else in the case has to wait for its own column to come round; the button
   * is on the next K read the ROM executes, whichever column is up and even
   * when neither is.
   */
  readUnstrobed(): number {
    return this._fire ? FIRE_K_LINE : 0;
  }

  /** Position of every control, for tests, the probe and debug UIs. */
  getState(): ControlState {
    return { fire: this._fire, lever: this._lever, skill: this._skill };
  }

  /**
   * Return the controls to their resting positions.
   *
   * Note this is *not* what the power switch does: throwing the power off does
   * not move the lever or the dial.
   */
  reset(): void {
    this._fire = false;
    this._lever = DEFAULT_LEVER;
    this._skill = DEFAULT_SKILL;
  }
}
