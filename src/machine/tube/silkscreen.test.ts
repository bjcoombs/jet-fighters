import { describe, expect, it } from 'vitest';

import { callsOf, createFakeContext } from './fake-canvas.js';
import { CIRCLE, FIELD, PLAYFIELD, RULER_TICKS, VIEWBOX } from './layout.js';
import { SILKSCREEN } from './palette.js';
import { drawSilkscreen } from './silkscreen.js';

function draw() {
  const { ctx, recorder } = createFakeContext();
  drawSilkscreen(ctx);
  return recorder;
}

describe('drawSilkscreen', () => {
  it('draws the playfield border at the printed rectangle', () => {
    const [border] = callsOf(draw(), 'strokeRect');
    expect(border.args).toEqual([
      PLAYFIELD.x,
      PLAYFIELD.y,
      PLAYFIELD.width,
      PLAYFIELD.height,
    ]);
    expect(border.strokeStyle).toBe(SILKSCREEN);
  });

  it('draws the inner rule dividing the SCORE box from the distance field', () => {
    const moves = callsOf(draw(), 'moveTo');
    const rule = moves.find(
      (call) => Math.abs(call.args[0] - FIELD.x) < 1e-9 && Math.abs(call.args[1] - PLAYFIELD.y) < 1e-9,
    );
    expect(rule, 'inner vertical rule at the field boundary').toBeDefined();
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
