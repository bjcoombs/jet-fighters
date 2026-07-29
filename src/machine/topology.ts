// The display matrix's dimensions, in one place.
//
// Grid and plate counts used to be stated twice: `src/machine/tube/atlas-schema.ts`
// carried them as literals and `src/machine/board/display.ts` derived them from
// the v2 core's port map, and the only thing keeping the two in step was a test
// asserting they were equal. That was tolerable while there was one answer. It
// stopped being tolerable the moment there were two, which is what
// docs/research/tms1370-io.md established: the chip on our board is a TMS1370
// scanning **9 grids against 12 plates**, not the ten against twenty the v2
// machine assumed.
//
// Both consumers now read a topology from here, and the answer is named rather
// than argued about at each use site.
//
// Pure data: this module imports port constants and exports objects. No state,
// no clock, no DOM.

import {
  GRID_COUNT,
  PLATE_COUNT,
  PLATE_MASK,
  R_GRID_MASK,
} from './cpu/tms1370/ports.js';

/** How many grids a display matrix scans, and how many plates it drives. */
export interface DisplayTopology {
  /** The chip whose pin budget this is - for error messages and debug UIs. */
  readonly name: string;
  /** Display grids. Exclusive upper bound on a segment's `grid` index. */
  readonly gridCount: number;
  /** The grid lines as a bit mask, in the port's own bit positions. */
  readonly gridMask: number;
  /** Plate (anode) lines. Exclusive upper bound on a segment's `plate` index. */
  readonly plateCount: number;
  /** The plate lines as a bit mask. */
  readonly plateMask: number;
}

/**
 * The TMS1370 matrix: 9 grids on R0-R8, 12 plates on O0-O7 plus R11-R14.
 *
 * Read off MAME's driver for our own ROM mask (`PWM_DISPLAY(config,
 * m_display).set_size(9, 12)`), and corroborated twice over by the teardown
 * photograph: seven printed playfield cells plus a two-cell score block is nine
 * grids, and 9 + 12 electrodes is the 21 +/- 1 series resistors counted on the
 * board. See docs/research/tms1370-io.md sections 1 and 3.
 *
 * The v2 machine assumed ten grids and twenty plates, adopted from MAME's
 * `ghalien` while this project believed its chip was an HD38800. Both figures
 * are superseded as descriptions of our hardware - see
 * docs/evidence/open-questions.md section 7 - and the core that held them has
 * been removed, so there is one topology in the tree again.
 */
export const TMS1370_TOPOLOGY: DisplayTopology = {
  name: 'TMS1370',
  gridCount: GRID_COUNT,
  gridMask: R_GRID_MASK,
  plateCount: PLATE_COUNT,
  plateMask: PLATE_MASK,
};

/**
 * The topology `src/machine/tube/atlas.json` is addressed in: the real tube's.
 *
 * The atlas describes glass, and the glass has nine grids and twelve plates
 * whatever core is soldered next to it. Naming it separately from
 * {@link DEFAULT_TOPOLOGY} is what let the two differ while the board was still
 * being rebuilt; they describe the same machine now, and the alias records that
 * the atlas's bounds are a fact about the tube rather than about the chip.
 */
export const ATLAS_TOPOLOGY: DisplayTopology = TMS1370_TOPOLOGY;

/**
 * What `Display` scans unless a caller says otherwise.
 *
 * Nine grids and twelve plates: the core, the ROM and the glass agree, so the
 * count of pins the core bonds out and the count of electrodes on the tube are
 * the same number because they describe the same machine.
 */
export const DEFAULT_TOPOLOGY: DisplayTopology = TMS1370_TOPOLOGY;
