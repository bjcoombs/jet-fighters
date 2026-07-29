import { describe, it, expect } from 'vitest';
import { encode, encodeLong } from '../cpu/decoder.js';
import { InstructionType } from '../cpu/instruction.js';
import { D_INPUT, D_SPEAKER } from '../cpu/ports.js';
import { Board } from './board.js';
import { GRID_COUNT } from './display.js';
import type { SegmentDuty } from './pwm.js';

/** Assemble a word list into a program-region ROM image. */
function rom(words: number[]): Uint16Array {
  const image = new Uint16Array(2048);
  image.set(words);
  return image;
}

/**
 * A master loop in the shape the real ROM uses: put a plate pattern on R0, then
 * strobe each of the ten grids in turn, then start over.
 *
 * @param plates the four-bit pattern driven on R0-R3.
 * @param dwell NOPs each grid is held for.
 */
function sweepRom(plates = 0b0101, dwell = 1): Uint16Array {
  const words = [encode(InstructionType.LAI, plates), encode(InstructionType.LRA, 0)];
  for (let grid = 0; grid < GRID_COUNT; grid += 1) {
    words.push(encode(InstructionType.SED, grid));
    for (let i = 0; i < dwell; i += 1) {
      words.push(encode(InstructionType.NOP));
    }
    words.push(encode(InstructionType.RED, grid));
  }
  words.push(...encodeLong(InstructionType.JMPL, 0));
  return rom(words);
}

/** Cycles one pass of `sweepRom` costs: two setup, three per grid, two to jump. */
const SWEEP_CYCLES = 2 + GRID_COUNT * 3 + 2;

/** Cycles each grid of `sweepRom` is held: SED, one NOP, then RED. */
const GRID_DWELL_CYCLES = 2;

/**
 * A loop that reads the lever-up contact through the matrix and lights a second
 * plate when it is closed.
 *
 * Fits inside ROM page 0 so the in-page branches reach their targets.
 */
function inputRom(): Uint16Array {
  return rom([
    /* 0 */ encode(InstructionType.LAI, 0b0001),
    /* 1 */ encode(InstructionType.SED, D_INPUT), // release the read line
    /* 2 */ encode(InstructionType.SED, 1), // strobe the lever-up contact
    /* 3 */ encode(InstructionType.TD, D_INPUT), // ST = is it closed?
    /* 4 */ encode(InstructionType.BR, 6), // taken only when it is
    /* 5 */ encode(InstructionType.BR, 7), // ST is back to 1: unconditional
    /* 6 */ encode(InstructionType.LAI, 0b0011),
    /* 7 */ encode(InstructionType.RED, 1),
    /* 8 */ encode(InstructionType.LRA, 0),
    /* 9 */ encode(InstructionType.SED, 0),
    /* 10 */ encode(InstructionType.NOP),
    /* 11 */ encode(InstructionType.RED, 0),
    /* 12 */ encode(InstructionType.SED, 2),
    /* 13 */ encode(InstructionType.NOP),
    /* 14 */ encode(InstructionType.RED, 2),
    /* 15 */ ...encodeLong(InstructionType.JMPL, 0),
  ]);
}

/** A loop that toggles the speaker pin every two cycles, as a delay loop does. */
function beeperRom(): Uint16Array {
  return rom([
    encode(InstructionType.SED, D_SPEAKER),
    encode(InstructionType.NOP),
    encode(InstructionType.RED, D_SPEAKER),
    encode(InstructionType.NOP),
    ...encodeLong(InstructionType.JMPL, 0),
  ]);
}

/** Sorted `grid:plate` keys of a segment list, for set comparison. */
function segmentKeys(segments: readonly SegmentDuty[]): string[] {
  return segments.map((s) => `${s.grid}:${s.plate}`).sort();
}

describe('Board - construction', () => {
  it('comes up powered, running and dark', () => {
    const board = new Board(sweepRom());
    expect(board.running).toBe(true);
    expect(board.cycles).toBe(0);
    expect(board.getLitSegments()).toEqual([]);
    expect(board.power.state).toBe('on');
  });

  it('can be built with the switch off', () => {
    const board = new Board(sweepRom(), { power: 'off' });
    expect(board.running).toBe(false);
    expect(board.step(1000)).toBe(0);
    expect(board.cycles).toBe(0);
  });

  it('accepts a program-region image without a pattern region', () => {
    expect(() => new Board(new Uint16Array(2048))).not.toThrow();
  });
});

describe('Board - the CPU drives the tube', () => {
  it('lights segments where the ROM strobes a grid against driven plates', () => {
    const board = new Board(sweepRom(0b0101));
    board.step(SWEEP_CYCLES * 3);

    const lit = board.getLitSegments();
    expect(lit.length).toBeGreaterThan(0);
    for (const segment of lit) {
      expect([0, 2]).toContain(segment.plate);
    }
  });

  it('sweeps every grid the board scans (contract V3)', () => {
    // Built from `GRID_COUNT` rather than typed out as `[0..9]`. Criterion V14
    // requires `getStrobedGrids` to be compared against the count and never
    // against a literal list: a written-out ten-grid list is an assumption that
    // survives a re-addressing without saying so, and how many grids this board
    // scans is exactly the thing v3 task 11.3 changes.
    const board = new Board(sweepRom());
    board.step(SWEEP_CYCLES * 2);
    expect(board.getStrobedGrids()).toEqual(
      Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
    );
  });

  it('accumulates a duty strictly between 0 and 1 (contract V3)', () => {
    const board = new Board(sweepRom());
    board.step(SWEEP_CYCLES * 3);

    const fractional = board.getLitSegments().filter((s) => s.duty > 0 && s.duty < 1);
    expect(fractional.length).toBeGreaterThan(0);
  });

  it('gives each grid its measured share of the sweep, not a binary on', () => {
    const board = new Board(sweepRom(0b0001));
    board.runFrames(3);

    const frame = board.getFrame();
    expect(frame.cycles).toBe(SWEEP_CYCLES);
    expect(frame.segments).toHaveLength(GRID_COUNT);
    for (const segment of frame.segments) {
      expect(segment.activeCycles).toBe(GRID_DWELL_CYCLES);
      expect(segment.duty).toBeCloseTo(GRID_DWELL_CYCLES / SWEEP_CYCLES, 12);
    }
  });

  it('derives the frame period from the sweep, not from wall time', () => {
    const board = new Board(sweepRom());
    board.runFrames(1);
    const first = board.getFrame().endCycle;
    board.runFrames(1);

    expect(board.getFrame().startCycle).toBe(first);
    expect(board.getFrame().cycles).toBe(SWEEP_CYCLES);
  });

  it('advances no further than asked, plus at most one instruction', () => {
    const board = new Board(sweepRom());
    const executed = board.step(50);
    expect(executed).toBeGreaterThanOrEqual(50);
    expect(executed).toBeLessThanOrEqual(51);
    expect(board.cycles).toBe(executed);
  });

  it('executes one instruction at a time on demand', () => {
    const board = new Board(sweepRom());
    expect(board.stepInstruction()).toBe(1);
    expect(board.cycles).toBe(1);
  });

  it('reports a live sample before the first sweep has wrapped', () => {
    const board = new Board(sweepRom());
    board.step(4);

    expect(board.display.frameCount).toBe(0);
    expect(board.getLitSegments().length).toBeGreaterThan(0);
  });
});

describe('Board - input through the strobe matrix (contract V4)', () => {
  it('changes the displayed segments when the lever moves', () => {
    const board = new Board(inputRom());
    board.runFrames(3);
    const before = segmentKeys(board.getFrame().segments);

    board.setLever(0);
    board.runFrames(3);
    const after = segmentKeys(board.getFrame().segments);

    expect(before).not.toEqual(after);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('reaches the ROM only through D15, on the strobe (contract V4)', () => {
    const board = new Board(inputRom());
    board.runFrames(2);

    // The board never writes machine state: the lever's position is only
    // observable to the program as a level on the read line while its contact's
    // line is strobed.
    board.setLever(0);
    expect(board.cpu.ports.readD(D_INPUT)).toBe(board.input.read(board.cpu.ports.readGrids()));
  });

  it('leaves the display alone until the ROM strobes the matrix again', () => {
    const board = new Board(inputRom());
    board.runFrames(3);
    const before = segmentKeys(board.getFrame().segments);

    board.setLever(0);
    expect(segmentKeys(board.getFrame().segments)).toEqual(before);
  });

  it('reads the fire button on its own strobe line', () => {
    const board = new Board(sweepRom());
    board.step(SWEEP_CYCLES);

    board.setFire(true);
    expect(board.input.read(1 << 0)).toBe(1);
    board.setFire(false);
    expect(board.input.read(1 << 0)).toBe(0);
  });

  it('moves controls by name, as the probe spec does', () => {
    const board = new Board(sweepRom());
    board.setControl('skill', '3');
    board.setControl('lever', 'down');
    board.setControl('fire');

    expect(board.getState().controls).toEqual({ fire: true, lever: 2, skill: 3 });
  });

  it('does not report a phantom press on the read line after power-on', () => {
    const board = new Board(inputRom());
    // D15 floats high when released, so a board that forgot to drive the read
    // line would answer "pressed" to every strobe.
    board.cpu.ports.writeD(D_INPUT, 1);
    expect(board.cpu.ports.readD(D_INPUT)).toBe(0);
  });
});

describe('Board - the speaker pin (contract V5)', () => {
  it('captures D14 transitions with their cycle timestamps', () => {
    const board = new Board(beeperRom());
    board.step(24);

    const edges = board.speaker.edges;
    expect(edges.length).toBeGreaterThan(3);
    expect(edges[0]).toEqual({ cycle: 0, level: 1 });
    expect(edges[1]).toEqual({ cycle: 2, level: 0 });
    expect(edges[2]).toEqual({ cycle: 6, level: 1 });
  });

  it('alternates levels, so the stream reconstructs a square wave', () => {
    const board = new Board(beeperRom());
    board.step(60);

    const levels = board.speaker.edges.map((edge) => edge.level);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).not.toBe(levels[i - 1]);
    }
  });

  it('timestamps rise monotonically with emulated time', () => {
    const board = new Board(beeperRom());
    board.step(120);

    const cycles = board.speaker.edges.map((edge) => edge.cycle);
    for (let i = 1; i < cycles.length; i += 1) {
      expect(cycles[i]).toBeGreaterThan(cycles[i - 1]);
    }
    expect(cycles[cycles.length - 1]).toBeLessThanOrEqual(board.cycles);
  });

  it('drains the edge stream for the audio layer', () => {
    const board = new Board(beeperRom());
    board.step(24);

    const taken = board.takeSpeakerEdges();
    expect(taken.length).toBeGreaterThan(0);
    expect(board.speaker.edgeCount).toBe(0);

    board.step(24);
    expect(board.speaker.edgeCount).toBeGreaterThan(0);
  });

  it('stays silent while the ROM never touches the pin', () => {
    const board = new Board(sweepRom());
    board.step(SWEEP_CYCLES * 4);
    expect(board.speaker.edgeCount).toBe(0);
    expect(board.speaker.level).toBe(0);
  });
});

describe('Board - power', () => {
  it('stops the machine and blanks the tube when switched off', () => {
    const board = new Board(sweepRom());
    board.runFrames(2);

    board.powerOff();
    expect(board.running).toBe(false);
    expect(board.getLitSegments()).toEqual([]);
    expect(board.display.getStrobedGrids()).toEqual([]);
  });

  it('restarts the ROM from the top when power cycled', () => {
    const board = new Board(sweepRom());
    board.runFrames(2);
    const before = board.getFrame().segments.length;

    board.powerCycle();
    expect(board.cycles).toBe(0);
    expect(board.display.frameCount).toBe(0);

    board.runFrames(2);
    expect(board.getFrame().segments).toHaveLength(before);
  });

  it('clears RAM on power-on - the only reset the machine has', () => {
    const board = new Board(sweepRom());
    board.cpu.memory.writeRam(0, 0xf);
    board.powerCycle();
    expect(board.cpu.memory.readRam(0)).toBe(0);
  });

  it('keeps the controls where the player left them across a power cycle', () => {
    const board = new Board(sweepRom());
    board.setSkill(3);
    board.setLever(2);
    board.powerCycle();

    expect(board.getState().controls).toMatchObject({ skill: 3, lever: 2 });
  });

  it('re-drives the read line after power-on', () => {
    const board = new Board(inputRom());
    board.setLever(0);
    board.powerCycle();
    board.runFrames(3);

    expect(board.getFrame().segments.length).toBeGreaterThan(0);
    expect(segmentKeys(board.getFrame().segments)).toContain('0:1');
  });
});

describe('Board - observable state', () => {
  it('snapshots the whole machine in one object', () => {
    const board = new Board(sweepRom());
    board.runFrames(2);

    const state = board.getState();
    expect(state.power).toBe('on');
    expect(state.running).toBe(true);
    expect(state.cycles).toBe(board.cycles);
    expect(state.elapsedTime).toBeCloseTo(board.cycles / 400_000, 12);
    expect(state.display.gridsStrobed).toHaveLength(GRID_COUNT);
    expect(state.display.frame.segments.length).toBeGreaterThan(0);
    expect(state.controls).toEqual({ fire: false, lever: 1, skill: 1 });
    expect(state.speakerLevel).toBe(0);
    expect(state.speakerEdges).toBe(0);
  });

  it('exposes the full CPU state for the probe', () => {
    const board = new Board(sweepRom());
    board.step(10);

    const cpu = board.getCPUState();
    expect(cpu.cycles).toBe(board.cycles);
    expect(cpu.illegalOpcodes).toBe(0);
    expect(cpu.unimplementedOpcodes).toBe(0);
  });

  it('gives up on runFrames when the ROM stops sweeping', () => {
    const board = new Board(rom([encode(InstructionType.STOP)]));
    expect(board.runFrames(1)).toBe(1);
    expect(board.running).toBe(false);
  });

  it('bounds runFrames by its cycle budget', () => {
    const board = new Board(rom([encode(InstructionType.NOP), ...encodeLong(InstructionType.JMPL, 0)]));
    const executed = board.runFrames(1, 100);
    expect(executed).toBeGreaterThanOrEqual(100);
    expect(board.display.frameCount).toBe(0);
  });
});
