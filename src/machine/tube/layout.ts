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
 * The printed frame - the rectangle the rails draw - as fractions of the scope
 * bounding box.
 *
 * Measured off the two lit close-ups in `assets/reference/`
 * (`tube-closeup-score0.webp`, `tube-closeup-score10.webp`). Both are 1600x1200
 * frames of the same unit at different distances, so each was registered to this
 * coordinate space independently before anything was read off it: the dark glass
 * boundary was masked, a circle least-squares fitted to its right and lower arc
 * (residual sd 1.7 px and 2.2 px), and that circle equated to {@link CIRCLE}.
 * The registration checks out on features the fit did not use - the glass's left
 * edge lands at x -3.5 and x +0.4 against {@link RECT}'s x = 0, and its right
 * edge at x 363.1 against VIEWBOX.width = 363.
 *
 * Rail positions in atlas units, with the photographs' 1 degree of roll removed:
 *
 * | Rail   | score0 | score10 | used  | v1 handed down |
 * | ------ | ------ | ------- | ----- | -------------- |
 * | top    | 85.5   | 84.9    | 85.2  | 102            |
 * | bottom | 187.6  | 186.8   | 187.2 | 198            |
 * | left   | 40.2   | 42.7    | 41.4  | 19.97          |
 * | right  | 314.4  | 312.7   | 313.6 | 344.85         |
 *
 * v1's rectangle was both **too tall and too wide**, and centred on the scope
 * circle when the real frame rides high in it: the real bottom rail sits 37 units
 * below the circle's centre line where v1's sat 48, and that missing 11 units is
 * the room the zone-label plumbing in silkscreen.ts hangs in. Five constants
 * there had been fitted to the inherited rectangle to keep that plumbing inside
 * the glass; with these figures they take their measured values instead.
 */
export const PLAYFIELD_FRACTION = {
  left: 0.114,
  right: 0.864,
  top: 0.284,
  bottom: 0.624,
} as const;

/**
 * The cell band - the three lanes of printed cells - as fractions of the frame's
 * height, measured down from the top rail.
 *
 * The lanes do **not** fill the frame. In both photographs the cells float in a
 * band with black air above and below, and the frame's top rail carries the
 * dotted ruler well clear of them. Two independent readings, in atlas units:
 *
 * | Band edge | from the printed cell borders | from the lit segments |
 * | --------- | ----------------------------- | --------------------- |
 * | top       | 113.4 / 111.7                 | 115.0                 |
 * | bottom    | 166.7 / 165.0                 | 167.8                 |
 *
 * The first column is the ridge centre of the cell rectangles' own printed top
 * and bottom borders in score0 / score10. The second works back from the lit red
 * and cyan sprites, whose blob centres put lane 1 at y 141.5 and 141.6 in the two
 * photographs and the lane pitch at 17.3 - three lanes of that pitch is the band.
 * The two disagree by 2.5 units and 0.28 / 0.80 splits them, which puts the band
 * at y 113.76-166.8 and the lane pitch at 17.68.
 *
 * A third, independent check: the atlas's SCORE readout was measured off these
 * same photographs by an earlier pass and sits at y 117.5-150.9, inside this band
 * rather than spread over the frame - so the atlas already half agreed with the
 * glass while the lattice around it did not.
 */
export const FIELD_BAND_FRACTION = {
  top: 0.28,
  bottom: 0.8,
} as const;

/**
 * Fraction of the playfield width occupied by the SCORE box, left of the printed
 * inner rule. Measured at 0.199 in both device-front reference frames and
 * rounded to 0.20; see ATLAS-COORDINATES.md, "The score box measurement".
 */
export const SCORE_BOX_FRACTION = 0.2;

/**
 * Distance cells across the field. atlas-schema.ts `ColumnIndex` is 0..6.
 *
 * Seven, counted off the printed cell boxes in
 * `assets/reference/tube-teardown/tube-unlit-full.jpg`: cell 0 the battleship
 * over printed sea, cells 1-5 the jet columns, cell 6 the player's end at the
 * `G` line. Six was never a claim about the glass - the ROM has modelled seven
 * columns all along and `PAT_COLUMN` mapped its columns 5 and 6 onto the same
 * display grid, which is the collapse this count removes. A cell and a grid are
 * now the same thing, which is also what makes the ROM/atlas conformance test
 * able to see a one-cell error at all.
 */
export const COLUMN_COUNT = 7;

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

/**
 * The cell band's vertical extent, shared by the SCORE box and the field.
 *
 * Both are the same three printed rows, so they take their y and height from
 * here rather than from {@link PLAYFIELD}: the frame is taller than the band it
 * encloses. See {@link FIELD_BAND_FRACTION}.
 */
const BAND_TOP = PLAYFIELD.y + PLAYFIELD.height * FIELD_BAND_FRACTION.top;
const BAND_HEIGHT = PLAYFIELD.height * (FIELD_BAND_FRACTION.bottom - FIELD_BAND_FRACTION.top);

/** The SCORE box: the region left of the printed inner vertical rule. */
export const SCORE_BOX: Box = {
  x: PLAYFIELD.x,
  y: BAND_TOP,
  width: PLAYFIELD.width * SCORE_BOX_FRACTION,
  height: BAND_HEIGHT,
};

/**
 * The distance-column field: everything right of the inner rule.
 *
 * This is the one place the tube deviates from v1's layout maths, and it is
 * deliberate. v1 spread all six distance columns across the whole playfield and
 * drew the SCORE readout on top of the column-0 cells; two phosphor segments
 * cannot occupy the same area of glass, so the atlas separates them and the
 * silkscreen follows the atlas.
 *
 * Vertically the field is the cell band, not the frame - the lanes sit in the
 * middle 52% of the frame's height with printed black air above and below.
 */
export const FIELD: Box = {
  x: SCORE_BOX.x + SCORE_BOX.width,
  y: BAND_TOP,
  width: PLAYFIELD.width - SCORE_BOX.width,
  height: BAND_HEIGHT,
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

/**
 * The dotted ruler's own scale: marks per tick, and how many mark pitches of it
 * the field is wide.
 *
 * **The ruler is not the cell lattice, and it does not divide the field into
 * cells.** That was the standing assumption - "five marks to the column, so the
 * ticks land on the column boundaries" - and the photographs contradict it.
 *
 * Both lit close-ups in `assets/reference/` were registered to this coordinate
 * space before anything was read off them. Each is shot slightly off axis, so
 * the printed frame photographs as a trapezoid rather than a rectangle: the left
 * and right rails were located at two rows apiece and interpolated to the
 * ruler's own row, and every x below is quoted as a fraction of the frame width
 * at that row. That removes the camera distance and the keystone together, and
 * it is why the two photographs agree here to better than a percent where their
 * raw pixel scales differ by ten.
 *
 * | Quantity                                      | score0 | score10 |
 * | --------------------------------------------- | ------ | ------- |
 * | left crosshair, fraction of frame width       | 0.2065 | 0.2008  |
 * | right crosshair                               | 0.9979 | 0.9994  |
 * | tick pitch                                    | 0.1060 | 0.1067  |
 * | field width, in tick pitches                  | 7.464  | 7.483   |
 * | first tick, in pitches right of the crosshair | 1.002  | 1.007   |
 *
 * The left crosshair lands on {@link FIELD}`.x` (0.2 by {@link
 * SCORE_BOX_FRACTION}) and the right one on the right rail, which is the check
 * that the registration holds - neither was used to fit it. Between them the run
 * is **seven and a half tick pitches**, so there are **seven** ticks, the first a
 * full pitch right of the left crosshair and the last half a pitch short of the
 * right one. The previous model drew six at a pitch of one cell - 13% wider -
 * which is why the error grew left to right and was worst at `G`.
 *
 * Counted off score10, where the glass is cleanest: four dots, then seven ticks
 * with four dots between each pair, then one last dot before the right
 * crosshair. 36 marks drawn of the 37.5 the field spans.
 */
export const RULER_MARKS_PER_TICK = 5;
export const RULER_SPAN_MARKS = 37.5;
export const RULER_MARK_COUNT = 36;
export const RULER_TICK_COUNT = 7;

/** The ruler's mark pitch: the spacing of the dots along the top rail. */
export const RULER_MARK_PITCH = FIELD.width / RULER_SPAN_MARKS;

/** Centre-x of ruler mark `mark`, counting from the left crosshair at mark 0. */
export function rulerMarkX(mark: number): number {
  return FIELD.x + mark * RULER_MARK_PITCH;
}

/** Centre-x of ruler tick `tick`, 1-based. Tick 0 would be the left crosshair. */
export function rulerTickX(tick: number): number {
  return rulerMarkX(tick * RULER_MARKS_PER_TICK);
}

/** A silkscreened ruler label and the 1-based ruler tick its bracket drops on. */
export interface RulerTick {
  readonly label: string;
  readonly tick: number;
}

/**
 * The printed 10 / 3 / 2 / 1 / G ruler: 10 marks the battleship zone, 3 / 2 / 1
 * the jet scoring bands, and G the capture line at the player's end.
 *
 * **A numeral is placed by the tick its bracket drops on, not by a column.**
 * Registered as above, the five bracket drops land on ticks 1, 2, 3, 4 and 6,
 * every one of them inside the tick's own printed width:
 *
 * | Label | tick | drop - tick, score0 | score10 |
 * | ----- | ---- | ------------------- | ------- |
 * | `10`  | 1    | +0.18               | +0.00   |
 * | `3`   | 2    | -0.18               | +0.00   |
 * | `2`   | 3    | +0.18               | +0.00   |
 * | `1`   | 4    | -0.35               | -0.64   |
 * | `G`   | 6    | -0.53               | -1.29   |
 *
 * in atlas units, against a tick 2.6 wide. Ticks 5 and 7 carry no label.
 *
 * These were previously placed at cell centres - `10` over cell 0, `2` spanning
 * cells 2-3, `1` spanning cells 4-5 - reasoning from the ROM's `PAT_COLUMN`
 * scoring table. That was an inference and the ink disagrees with it: the ruler
 * is printed on the front overlay and the cells are on the tube behind it, the
 * two run on different pitches (see {@link RULER_SPAN_MARKS}), and under it no
 * numeral landed on a tick at all. The photographs are the authority on where
 * the ink is, so the scoring table no longer places the numerals. Nothing about
 * scoring itself changes - the ROM is untouched.
 */
export const RULER_TICKS: readonly RulerTick[] = [
  { label: '10', tick: 1 },
  { label: '3', tick: 2 },
  { label: '2', tick: 3 },
  { label: '1', tick: 4 },
  { label: 'G', tick: 6 },
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
