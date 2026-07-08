// Pure, resolution-independent layout math for the VFD renderer.
//
// Everything here is a plain function of the projected scope geometry (from
// src/ui/geometry) and the grid shape from GameState - no DOM, no canvas, no
// game logic - so it can be unit tested in the vitest node environment.
// renderer.ts turns these coordinates into pixels; sprites.ts owns the shapes
// drawn at them. The scope-window shape (circle + left rectangle) is the single
// source of truth in src/ui/geometry; the playfield and rim geometry below are
// derived from it, never invented independently.

import { WIN_SCORE } from '../game/index.js';
import type { Rect, ScopeGeometry } from '../ui/geometry.js';

export type { Rect } from '../ui/geometry.js';

/**
 * The bordered playfield as fractions of the scope bounding box. The band is
 * centred vertically on the circle and spans nearly the full width (from the
 * left rectangle tab across the circle), leaving room for the ruler above and
 * the zone labels below, matching the reference photos.
 */
export const PLAYFIELD_FRACTION = {
  left: 0.055,
  right: 0.95,
  top: 0.34,
  bottom: 0.66,
} as const;

/** The white bordered playfield rectangle in canvas pixels, derived from geometry. */
export function computePlayfield(geom: ScopeGeometry): Rect {
  const b = geom.bounds;
  const x = b.x + PLAYFIELD_FRACTION.left * b.width;
  const right = b.x + PLAYFIELD_FRACTION.right * b.width;
  const y = b.y + PLAYFIELD_FRACTION.top * b.height;
  const bottom = b.y + PLAYFIELD_FRACTION.bottom * b.height;
  return { x, y, width: right - x, height: bottom - y };
}

/** Centre and radius for the arc title text, riding just inside the circle rim. */
export function arcGeometry(geom: ScopeGeometry): {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
} {
  return { cx: geom.circle.cx, cy: geom.circle.cy, radius: geom.circle.r * 0.9 };
}

/**
 * Centre-x of a distance column. Column 0 (battleship / far zone) sits at the
 * left, the last column (G / capture line, launcher) at the right. Accepts a
 * fractional column so the ruler labels can land between cells.
 */
export function columnToX(
  column: number,
  gridColumns: number,
  playfield: Rect,
): number {
  return playfield.x + ((column + 0.5) / gridColumns) * playfield.width;
}

/** Centre-y of a lane. Lane 0 = top, increasing downward. */
export function laneToY(lane: number, laneCount: number, playfield: Rect): number {
  return playfield.y + ((lane + 0.5) / laneCount) * playfield.height;
}

/** Width and height of a single grid cell in canvas pixels. */
export function cellExtent(
  gridColumns: number,
  laneCount: number,
  playfield: Rect,
): { readonly width: number; readonly height: number } {
  return {
    width: playfield.width / gridColumns,
    height: playfield.height / laneCount,
  };
}

/** A silkscreened ruler label and the (possibly fractional) column it marks. */
export interface RulerTick {
  readonly label: string;
  readonly column: number;
}

/**
 * The printed 10 / 3 / 2 / 1 / G ruler. 10 marks the battleship zone (column
 * 0), 3 / 2 / 1 the jet scoring bands, and G the capture line at the last
 * column, mirroring the SCORE_BANDS in the game logic and the reference photo.
 */
export function rulerTicks(gridColumns: number): readonly RulerTick[] {
  const last = gridColumns - 1;
  return [
    { label: '10', column: 0 },
    { label: '3', column: 1.5 },
    { label: '2', column: 3 },
    { label: '1', column: 4 },
    { label: 'G', column: last },
  ];
}

/**
 * The score digits to display, capped at {@link WIN_SCORE} (the physical VFD is
 * a 2-3 digit readout). No leading zeros; 0 renders as a single `0`.
 */
export function splitScoreDigits(score: number, cap: number = WIN_SCORE): number[] {
  const clamped = Math.max(0, Math.min(cap, Math.floor(score)));
  return String(clamped)
    .split('')
    .map((c) => Number(c));
}
