// The printed silkscreen overlay: everything painted on the glass rather than
// emitted by the phosphor.
//
// The border, the ruler, the cell lattice, the zone labels, the station missiles
// and the arc title are ink on the front of the tube. They are visible whenever
// there is light in the room, so this layer draws on top of the phosphor layers
// and stays up when the machine is off - which is exactly how the reference
// photos of the dark unit look.
//
// Originally ported from v1's `drawSilkscreen` in src/render/renderer.ts. The
// geometry has since been re-measured against the two lit close-ups in
// `assets/reference/` (`tube-closeup-score0.webp`, `tube-closeup-score10.webp`);
// see {@link PHOTO_SCALE} for the scale the measurements are quoted in, and the
// constant blocks below for the per-feature figures. v1's plain `strokeRect`
// border, its uniform dot run and its floating zone labels were all wrong.
//
// Drawing happens in atlas units under the renderer's transform, so line widths
// and font sizes here are atlas units too and scale with the canvas.

import {
  CELL,
  CIRCLE,
  COLUMN_COUNT,
  FIELD,
  LANE_COUNT,
  PLAYFIELD,
  RULER_TICKS,
  columnCenterX,
  laneCenterY,
} from './layout.js';
import { SILKSCREEN } from './palette.js';

// PHOTOGRAPH SCALE. The measurements quoted throughout this file come off the
// two lit close-ups in `assets/reference/`, both 1600x1200 frames of the same
// unit. An ellipse fitted to the red bezel's inner edge puts the scope circle at
// radius 405 px against CIRCLE.r = 150, so **one atlas unit is 2.70 photograph
// pixels**. Every absolute size below (line widths, dot radii, glyph heights,
// missile lengths) is the measured pixel figure divided by 2.70. Positions that
// hang off the printed frame are quoted as fractions of PLAYFIELD instead: the
// playfield rectangle v1 handed down is flatter and wider relative to the scope
// circle than the real one, so absolute offsets would not land on it.

/**
 * Printed line width in atlas units.
 *
 * A luminance cut across the left rail, the top rail and the bottom rail's solid
 * stretch measures 7.0-8.5 px full-width-at-half-maximum in both photographs, so
 * 7.6 px / 2.70 = 2.8. v1 used 0.9 (0.003 of the scope's short side), which drew
 * the whole printed frame at a third of its real weight.
 */
const LINE_WIDTH = 2.8;

/** Arc title text, riding the top rim of the round scope. From v1. */
const ARC_TITLE = 'COAST SIDE MISSILE STATION RADAR SIGHT SCREEN';

/**
 * Arc title radius and font size, as fractions of the circle radius.
 *
 * Measured off the two lit close-ups in `assets/reference/`
 * (`tube-closeup-score0.webp`, `tube-closeup-score10.webp`). An axis-aligned
 * ellipse was least-squares fitted to the red bezel's inner edge in each photo
 * to recover the scope circle under the camera's mild foreshortening (residual
 * rms 0.7 px and 1.0 px; the fitted squash is 0.977 and 0.962, so the face is
 * close to head-on). The white silkscreen pixels were then un-squashed into
 * that circle's frame and measured against it:
 *
 * | Quantity                          | score0 | score10 |
 * | --------------------------------- | ------ | ------- |
 * | arc centreline radius / circle r  | 0.932  | 0.920   |
 * | cap height / circle r             | 0.029  | 0.025   |
 * | angular sweep, first ink to last  | 67.7d  | 66.0d   |
 * | sweep midpoint (-90d is straight up) | -88.5d | -88.1d |
 *
 * v1 used 0.9 and 0.076. The radius was close; the font was twice life size,
 * and since {@link drawArcText} derives its angular step from the font size,
 * that doubled the sweep too - 132 degrees against the real 67, which wrapped
 * the legend a third of the way down both sides of the scope until the last
 * letters of SCREEN collided with the G ruler label. Halving the font both
 * shrinks the glyphs and pulls the sweep back to the photographed 65 degrees;
 * the 0.62 advance factor and the top-centred start angle were already right.
 */
const ARC_RADIUS_FRACTION = 0.925;
const ARC_FONT_FRACTION = 0.038;

/**
 * Draw one line of text bent around a circle, character by character.
 *
 * Ported from v1's `drawArcText`. The angular advance per character is
 * approximated from the font size rather than measured, which is what v1 did and
 * what keeps this free of `measureText` (and therefore cheap per frame).
 */
function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  fontSize: number,
): void {
  ctx.save();
  ctx.fillStyle = SILKSCREEN;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = (fontSize * 0.62) / radius;
  const start = -Math.PI / 2 - (step * (text.length - 1)) / 2;
  for (let i = 0; i < text.length; i += 1) {
    const angle = start + i * step;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Alpha the cell lattice is printed at, relative to the rest of the ink.
 *
 * The lattice is the faintest thing on the face: in the photographs the field
 * interior reads about 70/255 where a lattice line crosses it against 50/255 of
 * bare glass and 235/255 for the frame, so the ink is laid on at roughly a
 * seventh of full strength. 0.16 rather than 0.11 because the photographs are
 * shot with the tube lit and the room dark, which lifts the lattice a little.
 */
const LATTICE_ALPHA = 0.16;

/**
 * The three printed row marks: a short heavy dash crossing a field boundary at
 * each lane's centre line.
 *
 * There is one set straddling the left edge of the distance field, just right of
 * the SCORE box, and one straddling the right rail; both measure 25 x 8.8 px
 * (9.3 x 3.3 atlas units) and sit on the lattice row centres. These are the only
 * marks the real face carries at the field edges - there is no full-height rule
 * dividing SCORE from the field, and no lane tick poking inward from the frame.
 */
const ROW_MARK_LENGTH = 9.3;
const ROW_MARK_WIDTH = 3.3;

/**
 * The three-digit SCORE readout's printed boxes, in atlas units.
 *
 * Copied with citation rather than imported, per the layer rule: the
 * `score_digit0_*`..`score_digit2_*` segments in atlas.json span x 31.718-43.238,
 * 46.694-58.214 and 61.670-73.190 over y 131.760-150.960. The printed box around
 * each digit clears the segments by a little under a line width.
 */
const SCORE_DIGIT_LEFTS = [31.718, 46.694, 61.67] as const;
const SCORE_DIGIT_WIDTH = 11.52;
const SCORE_DIGIT_TOP = 131.76;
const SCORE_DIGIT_HEIGHT = 19.2;
const SCORE_DIGIT_PAD = 1.8;

/**
 * The printed cell lattice: the countable rectangles the field is divided into.
 *
 * Seven per row across the whole playfield - the SCORE box, then one per distance
 * column - and three rows, so the field reads as a radar grid rather than empty
 * black even with the tube dark. Drawn at {@link LATTICE_ALPHA} and aligned to
 * the atlas cells, so every rectangle frames the jet that can appear in it.
 */
function drawCellLattice(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalAlpha = LATTICE_ALPHA;
  ctx.strokeStyle = SILKSCREEN;
  ctx.lineWidth = LINE_WIDTH * 0.7;

  ctx.beginPath();
  // Column boundaries: the SCORE box's right edge, then every cell edge. The
  // outermost (the playfield right border) is left to the frame.
  for (let column = 0; column < COLUMN_COUNT; column += 1) {
    const x = FIELD.x + column * CELL.width;
    ctx.moveTo(x, FIELD.y);
    ctx.lineTo(x, FIELD.y + FIELD.height);
  }
  // Row boundaries run the full playfield width so the SCORE box is divided into
  // the same three rows as the field.
  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const y = FIELD.y + lane * CELL.height;
    ctx.moveTo(PLAYFIELD.x, y);
    ctx.lineTo(PLAYFIELD.x + PLAYFIELD.width, y);
  }
  ctx.stroke();

  // A box around each SCORE digit.
  for (const left of SCORE_DIGIT_LEFTS) {
    ctx.strokeRect(
      left - SCORE_DIGIT_PAD,
      SCORE_DIGIT_TOP - SCORE_DIGIT_PAD,
      SCORE_DIGIT_WIDTH + SCORE_DIGIT_PAD * 2,
      SCORE_DIGIT_HEIGHT + SCORE_DIGIT_PAD * 2,
    );
  }

  ctx.restore();
}

/** One printed row mark, centred on `x` at `y`. */
function drawRowMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = SILKSCREEN;
  ctx.fillRect(
    x - ROW_MARK_LENGTH / 2,
    y - ROW_MARK_WIDTH / 2,
    ROW_MARK_LENGTH,
    ROW_MARK_WIDTH,
  );
}

/** A row of printed dots along `y`, from `x1` to `x2`. */
function drawDottedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  gap: number,
  radius: number,
): void {
  ctx.fillStyle = SILKSCREEN;
  for (let x = x1; x <= x2; x += gap) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Paint the whole silkscreen overlay in atlas units.
 *
 * Takes no state: the printed layer is identical on every frame and whether the
 * machine is running makes no difference to it.
 */
export function drawSilkscreen(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = SILKSCREEN;
  ctx.fillStyle = SILKSCREEN;
  ctx.lineWidth = LINE_WIDTH;
  ctx.textBaseline = 'alphabetic';

  // Arc title riding the top rim of the round scope, outside the playfield.
  drawArcText(
    ctx,
    ARC_TITLE,
    CIRCLE.cx,
    CIRCLE.cy,
    CIRCLE.r * ARC_RADIUS_FRACTION,
    CIRCLE.r * ARC_FONT_FRACTION,
  );

  // The faint printed grid, under everything else on this layer.
  drawCellLattice(ctx);

  // Playfield border.
  ctx.strokeRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);

  // Row marks: one crossing each field edge at every lane centre. This is the
  // whole of the printed separation between SCORE and the field.
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const y = laneCenterY(lane);
    drawRowMark(ctx, FIELD.x, y);
    drawRowMark(ctx, PLAYFIELD.x + PLAYFIELD.width, y);
  }

  // Dotted distance ruler along the top border, starting at the field edge.
  drawDottedLine(
    ctx,
    FIELD.x,
    PLAYFIELD.x + PLAYFIELD.width,
    PLAYFIELD.y,
    CELL.width * 0.17,
    LINE_WIDTH * 1.3,
  );

  // Ruler labels above the border, each with an L-bracket dropping to it.
  const labelSize = CELL.height * 0.5;
  ctx.font = `bold ${labelSize}px sans-serif`;
  ctx.textAlign = 'left';
  const labelY = PLAYFIELD.y - CELL.height * 0.12;
  for (const tick of RULER_TICKS) {
    const x = columnCenterX(tick.column);
    ctx.fillText(tick.label, x, labelY);
    const bracketX = x + labelSize * 0.7;
    ctx.beginPath();
    ctx.moveTo(bracketX, labelY - labelSize * 0.7);
    ctx.lineTo(bracketX, PLAYFIELD.y);
    ctx.stroke();
  }

  // Zone labels below the playfield. The lower row stays pulled inward from the
  // playfield edges: the scope circle narrows below the left rectangle tab, and
  // labels at the full width would fall outside the window.
  const zoneSize = CELL.height * 0.32;
  ctx.font = `${zoneSize}px sans-serif`;
  ctx.textAlign = 'center';
  const midY = PLAYFIELD.y + PLAYFIELD.height + CELL.height * 0.34;
  const lowY = PLAYFIELD.y + PLAYFIELD.height + CELL.height * 0.66;
  ctx.fillText('JET FIGHTER FLYING ZONE', PLAYFIELD.x + PLAYFIELD.width * 0.5, midY);
  ctx.fillText('BATTLE SHIP ZONE', PLAYFIELD.x + PLAYFIELD.width * 0.27, lowY);
  ctx.fillText('MISSILE STATION ZONE', PLAYFIELD.x + PLAYFIELD.width * 0.72, lowY);

  ctx.restore();
}
