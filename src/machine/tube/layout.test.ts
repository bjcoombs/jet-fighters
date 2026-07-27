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

  it('reproduces the measured playfield rectangle', () => {
    // The printed frame, as measured off the two lit close-ups: rails at y 85.2
    // and 187.2, x 41.4 and 313.6. See PLAYFIELD_FRACTION.
    expect(PLAYFIELD.x).toBeCloseTo(41.382, 3);
    expect(PLAYFIELD.y).toBeCloseTo(85.2, 3);
    expect(PLAYFIELD.width).toBeCloseTo(272.25, 3);
    expect(PLAYFIELD.height).toBeCloseTo(102, 3);
  });

  it('sits the cell band inside the frame with printed air above and below', () => {
    // The lanes fill the middle 52% of the frame's height, not all of it. This is
    // the whole point of FIELD_BAND_FRACTION: the frame carries the dotted ruler
    // clear above the cells and leaves room below the bottom rail for the
    // zone-label plumbing.
    const railTop = PLAYFIELD.y;
    const railBottom = PLAYFIELD.y + PLAYFIELD.height;
    expect(FIELD.y).toBeCloseTo(113.76, 3);
    expect(FIELD.height).toBeCloseTo(53.04, 3);
    expect(FIELD.y).toBeGreaterThan(railTop);
    expect(FIELD.y + FIELD.height).toBeLessThan(railBottom);
    // The air above is a little more than the air below, as the photographs show.
    const above = FIELD.y - railTop;
    const below = railBottom - (FIELD.y + FIELD.height);
    expect(above).toBeGreaterThan(below);
    expect(above / PLAYFIELD.height).toBeCloseTo(0.28, 6);
    // SCORE shares the band: it is the same three printed rows.
    expect(SCORE_BOX.y).toBeCloseTo(FIELD.y, 10);
    expect(SCORE_BOX.height).toBeCloseTo(FIELD.height, 10);
  });

  it('splits the playfield into the SCORE box and the distance-column field', () => {
    expect(SCORE_BOX.width).toBeCloseTo(54.45, 3);
    expect(FIELD.x).toBeCloseTo(95.832, 3);
    expect(FIELD.width).toBeCloseTo(217.8, 3);
    // The two partition the playfield's width exactly, with no gap and no overlap.
    expect(SCORE_BOX.x + SCORE_BOX.width).toBeCloseTo(FIELD.x, 10);
    expect(FIELD.x + FIELD.width).toBeCloseTo(PLAYFIELD.x + PLAYFIELD.width, 10);
  });

  it('derives the documented cell size', () => {
    // 217.8 / 7. The field is split seven ways, not six: the teardown
    // photographs count seven printed cell boxes.
    expect(CELL.width).toBeCloseTo(31.114, 3);
    expect(CELL.height).toBeCloseTo(17.68, 3);
  });
});

describe('columnCenterX and laneCenterY', () => {
  it('reproduces the documented column centres', () => {
    const centres = [0, 1, 2, 3, 4, 5, 6].map((c) => columnCenterX(c));
    // ATLAS-COORDINATES.md quotes these to one decimal place. Seven cells at a
    // 31.114 pitch, starting half a cell into the field at x = 95.832.
    const expected = [111.4, 142.5, 173.6, 204.7, 235.8, 267.0, 298.1];
    centres.forEach((centre, index) => {
      expect(Math.abs(centre - expected[index]), `column ${index}`).toBeLessThan(0.1);
    });
  });

  it('reproduces the documented lane centres', () => {
    [122.6, 140.28, 157.96].forEach((expected, lane) => {
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
    //
    // Within a quarter of a cell, not to the decimal. The jets are traced from
    // the bare tube and drawn where the photograph has them, and the tube does
    // not print them dead centre in their cells - so an exact match would be
    // asserting that the sprites were snapped to this lattice rather than
    // measured against it. A quarter cell still catches the failure that
    // matters, which is a sprite in the wrong cell or the wrong lane.
    const atlas = loadAtlas();
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const segment = atlas.segments.find((s) => s.id === `jet_lane${lane}_col2`);
      expect(segment).toBeDefined();
      if (!segment) continue;
      const centreY = segment.bounds.y + segment.bounds.height / 2;
      const centreX = segment.bounds.x + segment.bounds.width / 2;
      expect(Math.abs(centreY - laneCenterY(lane)), `lane ${lane} y`).toBeLessThan(CELL.height / 4);
      expect(Math.abs(centreX - columnCenterX(2)), `lane ${lane} x`).toBeLessThan(CELL.width / 4);
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
