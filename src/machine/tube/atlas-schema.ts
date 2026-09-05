// Types and constants for the VFD segment atlas.
//
// The atlas is pure data: every phosphor anode segment on the real tube, its
// shape, and the (grid, plate) address the MCU drives it from. Nothing here
// renders, and nothing here touches the DOM - the atlas is consumed by the tube
// renderer, by the headless machine probe, and by tests, so it must import
// cleanly in plain Node.
//
// The coordinate system, the reference-photo provenance of each shape, and the
// assumptions behind the grid/plate mapping are documented in
// ATLAS-COORDINATES.md (same directory).

import { ATLAS_TOPOLOGY } from '../topology.js';

/**
 * Display grids on the tube: nine, driven by R0-R8.
 *
 * This used to be a literal 10, borrowed from a sibling machine's driver while
 * the chip on our board was misidentified. It is now derived from
 * {@link ATLAS_TOPOLOGY}, which is the TMS1370's - MAME's driver for our own ROM
 * mask configures a 9 x 12 matrix, and the teardown photograph agrees twice
 * over. See src/machine/topology.ts and docs/research/tms1370-io.md section 3.
 */
export const GRID_COUNT = ATLAS_TOPOLOGY.gridCount;

/**
 * Plate (anode) lines available per grid: twelve, O0-O7 plus R11-R14.
 *
 * The exclusive upper bound on a segment's `plate` index, not the count wired
 * under every grid - the score grids use seven and eight of them. Twelve was
 * always enough for this tube: the atlas has never addressed a plate above 11,
 * which is why moving the bound down from the v2 machine's 20 rejects addresses
 * rather than invalidating data.
 */
export const PLATE_COUNT = ATLAS_TOPOLOGY.plateCount;

/**
 * Phosphor regions of the two-colour tube. Colour comes from patterned phosphor
 * plus the filter overlay, so it is a fixed property of the segment - a segment
 * can never change colour at runtime.
 *
 * Note for readers coming from v1: `src/render/sprites.ts` calls the attacker
 * colour `amber`. The v2 PRD is authoritative and specifies a cyan/red tube; the
 * atlas uses `red`. See ATLAS-COORDINATES.md, "Colour regions".
 */
export type ColorRegion = 'cyan' | 'red';

/** Lane index: 0 = top, 2 = bottom, matching the game grid and the case lever. */
export type LaneIndex = 0 | 1 | 2;

/**
 * Distance cell: 0 = the battleship's own cell, 6 = the G (capture) line where
 * the player stands. Seven, counted off the printed cell boxes in the teardown
 * photographs; a cell and a display grid are the same thing.
 */
export type ColumnIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The five cells that carry a jet, and everything that happens to one. Neither
 * end cell has a jet: cell 0 is the battleship's and cell 6 is the player's,
 * and the teardown photographs show no aircraft printed in either.
 */
export type JetCellIndex = 1 | 2 | 3 | 4 | 5;



/** Seven-segment keys in the conventional a-g order (a = top, g = middle). */
export type SevenSegmentKey = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

/** Score digit position: 0 = leftmost (hundreds), 2 = rightmost (units). */
export type ScoreDigitIndex = 0 | 1 | 2;

/**
 * Attacking jet silhouettes: one per lane per distance column (18 total).
 *
 * Two outlines, not one translated across the lattice. The tube carries the
 * wing-beat in the phosphor: a cell whose `(column + lane)` is even holds the
 * level-winged pose and an odd one the raked pose, which is the parity the
 * gameplay video measured across thirteen cells. See ATLAS-COORDINATES.md.
 */
export type JetSegmentId = `jet_lane${LaneIndex}_col${JetCellIndex}`;
/**
 * The attackers' shot: a colon, two red dots one directly above the other, one
 * per lane per distance column (18 total). It travels toward the player, so it
 * is drawn in every cell it can cross.
 */
export type RocketSegmentId = `rocket_lane${LaneIndex}_col${JetCellIndex}`;
/**
 * The player's missile in flight: a cyan dart pointing left, the direction it
 * travels, one per lane in each of the five columns it crosses (15 total). The
 * same outline in every column - unlike the jet it does not change with
 * position, which the video records as a negative result.
 */
export type MissileSegmentId = `missile_lane${LaneIndex}_col${JetCellIndex}`;
/**
 * The burst a jet leaves when the missile kills it: two spiky cyan blobs
 * stacked vertically in one cell, the upper broader than the lower, their
 * jagged edges facing away from each other (12 total). One segment, not two -
 * the pair always appears together, so the machine has no reason to light half
 * of it, and the path carries both blobs as disjoint sub-paths.
 */
export type BurstSegmentId = `burst_lane${LaneIndex}_col${JetCellIndex}`;
/**
 * The player's ship, inside the field at the G line, one segment per lane
 * position (3 total). Owner-confirmed as the object the player controls and
 * fires from; the id keeps the `launcher_` prefix because the (grid, plate)
 * addresses the ROM writes have not moved. See ATLAS-COORDINATES.md.
 */
export type LauncherSegmentId = `launcher_lane${LaneIndex}`;
/**
 * The SCORE readout: two full seven-segment digits, plus the hundreds as a
 * two-stroke half-digit that reads 1 or nothing (15 total).
 *
 * The tube has **two** digit cells, not three - the left one carries the
 * half-digit and the tens together, the right one the units
 * (`assets/reference/tube-teardown/score-block.jpg`). The hundreds is not a
 * seven-segment digit at all: five of the segments the atlas used to define
 * there are phosphor the glass does not have, which is why the ROM/atlas
 * conformance test could never get them lit.
 */
export type ScoreSegmentId =
  | `score_tens_seg${SevenSegmentKey}`
  | `score_units_seg${SevenSegmentKey}`;
/**
 * The red starburst thrown up where the player's ship is hit, one per lane
 * position (3 total). Photographed in
 * `assets/reference/sprites/explosion-red-lit.png`.
 */
export type ExplosionSegmentId = `explosion_lane${LaneIndex}`;
/**
 * The battleship, a warship in side profile, one per lane position (3 total).
 * The video finds it in the far cell in any of the three lanes and never
 * anywhere else, so it is three segments rather than the one the atlas used to
 * carry, and a crossing is segments lighting rather than a sprite moving.
 */
export type BattleshipSegmentId = `battleship_lane${LaneIndex}`;
/**
 * The printed sea the battleship sits on: two rows of small wave glyphs below
 * the hull, one segment per lane with a sub-path for each glyph (3 total).
 *
 * Nothing had accounted for it - it is phosphor the atlas had never carried,
 * found by tracing the bare tube. The ROM does not drive it yet.
 */
export type SeaSegmentId = `sea_lane${LaneIndex}`;
/**
 * The cyan burst behind the battleship, one per lane (3 total).
 *
 * On the bare tube it is a single wide starburst wrapping over and behind the
 * hull, not the side-by-side pair the video-derived catalogue describes; the
 * teardown wins on shape. The ROM scores a battleship kill already and does not
 * draw it.
 */
export type BattleshipBurstSegmentId = `battleship_burst_lane${LaneIndex}`;
/**
 * The burst a jet makes when it reaches the capture line, one per lane
 * (3 total).
 *
 * The player's cell prints **two** bursts and they are different events, which
 * the owner settled: one is "when the plane reaches right hand side" and the
 * other "when the `:`". {@link ExplosionSegmentId} is the second - being hit by
 * the attackers' colon - and this is the first. They are near the same size but
 * clearly different shapes, the capture burst deeper and the rocket burst
 * flatter, and each is consistent across its own three lanes.
 */
export type CaptureSegmentId = `capture_lane${LaneIndex}`;

/**
 * Every addressable segment on the tube. Exhaustive by construction: a typo in
 * an id is a compile error, and `getSegmentById` is total over this union.
 */
export type SegmentId =
  | JetSegmentId
  | RocketSegmentId
  | MissileSegmentId
  | BurstSegmentId
  | LauncherSegmentId
  | ScoreSegmentId
  | ExplosionSegmentId
  | BattleshipSegmentId
  | SeaSegmentId
  | BattleshipBurstSegmentId
  | CaptureSegmentId
  | 'score_hundreds'
  | 'score_label';

/** Axis-aligned bounding box of a segment's path, in atlas units. */
export interface SegmentBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One phosphor anode segment: what it looks like and where the MCU drives it. */
export interface Segment {
  /** Semantic identifier, e.g. `jet_lane0_col1`. Unique across the atlas. */
  readonly id: SegmentId;
  /** Display grid, 0 to `GRID_COUNT - 1`, driven by R0-R8. */
  readonly grid: number;
  /** Plate (anode) bit index within the grid, 0 to `PLATE_COUNT - 1`. */
  readonly plate: number;
  /** SVG path data for the segment outline, in atlas units. */
  readonly path: string;
  /** Which phosphor region the segment sits in - fixed by the tube. */
  readonly colorRegion: ColorRegion;
  /** Axis-aligned bounds of `path`, so consumers need not parse the path. */
  readonly bounds: SegmentBounds;
}

/**
 * The atlas coordinate space. Equal to the scope bounding box of
 * the case drawing (`CIRCLE` and `RECT` in layout.ts) with the origin translated to (0, 0): 363 x 300 units,
 * +x right, +y down (SVG convention). See ATLAS-COORDINATES.md.
 */
export interface AtlasViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The complete segment atlas as loaded from `atlas.json`. */
export interface Atlas {
  readonly viewBox: AtlasViewBox;
  readonly segments: readonly Segment[];
}

/** Expected segment counts, asserted by the atlas tests and by `validateAtlas`. */
export const EXPECTED_SEGMENT_COUNTS = {
  jet: 15,
  rocket: 15,
  missile: 15,
  burst: 15,
  launcher: 3,
  score: 14,
  scoreHundreds: 1,
  explosion: 3,
  battleship: 3,
  sea: 3,
  battleshipBurst: 3,
  capture: 3,
  scoreLabel: 1,
} as const;

/** Total number of segments on the tube. */
export const TOTAL_SEGMENT_COUNT = Object.values(EXPECTED_SEGMENT_COUNTS).reduce(
  (sum, n) => sum + n,
  0,
);

/** The result of validating atlas data. `errors` is empty exactly when valid. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}
