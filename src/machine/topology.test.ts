import { describe, it, expect } from 'vitest';

import {
  ATLAS_TOPOLOGY,
  DEFAULT_TOPOLOGY,
  TMS1370_TOPOLOGY,
  type DisplayTopology,
} from './topology.js';
import { GRID_COUNT as ATLAS_GRID_COUNT, PLATE_COUNT as ATLAS_PLATE_COUNT } from './tube/atlas-schema.js';
import { GRID_COUNT as BOARD_GRID_COUNT, PLATE_COUNT as BOARD_PLATE_COUNT } from './board/display.js';

const ALL: readonly DisplayTopology[] = [TMS1370_TOPOLOGY];

/** Set bits in a mask - a topology's mask must have exactly as many as it counts. */
function popcount(mask: number): number {
  let count = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    count += (mask >>> bit) & 1;
  }
  return count;
}

describe('display topologies', () => {
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

  it('puts the live board on the TMS1370, the core and the ROM having moved', () => {
    // The v2 core scanned ten grids and this default was deliberately still its
    // while that core drove the tube: pointing it at nine before the core and
    // the ROM had been rebuilt would not have made the board a TMS1370, it would
    // have made it the old machine with its top grid pin silently masked off.
    // Both have been rebuilt, so this now says what the hardware says.
    expect(DEFAULT_TOPOLOGY).toBe(TMS1370_TOPOLOGY);
    expect(BOARD_GRID_COUNT).toBe(DEFAULT_TOPOLOGY.gridCount);
    expect(BOARD_PLATE_COUNT).toBe(DEFAULT_TOPOLOGY.plateCount);
  });

  it('addresses the atlas in the tube its own glass has', () => {
    expect(ATLAS_TOPOLOGY).toBe(TMS1370_TOPOLOGY);
    expect(ATLAS_GRID_COUNT).toBe(ATLAS_TOPOLOGY.gridCount);
    expect(ATLAS_PLATE_COUNT).toBe(ATLAS_TOPOLOGY.plateCount);
  });

  it('keeps the board able to drive everything the atlas addresses', () => {
    // The invariant that had to hold through the transition and still has to
    // hold after it. The two are the same object now, but they answer different
    // questions - one counts pins a core bonds out, the other electrodes on
    // glass - and a board that cannot reach the whole tube is broken either way.
    expect(DEFAULT_TOPOLOGY.gridCount).toBeGreaterThanOrEqual(ATLAS_TOPOLOGY.gridCount);
    expect(DEFAULT_TOPOLOGY.plateCount).toBeGreaterThanOrEqual(ATLAS_TOPOLOGY.plateCount);
  });

  it('states the two counts once, not once per consumer', () => {
    // atlas-schema.ts carried literals and display.ts carried port-derived
    // values, and only a test asserting they were equal kept them together.
    // Both now read from here, so the pair cannot drift apart in silence - and
    // they agree again, this time because they describe the same machine rather
    // than by coincidence.
    expect(ATLAS_GRID_COUNT).toBe(BOARD_GRID_COUNT);
    expect(ATLAS_PLATE_COUNT).toBe(BOARD_PLATE_COUNT);
    expect(ATLAS_GRID_COUNT).toBe(TMS1370_TOPOLOGY.gridCount);
    expect(BOARD_GRID_COUNT).toBe(TMS1370_TOPOLOGY.gridCount);
  });
});
