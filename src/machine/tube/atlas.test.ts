import { describe, expect, it } from 'vitest';

import rawAtlas from './atlas.json';
import {
  EXPECTED_SEGMENT_COUNTS,
  GRID_COUNT,
  PLATE_COUNT,
  TOTAL_SEGMENT_COUNT,
  type SegmentId,
} from './atlas-schema.js';
import {
  getSegmentByAddress,
  getSegmentById,
  getSegmentsByColor,
  getSegmentsByGrid,
  listAllIds,
  loadAtlas,
  validateAtlas,
} from './atlas.js';

const atlas = loadAtlas();

/** A structurally valid segment, cloned and mutated by the rejection tests. */
function validData(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rawAtlas)) as Record<string, unknown>;
}

function segmentsOf(data: Record<string, unknown>): Record<string, unknown>[] {
  return data.segments as Record<string, unknown>[];
}

describe('atlas.json shape', () => {
  it('loads and validates', () => {
    expect(validateAtlas(rawAtlas)).toEqual({ valid: true, errors: [] });
  });

  it('declares the scope-bounding-box viewBox', () => {
    expect(atlas.viewBox).toEqual({ x: 0, y: 0, width: 363, height: 300 });
  });

  it('holds every tube segment exactly once', () => {
    expect(atlas.segments).toHaveLength(TOTAL_SEGMENT_COUNT);
    expect(new Set(atlas.segments.map((s) => s.id)).size).toBe(TOTAL_SEGMENT_COUNT);
  });

  it('addresses every segment within the hardware grid/plate range', () => {
    for (const segment of atlas.segments) {
      expect(segment.grid, segment.id).toBeGreaterThanOrEqual(0);
      expect(segment.grid, segment.id).toBeLessThan(GRID_COUNT);
      expect(segment.plate, segment.id).toBeGreaterThanOrEqual(0);
      expect(segment.plate, segment.id).toBeLessThan(PLATE_COUNT);
    }
  });

  it('assigns each (grid, plate) address to at most one segment', () => {
    const seen = new Map<string, string>();
    for (const segment of atlas.segments) {
      const key = `${segment.grid}-${segment.plate}`;
      expect(seen.get(key), `${segment.id} collides with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, segment.id);
    }
    expect(seen.size).toBe(TOTAL_SEGMENT_COUNT);
  });

  it('gives every segment a non-empty path and positive bounds', () => {
    for (const segment of atlas.segments) {
      expect(segment.path, segment.id).toMatch(/^M /);
      expect(segment.bounds.width, segment.id).toBeGreaterThan(0);
      expect(segment.bounds.height, segment.id).toBeGreaterThan(0);
    }
  });

  it('keeps every segment inside the viewBox', () => {
    const { x, y, width, height } = atlas.viewBox;
    for (const s of atlas.segments) {
      expect(s.bounds.x, s.id).toBeGreaterThanOrEqual(x);
      expect(s.bounds.y, s.id).toBeGreaterThanOrEqual(y);
      expect(s.bounds.x + s.bounds.width, s.id).toBeLessThanOrEqual(x + width);
      expect(s.bounds.y + s.bounds.height, s.id).toBeLessThanOrEqual(y + height);
    }
  });
});

describe('geometry invariants', () => {
  // The scope window is a circle fused with a rectangle to its left, in atlas
  // units: src/ui/geometry.ts SCOPE_CIRCLE / SCOPE_RECT translated by (-320, -72).
  const CIRCLE = { cx: 213, cy: 150, r: 150 };
  const TAB = { x: 0, y: 78, width: 213, height: 144 };
  const inWindow = (x: number, y: number) =>
    (x - CIRCLE.cx) ** 2 + (y - CIRCLE.cy) ** 2 <= CIRCLE.r ** 2 ||
    (x >= TAB.x && x <= TAB.x + TAB.width && y >= TAB.y && y <= TAB.y + TAB.height);

  // src/render/layout.ts PLAYFIELD_FRACTION applied to the 363 x 300 viewBox.
  const PLAYFIELD = { x: 19.965, y: 102, width: 324.885, height: 96 };

  it('keeps every segment inside the round scope window, not just its bounding box', () => {
    for (const s of atlas.segments) {
      const corners: [number, number][] = [
        [s.bounds.x, s.bounds.y],
        [s.bounds.x + s.bounds.width, s.bounds.y],
        [s.bounds.x, s.bounds.y + s.bounds.height],
        [s.bounds.x + s.bounds.width, s.bounds.y + s.bounds.height],
      ];
      for (const [x, y] of corners) {
        expect(inWindow(x, y), `${s.id} at ${x},${y}`).toBe(true);
      }
    }
  });

  it('keeps every segment but the reserve-launcher marks inside the printed border', () => {
    for (const s of atlas.segments) {
      if (s.id.startsWith('life_')) continue;
      expect(s.bounds.x, s.id).toBeGreaterThanOrEqual(PLAYFIELD.x);
      expect(s.bounds.x + s.bounds.width, s.id).toBeLessThanOrEqual(
        PLAYFIELD.x + PLAYFIELD.width,
      );
      expect(s.bounds.y, s.id).toBeGreaterThanOrEqual(PLAYFIELD.y);
      expect(s.bounds.y + s.bounds.height, s.id).toBeLessThanOrEqual(
        PLAYFIELD.y + PLAYFIELD.height,
      );
    }
  });

  it('puts the reserve-launcher marks outside the right border', () => {
    for (let i = 0; i < 3; i += 1) {
      const life = getSegmentById(`life_${i}` as SegmentId);
      expect(life.bounds.x).toBeGreaterThan(PLAYFIELD.x + PLAYFIELD.width);
    }
  });

  it('overlaps only the pairs documented in ATLAS-COORDINATES.md', () => {
    // Two phosphor segments sharing glass must be mutually exclusive in play.
    const family = (id: string) =>
      id.replace(/_?(lane|col|digit|dot)[0-9a-g]+/g, '').replace(/_seg[a-g]/, '');
    const found: string[] = [];
    for (let i = 0; i < atlas.segments.length; i += 1) {
      for (let j = i + 1; j < atlas.segments.length; j += 1) {
        const a = atlas.segments[i];
        const b = atlas.segments[j];
        if (family(a.id) === family(b.id)) continue;
        const overlap =
          a.bounds.x < b.bounds.x + b.bounds.width &&
          b.bounds.x < a.bounds.x + a.bounds.width &&
          a.bounds.y < b.bounds.y + b.bounds.height &&
          b.bounds.y < a.bounds.y + a.bounds.height;
        if (overlap) found.push(`${a.id} <-> ${b.id}`);
      }
    }
    expect(found.sort()).toEqual(
      [
        'jet_lane0_col5 <-> launcher_lane0',
        'jet_lane1_col0 <-> battleship',
        'jet_lane1_col5 <-> launcher_lane1',
        'jet_lane2_col5 <-> launcher_lane2',
        'rocket_lane1_col0 <-> battleship',
      ].sort(),
    );
  });

  it('lays the jets out on a regular 6 x 3 lattice', () => {
    const centre = (id: string) => {
      const b = getSegmentById(id as SegmentId).bounds;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const step = centre('jet_lane0_col1').x - centre('jet_lane0_col0').x;
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 1; col < 6; col += 1) {
        const dx = centre(`jet_lane${lane}_col${col}`).x - centre(`jet_lane${lane}_col${col - 1}`).x;
        expect(dx, `lane ${lane} col ${col}`).toBeCloseTo(step, 3);
      }
      // Lanes share the same column x positions.
      expect(centre(`jet_lane${lane}_col3`).x).toBeCloseTo(centre('jet_lane0_col3').x, 3);
    }
    const laneStep = centre('jet_lane1_col0').y - centre('jet_lane0_col0').y;
    expect(centre('jet_lane2_col0').y - centre('jet_lane1_col0').y).toBeCloseTo(laneStep, 3);
  });
});

describe('sprite proportions', () => {
  // The distance-column cell the playfield sprites live in: the field is 80% of
  // the printed playfield width split six ways, its height split three ways.
  // See ATLAS-COORDINATES.md, "Relationship to src/render/layout.ts".
  const CELL = { width: 43.318, height: 32 };

  const boundsOf = (id: string) => getSegmentById(id as SegmentId).bounds;
  const jetIds = Array.from({ length: 3 }, (_, lane) =>
    Array.from({ length: 6 }, (_, col) => `jet_lane${lane}_col${col}`),
  ).flat();

  // The v2.11 render showed the jets as chunky chevrons filling over half their
  // cell and the launcher as a triangle filling four fifths of one. Measured off
  // device-front-gameplay.jpg (sprite width over printed cell width, sprite
  // height over lane pitch, so perspective cancels on each axis) a jet is
  // ~0.37-0.42 x ~0.52-0.63 of a cell and a launcher ~0.34 x ~0.54.
  it('keeps every jet small against its lane cell', () => {
    for (const id of jetIds) {
      const b = boundsOf(id);
      expect(b.width / CELL.width, `${id} width`).toBeLessThanOrEqual(0.45);
      expect(b.height / CELL.height, `${id} height`).toBeLessThanOrEqual(0.4);
    }
  });

  it('draws every jet as one aircraft plan-form: wider along the flight axis', () => {
    for (const id of jetIds) {
      const b = boundsOf(id);
      // Nose points along +x, so a fighter silhouette is longer than its span.
      expect(b.width, `${id}`).toBeGreaterThan(b.height);
    }
  });

  it('gives all 18 jets the same silhouette', () => {
    const first = boundsOf(jetIds[0]);
    for (const id of jetIds) {
      const b = boundsOf(id);
      expect(b.width, `${id} width`).toBeCloseTo(first.width, 6);
      expect(b.height, `${id} height`).toBeCloseTo(first.height, 6);
      // Same outline, translated onto the lattice: normalising by the bounds
      // origin must give byte-identical path data.
      const norm = (s: string, ox: number, oy: number) =>
        s.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) =>
          `${(Number(x) - ox).toFixed(3)},${(Number(y) - oy).toFixed(3)}`,
        );
      expect(norm(getSegmentById(id as SegmentId).path, b.x, b.y), id).toBe(
        norm(getSegmentById(jetIds[0] as SegmentId).path, first.x, first.y),
      );
    }
  });

  it('keeps each launcher a small marker at the G line, not a cell-filling block', () => {
    const jet = boundsOf('jet_lane0_col5');
    for (let lane = 0; lane < 3; lane += 1) {
      const b = boundsOf(`launcher_lane${lane}`);
      expect(b.width / CELL.width, `launcher_lane${lane} width`).toBeLessThanOrEqual(0.4);
      expect(b.height / CELL.height, `launcher_lane${lane} height`).toBeLessThanOrEqual(0.4);
      // It sits behind a jet that has reached the capture line, so it must not
      // out-mass one.
      expect(b.width * b.height, `launcher_lane${lane} area`).toBeLessThan(jet.width * jet.height);
    }
  });

  it('draws the launcher as separate rails rather than one filled body', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      const path = getSegmentById(`launcher_lane${lane}` as SegmentId).path;
      const subpaths = path.match(/M/g) ?? [];
      expect(subpaths.length, `launcher_lane${lane}`).toBeGreaterThan(1);
    }
  });

  it('keeps a jet rocket dot subordinate to the jet that fires it', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 0; col < 6; col += 1) {
        const rocket = boundsOf(`rocket_lane${lane}_col${col}`);
        const jet = boundsOf(`jet_lane${lane}_col${col}`);
        expect(rocket.height, `rocket_lane${lane}_col${col}`).toBeLessThan(jet.height * 0.6);
        expect(rocket.width, `rocket_lane${lane}_col${col}`).toBeCloseTo(rocket.height, 6);
      }
    }
  });
});

describe('semantic segment coverage', () => {
  const ids = new Set<string>(listAllIds());
  const countMatching = (re: RegExp) => atlas.segments.filter((s) => re.test(s.id)).length;

  it('has all 18 jets, one per lane per distance column', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 0; col < 6; col += 1) {
        expect(ids.has(`jet_lane${lane}_col${col}`)).toBe(true);
      }
    }
    expect(countMatching(/^jet_/)).toBe(EXPECTED_SEGMENT_COUNTS.jet);
  });

  it('has all 18 jet rockets, one per lane per distance column', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 0; col < 6; col += 1) {
        expect(ids.has(`rocket_lane${lane}_col${col}`)).toBe(true);
      }
    }
    expect(countMatching(/^rocket_/)).toBe(EXPECTED_SEGMENT_COUNTS.rocket);
  });

  it('has the two-dot missile trail in every lane', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      expect(ids.has(`missile_lane${lane}_dot0`)).toBe(true);
      expect(ids.has(`missile_lane${lane}_dot1`)).toBe(true);
    }
    expect(countMatching(/^missile_/)).toBe(EXPECTED_SEGMENT_COUNTS.missile);
  });

  it('has a launcher segment in every lane', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      expect(ids.has(`launcher_lane${lane}`)).toBe(true);
    }
    expect(countMatching(/^launcher_/)).toBe(EXPECTED_SEGMENT_COUNTS.launcher);
  });

  it('has all 21 score segments, a-g on three digits', () => {
    for (let digit = 0; digit < 3; digit += 1) {
      for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        expect(ids.has(`score_digit${digit}_seg${key}`)).toBe(true);
      }
    }
    expect(countMatching(/^score_digit/)).toBe(EXPECTED_SEGMENT_COUNTS.score);
  });

  it('has three life indicators, the SCORE label, and the battleship', () => {
    for (let i = 0; i < 3; i += 1) expect(ids.has(`life_${i}`)).toBe(true);
    expect(countMatching(/^life_/)).toBe(EXPECTED_SEGMENT_COUNTS.life);
    expect(ids.has('score_label')).toBe(true);
    expect(ids.has('battleship')).toBe(true);
  });

  it('puts the attacker segments in the red region and the defender segments in cyan', () => {
    const red = new Set(getSegmentsByColor('red').map((s) => s.id));
    const cyan = new Set(getSegmentsByColor('cyan').map((s) => s.id));
    expect(red.has('jet_lane0_col0')).toBe(true);
    expect(red.has('rocket_lane2_col5')).toBe(true);
    expect(red.has('battleship')).toBe(true);
    expect(cyan.has('launcher_lane1')).toBe(true);
    expect(cyan.has('missile_lane0_dot0')).toBe(true);
    expect(cyan.has('score_digit0_sega')).toBe(true);
    expect(cyan.has('score_label')).toBe(true);
    expect(cyan.has('life_0')).toBe(true);
    expect(red.size + cyan.size).toBe(TOTAL_SEGMENT_COUNT);
  });
});

describe('indexes', () => {
  it('resolves every segment by id', () => {
    for (const segment of atlas.segments) {
      expect(getSegmentById(segment.id)).toBe(segment);
    }
    expect(listAllIds()).toHaveLength(TOTAL_SEGMENT_COUNT);
  });

  it('resolves every segment by (grid, plate) address', () => {
    for (const segment of atlas.segments) {
      expect(getSegmentByAddress(segment.grid, segment.plate)).toBe(segment);
    }
  });

  it('returns undefined for an unwired address', () => {
    expect(getSegmentByAddress(9, PLATE_COUNT - 1)).toBeUndefined();
    expect(getSegmentByAddress(-1, 0)).toBeUndefined();
    expect(getSegmentByAddress(0, 999)).toBeUndefined();
  });

  it('throws a descriptive error for an unknown id', () => {
    expect(() => getSegmentById('jet_lane9_col9' as SegmentId)).toThrow(/jet_lane9_col9/);
  });

  it('groups segments by grid, covering every segment exactly once', () => {
    let total = 0;
    for (let grid = 0; grid < GRID_COUNT; grid += 1) {
      const inGrid = getSegmentsByGrid(grid);
      for (const segment of inGrid) expect(segment.grid).toBe(grid);
      total += inGrid.length;
    }
    expect(total).toBe(TOTAL_SEGMENT_COUNT);
    expect(getSegmentsByGrid(GRID_COUNT)).toEqual([]);
  });

  it('uses all ten grids', () => {
    for (let grid = 0; grid < GRID_COUNT; grid += 1) {
      expect(getSegmentsByGrid(grid).length, `grid ${grid}`).toBeGreaterThan(0);
    }
  });

  it('returns a stable, cached atlas instance', () => {
    expect(loadAtlas()).toBe(atlas);
  });
});

describe('validateAtlas rejects malformed data', () => {
  const expectInvalid = (data: unknown, pattern: RegExp) => {
    const result = validateAtlas(data);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(pattern);
  };

  it('rejects non-objects', () => {
    expectInvalid(null, /object/i);
    expectInvalid('atlas', /object/i);
  });

  it('rejects a missing or malformed viewBox', () => {
    const data = validData();
    delete data.viewBox;
    expectInvalid(data, /viewBox/);

    const bad = validData();
    bad.viewBox = { x: 0, y: 0, width: 0, height: 300 };
    expectInvalid(bad, /viewBox/);
  });

  it('rejects a missing segments array', () => {
    const data = validData();
    delete data.segments;
    expectInvalid(data, /segments/);
  });

  it('rejects a segment missing a required field', () => {
    const data = validData();
    delete segmentsOf(data)[0].path;
    expectInvalid(data, /path/);
  });

  it('rejects an out-of-range grid', () => {
    const data = validData();
    segmentsOf(data)[0].grid = GRID_COUNT;
    expectInvalid(data, /grid/);

    const negative = validData();
    segmentsOf(negative)[0].grid = -1;
    expectInvalid(negative, /grid/);
  });

  it('rejects an out-of-range plate', () => {
    const data = validData();
    segmentsOf(data)[0].plate = PLATE_COUNT;
    expectInvalid(data, /plate/);
  });

  it('rejects an unknown colorRegion', () => {
    const data = validData();
    segmentsOf(data)[0].colorRegion = 'amber';
    expectInvalid(data, /colorRegion/);
  });

  it('rejects duplicate ids', () => {
    const data = validData();
    const segments = segmentsOf(data);
    segments[1].id = segments[0].id;
    expectInvalid(data, /duplicate segment id/i);
  });

  it('rejects duplicate (grid, plate) addresses', () => {
    const data = validData();
    const segments = segmentsOf(data);
    segments[1].grid = segments[0].grid;
    segments[1].plate = segments[0].plate;
    expectInvalid(data, /duplicate address/i);
  });

  it('rejects malformed bounds', () => {
    const data = validData();
    (segmentsOf(data)[0].bounds as Record<string, unknown>).width = -1;
    expectInvalid(data, /bounds/);
  });

  it('rejects an empty path', () => {
    const data = validData();
    segmentsOf(data)[0].path = '';
    expectInvalid(data, /path/);
  });

  it('rejects a segment count that does not match the tube', () => {
    const data = validData();
    segmentsOf(data).pop();
    expectInvalid(data, /expected \d+ segments/i);
  });

  it('reports every problem it finds, not just the first', () => {
    const data = validData();
    segmentsOf(data)[0].grid = 99;
    segmentsOf(data)[1].colorRegion = 'amber';
    expect(validateAtlas(data).errors.length).toBeGreaterThanOrEqual(2);
  });
});
