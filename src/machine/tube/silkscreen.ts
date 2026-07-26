// The printed silkscreen overlay: everything painted on the glass rather than
// emitted by the phosphor.
//
// The border, the ruler, the lane ticks, the zone labels and the arc title are
// ink on the front of the tube. They are visible whenever there is light in the
// room, so this layer draws on top of the phosphor layers and stays up when the
// machine is off - which is exactly how the reference photos of the dark unit
// look.
//
// Ported from v1's `drawSilkscreen` in src/render/renderer.ts, re-expressed in
// atlas units. v1 is read, not imported: task 11 deletes src/render/. The one
// deliberate change is the inner vertical rule dividing the SCORE box from the
// distance-column field, which device-front-gameplay.jpg shows and v1 lacked
// (v1 drew the score readout on top of the column-0 cells - see layout.ts).
//
// Drawing happens in atlas units under the renderer's transform, so line widths
// and font sizes here are atlas units too and scale with the canvas.

import {
  CELL,
  CIRCLE,
  FIELD,
  LANE_COUNT,
  PLAYFIELD,
  RULER_TICKS,
  columnCenterX,
} from './layout.js';
import { SILKSCREEN } from './palette.js';

/** Printed line width in atlas units. v1 used 0.003 of the scope's short side. */
const LINE_WIDTH = 0.9;

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

  // Playfield border.
  ctx.strokeRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);

  // Inner vertical rule: the SCORE box on its left, the distance columns on its
  // right (device-front-gameplay.jpg).
  ctx.beginPath();
  ctx.moveTo(FIELD.x, PLAYFIELD.y);
  ctx.lineTo(FIELD.x, PLAYFIELD.y + PLAYFIELD.height);
  ctx.stroke();

  // Dotted distance ruler along the top border, starting at the inner rule.
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

  // Lane separator ticks at both edges of the playfield border.
  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const y = FIELD.y + (lane / LANE_COUNT) * FIELD.height;
    ctx.beginPath();
    ctx.moveTo(PLAYFIELD.x, y);
    ctx.lineTo(PLAYFIELD.x + CELL.width * 0.2, y);
    ctx.moveTo(PLAYFIELD.x + PLAYFIELD.width - CELL.width * 0.2, y);
    ctx.lineTo(PLAYFIELD.x + PLAYFIELD.width, y);
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
