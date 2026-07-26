import { describe, expect, it } from 'vitest';

import { callsOf, createFakeContext } from './fake-canvas.js';
import {
  CELL,
  CIRCLE,
  COLUMN_COUNT,
  FIELD,
  LANE_COUNT,
  PLAYFIELD,
  RULER_TICKS,
  VIEWBOX,
  laneCenterY,
} from './layout.js';
import { SILKSCREEN } from './palette.js';
import { drawSilkscreen } from './silkscreen.js';

function draw() {
  const { ctx, recorder } = createFakeContext();
  drawSilkscreen(ctx);
  return recorder;
}

describe('drawSilkscreen', () => {
  it('draws the playfield border at the printed rectangle', () => {
    const [border] = callsOf(draw(), 'strokeRect').filter((call) => call.globalAlpha === 1);
    expect(border.args).toEqual([
      PLAYFIELD.x,
      PLAYFIELD.y,
      PLAYFIELD.width,
      PLAYFIELD.height,
    ]);
    expect(border.strokeStyle).toBe(SILKSCREEN);
  });

  it('draws no full-height rule between the SCORE box and the field', () => {
    // The bright inner rule this layer used to draw is not on the real face -
    // the separation is the faint lattice plus the three row marks. Nothing may
    // run the playfield's full height at the field boundary.
    const recorder = draw();
    const full = recorder.calls.filter(
      (call) =>
        (call.op === 'moveTo' || call.op === 'lineTo') &&
        Math.abs(call.args[0] - FIELD.x) < 1e-9 &&
        Math.abs(call.args[1] - PLAYFIELD.y) < 1e-9 &&
        call.globalAlpha === 1,
    );
    expect(full, 'a full-strength rule starting at the field boundary').toEqual([]);
  });

  it('divides the playfield into seven countable cells per row, three rows deep', () => {
    // The critique's highest-value finding: the real face carries a faint printed
    // lattice, and without it the field reads as empty black rather than a radar
    // screen. Seven rectangles per row across the playfield - the SCORE box plus
    // one per distance column - and three rows.
    const faint = draw().calls.filter((call) => call.globalAlpha < 1);
    const moves = faint.filter((call) => call.op === 'moveTo');

    const columnEdges = moves
      .filter((call) => Math.abs(call.args[1] - FIELD.y) < 1e-9)
      .map((call) => call.args[0]);
    // COLUMN_COUNT verticals: the SCORE box's right edge and every interior cell
    // edge. The seventh boundary is the playfield's own right border.
    expect(columnEdges.length).toBe(COLUMN_COUNT);
    for (let column = 0; column < COLUMN_COUNT; column += 1) {
      expect(columnEdges).toContain(FIELD.x + column * CELL.width);
    }

    const rowEdges = moves
      .filter((call) => Math.abs(call.args[0] - PLAYFIELD.x) < 1e-9)
      .map((call) => call.args[1]);
    expect(rowEdges.length).toBe(LANE_COUNT - 1);
    for (let lane = 1; lane < LANE_COUNT; lane += 1) {
      expect(rowEdges).toContain(FIELD.y + lane * CELL.height);
    }
  });

  it('prints the lattice far fainter than the frame', () => {
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
