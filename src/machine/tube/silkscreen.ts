// The printed silkscreen overlay: everything painted on the glass rather than
// emitted by the phosphor.
//
// The border, the ruler, the SCORE digit boxes, the zone labels, the station
// missiles and the arc title are ink on the front. They are visible whenever
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
  CIRCLE,
  FIELD,
  LANE_COUNT,
  PLAYFIELD,
  RULER_MARKS_PER_TICK,
  RULER_MARK_COUNT,
  RULER_TICKS,
  laneCenterY,
  rulerMarkX,
  rulerTickX,
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
 * Alpha the faintest printed ink is laid on at, relative to the rest.
 *
 * In the photographs the field interior reads about 70/255 where one of these
 * lines crosses it against 50/255 of bare glass and 235/255 for the frame, so
 * roughly a seventh of full strength. 0.16 rather than 0.11 because the
 * photographs are shot with the tube lit and the room dark, which lifts it a
 * little.
 */
const FAINT_ALPHA = 0.16;

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
 * `score_digit0_*`..`score_digit2_*` segments in atlas.json span x 51.231-60.885,
 * 63.781-73.435 and 76.330-85.984 over y 130.202-140.810. The printed box around
 * each digit clears the segments by a little under a line width.
 *
 * These moved with the atlas when layout.ts took the frame and the cell band off
 * the photographs; the box has to keep framing the segments it is drawn around,
 * so the citation is re-read rather than left pointing at the old coordinates.
 */
const SCORE_DIGIT_LEFTS = [51.231, 63.781, 76.33] as const;
const SCORE_DIGIT_WIDTH = 9.654;
const SCORE_DIGIT_TOP = 130.202;
const SCORE_DIGIT_HEIGHT = 10.608;
const SCORE_DIGIT_PAD = 1.5;

/**
 * The faint printed box around each SCORE digit.
 *
 * **This used to draw the cell lattice too** - seven verticals on the cell
 * boundaries and two horizontals on the lane boundaries, a hash right across the
 * glass. It went in with #48 for a stated reason: "the field was empty black
 * between the frame and the phosphor", and the lattice was what made the face
 * read as a radar screen rather than a void.
 *
 * That reason no longer holds. The renderer's ghost layer draws *every* segment
 * at the unlit-phosphor level (renderer.ts, pipeline step 2), so the field now
 * carries the tube's own printed artwork - the jets, the bursts, the sea - in
 * every cell, dark or lit. The lattice was a second, brighter copy of a division
 * the ghosting already shows, and drawn on the wrong pitch besides: it used the
 * cell boundaries the {@link RULER_SPAN_MARKS} registration finds the printed
 * ruler does not share. Owner-confirmed against the real unit.
 *
 * The digit boxes stay. They are on the tube in
 * `assets/reference/tube-teardown/score-block.jpg`, the ghost layer does not
 * draw them - a box is not a segment - and they are three small rectangles
 * rather than a grid over the playfield.
 */
function drawScoreDigitBoxes(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalAlpha = FAINT_ALPHA;
  ctx.strokeStyle = SILKSCREEN;
  ctx.lineWidth = LINE_WIDTH * 0.7;

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

/**
 * Radius of the printed frame's rounded left corners. Photographs: about 10 px.
 * The right corners are not corners at all - the right rail runs on past both
 * rails, so there is nothing there to round.
 */
const CORNER_RADIUS = 3.7;

/**
 * The bottom rail: a row of long heavy dashes, and the heaviest ink on the face.
 *
 * A luminance cut through a dash measures 11 px against 7.6 px for every other
 * printed line, so 11 / 2.70 = 4.1. The dashes measure 79 px long on an 88 px
 * pitch (a duty of 0.9) and run from the SCORE box's right edge to a little past
 * the right rail; the stretch under the SCORE box itself is solid, at the normal
 * line width. Seven dashes span the distance field in the photographs (632 px of
 * field over an 88 px pitch is 7.2), and an eighth starts exactly on the right
 * rail and is cut short by the glass.
 *
 * The overhang past the right rail measures 57 px, which in atlas units would put
 * ink outside the scope circle; 9.5 is as far as the window reaches at this
 * height.
 */
const BOTTOM_RAIL_WIDTH = 4.1;
const BOTTOM_RAIL_DASHES = 7;
const BOTTOM_RAIL_DUTY = 0.9;
const BOTTOM_RAIL_OVERHANG = 9.5;

/**
 * The dotted distance ruler along the top rail.
 *
 * The dots are chunky - 9.5 px across, so a radius of 1.8 - and they run at a
 * single uniform pitch with every fifth mark replaced by a short vertical tick,
 * which is what reads as "groups of four separated by a tick". The tick itself is
 * 7 x 21 px, standing clear of the rail above and below.
 *
 * Where the ticks fall is layout.ts's business, not this file's: the pitch is not
 * a cell and the run does not end on the right rail. See {@link RULER_SPAN_MARKS}
 * for the registration those figures come off, and {@link rulerMarkX} for the
 * scale itself.
 */
const RULER_DOT_RADIUS = 1.8;
const RULER_TICK_WIDTH = 2.6;
const RULER_TICK_HEIGHT = 7.8;

/**
 * The surveyor's crosshairs at both ends of the dotted ruler.
 *
 * A ring 16 px across sits where the solid rail hands over to the dots (the
 * field's left edge) and again on the right rail, each with a bar running well
 * above the rail and a shorter tail below. The right-hand one also throws a
 * horizontal arm outward past the rail - 28 px in the photograph, trimmed here to
 * what the glass allows.
 */
const CROSSHAIR_RADIUS = 3;
const CROSSHAIR_RISE = 16;
const CROSSHAIR_DROP = 6;
const CROSSHAIR_ARM = 9.5;

/**
 * The 10 / 3 / 2 / 1 / G ruler numerals and the elbow bracket each one carries.
 *
 * Cap height measures 24 px (8.9 atlas units, so about a 12.3 unit font at the
 * 0.72 cap ratio of a bold sans), and the baseline sits 45.5 px clear of the rail
 * - a seventh of the playfield height, where this layer previously used a
 * twelfth. The bracket is an arm leaving the numeral's shoulder at 0.55 of cap
 * height, running sideways, then dropping to just short of the rail: `10` reads
 * as `10⌐`. The last label (`G`) has its bracket mirrored - arm and drop to its
 * left, so it reads as `⌐G` - which is what both photographs show.
 *
 * **The drop lands on a ruler tick**, and the arm is what sets the numeral's
 * distance from it - so the numeral is placed from its drop outward, not the
 * drop from the numeral. `RULER_TICKS` says which tick each label drops on and
 * how that was measured. The arm runs from the numeral's near edge to the drop
 * and measures 7.7-9.0 atlas units across the eight readable brackets in the two
 * close-ups (score0 7.7 / 8.1 / 8.1 / 8.4, score10 9.0 / 9.0 / 8.4 / 8.4 / 9.3),
 * so 8.5.
 *
 * The reach used to be 0.38 of a cell measured from the numeral's *centre*,
 * chosen to keep `1` and `G` from sharing a drop line when they sat in adjacent
 * columns. Both halves of that are gone: the labels are no longer placed by
 * column, and on their measured ticks `1` and `G` are two pitches apart.
 */
const RULER_LABEL_SIZE = 12.3;
const RULER_LABEL_CAP = 8.9;
const RULER_LABEL_RISE_FRACTION = 0.14;
const RULER_ELBOW_ARM = 8.5;
const RULER_ELBOW_GAP_FRACTION = 0.06;

/**
 * The zone-label bracket plumbing hanging below the bottom rail.
 *
 * This is one of the most distinctive things on the face and it was missing
 * entirely: the labels used to float, centred, just under the rail. What the
 * photographs show, working outward from the middle:
 *
 * - Two drop lines leave the bottom rail, one at the field's left edge and one on
 *   the right rail, and turn inward along a horizontal at {@link ZONE_MID_DEPTH}.
 * - Each inward run ends in a short arm turning back up, and a second arm just
 *   inboard of it turns up too, so the pair reads as nested square brackets.
 * - `JET FIGHTER FLYING ZONE` is joined to the inner pair by a horizontal dash on
 *   each side.
 * - `BATTLE SHIP ZONE` hangs from the left outer run on a deeper bracket at
 *   {@link ZONE_LOW_DEPTH}, joined by a dash on its left; `MISSILE STATION ZONE`
 *   hangs from the right outer run and is joined on its right, its bracket
 *   turning back up to the rail.
 *
 * Depths are fractions of the playfield height and columns are fractions of its
 * width. These were previously fitted rather than measured: the inherited
 * playfield rectangle was too tall and too wide for the scope circle, so at the
 * photographed depths the outer drops and the lower brackets fell outside the
 * glass. layout.ts now takes the frame off the photographs, and these are the
 * measured figures - read off both close-ups after registering each to the scope
 * circle, and agreeing between them to better than a percent:
 *
 * | Feature                    | score0 | score10 | used  | was fitted to |
 * | -------------------------- | ------ | ------- | ----- | ------------- |
 * | middle line, depth         | 0.334  | 0.332   | 0.33  | 0.235         |
 * | lower line, depth          | 0.559  | 0.568   | 0.57  | 0.45          |
 * | outer bracket arm, left    | 0.283  | 0.282   | 0.283 | 0.3           |
 * | inner bracket arm, left    | 0.299  | 0.298   | 0.298 | 0.315         |
 * | inner bracket arm, right   | 0.862  | 0.861   | 0.861 | 0.845         |
 * | outer bracket arm, right   | 0.878  | 0.877   | 0.877 | 0.86          |
 * | lower bracket column, left | 0.231  | 0.232   | 0.232 | 0.28          |
 * | lower bracket column, right| 0.961  | 0.962   | 0.961 | 0.9           |
 *
 * The deepest ink is the lower row, and it now clears the glass with room to
 * spare: its left column lands 144 units from the circle's centre and its right
 * column 131, against a radius of 150. On the inherited rectangle the same two
 * measured fractions would have landed at 151 and 153 - outside the glass, which
 * is why they had been pulled in.
 *
 * {@link ZONE_INNER_RISE} is left as it was. The photographs put the arms' rise at
 * 0.158 of the frame height (they run from y 205.2 to the middle line at 221.3 in
 * both), and they also show the outer drops turning inward at the arms' top rather
 * than at the middle line as drawn here - but neither is a fitted constant and the
 * bracket's topology is not this change's business.
 */
const ZONE_MID_DEPTH = 0.33;
const ZONE_LOW_DEPTH = 0.57;
const ZONE_INNER_RISE = 0.115;
const ZONE_BRACKET_INNER = [0.283, 0.298, 0.861, 0.877] as const;
const ZONE_LOW_LEFT_FRACTION = 0.232;
const ZONE_LOW_RIGHT_FRACTION = 0.961;
const ZONE_LABEL_SIZE = 8;
const ZONE_LABEL_ADVANCE = 0.6;
const ZONE_DASH_GAP = 3;

/**
 * The three station missiles at the right edge of the glass.
 *
 * Painted, not phosphor - owner-confirmed - and drawn here because the atlas no
 * longer carries them. One at each lane centre, in the glass outboard of the right
 * rail. Two figures were handed over with this item, `x 346.4 to 359.4` and
 * `13 x 8`; the x origin is taken from them, and the other two need recording,
 * because they disagree with the photographs and with the scope window.
 *
 * **Orientation.** The item was described as nose up. At 8x both photographs show
 * a bullet lying *horizontally* - rounded nose pointing left, into the field and
 * toward the jets, square tail outboard - measuring about 49 x 19 px. The handed
 * over `13 x 8` is itself wider than it is tall, so it agrees with the
 * photographs and only the word disagrees. Drawn horizontal, nose left.
 *
 * **These four constants have gone back to scale**, which #51 asked for: "the
 * inherited playfield is about 27 units wider than the photographed one and so
 * reaches much closer to the bezel. If that geometry is corrected upstream, these
 * four constants should go back to scale." layout.ts has now corrected it - the
 * right rail is at the measured 313.6 rather than 344.85 - so there are 49 atlas
 * units of glass outboard of the rail instead of 15, and the squeeze is gone.
 *
 * At the photograph scale 49 x 19 px is 15.4 x 6.0 atlas units (score10) or
 * 17.1 x 6.6 (score0); 15.4 x 6 is taken, an aspect of 2.6 against the
 * photographed 2.6 - #51 could only reach 2.0. The nose lands at x 331.6, which is
 * where the bullets' noses register in the photographs: x 331.4 and 331.7. The
 * furthest corner is now 137 units from the scope circle's centre against a radius
 * of 150, where before the same figures would not have fitted at all.
 */
const MISSILE_GAP = 18;
const MISSILE_LENGTH = 15.4;
const MISSILE_HEIGHT = 6;
const MISSILE_NOSE_FRACTION = 0.5;

/** The printed frame: left rail, the solid rail stretches, and the right rail. */
function drawFrame(ctx: CanvasRenderingContext2D, rightRailBottom: number): void {
  const left = PLAYFIELD.x;
  const right = PLAYFIELD.x + PLAYFIELD.width;
  const top = PLAYFIELD.y;
  const bottom = PLAYFIELD.y + PLAYFIELD.height;

  ctx.strokeStyle = SILKSCREEN;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  // Top rail: solid only as far as the field's left edge, where the crosshair
  // hands over to the dots. There is no line under the dots.
  ctx.moveTo(FIELD.x, top);
  ctx.lineTo(left + CORNER_RADIUS, top);
  ctx.quadraticCurveTo(left, top, left, top + CORNER_RADIUS);
  ctx.lineTo(left, bottom - CORNER_RADIUS);
  ctx.quadraticCurveTo(left, bottom, left + CORNER_RADIUS, bottom);
  // Bottom rail: solid under the SCORE box, dashed from here on.
  ctx.lineTo(FIELD.x, bottom);
  // Right rail: up through the top rail to the crosshair, and down past the
  // bottom rail to wherever the zone brackets pick it up.
  ctx.moveTo(right, top - CROSSHAIR_RISE);
  ctx.lineTo(right, rightRailBottom);
  ctx.stroke();
}

/** The long heavy dashes that make up the rest of the bottom rail. */
function drawBottomRail(ctx: CanvasRenderingContext2D): void {
  const y = PLAYFIELD.y + PLAYFIELD.height;
  const end = PLAYFIELD.x + PLAYFIELD.width + BOTTOM_RAIL_OVERHANG;
  const pitch = FIELD.width / BOTTOM_RAIL_DASHES;

  ctx.strokeStyle = SILKSCREEN;
  ctx.lineWidth = BOTTOM_RAIL_WIDTH;
  ctx.beginPath();
  for (let dash = 0; ; dash += 1) {
    const start = FIELD.x + dash * pitch;
    if (start >= end) break;
    ctx.moveTo(start, y);
    ctx.lineTo(Math.min(start + pitch * BOTTOM_RAIL_DUTY, end), y);
  }
  ctx.stroke();
}

/**
 * The ruler: chunky dots at a uniform pitch, every fifth mark a tick.
 *
 * The run starts one pitch right of the left crosshair, so that crosshair stands
 * alone; at the other end it simply stops where the printed run stops, a mark and
 * a half short of the right crosshair. See {@link RULER_SPAN_MARKS}.
 */
function drawRuler(ctx: CanvasRenderingContext2D): void {
  const y = PLAYFIELD.y;

  for (let mark = 1; mark <= RULER_MARK_COUNT; mark += 1) {
    const x = rulerMarkX(mark);
    if (mark % RULER_MARKS_PER_TICK === 0) {
      ctx.fillStyle = SILKSCREEN;
      ctx.fillRect(
        x - RULER_TICK_WIDTH / 2,
        y - RULER_TICK_HEIGHT / 2,
        RULER_TICK_WIDTH,
        RULER_TICK_HEIGHT,
      );
    } else {
      ctx.fillStyle = SILKSCREEN;
      ctx.beginPath();
      ctx.arc(x, y, RULER_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** One surveyor's crosshair on the top rail: a ring, a tall bar, and its arm. */
function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, arm: number): void {
  const y = PLAYFIELD.y;
  ctx.strokeStyle = SILKSCREEN;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  ctx.arc(x, y, CROSSHAIR_RADIUS, 0, Math.PI * 2);
  ctx.moveTo(x, y - CROSSHAIR_RISE);
  ctx.lineTo(x, y + CROSSHAIR_DROP);
  if (arm !== 0) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + arm, y);
  }
  ctx.stroke();
}

/**
 * The ruler numerals, each with its elbow bracket dropping to the rail.
 *
 * Glyph advance is approximated from the font size rather than measured, for the
 * same reason {@link drawArcText} approximates it: `measureText` would put a
 * layout pass in the per-frame path.
 */
function drawRulerLabels(ctx: CanvasRenderingContext2D): void {
  const baseline = PLAYFIELD.y - PLAYFIELD.height * RULER_LABEL_RISE_FRACTION;
  const armY = baseline - RULER_LABEL_CAP * 0.55;
  const dropBottom = PLAYFIELD.y - PLAYFIELD.height * RULER_ELBOW_GAP_FRACTION;

  ctx.font = `bold ${RULER_LABEL_SIZE}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = LINE_WIDTH;

  for (let index = 0; index < RULER_TICKS.length; index += 1) {
    const tick = RULER_TICKS[index];
    // `G` is the one mirrored bracket - arm and drop to its left - which is what
    // both photographs show, and it is the last label.
    const side = index === RULER_TICKS.length - 1 ? -1 : 1;
    // The drop is the fixed point: it lands on the tick, and the numeral hangs
    // off the far end of the arm.
    const dropX = rulerTickX(tick.tick);
    const halfAdvance = (tick.label.length * RULER_LABEL_SIZE * 0.6) / 2;
    const x = dropX - side * (RULER_ELBOW_ARM + halfAdvance);

    ctx.fillStyle = SILKSCREEN;
    ctx.fillText(tick.label, x, baseline);

    ctx.strokeStyle = SILKSCREEN;
    ctx.beginPath();
    ctx.moveTo(x + side * (halfAdvance + LINE_WIDTH * 0.5), armY);
    ctx.lineTo(dropX, armY);
    ctx.lineTo(dropX, dropBottom);
    ctx.stroke();
  }
}

/** Half the printed width of `text`, approximated from the font size. */
function halfWidth(text: string, size: number): number {
  return (text.length * size * ZONE_LABEL_ADVANCE) / 2;
}

/**
 * The zone labels and the bracket plumbing that carries them.
 *
 * Returns the depth the right rail has to run to, so the frame and the plumbing
 * meet rather than merely coming close.
 */
function drawZoneBrackets(ctx: CanvasRenderingContext2D): void {
  const left = PLAYFIELD.x;
  const right = PLAYFIELD.x + PLAYFIELD.width;
  const rail = PLAYFIELD.y + PLAYFIELD.height;
  const midY = rail + PLAYFIELD.height * ZONE_MID_DEPTH;
  const lowY = rail + PLAYFIELD.height * ZONE_LOW_DEPTH;
  const innerTop = midY - PLAYFIELD.height * ZONE_INNER_RISE;
  const [outerL, innerL, innerR, outerR] = ZONE_BRACKET_INNER.map(
    (fraction) => left + PLAYFIELD.width * fraction,
  );
  const lowLeft = left + PLAYFIELD.width * ZONE_LOW_LEFT_FRACTION;
  const lowRight = left + PLAYFIELD.width * ZONE_LOW_RIGHT_FRACTION;

  ctx.strokeStyle = SILKSCREEN;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();

  // Outer brackets: down from the rail, inward, and back up.
  ctx.moveTo(FIELD.x, rail);
  ctx.lineTo(FIELD.x, midY);
  ctx.lineTo(outerL, midY);
  ctx.lineTo(outerL, innerTop);
  // The right-hand drop is the right rail itself, which {@link drawFrame} has
  // already run down to this depth.
  ctx.moveTo(right, midY);
  ctx.lineTo(outerR, midY);
  ctx.lineTo(outerR, innerTop);

  // Inner brackets, nested just inboard of them, with a dash into the label.
  const midLabel = 'JET FIGHTER FLYING ZONE';
  const midCentre = (innerL + innerR) / 2;
  const midReach = halfWidth(midLabel, ZONE_LABEL_SIZE) + ZONE_DASH_GAP;
  ctx.moveTo(innerL, innerTop);
  ctx.lineTo(innerL, midY);
  ctx.lineTo(midCentre - midReach, midY);
  ctx.moveTo(innerR, innerTop);
  ctx.lineTo(innerR, midY);
  ctx.lineTo(midCentre + midReach, midY);

  // The deeper row hangs off the two outer runs.
  const lowLabel = 'BATTLE SHIP ZONE';
  const stationLabel = 'MISSILE STATION ZONE';
  ctx.moveTo(lowLeft, midY);
  ctx.lineTo(lowLeft, lowY);
  ctx.lineTo(lowLeft + ZONE_DASH_GAP * 2, lowY);
  ctx.moveTo(lowRight, midY);
  ctx.lineTo(lowRight, lowY);
  ctx.lineTo(lowRight - ZONE_DASH_GAP * 2, lowY);
  ctx.stroke();

  // The labels sit on the lines their dashes run along.
  ctx.font = `${ZONE_LABEL_SIZE}px sans-serif`;
  ctx.fillStyle = SILKSCREEN;
  const drop = ZONE_LABEL_SIZE * 0.36;
  ctx.textAlign = 'center';
  ctx.fillText(midLabel, midCentre, midY + drop);
  ctx.textAlign = 'left';
  ctx.fillText(lowLabel, lowLeft + ZONE_DASH_GAP * 3, lowY + drop);
  ctx.textAlign = 'right';
  ctx.fillText(stationLabel, lowRight - ZONE_DASH_GAP * 3, lowY + drop);
  ctx.textAlign = 'center';
}

/** How deep the right rail runs before the zone plumbing takes it over. */
function zoneMidY(): number {
  return PLAYFIELD.y + PLAYFIELD.height * (1 + ZONE_MID_DEPTH);
}

/** The three painted station missiles: bullets lying nose-left at each lane row. */
function drawStationMissiles(ctx: CanvasRenderingContext2D): void {
  const nose = PLAYFIELD.x + PLAYFIELD.width + MISSILE_GAP;
  const tail = nose + MISSILE_LENGTH;
  const shoulder = nose + MISSILE_LENGTH * MISSILE_NOSE_FRACTION;

  ctx.fillStyle = SILKSCREEN;
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const cy = laneCenterY(lane);
    const top = cy - MISSILE_HEIGHT / 2;
    const bottom = cy + MISSILE_HEIGHT / 2;
    ctx.beginPath();
    ctx.moveTo(tail, top);
    ctx.lineTo(shoulder, top);
    ctx.quadraticCurveTo(nose, top, nose, cy);
    ctx.quadraticCurveTo(nose, bottom, shoulder, bottom);
    ctx.lineTo(tail, bottom);
    ctx.closePath();
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

  // The faint digit boxes, under everything else on this layer.
  drawScoreDigitBoxes(ctx);

  // The printed frame, and the bottom rail's long heavy dashes. The right rail
  // runs on down to where the zone brackets pick it up.
  drawFrame(ctx, zoneMidY());
  drawBottomRail(ctx);

  // The distance ruler, then its crosshairs on top of the dot run.
  drawRuler(ctx);
  drawCrosshair(ctx, FIELD.x, 0);
  drawCrosshair(ctx, PLAYFIELD.x + PLAYFIELD.width, CROSSHAIR_ARM);

  // Row marks: one crossing each field edge at every lane centre. This is the
  // whole of the printed separation between SCORE and the field.
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const y = laneCenterY(lane);
    drawRowMark(ctx, FIELD.x, y);
    drawRowMark(ctx, PLAYFIELD.x + PLAYFIELD.width, y);
  }

  drawRulerLabels(ctx);

  // The three painted station missiles, outboard of the right rail.
  drawStationMissiles(ctx);

  // Zone labels below the playfield, on their bracket plumbing.
  drawZoneBrackets(ctx);

  ctx.restore();
}
