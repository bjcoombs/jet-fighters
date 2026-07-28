// The display matrix's dimensions, in one place.
//
// Grid and plate counts used to be stated twice: `src/machine/tube/atlas-schema.ts`
// carried them as literals and `src/machine/board/display.ts` derived them from
// the HMCS44 port map, and the only thing keeping the two in step was a test
// asserting they were equal. That was tolerable while there was one answer. It
// stopped being tolerable the moment there were two, which is what
// docs/research/tms1370-io.md established: the chip on our board is a TMS1370
// scanning **9 grids against 12 plates**, not the HMCS44's 10 against 20.
//
// So both consumers now read a topology from here, and the two answers are
// named rather than argued about at each use site.
//
// Pure data: this module imports port constants and exports objects. No state,
// no clock, no DOM.

import { D_GRID_FIRST, D_GRID_LAST, D_GRID_MASK, R_MASK, R_PIN_COUNT } from './cpu/ports.js';
import {
  GRID_COUNT as TMS1370_GRID_COUNT,
  PLATE_COUNT as TMS1370_PLATE_COUNT,
  PLATE_MASK as TMS1370_PLATE_MASK,
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
 * The HMCS44 (Hitachi HD38800) matrix: 10 grids on D0-D9, 20 plates on R0-R19.
 *
 * Adopted from MAME's `ghalien` when this project believed its chip was an
 * HD38800. The grid count is that sibling's documented figure; the plate count
 * is this repository's own assumption about a bus the research only ever
 * described as "~20 plates (R ports + D10-D13)". Both are superseded as
 * descriptions of our hardware - see docs/evidence/open-questions.md section 7 -
 * and both are still exactly right as descriptions of the core `src/machine/cpu/`
 * currently implements, which is why this is still the default below.
 */
export const HMCS44_TOPOLOGY: DisplayTopology = {
  name: 'HMCS44',
  gridCount: D_GRID_LAST - D_GRID_FIRST + 1,
  gridMask: D_GRID_MASK,
  plateCount: R_PIN_COUNT,
  plateMask: R_MASK,
};

/**
 * The TMS1370 matrix: 9 grids on R0-R8, 12 plates on O0-O7 plus R11-R14.
 *
 * Read off MAME's driver for our own ROM mask (`PWM_DISPLAY(config,
 * m_display).set_size(9, 12)`), and corroborated twice over by the teardown
 * photograph: seven printed playfield cells plus a two-cell score block is nine
 * grids, and 9 + 12 electrodes is the 21 +/- 1 series resistors counted on the
 * board. See docs/research/tms1370-io.md sections 1 and 3.
 */
export const TMS1370_TOPOLOGY: DisplayTopology = {
  name: 'TMS1370',
  gridCount: TMS1370_GRID_COUNT,
  gridMask: R_GRID_MASK,
  plateCount: TMS1370_PLATE_COUNT,
  plateMask: TMS1370_PLATE_MASK,
};

/**
 * The topology `src/machine/tube/atlas.json` is addressed in: the real tube's.
 *
 * The atlas describes glass, and the glass has nine grids and twelve plates
 * whatever core is soldered next to it. So the atlas's bounds move to the
 * TMS1370's figures now, ahead of the board's: `validateAtlas` rejects grid 9
 * and plate 12, and the atlas data - which already sat inside plates 0-11 -
 * satisfies that once `score_label` comes off grid 9.
 */
export const ATLAS_TOPOLOGY: DisplayTopology = TMS1370_TOPOLOGY;

/**
 * What `Display` scans unless a caller says otherwise.
 *
 * **This is deliberately still the HMCS44's, and it is the one line v3 task 11
 * subtask 11.3 changes.** The live path is the HMCS44 core running
 * `asm/jetfighter.asm`, and that program drives ten grid lines. Pointing this at
 * {@link TMS1370_TOPOLOGY} before the core and the ROM have been rebuilt would
 * not make the board a TMS1370; it would make it an HMCS44 with its top grid
 * pin silently masked off.
 *
 * That the default and {@link ATLAS_TOPOLOGY} can differ at all is the point of
 * naming them separately. Ten is a count of *pins a core bonds out*; nine is a
 * count of *electrodes on a tube*. They were the same number by coincidence and
 * are now two facts, one of which is being replaced. When 11.3 lands they
 * coincide again, this time because they describe the same machine.
 */
export const DEFAULT_TOPOLOGY: DisplayTopology = HMCS44_TOPOLOGY;
