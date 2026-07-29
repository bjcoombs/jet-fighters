import { describe, it, expect } from 'vitest';
import { encodeInstruction, Mnemonic } from '../cpu/tms1370/isa.js';
import { K1, K2, K8, O_PLATE_COUNT, R_PLATE_FIRST, R_SPEAKER } from '../cpu/tms1370/ports.js';
import { pcForOrdinal, ROM_WORD_COUNT } from '../cpu/tms1370/registers.js';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { Board, type MachineImage } from './board.js';
import { GRID_COUNT } from './display.js';
import type { SegmentDuty } from './pwm.js';

const op = encodeInstruction;

/**
 * Lay a word list onto the reset page at its LFSR offsets.
 *
 * The program counter is a 6-bit LFSR, so the instruction *after* the one at
 * offset n is not at offset n + 1. `pcForOrdinal` is the map from "nth
 * instruction executed" to "physical word", and every test ROM here is written
 * in execution order and placed through it - which is exactly what the assembler
 * does for the real program.
 */
function place(words: number[]): Uint8Array {
  const image = new Uint8Array(ROM_WORD_COUNT);
  // The reset page is the last page of chapter 0, and every ROM below lives on
  // it: the core enters there and none of these programs leaves the page.
  const base = 15 * 64;
  words.forEach((word, ordinal) => {
    image[base + pcForOrdinal(ordinal)] = word;
  });
  return image;
}

/**
 * An output PLA whose slot n drives plate mask `masks[n]`.
 *
 * Slot 0 stays dark whatever a caller passes, because reset writes index 0 and a
 * machine that lit the tube before its program had chosen a pattern would be
 * flashing whatever the table happened to hold.
 */
function opla(masks: Record<number, number>): Uint8Array {
  const table = new Uint8Array(32);
  for (const [index, mask] of Object.entries(masks)) {
    table[Number(index)] = mask;
  }
  table[0] = 0;
  return table;
}

/** Strobe grid `g`: select it on Y, raise the line, drop it. Three instructions. */
function strobe(grid: number): number[] {
  return [op(Mnemonic.TCY, grid), op(Mnemonic.SETR), op(Mnemonic.RSTR)];
}

/** Instructions each grid of a sweep costs: TCY, SETR, RSTR. */
const GRID_INSTRUCTIONS = 3;

/** Instructions a grid line stays high: SETR at n, RSTR at n + 1. */
const GRID_DWELL_CYCLES = 1;

/**
 * A master loop in the shape the real ROM uses: choose a plate pattern through
 * the output PLA, then strobe each of the nine grids in turn, then start over.
 *
 * @param plates the PLA slot the pattern is taken from. `TDO` writes
 *   `statusLatch:A`, and the status latch is clear out of reset, so loading A
 *   with the slot number selects it.
 */
function sweepRom(plates = 1): number[] {
  const words = [op(Mnemonic.CLA), op(Mnemonic.ANAAC, plates), op(Mnemonic.TDO)];
  for (let grid = 0; grid < GRID_COUNT; grid += 1) {
    words.push(...strobe(grid));
  }
  words.push(op(Mnemonic.BR, pcForOrdinal(SWEEP_FIRST_ORDINAL)));
  return words;
}

/** Ordinal the sweep loop branches back to - past the one-off PLA selection. */
const SWEEP_FIRST_ORDINAL = 3;

/** Cycles one pass of `sweepRom` costs: nine grids of three, plus the branch. */
const SWEEP_CYCLES = GRID_COUNT * GRID_INSTRUCTIONS + 1;

/** The plate masks `sweepRom`'s slots drive. */
const SWEEP_PLA = opla({ 1: 0b0101, 2: 0b0001 });

function sweepBoard(plates = 1, options?: { power?: 'on' | 'off' }): Board {
  return new Board({ rom: place(sweepRom(plates)), opla: SWEEP_PLA }, options);
}

/**
 * A sweep whose plate pattern *is* what the K port returned.
 *
 * `TDO` writes `statusLatch:A` and `TKA` puts K into A, so with the status latch
 * clear the O index is the K nibble itself. The lever's contact therefore picks
 * the plate pattern, and it does so the only way a control can reach this
 * machine: the program drives a strobe column, samples K, and acts on what came
 * back.
 */
function inputRom(): number[] {
  const words = [
    op(Mnemonic.TCY, 10), // R10 - the lever's strobe column
    op(Mnemonic.SETR),
    op(Mnemonic.TKA), // A = K: K1 lever up, K2 centre, K4 down, K8 fire
    op(Mnemonic.TDO), // O index = the contacts that answered
    op(Mnemonic.RSTR), // R10 back down, so the columns never superimpose
  ];
  for (let grid = 0; grid < GRID_COUNT; grid += 1) {
    words.push(...strobe(grid));
  }
  words.push(op(Mnemonic.BR, pcForOrdinal(0)));
  return words;
}

/**
 * Plate patterns for `inputRom`, indexed by the K nibble the lever returns.
 *
 * One plate at centre and two with the lever up, so moving it changes what is on
 * the glass and a test can tell the two apart by counting segments.
 */
const INPUT_PLA = opla({
  [K1]: 0b0011,
  [K2]: 0b0001,
  [K1 | K8]: 0b0111,
  [K2 | K8]: 0b0101,
});

function inputBoard(): Board {
  return new Board({ rom: place(inputRom()), opla: INPUT_PLA });
}

/** A loop that toggles R15, as the ROM's bit-banged delay loops do. */
function beeperRom(): number[] {
  return [
    op(Mnemonic.TCY, R_SPEAKER),
    op(Mnemonic.SETR),
    op(Mnemonic.CLA),
    op(Mnemonic.RSTR),
    op(Mnemonic.CLA),
    op(Mnemonic.BR, pcForOrdinal(1)),
  ];
}

function beeperBoard(): Board {
  return new Board({ rom: place(beeperRom()), opla: opla({}) });
}

/** Sorted `grid:plate` keys of a segment list, for set comparison. */
function segmentKeys(segments: readonly SegmentDuty[]): string[] {
  return segments.map((s) => `${s.grid}:${s.plate}`).sort();
}

describe('Board - construction', () => {
  it('comes up powered, running and dark', () => {
    const board = sweepBoard();
    expect(board.running).toBe(true);
    expect(board.cycles).toBe(0);
    expect(board.getLitSegments()).toEqual([]);
    expect(board.power.state).toBe('on');
  });

  it('can be built with the switch off', () => {
    const board = sweepBoard(1, { power: 'off' });
    expect(board.running).toBe(false);
    expect(board.step(1000)).toBe(0);
    expect(board.cycles).toBe(0);
  });

  it('accepts an image shorter than the ROM, and fills the rest', () => {
    const image: MachineImage = { rom: new Uint8Array(16), opla: new Uint8Array(0) };
    expect(() => new Board(image)).not.toThrow();
  });
});

describe('Board - the CPU drives the tube', () => {
  it('lights segments where the ROM strobes a grid against driven plates', () => {
    const board = sweepBoard(1);
    board.step(SWEEP_CYCLES * 3);

    const lit = board.getLitSegments();
    expect(lit.length).toBeGreaterThan(0);
    for (const segment of lit) {
      expect([0, 2]).toContain(segment.plate);
    }
  });

  it('sweeps every grid the board scans (contract V5)', () => {
    // Built from `GRID_COUNT` rather than typed out as `[0..8]`. Criterion V14
    // requires `getStrobedGrids` to be compared against the count and never
    // against a literal list: a written-out grid list is an assumption about how
    // many grids there are that survives a re-addressing without saying so.
    const board = sweepBoard();
    board.step(SWEEP_CYCLES * 2);
    expect(board.getStrobedGrids()).toEqual(
      Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
    );
  });

  it('accumulates a duty strictly between 0 and 1 (contract V5)', () => {
    const board = sweepBoard();
    board.step(SWEEP_CYCLES * 3);

    const fractional = board.getLitSegments().filter((s) => s.duty > 0 && s.duty < 1);
    expect(fractional.length).toBeGreaterThan(0);
  });

  it('gives each grid its measured share of the sweep, not a binary on', () => {
    const board = sweepBoard(2);
    board.runFrames(3);

    const frame = board.getFrame();
    expect(frame.cycles).toBe(SWEEP_CYCLES);
    expect(frame.segments).toHaveLength(GRID_COUNT);
    for (const segment of frame.segments) {
      expect(segment.activeCycles).toBe(GRID_DWELL_CYCLES);
      expect(segment.duty).toBeCloseTo(GRID_DWELL_CYCLES / SWEEP_CYCLES, 12);
    }
  });

  it('closes the frame when the sweep wraps, not when a grid repeats', () => {
    const board = sweepBoard();
    board.runFrames(1);
    const first = board.getFrame().endCycle;
    board.runFrames(1);

    expect(board.getFrame().startCycle).toBe(first);
    expect(board.getFrame().cycles).toBe(SWEEP_CYCLES);
  });

  it('advances no further than asked, plus at most one instruction', () => {
    const board = sweepBoard();
    const executed = board.step(50);
    expect(executed).toBeGreaterThanOrEqual(50);
    expect(executed).toBeLessThanOrEqual(51);
    expect(board.cycles).toBe(executed);
  });

  it('executes one instruction at a time on demand', () => {
    const board = sweepBoard();
    expect(board.stepInstruction()).toBe(1);
    expect(board.cycles).toBe(1);
  });

  it('reports a live sample before the first sweep has wrapped', () => {
    const board = sweepBoard();
    board.step(6);

    expect(board.display.frameCount).toBe(0);
    expect(board.getLitSegments().length).toBeGreaterThan(0);
  });

  it('drives plates 0-7 from the O port and 8-11 from R11-R14 (contract V4)', () => {
    // The one place the split is applied. A build wiring all twelve plates to a
    // widened O port is a TMS1370 in name only, and the core's 5-bit index
    // conjunct does not reach it: the output PLA governs eight lines and no
    // more, so the high four have to come from somewhere else or not at all.
    const words = [
      op(Mnemonic.CLA),
      op(Mnemonic.ANAAC, 1),
      op(Mnemonic.TDO), // plates 0 and 2, from the O port
      op(Mnemonic.TCY, R_PLATE_FIRST),
      op(Mnemonic.SETR), // plate 8, from R11
      op(Mnemonic.TCY, 0),
      op(Mnemonic.SETR), // grid 0 up, with all three plates driven
      op(Mnemonic.RSTR),
      op(Mnemonic.BR, pcForOrdinal(5)),
    ];
    const board = new Board({ rom: place(words), opla: SWEEP_PLA });
    board.step(20);

    const plates = new Set(board.getLitSegments().map((segment) => segment.plate));
    // R11 is the first plate past the O port's eight, which is plate 8.
    expect(plates).toEqual(new Set([0, 2, O_PLATE_COUNT]));
  });
});

describe('Board - input through the K matrix (contract V7)', () => {
  it('changes the displayed segments when the lever moves', () => {
    const board = inputBoard();
    board.runFrames(3);
    const before = segmentKeys(board.getFrame().segments);

    board.setLever(0);
    board.runFrames(3);
    const after = segmentKeys(board.getFrame().segments);

    expect(before).not.toEqual(after);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('reaches the ROM only when the ROM samples K', () => {
    // The board never writes machine state: the lever's position is observable
    // to the program only as a level on the K lines while its column is driven,
    // so moving it changes nothing until the program looks.
    const board = inputBoard();
    board.runFrames(3);
    const before = segmentKeys(board.getFrame().segments);

    board.setLever(0);
    expect(segmentKeys(board.getFrame().segments)).toEqual(before);
  });

  it('never drives both strobe columns at once (contract V7)', () => {
    // `read_inputs` is a wired-OR over the driven columns, so with both up the
    // skill switch and the lever arrive superimposed on the same three K lines
    // and the program cannot tell them apart.
    const board = inputBoard();
    board.runFrames(4);
    expect(board.superimposedStrobes).toEqual([]);
  });

  it('reads the fire button unstrobed, past the columns entirely', () => {
    // K8 is ORed into every K sample whatever R9 and R10 are doing, which is the
    // whole practical consequence of it not being on a column: fire is the one
    // control whose latency does not depend on where the scan loop is.
    const board = inputBoard();
    board.runFrames(3);
    const before = segmentKeys(board.getFrame().segments);

    board.setFire(true);
    board.runFrames(3);
    expect(segmentKeys(board.getFrame().segments)).not.toEqual(before);
  });

  it('moves controls by name, as the probe spec does', () => {
    const board = sweepBoard();
    board.setControl('skill', '3');
    board.setControl('lever', 'down');
    board.setControl('fire');

    expect(board.getState().controls).toEqual({ fire: true, lever: 2, skill: 3 });
  });
});

describe('Board - the speaker pin (contract V8)', () => {
  it('captures R15 transitions with their cycle timestamps', () => {
    const board = beeperBoard();
    board.step(24);

    const edges = board.speaker.edges;
    expect(edges.length).toBeGreaterThan(3);
    expect(edges[0]).toEqual({ cycle: 1, level: 1 });
    expect(edges[1]).toEqual({ cycle: 3, level: 0 });
    expect(edges[2]).toEqual({ cycle: 6, level: 1 });
  });

  it('alternates levels, so the stream reconstructs a square wave', () => {
    const board = beeperBoard();
    board.step(60);

    const levels = board.speaker.edges.map((edge) => edge.level);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).not.toBe(levels[i - 1]);
    }
  });

  it('timestamps rise monotonically with emulated time', () => {
    const board = beeperBoard();
    board.step(120);

    const cycles = board.speaker.edges.map((edge) => edge.cycle);
    for (let i = 1; i < cycles.length; i += 1) {
      expect(cycles[i]).toBeGreaterThan(cycles[i - 1]);
    }
    expect(cycles[cycles.length - 1]).toBeLessThanOrEqual(board.cycles);
  });

  it('drains the edge stream for the audio layer', () => {
    const board = beeperBoard();
    board.step(24);

    const taken = board.takeSpeakerEdges();
    expect(taken.length).toBeGreaterThan(0);
    expect(board.speaker.edgeCount).toBe(0);

    board.step(24);
    expect(board.speaker.edgeCount).toBeGreaterThan(0);
  });

  it('stays silent while the ROM never touches the pin', () => {
    const board = sweepBoard();
    board.step(SWEEP_CYCLES * 4);
    expect(board.speaker.edgeCount).toBe(0);
    expect(board.speaker.level).toBe(0);
  });

  it('keeps the speaker off the display, though both are R latches', () => {
    // R15 is a bit of the same latch the grids come from, so a board that
    // handed every R transition to the tube would light a tenth grid every time
    // the ROM made a sound.
    const board = beeperBoard();
    board.step(60);
    expect(board.getStrobedGrids()).toEqual([]);
  });
});

describe('Board - power', () => {
  it('stops the machine and blanks the tube when switched off', () => {
    const board = sweepBoard();
    board.runFrames(2);

    board.powerOff();
    expect(board.running).toBe(false);
    expect(board.step(1000)).toBe(0);
    expect(board.getLitSegments()).toEqual([]);
    expect(board.display.getStrobedGrids()).toEqual([]);
  });

  it('restarts the ROM from the top when power cycled', () => {
    const board = sweepBoard();
    board.runFrames(2);
    const before = board.getFrame().segments.length;

    board.powerCycle();
    expect(board.cycles).toBe(0);
    expect(board.display.frameCount).toBe(0);

    board.runFrames(2);
    expect(board.getFrame().segments).toHaveLength(before);
  });

  it('invalidates RAM on power-on - the only reset the machine has', () => {
    const board = sweepBoard();
    board.cpu.ram.write(0, 0, 0xf);
    board.powerCycle();
    expect(board.cpu.ram.read(0, 0)).not.toBe(0xf);
  });

  it('keeps the controls where the player left them across a power cycle', () => {
    const board = sweepBoard();
    board.setSkill(3);
    board.setLever(2);
    board.powerCycle();

    expect(board.getState().controls).toMatchObject({ skill: 3, lever: 2 });
  });

  it('forgets the pin state, so a reset leaves no plate driven', () => {
    const board = inputBoard();
    board.runFrames(3);
    expect(board.getFrame().segments.length).toBeGreaterThan(0);

    board.powerOff();
    expect(board.display.plateMask).toBe(0);
    expect(board.superimposedStrobes).toEqual([]);
  });
});

describe('Board - observable state', () => {
  it('snapshots the whole machine in one object', () => {
    const board = sweepBoard();
    board.runFrames(2);

    const state = board.getState();
    expect(state.power).toBe('on');
    expect(state.running).toBe(true);
    expect(state.cycles).toBe(board.cycles);
    expect(state.elapsedTime).toBeCloseTo(board.cycles / CYCLE_HZ, 12);
    expect(state.display.gridsStrobed).toHaveLength(GRID_COUNT);
    expect(state.display.frame.segments.length).toBeGreaterThan(0);
    expect(state.controls).toEqual({ fire: false, lever: 1, skill: 1 });
    expect(state.speakerLevel).toBe(0);
    expect(state.speakerEdges).toBe(0);
  });

  it('exposes the full core state for the probe', () => {
    const board = sweepBoard();
    board.step(10);

    const cpu = board.getCPUState();
    expect(cpu.cycles).toBe(board.cycles);
    expect(cpu.registers.romAddress).toBe(board.cpu.romAddress);
    expect(cpu.lastOpcode).not.toBeNull();
  });

  it('bounds runFrames by its cycle budget when no sweep arrives', () => {
    const board = new Board({
      rom: place([op(Mnemonic.CLA), op(Mnemonic.BR, pcForOrdinal(0))]),
      opla: opla({}),
    });
    const executed = board.runFrames(1, 100);
    expect(executed).toBeGreaterThanOrEqual(100);
    expect(board.display.frameCount).toBe(0);
  });

  it('gives up on runFrames the moment the machine is unpowered', () => {
    const board = sweepBoard(1, { power: 'off' });
    expect(board.runFrames(1)).toBe(0);
  });
});
