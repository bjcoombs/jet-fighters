// Where does a plane enter, and what decides it?
//
// Paths in this file are relative to the repository root.
//
// ## The rule
//
// `jet_enter` (P_SPAWN) draws an entry position from two things:
//
//   - the **row** from `(NIB_J_SENT + 1 + NIB_ENT) mod 3`. `NIB_J_SENT` is the
//     wave's release count, so it steps by one per entry and supplies the
//     rotation; `NIB_ENT` is the entropy nibble and supplies the offset.
//   - the **column** from the entropy nibble's top bit: `GRID_COL_FIRST` or one
//     grid nearer. The far half of a five-column field, and never the capture
//     line - `asm/jetfighter.asm` records why an entry column is a life
//     expectancy.
//
// ## Two things have to hold together, and they pull in opposite directions
//
// The same tension `entropy-nibble.test.ts` records about the source, now about
// what the source is used for:
//
//   - **Entries have to vary.** A machine that releases every plane at the same
//     cell plays the same game every time, and the reference photograph
//     `assets/reference/device-front-gameplay.jpg` - two jets airborne at
//     different distances - is not a picture it can produce except briefly after
//     a kill.
//   - **The emulation has to stay deterministic.** The entropy is the player's
//     own rhythm, not a random source. Two runs of one input schedule must give
//     the same sequence of entry positions, or every other probe in this
//     directory stops being reproducible.
//
// ## And one that only shows up when nobody plays
//
// `NIB_ENT` is 0 out of the power-on clear and moves only when the fire contact
// closes. So the third test below is about the machine nobody has touched: it
// has to release every plane at the far end, which is where every plane entered
// before this routine drew for it. A first draft had that polarity backwards and
// gave the quietest player the shortest game.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect, vi } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, assembleGame, slotsOf, type Plane } from './tms1370-probe.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const SQUADRON = {
  base: symbol('FILE_JETS') * 16 + symbol('NIB_P_BASE'),
  stride: symbol('PLANE_STRIDE'),
  count: symbol('PLANE_COUNT'),
};
const STATE = symbol('FILE_STATE') * 16 + symbol('NIB_STATE');
const GRID_COL_FIRST = symbol('GRID_COL_FIRST');
const GRID_COL_LAST = symbol('GRID_COL_LAST');

/** Sampling interval. A march step is 32 sweeps at its fastest, far coarser. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/** Emulated seconds one drive plays. A sampling window, not a stop horizon. */
const DRIVE_SECONDS = 90;

/** Wall-clock allowance. Every bound that means anything is in cycles. */
vi.setConfig({ testTimeout: 120_000 });

interface Entry {
  readonly row: number;
  readonly column: number;
}

/**
 * Play one game and record every entry position, in order.
 *
 * An entry is a slot that held nothing and now holds a plane. The lever walks
 * the three lanes and fire is pressed once a block, which is a player with a
 * rhythm rather than a player with a plan - and the rhythm is the whole input to
 * the rule under test.
 */
function entriesOf(block: number): readonly Entry[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const entries: Entry[] = [];
  let previous = slotsOf(machine.ram, SQUADRON);
  const until = DRIVE_SECONDS * CYCLE_HZ;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    const within = tick % block;
    machine.setContacts({
      lane: (Math.floor(tick / block) % 3) as 0 | 1 | 2,
      fire: within >= block / 2 && within < block / 2 + 5,
    });
    machine.step(SAMPLE_CYCLES);
    const ram = machine.ram;
    if ((ram[STATE] as number) !== 0) break;
    const slots = slotsOf(ram, SQUADRON);
    for (let slot = 0; slot < slots.length; slot += 1) {
      const now = slots[slot] as Plane;
      if ((previous[slot] as Plane).column === 0 && now.column !== 0) {
        entries.push({ row: now.row, column: now.column });
      }
    }
    previous = slots;
  }
  return entries;
}

/** Play with the fire contact never closed, and record the same thing. */
function unattendedEntries(): readonly Entry[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const entries: Entry[] = [];
  let previous = slotsOf(machine.ram, SQUADRON);
  const until = DRIVE_SECONDS * CYCLE_HZ;
  while (machine.cycles < until) {
    machine.step(SAMPLE_CYCLES);
    const ram = machine.ram;
    if ((ram[STATE] as number) !== 0) break;
    const slots = slotsOf(ram, SQUADRON);
    for (let slot = 0; slot < slots.length; slot += 1) {
      const now = slots[slot] as Plane;
      if ((previous[slot] as Plane).column === 0 && now.column !== 0) {
        entries.push({ row: now.row, column: now.column });
      }
    }
    previous = slots;
  }
  return entries;
}

/** Firing rhythms to pool over. One rhythm fixes one phase, and one answer. */
const BLOCKS = [45, 50, 60, 70, 85] as const;

const POOLED: readonly Entry[] = BLOCKS.flatMap((block) => entriesOf(block));

/**
 * Every sample in which both planes were airborne, as the gap between their
 * columns.
 *
 * This is the fidelity measurement the entry position exists to move.
 * `assets/reference/device-front-gameplay.jpg` shows two jets airborne at
 * different distances, and a ROM that released both at the far column could
 * barely produce it: the entry countdown is 664 ms against a march step of up to
 * 2195 ms, so the pair usually filled both slots between two march steps and
 * then advanced together for the rest of their lives. Measured on that ROM, the
 * gap was zero 66% of the time and never once exceeded one.
 */
function gapsOf(block: number): readonly number[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 0, fire: false });
  const gaps: number[] = [];
  const until = DRIVE_SECONDS * CYCLE_HZ;
  for (let tick = 0; machine.cycles < until; tick += 1) {
    const within = tick % block;
    machine.setContacts({
      lane: (Math.floor(tick / block) % 3) as 0 | 1 | 2,
      fire: within >= block / 2 && within < block / 2 + 5,
    });
    machine.step(SAMPLE_CYCLES);
    const ram = machine.ram;
    if ((ram[STATE] as number) !== 0) break;
    const flying = slotsOf(ram, SQUADRON).filter((plane) => plane.column !== 0);
    if (flying.length === 2) {
      const [left, right] = flying as [Plane, Plane];
      gaps.push(Math.abs(left.column - right.column));
    }
  }
  return gaps;
}

const GAPS: readonly number[] = BLOCKS.flatMap((block) => gapsOf(block));

describe("a plane enters at a position the player's rhythm decides", () => {
  it('produced entries at all, or nothing below means anything', () => {
    expect(POOLED.length, 'no plane entered in any of the drives').toBeGreaterThan(50);
  });

  it('enters in all three rows', () => {
    const rows = [...new Set(POOLED.map((entry) => entry.row))].sort();
    expect(rows, 'the squadron never entered in every row').toEqual([0, 1, 2]);
  });

  it('enters at more than one column, so not every plane starts at the far end', () => {
    // The assertion the task turns on. Before `jet_enter` drew for it, this list
    // was `[GRID_COL_FIRST]` for every drive ever run.
    const columns = [...new Set(POOLED.map((entry) => entry.column))].sort((a, b) => a - b);
    expect(
      columns.length,
      `every plane entered at column ${columns[0]}, so the entry position is still a constant`,
    ).toBeGreaterThan(1);
    expect(columns, 'entries reached a column the far half does not contain').toEqual([
      GRID_COL_FIRST,
      GRID_COL_FIRST + 1,
    ]);
  });

  it('never enters at the capture line, or anywhere it could not be shot at', () => {
    // An entry column is a life expectancy: a plane marches one grid closer per
    // step and is captured on the step past `GRID_COL_LAST`, so a plane entering
    // there would take a launcher almost at once. The far half is the judgement
    // recorded at `jet_enter`; what is asserted here is the half of it that is
    // not a matter of taste.
    const nearest = Math.max(...POOLED.map((entry) => entry.column));
    expect(nearest, 'a plane entered in the near half of the field').toBeLessThan(
      (GRID_COL_FIRST + GRID_COL_LAST) / 2,
    );
  });

  it('reaches every cell of the entry region, not two of the six', () => {
    // Non-vacuity for the pair of them together. Rows varying and columns
    // varying, separately, is satisfied by a rule that pairs them - three rows
    // and two columns give six cells and all six have to be reachable, or the
    // row and the column are not independent draws.
    const cells = new Set(POOLED.map((entry) => `${entry.row},${entry.column}`));
    expect(cells.size, `entries reached only ${cells.size} of the six entry cells`).toBe(6);
  });

  it('breaks the squadron out of lockstep, which is what the photograph shows', () => {
    // Both are shapes rather than thresholds: the exact share moves with every
    // cadence constant, and `tools/probe/drives/entry-spread.ts` is where the
    // figure is re-derived. Measured there, over the same five rhythms:
    //
    // | ROM | gap 0 | gap 1 | gap 2 |
    // | --- | --- | --- | --- |
    // | one entry column, rotor row | 66.0% | 34.0% | never |
    // | one entry column, drawn row | 48.7% | 50.7% | 0.6% |
    // | drawn row and column | 41.7% | 50.1% | 8.1% |
    //
    // **Most of the break comes from the row, which is not where it was expected
    // to come from**, and the middle line is a negative control that says so: a
    // build with the column draw reverted still clears the first assertion.
    // Drawing the row moves the squadron out of the lever's way differently, so
    // captures and kills land on different planes and the pair stops being
    // filled two-at-a-time. The column draw is what the assertion below is armed
    // against, and what the two tests above cover directly.
    expect(GAPS.length, 'the two slots were rarely both full').toBeGreaterThan(1_000);
    const lockstep = GAPS.filter((gap) => gap === 0).length / GAPS.length;
    expect(
      lockstep,
      `the two planes stood on one column ${(100 * lockstep).toFixed(1)}% of the time, ` +
        'which is the lockstep a single entry column produced',
    ).toBeLessThan(0.5);
    expect(
      GAPS.filter((gap) => gap > 1).length,
      'the two planes were never more than one grid apart, which is what a ' +
        'squadron entering at one column and marching on one countdown does',
    ).toBeGreaterThan(0);
  });

  it('is deterministic: one input schedule gives one sequence of entries', () => {
    // **The one that matters.** The entropy is the player's rhythm and not a
    // random source, and `CLAUDE.md` requires the same drive to produce the same
    // run - that is what makes every other probe in this directory reproducible.
    // Compared as the whole ordered sequence rather than as a set, so a rule
    // that reached the same positions in a different order still fails.
    const first = entriesOf(60);
    const second = entriesOf(60);
    expect(second).toEqual(first);
    expect(first.length, 'the schedule produced no entries to compare').toBeGreaterThan(10);
    // ...and a *different* schedule has to give a different sequence, or the
    // equality above is satisfied by a rule that ignores the player entirely -
    // which is what the whole file exists to rule out.
    expect(
      entriesOf(45),
      'two different press rhythms produced the same entry sequence',
    ).not.toEqual(first);
  });

  it('releases every plane at the far end when nobody has touched the fire button', () => {
    // `NIB_ENT` is 0 out of the power-on clear and the fire contact is the only
    // thing that moves it, so an untouched machine has to play the game it
    // always played. Getting this backwards gave the quietest player the
    // shortest game, and put the three parked-lever runs behind contract
    // criterion V7 on a machine their ROM never was.
    const entries = unattendedEntries();
    expect(entries.length, 'the unattended machine released no planes').toBeGreaterThan(5);
    expect(
      [...new Set(entries.map((entry) => entry.column))],
      'an unstirred entropy nibble released a plane somewhere other than the far end',
    ).toEqual([GRID_COL_FIRST]);
    // And the rows still walk, because the rotation is the release count and
    // does not need the player at all.
    expect(
      [...new Set(entries.map((entry) => entry.row))].sort(),
      'the unattended machine put every plane in one row',
    ).toEqual([0, 1, 2]);
  });
});
