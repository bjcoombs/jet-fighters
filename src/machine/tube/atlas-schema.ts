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

/** Seven-segment keys in the conventional a-g order (a = top, g = middle). */
export type SevenSegmentKey = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

/** Score digit position: 0 = leftmost (hundreds), 2 = rightmost (units). */
export type ScoreDigitIndex = 0 | 1 | 2;

/** Attacking jet silhouettes: one per lane per distance column (18 total). */
export type JetSegmentId = `jet_lane${LaneIndex}_col${ColumnIndex}`;
/** Jet rocket dots travelling back toward the player (18 total). */
export type RocketSegmentId = `rocket_lane${LaneIndex}_col${ColumnIndex}`;
/** The player missile's two-dot trail: dot0 = head, dot1 = trail (6 total). */
export type MissileSegmentId = `missile_lane${LaneIndex}_dot${0 | 1}`;
/** The player launcher at the G line, one segment per lane position (3 total). */
export type LauncherSegmentId = `launcher_lane${LaneIndex}`;
/** Seven-segment SCORE readout: 3 digits x 7 segments (21 total). */
export type ScoreSegmentId = `score_digit${ScoreDigitIndex}_seg${SevenSegmentKey}`;
/** Remaining-launcher (life) indicators (3 total). */
export type LifeSegmentId = `life_${LaneIndex}`;

/**
 * Every addressable segment on the tube. Exhaustive by construction: a typo in
 * an id is a compile error, and `getSegmentById` is total over this union.
 */
export type SegmentId =
  | JetSegmentId
  | RocketSegmentId
  | MissileSegmentId
  | LauncherSegmentId
  | ScoreSegmentId
  | LifeSegmentId
  | 'battleship'
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
  missile: 6,
  launcher: 3,
  score: 21,
  life: 3,
  battleship: 1,
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
