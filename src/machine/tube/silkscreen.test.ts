import { describe, expect, it } from 'vitest';

import type { FakeCanvasContext, RecordedCall } from './fake-canvas.js';
import { callsOf, createFakeContext } from './fake-canvas.js';
import {
  CELL,
  CIRCLE,
  FIELD,
  LANE_COUNT,
  PLAYFIELD,
  RECT,
  RULER_MARK_COUNT,
  RULER_TICKS,
  RULER_TICK_COUNT,
  VIEWBOX,
  laneCenterY,
  rulerTickX,
} from './layout.js';
import { SILKSCREEN } from './palette.js';
import { drawSilkscreen } from './silkscreen.js';

function draw() {
  const { ctx, recorder } = createFakeContext();
  drawSilkscreen(ctx);
  return recorder;
}

/** Two coordinates that are the same coordinate. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * The largest radius a ruler dot may have.
 *
 * Separates the dot run from the crosshair rings, which are drawn with the same
 * `arc` op on the same rail.
 */
const RULER_DOT_RADIUS_MAX = 2.5;

/**
 * The least an elbow arm may hold its numeral clear of the drop, in atlas units.
 *
 * The arm measures 7.7-9.0 units across the eight readable brackets in the two
 * close-ups and silkscreen.ts draws 8.5, plus half the glyph advance. This is a
 * floor, not the figure: the point is that the numeral is beside its drop rather
 * than on it.
 */
const RULER_ELBOW_ARM_MIN = 8;

/** One straight stroked segment, with the pen width and alpha it was drawn at. */
interface Segment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly lineWidth: number;
  readonly alpha: number;
}

/**
 * Draw once, and read back both the call log and every straight stroked segment
 * with the pen width in force when its `stroke` landed.
 *
 * `FakeCanvasContext` snapshots colour and alpha per call but not `lineWidth`,
 * and line weight is half of what the photographs pin here: the bottom rail is
 * the heaviest ink on the face and the SCORE digit boxes the lightest. Rather than change
 * the shared recorder, this drives it through a proxy that samples `lineWidth`
 * alongside each call.
 */
function trace(): {
  readonly calls: readonly RecordedCall[];
  readonly segments: readonly Segment[];
} {
  const { recorder } = createFakeContext();
  const widths: number[] = [];
  const target = recorder as unknown as FakeCanvasContext & Record<string, unknown>;
  const proxy = new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          widths[object.calls.length] = object.lineWidth;
          return (value as (...rest: unknown[]) => unknown).apply(object, args);
        };
      }
      return value;
    },
  });
  drawSilkscreen(proxy as unknown as CanvasRenderingContext2D);

  const segments: Segment[] = [];
  let open: { x: number; y: number } | null = null;
  let runs: { x0: number; y0: number; x1: number; y1: number; alpha: number }[] = [];
  for (let index = 0; index < recorder.calls.length; index += 1) {
    const call = recorder.calls[index];
    if (call.op === 'moveTo') {
      open = { x: call.args[0], y: call.args[1] };
    } else if (call.op === 'lineTo' && open) {
      runs.push({
        x0: open.x,
        y0: open.y,
        x1: call.args[0],
        y1: call.args[1],
        alpha: call.globalAlpha,
      });
      open = { x: call.args[0], y: call.args[1] };
    } else if (call.op === 'quadraticCurveTo') {
      // Rounded corners move the pen without contributing a straight segment.
      open = { x: call.args[2], y: call.args[3] };
    } else if (call.op === 'stroke') {
      for (const run of runs) {
        // Normalised so callers can reason about x0 <= x1 and y0 <= y1.
        const flip = run.x1 < run.x0 || (near(run.x0, run.x1) && run.y1 < run.y0);
        segments.push({
          x0: flip ? run.x1 : run.x0,
          y0: flip ? run.y1 : run.y0,
          x1: flip ? run.x0 : run.x1,
          y1: flip ? run.y0 : run.y1,
          lineWidth: widths[index],
          alpha: run.alpha,
        });
      }
      runs = [];
      open = null;
    }
  }
  return { calls: recorder.calls, segments };
}

/** Every call of one kind in a {@link trace} log. */
function ops(calls: readonly RecordedCall[], op: string): readonly RecordedCall[] {
  return calls.filter((call) => call.op === op);
}

describe('drawSilkscreen', () => {
  it('draws the frame as edges, not a rectangle - the top rail carries no line under the dots', () => {
    // The real top rail is solid only as far as the field's left edge; right of
    // the crosshair it is dots on bare glass. A strokeRect would run a line the
    // whole way, which is what this layer used to do.
    const drawn = trace();
    const right = PLAYFIELD.x + PLAYFIELD.width;
    const bottom = PLAYFIELD.y + PLAYFIELD.height;

    expect(ops(drawn.calls, 'strokeRect').filter((c) => c.globalAlpha === 1)).toEqual([]);

    const segments = drawn.segments.filter((seg) => seg.alpha === 1);
    // Top rail: solid from the field edge back to the rounded left corner only.
    expect(
      segments.some(
        (seg) =>
          near(seg.y0, PLAYFIELD.y) &&
          near(seg.y1, PLAYFIELD.y) &&
          near(seg.x1, FIELD.x) &&
          seg.x0 < FIELD.x,
      ),
      'solid top rail from the field edge leftward',
    ).toBe(true);
    // and nothing solid along the top rail right of the field edge.
    expect(
      segments.filter(
        (seg) =>
          near(seg.y0, PLAYFIELD.y) &&
          near(seg.y1, PLAYFIELD.y) &&
          seg.x0 > FIELD.x + 1 &&
          // The right crosshair's arm reaches outward past the rail; anything
          // inside the field span would be a rail under the dots.
          seg.x1 <= right + 1e-9 &&
          Math.abs(seg.x1 - seg.x0) > CELL.width * 0.2,
      ),
      'no line under the dotted stretch of the top rail',
    ).toEqual([]);
    // Left rail, full height.
    expect(
      segments.some(
        (seg) => near(seg.x0, PLAYFIELD.x) && near(seg.x1, PLAYFIELD.x) && seg.y1 - seg.y0 > 50,
      ),
      'left rail',
    ).toBe(true);
    // Right rail, running past the top rail and down to at least the bottom.
    expect(
      segments.some(
        (seg) =>
          near(seg.x0, right) && near(seg.x1, right) && seg.y0 < PLAYFIELD.y && seg.y1 >= bottom,
      ),
      'right rail overrunning both rails',
    ).toBe(true);
  });

  it('draws no full-height rule between the SCORE box and the field', () => {
    // The bright inner rule this layer used to draw is not on the real face - the
    // separation is the three row marks.
    const rules = trace().segments.filter(
      (seg) =>
        seg.alpha === 1 &&
        near(seg.x0, FIELD.x) &&
        near(seg.x1, FIELD.x) &&
        seg.y1 - seg.y0 > PLAYFIELD.height * 0.5,
    );
    expect(rules, 'a full-strength rule down the field boundary').toEqual([]);
  });

  it('makes the bottom rail long heavy dashes, heavier than every other line', () => {
    const bottom = PLAYFIELD.y + PLAYFIELD.height;
    const right = PLAYFIELD.x + PLAYFIELD.width;
    const all = trace().segments.filter((seg) => seg.alpha === 1);
    const dashes = all.filter(
      (seg) => near(seg.y0, bottom) && near(seg.y1, bottom) && seg.x0 >= FIELD.x - 1e-9,
    );

    // Eight dashes: seven spanning the distance field, and one starting on the
    // right rail that the glass cuts short.
    expect(dashes.length).toBe(8);
    const pitch = FIELD.width / 7;
    for (let dash = 0; dash < 8; dash += 1) {
      expect(dashes[dash].x0).toBeCloseTo(FIELD.x + dash * pitch, 6);
    }
    // Long: each full dash covers most of its pitch.
    for (const dash of dashes.slice(0, 7)) {
      expect(dash.x1 - dash.x0).toBeCloseTo(pitch * 0.9, 6);
    }
    // The run overhangs the right rail, and stays on the glass.
    const last = dashes[dashes.length - 1];
    expect(last.x1).toBeGreaterThan(right);
    // The dash run is a fixed pitch that does not scale with the cell, so the
    // overhang is pinned in atlas units rather than as a share of a cell -
    // splitting the field seven ways instead of six must not move it.
    expect(last.x1 - right).toBeGreaterThan(0);
    expect(last.x1 - right).toBeLessThan(10);

    // Heavier than every other printed line, and the stretch under the SCORE box
    // stays at the normal weight.
    const dashWidth = dashes[0].lineWidth;
    for (const seg of all) {
      const isDash = dashes.includes(seg);
      if (!isDash) expect(seg.lineWidth).toBeLessThan(dashWidth);
    }
    const solid = all.find(
      (seg) => near(seg.y0, bottom) && near(seg.y1, bottom) && seg.x0 < FIELD.x - 1e-9,
    );
    expect(solid, 'solid bottom rail under the SCORE box').toBeDefined();
    expect(solid!.lineWidth).toBeLessThan(dashWidth);
  });

  it('crosshairs both ends of the dotted ruler', () => {
    // A ring with a bar running well above and below the rail, like a surveyor's
    // mark. One where the solid rail hands over to the dots, one on the right rail.
    const drawn = trace();
    const right = PLAYFIELD.x + PLAYFIELD.width;
    const rings = ops(drawn.calls, 'arc').filter(
      (call) => near(call.args[1], PLAYFIELD.y) && call.args[2] > RULER_DOT_RADIUS_MAX,
    );
    expect(rings.map((call) => call.args[0]).sort((a, b) => a - b)).toEqual([FIELD.x, right]);

    const bars = drawn.segments.filter(
      (seg) =>
        seg.alpha === 1 &&
        near(seg.x0, seg.x1) &&
        seg.y0 < PLAYFIELD.y - 1 &&
        seg.y1 > PLAYFIELD.y + 1,
    );
    for (const x of [FIELD.x, right]) {
      expect(bars.some((seg) => near(seg.x0, x)), `crosshair bar at x=${x}`).toBe(true);
    }
  });

  it('groups the ruler dots in fours, separated by seven ticks on the ruler pitch', () => {
    const drawn = trace();
    const dots = ops(drawn.calls, 'arc')
      .filter((call) => near(call.args[1], PLAYFIELD.y) && call.args[2] <= RULER_DOT_RADIUS_MAX)
      .map((call) => call.args[0]);
    const ticks = ops(drawn.calls, 'fillRect')
      .filter((call) => Math.abs(call.args[1] + call.args[3] / 2 - PLAYFIELD.y) < 1e-9)
      .map((call) => call.args[0] + call.args[2] / 2);

    // Seven ticks, on the ruler's own pitch. Counted off score10 and *not* the
    // cell boundaries - the run overshoots the seventh cell by half a pitch.
    expect(ticks.length).toBe(RULER_TICK_COUNT);
    for (let tick = 1; tick <= RULER_TICK_COUNT; tick += 1) {
      expect(ticks.some((x) => Math.abs(x - rulerTickX(tick)) < 1e-9), `tick ${tick}`).toBe(true);
    }
    // Four dots between consecutive ticks, four leading the first, and a lone
    // trailing dot before the right crosshair.
    expect(dots.length).toBe(RULER_MARK_COUNT - RULER_TICK_COUNT);
    const bounds = [FIELD.x, ...ticks, FIELD.x + FIELD.width];
    for (let group = 0; group + 1 < bounds.length; group += 1) {
      const inGroup = dots.filter((x) => x > bounds[group] && x < bounds[group + 1]);
      const expected = group === bounds.length - 2 ? 1 : 4;
      expect(inGroup.length, `dots in group ${group}`).toBe(expected);
    }
    // Chunky: a dot is wider than a printed line.
    const radii = ops(drawn.calls, 'arc')
      .filter((call) => near(call.args[1], PLAYFIELD.y) && call.args[2] <= RULER_DOT_RADIUS_MAX)
      .map((call) => call.args[2]);
    const frameWidth = Math.min(
      ...drawn.segments.filter((seg) => seg.alpha === 1).map((seg) => seg.lineWidth),
    );
    for (const radius of radii) expect(radius * 2).toBeGreaterThan(frameWidth);
  });

  it('drops every ruler numeral onto its tick', () => {
    // The bug this pins: the numerals were placed at cell centres while the ticks
    // were drawn on the ruler's own pitch, so no bracket landed on a mark. Each
    // numeral carries a horizontal arm off its shoulder that turns down and drops
    // onto a tick - `10` reads as `10⌐`. `G`'s bracket mirrors.
    const drawn = trace();
    // 'G' also occurs in the arc title (SIGHT), whose characters are drawn at the
    // origin under a translate - match on the rail position, not the text alone.
    const numerals = ops(drawn.calls, 'fillText').filter(
      (call) =>
        call.args[1] < PLAYFIELD.y &&
        call.args[1] > PLAYFIELD.y - PLAYFIELD.height * 0.5 &&
        RULER_TICKS.some((tick) => tick.label === call.text),
    );
    const segments = drawn.segments.filter((seg) => seg.alpha === 1);
    const drops: number[] = [];

    // The tick centres the ruler actually drew, straight off the call log - so
    // this compares the two coordinate systems rather than trusting either.
    const drawnTicks = ops(drawn.calls, 'fillRect')
      .filter((call) => Math.abs(call.args[1] + call.args[3] / 2 - PLAYFIELD.y) < 1e-9)
      .map((call) => call.args[0] + call.args[2] / 2);

    for (let index = 0; index < RULER_TICKS.length; index += 1) {
      const tick = RULER_TICKS[index];
      const side = index === RULER_TICKS.length - 1 ? -1 : 1;
      const dropX = rulerTickX(tick.tick);
      expect(
        drawnTicks.some((x) => Math.abs(x - dropX) < 1e-9),
        `${tick.label} drops on a drawn tick`,
      ).toBe(true);
      const numeral = numerals.find((call) => call.text === tick.label);
      expect(numeral, `numeral ${tick.label}`).toBeDefined();
      // The numeral hangs off the far end of the arm, on the side away from the
      // field for `G` and toward it for the rest.
      expect(
        (dropX - numeral!.args[0]) * side,
        `${tick.label} sits clear of its drop`,
      ).toBeGreaterThan(RULER_ELBOW_ARM_MIN);

      // The numeral sits well clear of the rail - a seventh of the playfield
      // height, not a twelfth.
      expect(PLAYFIELD.y - numeral!.args[1]).toBeGreaterThan(PLAYFIELD.height * 0.12);

      const arm = segments.find(
        (seg) =>
          near(seg.y0, seg.y1) &&
          seg.y0 < PLAYFIELD.y &&
          (near(seg.x0, dropX) || near(seg.x1, dropX)) &&
          Math.abs(seg.x1 - seg.x0) > 1,
      );
      expect(arm, `elbow arm for ${tick.label}`).toBeDefined();
      const drop = segments.find(
        (seg) => near(seg.x0, dropX) && near(seg.x1, dropX) && seg.y1 < PLAYFIELD.y,
      );
      expect(drop, `elbow drop for ${tick.label}`).toBeDefined();
      // The arm leaves the numeral's shoulder and the drop heads for the rail.
      expect(drop!.y0).toBeLessThan(numeral!.args[1]);
      expect(drop!.y1).toBeGreaterThan(numeral!.args[1]);
      drops.push(dropX);
    }

    // No two brackets share a drop line. On the measured ticks `1` and `G` are
    // two pitches apart, so this is slack now - it was tight when the labels sat
    // in adjacent cells.
    expect(new Set(drops).size).toBe(RULER_TICKS.length);
    const sorted = [...drops].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index] - sorted[index - 1]).toBeGreaterThan(CELL.width * 0.2);
    }
  });

  it('draws no cell lattice over the playfield', () => {
    // This layer used to print a faint hash across the glass - a vertical on
    // every cell boundary and a horizontal on every lane boundary. It went in
    // with #48 because "the field was empty black between the frame and the
    // phosphor"; the renderer's ghost layer now draws every segment at the
    // unlit-phosphor level, so the field carries the tube's own artwork and the
    // hash was a brighter second copy of a division already visible. Removed at
    // the owner's request against the real unit.
    //
    // Asserted as an absence rather than deleted, because a redraw of this layer
    // that reintroduces the grid should fail here rather than pass quietly.
    const faint = draw().calls.filter((call) => call.globalAlpha < 1);
    const moves = faint.filter((call) => call.op === 'moveTo');
    expect(moves, 'faint strokes across the field').toEqual([]);

    // And nothing at full strength has replaced it: no vertical spanning the
    // cell band on a cell boundary, no horizontal on a lane boundary.
    for (const seg of trace().segments) {
      const onColumnEdge =
        near(seg.x0, seg.x1) &&
        Math.abs((seg.x0 - FIELD.x) % CELL.width) < 1e-9 &&
        seg.y0 >= FIELD.y - 1e-9 &&
        seg.y1 <= FIELD.y + FIELD.height + 1e-9;
      expect(onColumnEdge, `stroke down a cell boundary at x=${seg.x0}`).toBe(false);
      for (let lane = 1; lane < LANE_COUNT; lane += 1) {
        const onLaneEdge =
          near(seg.y0, seg.y1) &&
          near(seg.y0, FIELD.y + lane * CELL.height) &&
          Math.abs(seg.x1 - seg.x0) > CELL.width;
        expect(onLaneEdge, `stroke along lane boundary ${lane}`).toBe(false);
      }
    }
  });

  it('prints the faintest ink far fainter than the frame', () => {
    const alphas = draw().calls.filter((call) => call.globalAlpha < 1).map((c) => c.globalAlpha);
    expect(alphas.length).toBeGreaterThan(0);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThan(0.05);
      expect(alpha).toBeLessThan(0.3);
    }
  });

  it('boxes each SCORE digit', () => {
    // Faint boxes around the three score digits, matching the atlas segments.
    const boxes = callsOf(draw(), 'strokeRect').filter((call) => call.globalAlpha < 1);
    expect(boxes.length).toBe(3);
    for (const box of boxes) {
      expect(box.args[0]).toBeGreaterThan(PLAYFIELD.x);
      expect(box.args[0] + box.args[2]).toBeLessThan(FIELD.x);
    }
  });

  it('marks each lane centre with a dash crossing both field edges, and nothing else', () => {
    // The real face has bead-like dashes straddling the field's left edge and the
    // right rail at every row centre. It has no lane ticks poking inward from the
    // frame - those were invented.
    const right = PLAYFIELD.x + PLAYFIELD.width;
    const marks = callsOf(draw(), 'fillRect').filter(
      (call) => call.args[1] > PLAYFIELD.y && call.args[1] < PLAYFIELD.y + PLAYFIELD.height,
    );
    expect(marks.length).toBe(LANE_COUNT * 2);
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const y = laneCenterY(lane);
      for (const x of [FIELD.x, right]) {
        const mark = marks.find(
          (call) =>
            Math.abs(call.args[0] + call.args[2] / 2 - x) < 1e-9 &&
            Math.abs(call.args[1] + call.args[3] / 2 - y) < 1e-9,
        );
        expect(mark, `row mark crossing x=${x} at lane ${lane}`).toBeDefined();
        // Wider than it is tall, and heavier than a printed line.
        expect(mark!.args[2]).toBeGreaterThan(mark!.args[3]);
        expect(mark!.args[3]).toBeGreaterThan(2);
      }
    }
  });

  it('prints every ruler label', () => {
    const labels = callsOf(draw(), 'fillText').map((call) => call.text);
    for (const tick of RULER_TICKS) {
      expect(labels).toContain(tick.label);
    }
  });

  it('hangs the zone labels off nested bracket plumbing, not in mid air', () => {
    // The most distinctive thing on the lower face: drop lines leave the bottom
    // rail and turn into nested square brackets, the middle label is joined by a
    // dash on each side, and the two lower labels hang from a deeper bracket.
    const drawn = trace();
    const rail = PLAYFIELD.y + PLAYFIELD.height;
    const right = PLAYFIELD.x + PLAYFIELD.width;
    const below = drawn.segments.filter((seg) => seg.alpha === 1 && seg.y1 > rail + 1);

    // Two drop lines off the rail, at the field's left edge and the right rail.
    for (const x of [FIELD.x, right]) {
      expect(
        below.some((seg) => near(seg.x0, x) && near(seg.x1, x) && seg.y0 <= rail + 1e-9),
        `drop line off the rail at x=${x}`,
      ).toBe(true);
    }

    // Both bracket runs turn inward along one depth, and each ends in an arm
    // turning back up, with a second arm nested just inboard of it.
    // Two horizontal depths below the rail: the bracket run, then the deeper row.
    const depths = [
      ...new Set(below.filter((seg) => near(seg.y0, seg.y1)).map((seg) => seg.y0)),
    ].sort((a, b) => a - b);
    expect(depths.length).toBe(2);
    const midY = depths[0];
    expect(midY).toBeGreaterThan(rail);
    // Turn-ups only: they rise from the bracket run without reaching the rail.
    const risers = below
      .filter((seg) => near(seg.x0, seg.x1) && near(seg.y1, midY) && seg.y0 > rail + 1e-9)
      .map((seg) => seg.x0)
      .sort((a, b) => a - b);
    // Four: the two outer turn-ups and the two nested inner ones.
    expect(risers.length).toBe(4);
    expect(risers[1] - risers[0]).toBeLessThan(CELL.width * 0.5);
    expect(risers[3] - risers[2]).toBeLessThan(CELL.width * 0.5);
    expect(risers[2] - risers[1]).toBeGreaterThan(CELL.width * 2);

    // The middle label sits between the nested pair, joined by a dash each side.
    const labels = ops(drawn.calls, 'fillText');
    const middle = labels.find((call) => call.text === 'JET FIGHTER FLYING ZONE');
    expect(middle).toBeDefined();
    expect(middle!.args[0]).toBeCloseTo((risers[1] + risers[2]) / 2, 6);
    const dashes = below.filter((seg) => near(seg.y0, midY) && near(seg.y1, midY));
    expect(dashes.some((seg) => near(seg.x0, risers[1]) && seg.x1 < middle!.args[0])).toBe(true);
    expect(dashes.some((seg) => near(seg.x1, risers[2]) && seg.x0 > middle!.args[0])).toBe(true);

    // The lower row hangs deeper, one label off each outer run.
    const lowY = depths[1];
    expect(lowY).toBeGreaterThan(midY);
    for (const text of ['BATTLE SHIP ZONE', 'MISSILE STATION ZONE']) {
      const label = labels.find((call) => call.text === text);
      expect(label, text).toBeDefined();
      expect(label!.args[1]).toBeGreaterThan(midY);
      const hanger = below.find(
        (seg) => near(seg.x0, seg.x1) && near(seg.y0, midY) && near(seg.y1, lowY),
      );
      expect(hanger, `hanger for ${text}`).toBeDefined();
    }
  });

  it('paints three station missiles outboard of the right rail, nose left', () => {
    // Painted, not phosphor: the atlas no longer carries them. Both photographs
    // show a bullet lying horizontally with a rounded nose pointing into the
    // field and a square tail outboard of it, one per lane row.
    const recorder = draw();
    const right = PLAYFIELD.x + PLAYFIELD.width;
    const noses = callsOf(recorder, 'quadraticCurveTo');
    // The bottom rail's last dash starts on the rail itself; allow for that.
    const outboard = callsOf(recorder, 'moveTo').filter((call) => call.args[0] > right + 1);
    expect(outboard.length).toBe(LANE_COUNT);

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const cy = laneCenterY(lane);
      // The nose curve's apex is the leftmost point, and it is on the lane centre.
      const apex = noses.find((call) => near(call.args[3], cy) && call.args[2] > right);
      expect(apex, `missile nose at lane ${lane}`).toBeDefined();
      const tail = outboard.find((call) => Math.abs(call.args[1] - cy) < CELL.height * 0.5);
      expect(tail, `missile tail at lane ${lane}`).toBeDefined();
      // Nose left of tail: the bullet points into the field.
      expect(apex!.args[2]).toBeLessThan(tail!.args[0]);
      // The nose starts where the photographs put it. #51 pinned this to 346.4,
      // which was the inherited right rail (344.85) plus the squeezed gap it had
      // to use, not a figure off the glass. With layout.ts taking the rail off the
      // photographs the nose lands at 331.6, and the bullets' noses register at
      // x 331.4 and 331.7 in the two close-ups - so this is now measured rather
      // than derived from a rail in the wrong place.
      expect(apex!.args[2]).toBeCloseTo(331.632, 3);
      // Near the photographed 2.6:1, so it reads as a bullet and not a blob. The
      // height handed over with this item was 8, which gives 1.5:1 once the length
      // is trimmed enough to keep the outer two inside the glass; that fails here.
      const height = Math.abs(tail!.args[1] - cy) * 2;
      expect((tail!.args[0] - apex!.args[2]) / height).toBeGreaterThan(1.8);
    }
  });

  it('keeps the whole printed overlay inside the scope window', () => {
    // The canvas is clipped to the scope window (circle united with the SCORE
    // tab), so ink outside it is silently cut off. Several of the measurements
    // here - the bracket depths, the bottom rail's overhang, the missile tails -
    // sit against that boundary, and this is what stops one drifting outside it.
    const inside = (x: number, y: number): boolean => {
      const inCircle = Math.hypot(x - CIRCLE.cx, y - CIRCLE.cy) <= CIRCLE.r;
      const inRect =
        x >= RECT.x && x <= RECT.x + RECT.width && y >= RECT.y && y <= RECT.y + RECT.height;
      return inCircle || inRect;
    };
    for (const call of draw().calls) {
      if (call.op === 'moveTo' || call.op === 'lineTo' || call.op === 'arc') {
        // An arc's own radius pushes it out beyond its centre.
        const pad = call.op === 'arc' ? call.args[2] : 0;
        for (const [dx, dy] of [
          [-pad, 0],
          [pad, 0],
          [0, -pad],
          [0, pad],
        ]) {
          expect(
            inside(call.args[0] + dx, call.args[1] + dy),
            `${call.op} at ${call.args[0]},${call.args[1]}`,
          ).toBe(true);
        }
      }
      if (call.op === 'fillRect' || call.op === 'strokeRect') {
        for (const [x, y] of [
          [call.args[0], call.args[1]],
          [call.args[0] + call.args[2], call.args[1]],
          [call.args[0], call.args[1] + call.args[3]],
          [call.args[0] + call.args[2], call.args[1] + call.args[3]],
        ]) {
          expect(inside(x, y), `${call.op} corner at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('prints the zone labels below the playfield', () => {
    const texts = callsOf(draw(), 'fillText');
    const labels = texts.map((call) => call.text);
    for (const zone of ['JET FIGHTER FLYING ZONE', 'BATTLE SHIP ZONE', 'MISSILE STATION ZONE']) {
      expect(labels).toContain(zone);
      const call = texts.find((c) => c.text === zone);
      expect(call?.args[1]).toBeGreaterThan(PLAYFIELD.y + PLAYFIELD.height);
    }
  });

  it('bends the arc title around the scope rim, one character at a time', () => {
    const recorder = draw();
    const title = 'COAST SIDE MISSILE STATION RADAR SIGHT SCREEN';
    const chars = callsOf(recorder, 'fillText').filter((call) => (call.text ?? '').length === 1);
    // Every character of the title is drawn individually, each preceded by a
    // rotate; single-character ruler labels ('3', '2', '1', 'G') are drawn flat.
    expect(chars.length).toBeGreaterThanOrEqual(title.replace(/ /g, '').length);
    expect(callsOf(recorder, 'rotate').length).toBe(title.length);
  });

  it('sets the arc title to the photographed radius, sweep and glyph size', () => {
    // Measured off assets/reference/tube-closeup-score0.webp and
    // tube-closeup-score10.webp; see the constants in silkscreen.ts for the
    // method and the per-photo figures. Guarding all three together matters
    // because drawArcText derives the angular step from the font size, so one
    // wrong constant moves the glyphs and the sweep at once - which is exactly
    // how the legend came to wrap a third of the way down both sides.
    const title = 'COAST SIDE MISSILE STATION RADAR SIGHT SCREEN';
    const spots = callsOf(draw(), 'translate').map((call) => ({
      radius: Math.hypot(call.args[0] - CIRCLE.cx, call.args[1] - CIRCLE.cy),
      angle: Math.atan2(call.args[1] - CIRCLE.cy, call.args[0] - CIRCLE.cx),
    }));
    expect(spots.length).toBe(title.length);

    // Every character rides one circle, between 0.92 and 0.93 of the scope
    // radius (photographs: 0.932 and 0.920).
    for (const spot of spots) {
      expect(spot.radius / CIRCLE.r).toBeGreaterThan(0.92);
      expect(spot.radius / CIRCLE.r).toBeLessThan(0.93);
    }

    // The swept angle between the first and last character centres. The
    // photographs measure 67.7 and 66.0 degrees from first ink to last, which
    // is about one character advance wider than the centre-to-centre sweep.
    const angles = spots.map((spot) => spot.angle);
    const sweep = ((Math.max(...angles) - Math.min(...angles)) * 180) / Math.PI;
    expect(sweep).toBeGreaterThan(58);
    expect(sweep).toBeLessThan(68);

    // Centred on straight up, not drifting to one side (photographs: -88.5 and
    // -88.1 degrees, where -90 is straight up).
    const midpoint = ((Math.max(...angles) + Math.min(...angles)) / 2) * (180 / Math.PI);
    expect(midpoint).toBeCloseTo(-90, 6);

    // Glyph size, as the character pitch along the arc over the scope radius.
    // Measuring the pitch rather than the font size keeps this independent of
    // the advance factor drawArcText happens to use, and the pitch is what the
    // photographs give directly: 0.0246 and 0.0237 of the scope radius.
    const sorted = [...angles].sort((a, b) => a - b);
    const pitch = ((sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1)) * spots[0].radius;
    expect(pitch / CIRCLE.r).toBeGreaterThan(0.022);
    expect(pitch / CIRCLE.r).toBeLessThan(0.026);
  });

  it('dots the distance ruler along the top border, right of the inner rule', () => {
    const dots = callsOf(draw(), 'arc');
    expect(dots.length).toBeGreaterThan(5);
    for (const dot of dots) {
      expect(dot.args[0]).toBeGreaterThanOrEqual(FIELD.x - 1e-9);
      expect(dot.args[0]).toBeLessThanOrEqual(PLAYFIELD.x + PLAYFIELD.width + 1e-9);
      expect(dot.args[1]).toBeCloseTo(PLAYFIELD.y, 9);
    }
  });

  it('paints everything in the silkscreen ink', () => {
    for (const call of draw().calls) {
      if (call.op === 'fill' || call.op === 'fillText') {
        expect(call.fillStyle).toBe(SILKSCREEN);
      }
      if (call.op === 'stroke' || call.op === 'strokeRect') {
        expect(call.strokeStyle).toBe(SILKSCREEN);
      }
    }
  });

  it('never casts a glow - printed ink does not emit', () => {
    for (const call of draw().calls) {
      expect(call.shadowBlur).toBe(0);
    }
  });

  it('stays inside the atlas viewBox', () => {
    for (const call of draw().calls) {
      if (call.op === 'save' || call.op === 'restore' || call.op === 'rotate') continue;
      if (call.args.length < 2) continue;
      // Arc-title characters are drawn at the origin under a translate, so the
      // translate itself carries their position.
      expect(call.args[0]).toBeGreaterThanOrEqual(-1);
      expect(call.args[0]).toBeLessThanOrEqual(VIEWBOX.width + 1);
      expect(call.args[1]).toBeGreaterThanOrEqual(-1);
      expect(call.args[1]).toBeLessThanOrEqual(VIEWBOX.height + 1);
    }
  });

  it('keeps the arc title inside the scope circle', () => {
    for (const call of callsOf(draw(), 'translate')) {
      const distance = Math.hypot(call.args[0] - CIRCLE.cx, call.args[1] - CIRCLE.cy);
      expect(distance).toBeLessThan(CIRCLE.r);
    }
  });

  it('leaves the context balanced', () => {
    const recorder = draw();
    expect(callsOf(recorder, 'save').length).toBe(callsOf(recorder, 'restore').length);
  });

  it('is stateless - two draws produce identical output', () => {
    const first = draw().calls;
    const second = draw().calls;
    expect(second).toEqual(first);
  });
});
