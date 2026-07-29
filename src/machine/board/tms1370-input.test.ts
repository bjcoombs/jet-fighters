import { describe, it, expect } from 'vitest';

import {
  K1,
  K2,
  K4,
  K8,
  K_STROBED_MASK,
  R_STROBE_FIRST,
  STROBE_COLUMN_COUNT,
  Tms1370Ports,
} from '../cpu/tms1370/ports.js';
import { DEFAULT_LEVER, DEFAULT_SKILL, type LeverPosition, type SkillLevel } from './input.js';
import { KInputMatrix, LEVER_COLUMN, SKILL_COLUMN } from './tms1370-input.js';

/** Drive one strobe column and sample K, as the ROM's scan loop does. */
function readOn(ports: Tms1370Ports, matrix: KInputMatrix, column: number): number {
  ports.writeR(0);
  ports.setR(R_STROBE_FIRST + column);
  return ports.readK(matrix);
}

describe('KInputMatrix - resting state', () => {
  it('starts where the case controls rest', () => {
    const matrix = new KInputMatrix();
    expect(matrix.fire).toBe(false);
    expect(matrix.lever).toBe(DEFAULT_LEVER);
    expect(matrix.skill).toBe(DEFAULT_SKILL);
  });

  it('shares the case control vocabulary with the rest of the board', () => {
    // The lever positions and skill settings are properties of the case, not of
    // the chip behind it, so they are imported rather than restated. If they
    // ever diverge that is a change to the physical unit, and this stopped it
    // happening by accident while the chip was being swapped.
    const lever: LeverPosition = DEFAULT_LEVER;
    const skill: SkillLevel = DEFAULT_SKILL;
    const matrix = new KInputMatrix();
    matrix.setLever(lever);
    matrix.setSkill(skill);
    expect(matrix.getState()).toEqual({ fire: false, lever, skill });
  });

  it('rejects a lever or skill position the case does not have', () => {
    const matrix = new KInputMatrix();
    expect(() => matrix.setLever(3 as LeverPosition)).toThrow(RangeError);
    expect(() => matrix.setSkill(0 as SkillLevel)).toThrow(RangeError);
  });

  it('rejects a strobe column the chip does not have', () => {
    const matrix = new KInputMatrix();
    expect(() => matrix.readColumn(STROBE_COLUMN_COUNT)).toThrow(RangeError);
    expect(() => matrix.readColumn(-1)).toThrow(RangeError);
  });
});

describe('KInputMatrix - the two strobe columns', () => {
  it('returns the skill switch one-hot on R9', () => {
    // MAME's `ginv` port for R9 is three PORT_CONFSETTINGs at 0x01, 0x02 and
    // 0x04 - a three-position slide switch closing exactly one of three
    // contacts, not a two-bit code. So a bad contact reads as *no* skill bit
    // rather than as some other skill, which is the answer to open question 2d.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    const lines = new Map<SkillLevel, number>([
      [1, K1],
      [2, K2],
      [3, K4],
    ]);
    for (const [skill, line] of lines) {
      matrix.setSkill(skill);
      const k = readOn(ports, matrix, SKILL_COLUMN);
      expect(k, `skill ${skill}`).toBe(line);
      // One bit, never two: a binary encoding would light two lines at skill 3.
      expect(k & (k - 1), `skill ${skill} is one-hot`).toBe(0);
    }
  });

  it('returns the lever on R10, centre included as its own contact', () => {
    // MAME asserts centre explicitly (`IPT_CUSTOM ... // joystick centered`)
    // rather than leaving the program to infer it from left and right both
    // being open. The lever is told, not deduced.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    const lines = new Map<LeverPosition, number>([
      [0, K1],
      [1, K2],
      [2, K4],
    ]);
    for (const [lane, line] of lines) {
      matrix.setLever(lane);
      expect(readOn(ports, matrix, LEVER_COLUMN), `lane ${lane}`).toBe(line);
    }
  });

  it('never returns a K line the column it was asked about does not carry', () => {
    const matrix = new KInputMatrix();
    matrix.setFire(true);
    for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
      const lines = matrix.readColumn(column);
      expect(lines & K8, `column ${column} must not carry fire`).toBe(0);
      expect(lines & ~K_STROBED_MASK, `column ${column}`).toBe(0);
    }
  });

  it('keeps the skill switch and the lever on separate columns', () => {
    // The two columns are wired-ORed onto the same three K lines, so telling
    // them apart is entirely a matter of which column is up. Skill 3 and lever
    // down both close K4; only the column distinguishes them.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    matrix.setSkill(3);
    matrix.setLever(0);
    expect(readOn(ports, matrix, SKILL_COLUMN)).toBe(K4);
    expect(readOn(ports, matrix, LEVER_COLUMN)).toBe(K1);
  });
});

describe('KInputMatrix - fire on K8', () => {
  it('is readable while both strobe columns are low', () => {
    // Contract V7: "A passing test drives the fire contact while both strobe
    // columns are low and observes the program respond, proving K8 is read
    // unstrobed - a build routing fire through R9/R10 fails it."
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    matrix.setFire(true);

    ports.writeR(0);
    expect(ports.readInputMux(), 'both columns must be low').toBe(0);
    expect(ports.readK(matrix) & K8).toBe(K8);
  });

  it('is readable on the same cycle a grid is being strobed', () => {
    // The scan loop spends most of its time holding a grid up with neither
    // input column driven. On a strobed line that is the dead time a contact
    // waits through; on K8 there is none.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    matrix.setFire(true);
    for (let grid = 0; grid < 9; grid += 1) {
      ports.writeR(0);
      ports.setR(grid);
      expect(ports.readK(matrix) & K8, `during grid ${grid}`).toBe(K8);
    }
  });

  it('costs one K read to see, where a lever move costs up to one per column', () => {
    // The concrete consequence of K8 bypassing the mux, driven rather than
    // asserted from a constant. Both controls move between two K reads; the
    // scan happens to be sitting on the skill column, so the lever's new
    // position is not visible on the first read and fire is.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    ports.writeR(0);
    ports.setR(R_STROBE_FIRST + SKILL_COLUMN);

    matrix.setLever(2);
    matrix.setFire(true);

    const onSkillColumn = ports.readK(matrix);
    expect(onSkillColumn & K8, 'fire is on the very next read').toBe(K8);
    expect(onSkillColumn & K4, 'the lever is not, on this column').toBe(
      // Skill defaults to 1, which is K1, so nothing on K4 comes back here.
      0,
    );

    // The lever is seen only once the loop reaches its own column.
    expect(readOn(ports, matrix, LEVER_COLUMN) & K4).toBe(K4);
  });

  it('goes quiet the moment the button is released, with no latch to drain', () => {
    // There is no input latch and no edge detector anywhere on the input side:
    // a K read sees the pins at that instant. Debounce and edge detection are
    // the ROM's problem on this chip, and a model that held the press would
    // hide that.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    matrix.setFire(true);
    expect(ports.readK(matrix) & K8).toBe(K8);
    matrix.setFire(false);
    expect(ports.readK(matrix) & K8).toBe(0);
  });
});

describe('KInputMatrix - a whole sweep', () => {
  it('reads every control across one sweep without ever superimposing the columns', () => {
    // The scan loop as the ROM must write it, checked on both counts at once:
    // each control comes back correctly, and `strobeColumnsDriven` never
    // exceeds one at any point, including across the change from one column to
    // the next.
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    matrix.setSkill(2);
    matrix.setLever(2);
    matrix.setFire(true);

    let worst = 0;
    ports.onRChange = () => {
      worst = Math.max(worst, ports.strobeColumnsDriven());
    };

    const readings: number[] = [];
    for (let grid = 0; grid < 9; grid += 1) {
      ports.setR(grid);
      ports.resetR(grid);
    }
    for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
      ports.setR(R_STROBE_FIRST + column);
      readings.push(ports.readK(matrix));
      ports.resetR(R_STROBE_FIRST + column);
    }

    expect(worst).toBeLessThanOrEqual(1);
    expect(readings[SKILL_COLUMN]).toBe(K2 | K8);
    expect(readings[LEVER_COLUMN]).toBe(K4 | K8);
  });

  it('resets the controls to rest without touching the ports', () => {
    const ports = new Tms1370Ports();
    const matrix = new KInputMatrix();
    matrix.setFire(true);
    matrix.setLever(0);
    matrix.setSkill(3);
    ports.setR(R_STROBE_FIRST);

    matrix.reset();

    expect(matrix.getState()).toEqual({ fire: false, lever: DEFAULT_LEVER, skill: DEFAULT_SKILL });
    expect(ports.readInputMux(), 'the power switch does not move the lever').toBe(0b01);
    expect(ports.readK(matrix)).toBe(K1);
  });
});

describe('KInputMatrix - setControl', () => {
  it('presses fire with no value', () => {
    const input = new KInputMatrix();
    input.setControl('fire');
    expect(input.fire).toBe(true);
  });

  it('releases fire on an explicit value', () => {
    const input = new KInputMatrix();
    input.setFire(true);
    input.setControl('fire', 'off');
    expect(input.fire).toBe(false);
  });

  it.each([
    ['up', 0],
    ['centre', 1],
    ['down', 2],
  ])('moves the lever for %s', (value, lane) => {
    const input = new KInputMatrix();
    input.setControl('lever', value);
    expect(input.lever).toBe(lane);
  });

  it.each(['1', '2', '3'])('turns the dial to %s', (value) => {
    const input = new KInputMatrix();
    input.setControl('skill', value);
    expect(input.skill).toBe(Number(value));
  });

  it('rejects an unknown control', () => {
    const input = new KInputMatrix();
    expect(() => input.setControl('turbo')).toThrow(RangeError);
  });

  it('rejects a value the case cannot express', () => {
    const input = new KInputMatrix();
    expect(() => input.setControl('lever', 'sideways')).toThrow(RangeError);
    expect(() => input.setControl('skill', '4')).toThrow(RangeError);
    expect(() => input.setControl('fire', 'maybe')).toThrow(RangeError);
  });
});
