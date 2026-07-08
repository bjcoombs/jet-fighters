// Pure, resolution-independent layout math for the VFD renderer.
//
// Everything here is a plain function of the canvas dimensions and the grid
// shape from GameState - no DOM, no canvas, no game logic - so it can be unit
// tested in the vitest node environment. renderer.ts turns these coordinates
// into pixels; sprites.ts owns the shapes drawn at them.

import { WIN_SCORE } from '../game/index.js';

/** An axis-aligned rectangle in canvas pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The bordered playfield rectangle as fractions of the canvas. The scope window
 * is round (task 6 supplies the case); the silkscreen rectangle sits centred in
 * it with the ruler above and the zone labels below, matching the reference
 * photos (screen-closeup-gameplay.jpg / device-front-gameplay.jpg).
 */
export const PLAYFIELD_FRACTION = {
  x: 0.085,
  y: 0.345,
  width: 0.83,
  height: 0.3,
} as const;

/** The white bordered playfield rectangle in canvas pixels. */
export function computePlayfield(width: number, height: number): Rect {
  return {
    x: PLAYFIELD_FRACTION.x * width,
    y: PLAYFIELD_FRACTION.y * height,
    width: PLAYFIELD_FRACTION.width * width,
    height: PLAYFIELD_FRACTION.height * height,
  };
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
