import { describe, expect, it } from 'vitest';

import { loadAtlas } from './atlas.js';
import {
  CELL,
  CIRCLE,
  COLUMN_COUNT,
  FIELD,
  LANE_COUNT,
  PLAYFIELD,
  RECT,
  RULER_TICKS,
  SCORE_BOX,
  VIEWBOX,
  columnCenterX,
  laneCenterY,
  projectTube,
  viewBoxMatchesAtlas,
} from './layout.js';

describe('the copied scope geometry', () => {
  it('still matches the shipped atlas viewBox', () => {
    expect(viewBoxMatchesAtlas()).toBe(true);
  });

  it('places the circle and the left tab as ATLAS-COORDINATES.md documents', () => {
    // src/ui/geometry.ts SCOPE_CIRCLE (533, 222, r150) and SCOPE_RECT
    // (320, 150, 213 x 144), with the bounding box origin (320, 72) removed.
    expect(CIRCLE).toEqual({ cx: 213, cy: 150, r: 150 });
    expect(RECT).toEqual({ x: 0, y: 78, width: 213, height: 144 });
  });

  it('reproduces the documented playfield rectangle', () => {
    expect(PLAYFIELD.x).toBeCloseTo(19.965, 3);
    expect(PLAYFIELD.y).toBeCloseTo(102, 3);
    expect(PLAYFIELD.width).toBeCloseTo(324.885, 3);
    expect(PLAYFIELD.height).toBeCloseTo(96, 3);
  });

  it('splits the playfield into the SCORE box and the distance-column field', () => {
    expect(SCORE_BOX.width).toBeCloseTo(64.977, 3);
    expect(FIELD.x).toBeCloseTo(84.942, 3);
    expect(FIELD.width).toBeCloseTo(259.908, 3);
    // The two partition the playfield exactly, with no gap and no overlap.
    expect(SCORE_BOX.x + SCORE_BOX.width).toBeCloseTo(FIELD.x, 10);
    expect(FIELD.x + FIELD.width).toBeCloseTo(PLAYFIELD.x + PLAYFIELD.width, 10);
  });

  it('derives the documented cell size', () => {
    expect(CELL.width).toBeCloseTo(43.318, 3);
    expect(CELL.height).toBeCloseTo(32, 3);
  });
});

describe('columnCenterX and laneCenterY', () => {
  it('reproduces the documented column centres', () => {
    const centres = [0, 1, 2, 3, 4, 5].map((c) => columnCenterX(c));
    // ATLAS-COORDINATES.md quotes these to one decimal place.
    const expected = [106.6, 149.9, 193.2, 236.5, 279.9, 323.2];
    centres.forEach((centre, index) => {
      expect(Math.abs(centre - expected[index]), `column ${index}`).toBeLessThan(0.1);
    });
  });

  it('reproduces the documented lane centres', () => {
    [118, 150, 182].forEach((expected, lane) => {
      expect(laneCenterY(lane)).toBeCloseTo(expected, 9);
    });
  });

  it('places every column centre inside the field', () => {
    for (let column = 0; column < COLUMN_COUNT; column += 1) {
      expect(columnCenterX(column)).toBeGreaterThan(FIELD.x);
      expect(columnCenterX(column)).toBeLessThan(FIELD.x + FIELD.width);
    }
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      expect(laneCenterY(lane)).toBeGreaterThan(FIELD.y);
      expect(laneCenterY(lane)).toBeLessThan(FIELD.y + FIELD.height);
    }
  });

  it('accepts a fractional column so ruler labels can land between cells', () => {
    expect(columnCenterX(1.5)).toBeCloseTo((columnCenterX(1) + columnCenterX(2)) / 2, 10);
  });

  it('agrees with where the atlas actually put the segments', () => {
    // The silkscreen is drawn from these functions and the segments from the
    // atlas; if they disagreed, the printed lanes would not line up with the
    // phosphor. Check a jet in each lane against its atlas bounds.
    const atlas = loadAtlas();
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const segment = atlas.segments.find((s) => s.id === `jet_lane${lane}_col2`);
      expect(segment).toBeDefined();
      if (!segment) continue;
      const centreY = segment.bounds.y + segment.bounds.height / 2;
      const centreX = segment.bounds.x + segment.bounds.width / 2;
      expect(centreY).toBeCloseTo(laneCenterY(lane), 1);
      expect(centreX).toBeCloseTo(columnCenterX(2), 0);
    }
  });
});

describe('RULER_TICKS', () => {
  it('is the printed 10 / 3 / 2 / 1 / G ruler', () => {
    expect(RULER_TICKS.map((t) => t.label)).toEqual(['10', '3', '2', '1', 'G']);
  });

  it('marks the battleship zone at column 0 and the capture line at the last', () => {
    expect(RULER_TICKS[0].column).toBe(0);
    expect(RULER_TICKS.at(-1)?.column).toBe(COLUMN_COUNT - 1);
  });

  it('advances left to right', () => {
    for (let i = 1; i < RULER_TICKS.length; i += 1) {
      expect(RULER_TICKS[i].column).toBeGreaterThan(RULER_TICKS[i - 1].column);
    }
  });
});

describe('projectTube', () => {
  it('scales uniformly so the scope circle stays round', () => {
    const projection = projectTube(726, 600);
    expect(projection.scale).toBe(2);
    expect(projection.width).toBe(726);
    expect(projection.height).toBe(600);
    expect(projection.offsetX).toBe(0);
    expect(projection.offsetY).toBe(0);
  });

  it('letterboxes and centres a canvas of the wrong aspect', () => {
    const wide = projectTube(1000, 300);
    expect(wide.scale).toBe(1);
    expect(wide.width).toBe(VIEWBOX.width);
    expect(wide.offsetX).toBeCloseTo((1000 - VIEWBOX.width) / 2, 10);
    expect(wide.offsetY).toBe(0);

    const tall = projectTube(363, 900);
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBeCloseTo((900 - VIEWBOX.height) / 2, 10);
  });

  it('projects a degenerate canvas to a zero scale rather than NaN', () => {
    for (const projection of [projectTube(0, 0), projectTube(-5, 100), projectTube(Number.NaN, 10)]) {
      expect(projection.scale).toBe(0);
      expect(Number.isFinite(projection.offsetX)).toBe(true);
      expect(Number.isFinite(projection.offsetY)).toBe(true);
    }
  });
});
