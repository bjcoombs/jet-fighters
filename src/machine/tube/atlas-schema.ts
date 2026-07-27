// Types and constants for the VFD segment atlas.
//
// The atlas is pure data: every phosphor anode segment on the real Futaba
// DM-series tube, its shape, and the (grid, plate) address the HD38800 drives it
// from. Nothing here renders, and nothing here touches the DOM - the atlas is
// consumed by the tube renderer, by the headless machine probe, and by tests, so
// it must import cleanly in plain Node.
//
// The coordinate system, the reference-photo provenance of each shape, and the
// assumptions behind the grid/plate mapping are documented in
// ATLAS-COORDINATES.md (same directory).

/**
 * Display grids driven by D0-D9 on the HD38800. The sibling hardware (MAME
 * `ghalien`) scans 10 grids; the master loop strobes one per sweep step.
 */
export const GRID_COUNT = 10;

/**
 * Plate (anode) lines available per grid. The sibling hardware exposes ~20
 * plates across the R ports plus D10-D13; this is the exclusive upper bound on
 * a segment's `plate` index, not the count actually wired on every grid.
 */
export const PLATE_COUNT = 20;

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

/** Distance column: 0 = battleship / far zone, 5 = the G (capture) line. */
export type ColumnIndex = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Columns the player's missile is drawn in. The gameplay video finds it in five
 * of the six cells - it is launched into the cell next to the launcher and steps
 * away as far as the far column, and it is never lit in the launcher's own cell,
 * which is where the launcher is. See ATLAS-COORDINATES.md.
 */
export type MissileColumnIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Columns the cyan jet-kill burst is drawn in: the four the video ever shows it
 * in. There is no burst in the two cells nearest the launcher, and the video
 * finds no jet there either.
 */
export type BurstColumnIndex = 0 | 1 | 2 | 3;

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
export type JetSegmentId = `jet_lane${LaneIndex}_col${ColumnIndex}`;
/**
 * The attackers' shot: a colon, two red dots one directly above the other, one
 * per lane per distance column (18 total). It travels toward the player, so it
 * is drawn in every cell it can cross.
 */
export type RocketSegmentId = `rocket_lane${LaneIndex}_col${ColumnIndex}`;
/**
 * The player's missile in flight: a cyan dart pointing left, the direction it
 * travels, one per lane in each of the five columns it crosses (15 total). The
 * same outline in every column - unlike the jet it does not change with
 * position, which the video records as a negative result.
 */
export type MissileSegmentId = `missile_lane${LaneIndex}_col${MissileColumnIndex}`;
/**
 * The burst a jet leaves when the missile kills it: two spiky cyan blobs
 * stacked vertically in one cell, the upper broader than the lower, their
 * jagged edges facing away from each other (12 total). One segment, not two -
 * the pair always appears together, so the machine has no reason to light half
 * of it, and the path carries both blobs as disjoint sub-paths.
 */
export type BurstSegmentId = `burst_lane${LaneIndex}_col${BurstColumnIndex}`;
/**
 * The player's ship, inside the field at the G line, one segment per lane
 * position (3 total). Owner-confirmed as the object the player controls and
 * fires from; the id keeps the `launcher_` prefix because the (grid, plate)
 * addresses the ROM writes have not moved. See ATLAS-COORDINATES.md.
 */
export type LauncherSegmentId = `launcher_lane${LaneIndex}`;
/** Seven-segment SCORE readout: 3 digits x 7 segments (21 total). */
export type ScoreSegmentId = `score_digit${ScoreDigitIndex}_seg${SevenSegmentKey}`;
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
  /** Display grid, 0-9, driven by D0-D9. */
  readonly grid: number;
  /** Plate (anode) bit index within the grid, 0-19. */
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
 * `src/ui/geometry.ts` with the origin translated to (0, 0): 363 x 300 units,
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
  jet: 18,
  rocket: 18,
  missile: 15,
  burst: 12,
  launcher: 3,
  score: 21,
  explosion: 3,
  battleship: 3,
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
