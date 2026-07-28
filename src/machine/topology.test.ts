import { describe, it, expect } from 'vitest';

import {
  ATLAS_TOPOLOGY,
  DEFAULT_TOPOLOGY,
  HMCS44_TOPOLOGY,
  TMS1370_TOPOLOGY,
  type DisplayTopology,
} from './topology.js';
import { GRID_COUNT as ATLAS_GRID_COUNT, PLATE_COUNT as ATLAS_PLATE_COUNT } from './tube/atlas-schema.js';
import { GRID_COUNT as BOARD_GRID_COUNT, PLATE_COUNT as BOARD_PLATE_COUNT } from './board/display.js';

const ALL: readonly DisplayTopology[] = [HMCS44_TOPOLOGY, TMS1370_TOPOLOGY];

/** Set bits in a mask - a topology's mask must have exactly as many as it counts. */
function popcount(mask: number): number {
  let count = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    count += (mask >>> bit) & 1;
  }
  return count;
}

describe('display topologies', () => {
  it('gives the HMCS44 ten grids and twenty plates', () => {
    expect(HMCS44_TOPOLOGY.gridCount).toBe(10);
    expect(HMCS44_TOPOLOGY.gridMask).toBe(0x3ff);
    expect(HMCS44_TOPOLOGY.plateCount).toBe(20);
    expect(HMCS44_TOPOLOGY.plateMask).toBe(0xfffff);
  });

  it('gives the TMS1370 nine grids and twelve plates', () => {
    // MAME's driver for our own ROM mask: `set_size(9, 12)`. Corroborated by
    // the teardown photograph twice over - seven printed playfield cells plus a
    // two-cell score block is nine grids, and 9 + 12 electrodes matches the
    // 21 +/- 1 series resistors counted on the board.
    expect(TMS1370_TOPOLOGY.gridCount).toBe(9);
    expect(TMS1370_TOPOLOGY.gridMask).toBe(0x1ff);
    expect(TMS1370_TOPOLOGY.plateCount).toBe(12);
    expect(TMS1370_TOPOLOGY.plateMask).toBe(0xfff);
  });

  it('keeps every mask in step with the count beside it', () => {
    for (const topology of ALL) {
      expect(popcount(topology.gridMask), `${topology.name} grids`).toBe(topology.gridCount);
      expect(popcount(topology.plateMask), `${topology.name} plates`).toBe(topology.plateCount);
    }
  });

  it('leaves the live board on the HMCS44 until the core and the ROM move', () => {
    // The line v3 task 11.3 changes, asserted so that changing it is a
    // deliberate act with a failing test attached rather than a silent edit.
    // asm/jetfighter.asm drives ten grid lines: a board scanning nine here
    // would not be a TMS1370, it would be an HMCS44 with a grid pin masked off.
    expect(DEFAULT_TOPOLOGY).toBe(HMCS44_TOPOLOGY);
    expect(BOARD_GRID_COUNT).toBe(DEFAULT_TOPOLOGY.gridCount);
    expect(BOARD_PLATE_COUNT).toBe(DEFAULT_TOPOLOGY.plateCount);
  });

  it('addresses the atlas in the tube its own glass has', () => {
    expect(ATLAS_TOPOLOGY).toBe(TMS1370_TOPOLOGY);
    expect(ATLAS_GRID_COUNT).toBe(ATLAS_TOPOLOGY.gridCount);
    expect(ATLAS_PLATE_COUNT).toBe(ATLAS_TOPOLOGY.plateCount);
  });

  it('keeps the board able to drive everything the atlas addresses', () => {
    // The invariant that has to hold through the transition and after it. The
    // two topologies may differ - one counts pins on a core being replaced, the
    // other electrodes on glass - but a board that cannot reach the whole tube
    // is broken in either era.
    expect(DEFAULT_TOPOLOGY.gridCount).toBeGreaterThanOrEqual(ATLAS_TOPOLOGY.gridCount);
    expect(DEFAULT_TOPOLOGY.plateCount).toBeGreaterThanOrEqual(ATLAS_TOPOLOGY.plateCount);
  });

  it('states the two counts once, not once per consumer', () => {
    // atlas-schema.ts carried literals and display.ts carried port-derived
    // values, and only a test asserting they were equal kept them together.
    // Both now read from here, so the pair cannot drift apart in silence.
    expect(ATLAS_GRID_COUNT).not.toBe(BOARD_GRID_COUNT);
    expect(ATLAS_GRID_COUNT).toBe(TMS1370_TOPOLOGY.gridCount);
    expect(BOARD_GRID_COUNT).toBe(HMCS44_TOPOLOGY.gridCount);
  });
});
