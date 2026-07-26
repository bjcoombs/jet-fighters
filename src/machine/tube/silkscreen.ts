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
 * which is what reads as "groups of four separated by a tick". Measured tick
 * pitch is 82.4 px against a 16.0 px mark pitch: five marks to the column, so the
 * ticks land on the column boundaries. The tick itself is 7 x 21 px, standing
 * clear of the rail above and below.
 */
const RULER_DOT_RADIUS = 1.8;
const RULER_MARKS_PER_COLUMN = 5;
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
 * left - because its own column boundary is the right rail, which is exactly what
 * the photographs show for `G`.
 *
 * The reach is 0.38 of a cell rather than the half cell that would land every
 * drop on a column-boundary tick, because `RULER_TICKS` puts `1` and `G` in
 * adjacent columns: at half a cell `1`'s right-hand drop and `G`'s mirrored
 * left-hand drop would be the same line, and the pair would read as one T rather
 * than two brackets. 0.38 keeps them ten units apart. On the real face the
 * labelled columns are never adjacent, so the question does not arise there.
 */
const RULER_LABEL_SIZE = 12.3;
const RULER_LABEL_CAP = 8.9;
const RULER_LABEL_RISE_FRACTION = 0.14;
const RULER_ELBOW_ARM_FRACTION = 0.38;
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
 * Depths are fractions of the playfield height. The photographs put the middle
 * line 0.33 of the playfield height below the rail and the lower line at 0.58,
 * but at those depths on our flatter playfield the outer drops and the lower
 * brackets fall outside the scope circle and would be clipped; 0.235 and 0.45 are
 * as deep as the window allows. Likewise the lower row's bracket columns are
 * pulled in from the photographed 0.245 and 0.955 of the playfield width.
 */
const ZONE_MID_DEPTH = 0.235;
const ZONE_LOW_DEPTH = 0.45;
const ZONE_INNER_RISE = 0.115;
const ZONE_BRACKET_INNER = [0.3, 0.315, 0.845, 0.86] as const;
const ZONE_LOW_LEFT_FRACTION = 0.28;
const ZONE_LOW_RIGHT_FRACTION = 0.9;
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
 * **Height.** At 8 tall the outer two missiles do not fit: a tail corner at
 * x 359.4, y 114 is 150.8 from the scope circle's centre against a radius of 150,
 * so the top and bottom missiles would be clipped by the glass. Trimming the
 * length until 8 fits gives 12.2 x 8, an aspect of 1.5 against the photographed
 * 2.6, at which point it stops reading as a bullet and reads as a blob. Height 6
 * on a length of 12.1 keeps the photographed proportion (2.0) and the furthest
 * corner 0.35 units inside the glass. The scope-window test covers this.
 *
 * The squeeze is not the missiles' fault. The real unit has about 89 px of glass
 * outboard of the right rail here - more than a whole cell's width - where ours
 * has 15 atlas units, because the inherited playfield is about 27 units wider
 * than the photographed one and so reaches much closer to the bezel. If that
 * geometry is corrected upstream, these four constants should go back to scale.
 */
const MISSILE_GAP = 1.55;
const MISSILE_LENGTH = 12.1;
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
 * The ruler: chunky dots at a uniform pitch, every fifth mark a column tick.
 *
 * The run starts one pitch right of the left crosshair and stops one pitch short
 * of the right one, so both crosshairs stand alone at the ends.
 */
function drawRuler(ctx: CanvasRenderingContext2D): void {
  const y = PLAYFIELD.y;
  const marks = RULER_MARKS_PER_COLUMN * COLUMN_COUNT;
  const pitch = FIELD.width / marks;

  for (let mark = 1; mark < marks; mark += 1) {
    const x = FIELD.x + mark * pitch;
    if (mark % RULER_MARKS_PER_COLUMN === 0) {
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
  const reach = CELL.width * RULER_ELBOW_ARM_FRACTION;

  ctx.font = `bold ${RULER_LABEL_SIZE}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = LINE_WIDTH;

  for (let index = 0; index < RULER_TICKS.length; index += 1) {
    const tick = RULER_TICKS[index];
    // The last label's own column boundary is the right rail, so its bracket
    // mirrors and reaches back into the field instead.
    const side = index === RULER_TICKS.length - 1 ? -1 : 1;
    const x = columnCenterX(tick.column);
    const halfAdvance = (tick.label.length * RULER_LABEL_SIZE * 0.6) / 2;

    ctx.fillStyle = SILKSCREEN;
    ctx.fillText(tick.label, x, baseline);

    ctx.strokeStyle = SILKSCREEN;
    ctx.beginPath();
    ctx.moveTo(x + side * (halfAdvance + LINE_WIDTH * 0.5), armY);
    ctx.lineTo(x + side * reach, armY);
    ctx.lineTo(x + side * reach, dropBottom);
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

  // The faint printed grid, under everything else on this layer.
  drawCellLattice(ctx);

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
