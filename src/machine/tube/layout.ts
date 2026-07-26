// Tube layout: the scope window and the printed silkscreen, in atlas units.
//
// Pure geometry - no canvas, no DOM - so it unit tests in plain Node alongside
// the atlas. renderer.ts turns these coordinates into pixels; silkscreen.ts
// draws at them.
//
// Everything here is expressed in the atlas coordinate space (viewBox
// 0 0 363 300, +x right, +y down), which is the scope bounding box of
// src/ui/geometry.ts with its origin translated to (0, 0). See
// ATLAS-COORDINATES.md for the derivation.
//
// The constants below are **copied** from v1 with their source cited, not
// imported: task 11 deletes src/game/ and src/render/, and nothing in
// src/machine/ may break when it does. That is the same rule the atlas followed.

import { loadAtlas } from './atlas.js';

/** The atlas viewBox: the scope bounding box, origin-translated. */
export const VIEWBOX = { width: 363, height: 300 } as const;

/**
 * The radar circle in atlas units.
 *
 * src/ui/geometry.ts `SCOPE_CIRCLE` is centre (533, 222) radius 150 in case
 * viewBox units; the scope bounding box starts at (320, 72), so the circle sits
 * at (213, 150) here. 1 atlas unit = 1 case viewBox unit.
 */
export const CIRCLE = { cx: 213, cy: 150, r: 150 } as const;

/**
 * The rectangular tab fused onto the circle's left, where SCORE lives.
 * src/ui/geometry.ts `SCOPE_RECT` (320, 150, 213 x 144), origin-translated.
 */
export const RECT = { x: 0, y: 78, width: 213, height: 144 } as const;

/**
 * The printed playfield as fractions of the scope bounding box. Taken unchanged
 * from v1's src/render/layout.ts `PLAYFIELD_FRACTION`.
 */
export const PLAYFIELD_FRACTION = {
  left: 0.055,
  right: 0.95,
  top: 0.34,
  bottom: 0.66,
} as const;

/**
 * Fraction of the playfield width occupied by the SCORE box, left of the printed
 * inner rule. Measured at 0.199 in both device-front reference frames and
 * rounded to 0.20; see ATLAS-COORDINATES.md, "The score box measurement".
 */
export const SCORE_BOX_FRACTION = 0.2;

/** Distance columns across the field. atlas-schema.ts `ColumnIndex` is 0..5. */
export const COLUMN_COUNT = 6;

/** Lanes down the field. atlas-schema.ts `LaneIndex` is 0..2. */
export const LANE_COUNT = 3;

/** An axis-aligned rectangle in atlas units. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function box(left: number, top: number, right: number, bottom: number): Box {
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The bordered playfield the silkscreen draws around the whole tube face. */
export const PLAYFIELD: Box = box(
  PLAYFIELD_FRACTION.left * VIEWBOX.width,
  PLAYFIELD_FRACTION.top * VIEWBOX.height,
  PLAYFIELD_FRACTION.right * VIEWBOX.width,
  PLAYFIELD_FRACTION.bottom * VIEWBOX.height,
);

/** The SCORE box: the region left of the printed inner vertical rule. */
export const SCORE_BOX: Box = {
  x: PLAYFIELD.x,
  y: PLAYFIELD.y,
  width: PLAYFIELD.width * SCORE_BOX_FRACTION,
  height: PLAYFIELD.height,
};

/**
 * The distance-column field: everything right of the inner rule.
 *
 * This is the one place the tube deviates from v1's layout maths, and it is
 * deliberate. v1 spread all six distance columns across the whole playfield and
 * drew the SCORE readout on top of the column-0 cells; two phosphor segments
 * cannot occupy the same area of glass, so the atlas separates them and the
 * silkscreen follows the atlas.
 */
export const FIELD: Box = {
  x: SCORE_BOX.x + SCORE_BOX.width,
  y: PLAYFIELD.y,
  width: PLAYFIELD.width - SCORE_BOX.width,
  height: PLAYFIELD.height,
};

/** One distance-column x lane cell of the field, in atlas units. */
export const CELL = {
  width: FIELD.width / COLUMN_COUNT,
  height: FIELD.height / LANE_COUNT,
} as const;

/**
 * Centre-x of a distance column. Column 0 (the battleship / far zone) sits at
 * the left, column 5 (the G capture line) at the right. Fractional columns are
 * accepted so a ruler label can land between cells.
 */
export function columnCenterX(column: number): number {
  return FIELD.x + ((column + 0.5) / COLUMN_COUNT) * FIELD.width;
}

/** Centre-y of a lane. Lane 0 = top, increasing downward. */
export function laneCenterY(lane: number): number {
  return FIELD.y + ((lane + 0.5) / LANE_COUNT) * FIELD.height;
}

/** A silkscreened ruler label and the (possibly fractional) column it marks. */
export interface RulerTick {
  readonly label: string;
  readonly column: number;
}

/**
 * The printed 10 / 3 / 2 / 1 / G ruler. Unchanged from v1's `rulerTicks`: 10
 * marks the battleship zone, 3 / 2 / 1 the jet scoring bands, and G the capture
 * line at the last column.
 */
export const RULER_TICKS: readonly RulerTick[] = [
  { label: '10', column: 0 },
  { label: '3', column: 1.5 },
  { label: '2', column: 3 },
  { label: '1', column: 4 },
  { label: 'G', column: COLUMN_COUNT - 1 },
];

/** The atlas box mapped onto a canvas, uniformly scaled and centred. */
export interface TubeProjection {
  /** Atlas units to CSS pixels. Uniform, so the scope circle stays round. */
  readonly scale: number;
  /** CSS pixels from the canvas origin to the atlas origin. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The projected atlas box in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/**
 * Fit the atlas box into a `cssWidth` x `cssHeight` canvas.
 *
 * The scale is a single scalar so the scope circle stays round, matching
 * `projectScope` in src/ui/geometry.ts; the canvas is sized to the same bounding
 * box by the case shell, so in practice the offsets are zero and this only
 * absorbs sub-pixel drift. Degenerate sizes project to a zero scale rather than
 * NaN, so a draw before the first resize is a no-op instead of a crash.
 */
export function projectTube(cssWidth: number, cssHeight: number): TubeProjection {
  const usableWidth = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0;
  const usableHeight = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 0;
  const scale = Math.min(usableWidth / VIEWBOX.width, usableHeight / VIEWBOX.height);
  const width = VIEWBOX.width * scale;
  const height = VIEWBOX.height * scale;
  return {
    scale,
    offsetX: (usableWidth - width) / 2,
    offsetY: (usableHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Assert that the copied scope constants still agree with the shipped atlas.
 *
 * The atlas is the contract between the two; if either moves, the silkscreen
 * would drift off the segments. Exported so the drift check is a test, not a
 * comment.
 */
export function viewBoxMatchesAtlas(): boolean {
  const viewBox = loadAtlas().viewBox;
  return (
    viewBox.x === 0 &&
    viewBox.y === 0 &&
    viewBox.width === VIEWBOX.width &&
    viewBox.height === VIEWBOX.height
  );
}
