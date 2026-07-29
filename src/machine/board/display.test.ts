import { describe, it, expect } from 'vitest';
import rawAtlas from '../tube/atlas.json';
import { GRID_COUNT as ATLAS_GRID_COUNT, PLATE_COUNT as ATLAS_PLATE_COUNT } from '../tube/atlas-schema.js';
import { validateAtlas } from '../tube/atlas.js';
import { TMS1370_TOPOLOGY } from '../topology.js';
import {
  Display,
  GRID_COUNT,
  GRID_MASK,
  PLATE_COUNT,
  PLATE_MASK,
  REFRESH_TIMEOUT_CYCLES,
} from './display.js';
import type { PwmFrame } from './pwm.js';

/**
 * Every grid of a matrix, ascending - what `getStrobedGrids` returns off a full
 * sweep.
 *
 * Built from the topology's own count rather than typed out. `docs/contract/
 * v3.contract.md` criterion V14 requires exactly this: `getStrobedGrids`
 * compared against `GRID_COUNT`, never against a literal grid list. A `[0..9]`
 * written out is a ten-grid assumption that survives a re-addressing without
 * saying so, and there are now two real answers to how many grids there are.
 */
function everyGrid(gridCount: number): number[] {
  return Array.from({ length: gridCount }, (_unused, grid) => grid);
}

/** Duty of one segment in a frame, or 0 when it never lit. */
function dutyOf(frame: PwmFrame, grid: number, plate: number): number {
  return frame.segments.find((s) => s.grid === grid && s.plate === plate)?.duty ?? 0;
}

/**
 * One pass of the ROM's master loop: strobe each grid in turn for `dwell`
 * cycles with `plates` driven.
 *
 * @returns the cycle at which the last grid's dwell ends.
 */
function sweep(display: Display, plates: number, dwell: number, from = 0): number {
  let cycle = from;
  display.setPlates(plates, cycle);
  for (let grid = 0; grid < GRID_COUNT; grid += 1) {
    display.setGrids(1 << grid, cycle);
    cycle += dwell;
  }
  return cycle;
}

describe('Display - geometry', () => {
  it('addresses every segment the tube renderer can ask it for', () => {
    // This asserted equality with the atlas, and equality is not the invariant
    // - it was true only while there was one candidate topology. There are two
    // now and they are different facts: ten is a count of *grid pins the HMCS44
    // bonds out*, nine is a count of *electrodes on the glass*, and the atlas
    // moved onto the second (src/machine/topology.ts) ahead of the board, which
    // v3 task 11.3 moves over with the core and the ROM.
    //
    // What has to hold in the meantime, and what still has to hold afterwards,
    // is containment: every address the atlas defines must be one this board can
    // drive. A board with fewer grids than the tube cannot light the whole tube,
    // and that is the failure worth catching.
    expect(GRID_COUNT).toBeGreaterThanOrEqual(ATLAS_GRID_COUNT);
    expect(PLATE_COUNT).toBeGreaterThanOrEqual(ATLAS_PLATE_COUNT);
  });

  it('defaults to the live board: ten grids on D0-D9, twenty plates on R0-R19', () => {
    // The default is deliberately still the HMCS44's. asm/jetfighter.asm drives
    // ten grid lines and the core under it is an HD38800 model, so a board
    // scanning nine here would not be a TMS1370 - it would be an HMCS44 with a
    // grid pin silently masked off.
    expect(GRID_COUNT).toBe(10);
    expect(GRID_MASK).toBe(0x3ff);
    expect(PLATE_COUNT).toBe(20);
    expect(PLATE_MASK).toBe(0xfffff);
  });

  it('scans whatever matrix it is handed, not the default one', () => {
    const display = new Display(TMS1370_TOPOLOGY);
    expect(display.matrix).toBe(TMS1370_TOPOLOGY);
    expect(display.matrix.gridCount).toBe(9);
    expect(display.matrix.plateCount).toBe(12);
    // The bound moves with the topology, so the grid and plate the HMCS44 has
    // and the TMS1370 does not are rejected rather than silently accepted.
    expect(() => display.setGridPin(9, 1, 0)).toThrow(RangeError);
    expect(() => display.setPlatePin(12, 1, 0)).toThrow(RangeError);
    expect(() => display.setGridPin(8, 1, 0)).not.toThrow();
  });

  it('drives the TMS1370 matrix over its whole address space', () => {
    // Nine grids against twelve plates, swept end to end: every one of the 108
    // addresses must accumulate duty, and none outside them may exist.
    const display = new Display(TMS1370_TOPOLOGY);
    const DWELL = 10;
    let cycle = 0;
    display.setPlates(TMS1370_TOPOLOGY.plateMask, cycle);
    for (let grid = 0; grid < TMS1370_TOPOLOGY.gridCount; grid += 1) {
      display.setGrids(1 << grid, cycle);
      cycle += DWELL;
    }
    const frame = display.endFrame(cycle);
    expect(frame.segments).toHaveLength(
      TMS1370_TOPOLOGY.gridCount * TMS1370_TOPOLOGY.plateCount,
    );
    expect(display.getStrobedGrids()).toEqual(everyGrid(TMS1370_TOPOLOGY.gridCount));
    for (const segment of frame.segments) {
      expect(segment.grid).toBeLessThan(TMS1370_TOPOLOGY.gridCount);
      expect(segment.plate).toBeLessThan(TMS1370_TOPOLOGY.plateCount);
    }
  });

  it('validates the shipped atlas against the TMS1370 matrix', () => {
    // The end state contract criterion V5 describes, provable now rather than
    // after the board flips: the atlas data fits nine grids and twelve plates.
    expect(validateAtlas(rawAtlas, TMS1370_TOPOLOGY)).toEqual({ valid: true, errors: [] });
  });
});

describe('Display - initial state', () => {
  it('comes up dark with nothing driven', () => {
    const display = new Display();
    expect(display.gridMask).toBe(0);
    expect(display.plateMask).toBe(0);
    expect(display.getLitSegments()).toEqual([]);
    expect(display.frameCount).toBe(0);
  });

  it('reports an empty frame before the first sweep completes', () => {
    const display = new Display();
    const frame = display.getFrame();
    expect(frame.cycles).toBe(0);
    expect(frame.segments).toEqual([]);
  });

  it('has strobed no grids yet', () => {
    expect(new Display().getStrobedGrids()).toEqual([]);
  });
});

describe('Display - driving grids and plates', () => {
  it('lights a segment only where a grid and a plate are driven together', () => {
    const display = new Display();
    display.setGrids(1 << 2, 0);
    display.setPlates(1 << 7, 0);
    const frame = display.endFrame(100);

    expect(frame.segments).toHaveLength(1);
    expect(frame.segments[0]).toMatchObject({ grid: 2, plate: 7, duty: 1 });
  });

  it('lights every plate driven against the selected grid', () => {
    const display = new Display();
    display.setGrids(1 << 0, 0);
    display.setPlates(0b1011, 0);
    const frame = display.endFrame(50);

    expect(frame.segments.map((s) => s.plate)).toEqual([0, 1, 3]);
  });

  it('masks grid bits above D9 - they are the speaker and input pins', () => {
    const display = new Display();
    display.setGrids(0xffff, 0);
    expect(display.gridMask).toBe(GRID_MASK);
  });

  it('drives one line at a time through the pin setters', () => {
    const display = new Display();
    display.setGridPin(4, 1, 0);
    display.setPlatePin(19, 1, 0);
    expect(display.gridMask).toBe(1 << 4);
    expect(display.plateMask).toBe(1 << 19);

    display.setGridPin(4, 0, 10);
    expect(display.gridMask).toBe(0);
  });

  it('rejects a pin outside the geometry', () => {
    const display = new Display();
    expect(() => display.setGridPin(GRID_COUNT, 1, 0)).toThrow(RangeError);
    expect(() => display.setPlatePin(PLATE_COUNT, 1, 0)).toThrow(RangeError);
  });

  it('records which grids have been strobed (contract V3)', () => {
    const display = new Display();
    sweep(display, 1, 40);
    expect(display.getStrobedGrids()).toEqual(everyGrid(GRID_COUNT));
  });
});

describe('Display - frame periods from the sweep', () => {
  it('closes a frame when the sweep wraps to a grid already driven', () => {
    const display = new Display();
    const end = sweep(display, 1 << 3, 40);
    expect(display.frameCount).toBe(0);

    display.setGrids(1 << 0, end);
    expect(display.frameCount).toBe(1);
    expect(display.getFrame().cycles).toBe(400);
  });

  it('gives each grid of a ten-grid sweep a duty of one tenth', () => {
    const display = new Display();
    const end = sweep(display, 0b101, 40);
    display.setGrids(1 << 0, end);

    const frame = display.getFrame();
    expect(frame.segments).toHaveLength(20);
    for (const segment of frame.segments) {
      expect(segment.duty).toBeCloseTo(0.1, 12);
    }
  });

  it('produces a duty strictly between 0 and 1 (contract V3)', () => {
    const display = new Display();
    const end = sweep(display, 1 << 5, 40);
    display.setGrids(1 << 0, end);

    const fractional = display.getLitSegments().filter((s) => s.duty > 0 && s.duty < 1);
    expect(fractional.length).toBeGreaterThan(0);
  });

  it('measures duty against a longer period when the sweep slows', () => {
    const display = new Display();
    display.setPlates(1, 0);
    display.setGrids(1 << 0, 0);
    display.setGrids(1 << 1, 40);
    display.setGrids(1 << 0, 440);

    // Grid 0 held 40 cycles of a 440-cycle frame: dimmer than the 0.1 of an
    // even sweep, which is the flicker character the criterion is after.
    expect(dutyOf(display.getFrame(), 0, 0)).toBeCloseTo(40 / 440, 12);
    expect(dutyOf(display.getFrame(), 1, 0)).toBeCloseTo(400 / 440, 12);
  });

  it('does not close a frame while the sweep is still stepping forward', () => {
    const display = new Display();
    sweep(display, 1, 40);
    expect(display.frameCount).toBe(0);
    expect(display.getFrame().segments).toEqual([]);
  });

  it('closes a frame on demand for a caller that needs a boundary', () => {
    const display = new Display();
    display.setGrids(1, 0);
    display.setPlates(1, 0);
    display.endFrame(100);

    expect(display.frameCount).toBe(1);
    expect(display.getFrame().cycles).toBe(100);
  });

  it('keeps the tube lit across a frame boundary', () => {
    const display = new Display();
    display.setGrids(1 << 2, 0);
    display.setPlates(1 << 1, 0);
    display.endFrame(100);
    display.endFrame(200);

    expect(dutyOf(display.getFrame(), 2, 1)).toBe(1);
  });

  it('starts counting grids afresh in the new frame', () => {
    const display = new Display();
    const end = sweep(display, 1, 40);
    display.setGrids(1 << 0, end);
    display.setGrids(1 << 1, end + 40);
    expect(display.frameCount).toBe(1);
  });

  it('samples mid-frame without closing it', () => {
    const display = new Display();
    display.setGrids(1, 0);
    display.setPlates(1, 0);

    expect(dutyOf(display.sample(50), 0, 0)).toBe(1);
    expect(display.frameCount).toBe(0);
  });
});

describe('Display - reading segment state', () => {
  it('reports the duty of a named segment from the last complete frame', () => {
    const display = new Display();
    const end = sweep(display, 1 << 2, 40);
    display.setGrids(1 << 0, end);

    expect(display.getSegmentDuty(7, 2)).toBeCloseTo(0.1, 12);
    expect(display.getSegmentDuty(7, 3)).toBe(0);
  });

  it('rejects a segment address outside the geometry', () => {
    const display = new Display();
    expect(() => display.getSegmentDuty(GRID_COUNT, 0)).toThrow(RangeError);
    expect(() => display.getSegmentDuty(0, PLATE_COUNT)).toThrow(RangeError);
  });

  it('snapshots the whole tube', () => {
    const display = new Display();
    const end = sweep(display, 1 << 1, 40);
    display.setGrids(1 << 0, end);

    const snapshot = display.snapshot();
    expect(snapshot.gridMask).toBe(1 << 0);
    expect(snapshot.plateMask).toBe(1 << 1);
    expect(snapshot.frameCount).toBe(1);
    expect(snapshot.gridsStrobed).toHaveLength(GRID_COUNT);
    expect(snapshot.frame.segments).toHaveLength(GRID_COUNT);
  });
});

describe('Display - clearing', () => {
  it('blanks the tube and forgets every frame', () => {
    const display = new Display();
    const end = sweep(display, 1, 40);
    display.setGrids(1 << 0, end);
    display.clear();

    expect(display.gridMask).toBe(0);
    expect(display.plateMask).toBe(0);
    expect(display.frameCount).toBe(0);
    expect(display.getLitSegments()).toEqual([]);
    expect(display.getStrobedGrids()).toEqual([]);
  });

  it('accepts a rewound cycle count - the power switch restarts the clock', () => {
    const display = new Display();
    display.setGrids(1, 5_000);
    display.clear(0);
    expect(() => display.setGrids(1 << 1, 10)).not.toThrow();
  });
});

describe('Display - a sweep that stops', () => {
  /**
   * The ROM has one core and no sound hardware, so while it bit-bangs the
   * speaker it drives no grid and the tube goes out (vfd-appearance.md D1).
   * Nothing here knows that; all it sees is drive that stopped.
   */
  const STALL = REFRESH_TIMEOUT_CYCLES * 10;

  /** A sweep, then the grids dropped, then nothing for `stall` cycles. */
  function sweepThenStall(display: Display, stall: number): { blankedAt: number; resumeAt: number } {
    const end = sweep(display, 0b11, 40);
    display.setGrids(0, end);
    return { blankedAt: end, resumeAt: end + stall };
  }

  it('goes on reporting the last completed frame while the sweep is running', () => {
    const display = new Display();
    const end = sweep(display, 0b11, 40);
    display.setGrids(1 << 0, end); // wraps: closes the frame

    // Read between two grids of the next sweep, the way a renderer would.
    const frame = display.getObservedFrame(end + 10);
    expect(frame.segments).toHaveLength(GRID_COUNT * 2);
    expect(display.isRefreshing(end + 10)).toBe(true);
  });

  it('tolerates the sweep-s own blanking intervals without going dark', () => {
    const display = new Display();
    const { blankedAt } = sweepThenStall(display, 0);
    display.setGrids(1 << 0, blankedAt + 1);
    display.setGrids(0, blankedAt + 41);

    // A gap at the timeout is still a running sweep - the boundary is inclusive
    // so that the largest gap the ROM produces cannot be read as a stop.
    expect(display.isRefreshing(blankedAt + 41 + REFRESH_TIMEOUT_CYCLES)).toBe(true);
    expect(display.refreshGap(blankedAt + 41 + REFRESH_TIMEOUT_CYCLES)).toBe(REFRESH_TIMEOUT_CYCLES);
  });

  it('reports the tube dark once the drive has been gone longer than the timeout', () => {
    const display = new Display();
    const { blankedAt } = sweepThenStall(display, STALL);

    expect(display.isRefreshing(blankedAt + REFRESH_TIMEOUT_CYCLES + 1)).toBe(false);
    expect(display.getObservedFrame(blankedAt + REFRESH_TIMEOUT_CYCLES + 1).segments).toEqual([]);
    expect(display.getObservedFrame(blankedAt + STALL).segments).toEqual([]);
  });

  it('measures the dark frame from the moment the drive stopped', () => {
    const display = new Display();
    const { blankedAt } = sweepThenStall(display, STALL);
    const frame = display.getObservedFrame(blankedAt + STALL);
    expect(frame.startCycle).toBe(blankedAt);
    expect(frame.cycles).toBe(STALL);
  });

  it('leaves getFrame alone - it is what the ROM drew, not what is on the glass', () => {
    const display = new Display();
    const end = sweep(display, 0b11, 40);
    display.setGrids(1 << 0, end);
    display.setGrids(0, end + 40);

    expect(display.getFrame().segments).toHaveLength(GRID_COUNT * 2);
    expect(display.getObservedFrame(end + 40 + STALL).segments).toEqual([]);
  });

  it('keeps the stall out of the period the sweep either side of it is measured against', () => {
    // Without this, the frame that contains a stall is the stall's length
    // longer and every duty in it collapses by the same factor - a fully driven
    // segment reading as a dim one, once per sound.
    const withoutStall = new Display();
    const plainEnd = sweep(withoutStall, 0b11, 40);
    withoutStall.setGrids(1 << 0, plainEnd);

    const withStall = new Display();
    const { blankedAt, resumeAt } = sweepThenStall(withStall, STALL);
    withStall.setGrids(1 << 0, resumeAt); // the sweep comes back and wraps

    expect(withStall.getFrame().cycles).toBe(withoutStall.getFrame().cycles);
    expect(dutyOf(withStall.getFrame(), 3, 1)).toBeCloseTo(dutyOf(withoutStall.getFrame(), 3, 1), 12);
    expect(blankedAt).toBeLessThan(resumeAt);
  });

  it('keeps ordinary sweep variation in the period, because a slower sweep is dimmer', () => {
    // Only a full stop is excluded. A pass that runs long because the ROM had
    // more to do is real dimming and stays in the denominator.
    const quick = new Display();
    const quickEnd = sweep(quick, 0b11, 40);
    quick.setGrids(0, quickEnd);
    quick.setGrids(1 << 0, quickEnd + REFRESH_TIMEOUT_CYCLES);

    const plain = new Display();
    const plainEnd = sweep(plain, 0b11, 40);
    plain.setGrids(1 << 0, plainEnd);

    expect(quick.getFrame().cycles).toBeGreaterThan(plain.getFrame().cycles);
    expect(dutyOf(quick.getFrame(), 3, 1)).toBeLessThan(dutyOf(plain.getFrame(), 3, 1));
  });

  it('forgets the stall when the power switch goes off', () => {
    const display = new Display();
    const { blankedAt } = sweepThenStall(display, STALL);
    display.clear(blankedAt + STALL);
    expect(display.refreshGap(blankedAt + STALL)).toBe(0);
  });
});
