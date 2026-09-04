import { describe, expect, it } from 'vitest';

import { CIRCLE, VIEWBOX, FIELD, PLAYFIELD } from '../machine/tube/layout.js';
import {
  CIRCLE_MM,
  MM_PER_UNIT,
  TUBE_FACE_MM,
  TUBE_FACE_TRANSFORM,
  WINDOW_MM,
  WINDOW_TRANSFORM,
  toUnits,
} from './registration.js';

describe('registration of the renderer on the glass', () => {
  it('puts the circle where the renderer draws it', () => {
    expect(toUnits(CIRCLE_MM.cx, CIRCLE_MM.cy)).toEqual([CIRCLE.cx, CIRCLE.cy]);
    const [rightX] = toUnits(CIRCLE_MM.cx + CIRCLE_MM.r, CIRCLE_MM.cy);
    expect(rightX).toBeCloseTo(CIRCLE.cx + CIRCLE.r, 6);
  });

  it('spans the window from its left edge to the circle', () => {
    // The circle's right edge is the renderer's right edge, and its top and
    // bottom are the canvas's: the window's box covers the whole canvas height.
    const { repeat, offset } = WINDOW_TRANSFORM;
    expect(offset[0] + repeat[0]).toBeCloseTo(1, 6);
    expect(offset[1]).toBeCloseTo(0, 6);
    expect(repeat[1]).toBeCloseTo(1, 6);
    // The measured window's rectangle is a little narrower than the renderer's,
    // so the window starts inside the canvas rather than at its edge. Anything
    // the renderer draws left of that is off the glass and not shown.
    expect(offset[0]).toBeGreaterThan(0);
    expect(offset[0]).toBeLessThan(0.15);
  });

  it('lands the tube face on the renderer\'s field, within the reads\' tolerance', () => {
    // The photograph's printed face and the renderer's segment band were measured
    // independently; the circle registration should bring them together to within
    // a few units. This is the check the dimensions document calls consistent.
    const [x0, y0] = toUnits(TUBE_FACE_MM.left, TUBE_FACE_MM.top);
    const [x1] = toUnits(TUBE_FACE_MM.right, TUBE_FACE_MM.bottom);
    const tolerance = 12; // units, about 5 mm
    expect(Math.abs(x0 - PLAYFIELD.x)).toBeLessThan(tolerance);
    expect(Math.abs(x1 - (PLAYFIELD.x + PLAYFIELD.width))).toBeLessThan(tolerance);
    expect(Math.abs(y0 - FIELD.y)).toBeLessThan(tolerance);
  });

  it('keeps the transforms inside the canvas', () => {
    for (const t of [WINDOW_TRANSFORM, TUBE_FACE_TRANSFORM]) {
      expect(t.offset[0]).toBeGreaterThanOrEqual(0);
      expect(t.offset[1]).toBeGreaterThanOrEqual(0);
      expect(t.offset[0] + t.repeat[0]).toBeLessThanOrEqual(1 + 1e-6);
      expect(t.offset[1] + t.repeat[1]).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(MM_PER_UNIT * VIEWBOX.height).toBeCloseTo(WINDOW_MM.bottom - WINDOW_MM.top, 6);
  });
});
