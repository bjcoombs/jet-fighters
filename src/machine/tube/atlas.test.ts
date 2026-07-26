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

  // layout.ts PLAYFIELD_FRACTION applied to the 363 x 300 viewBox.
  const PLAYFIELD = { x: 41.382, y: 85.2, width: 272.25, height: 102 };

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

  it('keeps every segment inside the printed border', () => {
    // Nothing lit sits outside the border any more. The three marks between the
    // right rail and the glass edge are white paint on the overlay, not
    // phosphor (owner-confirmed), so they left the atlas entirely.
    for (const s of atlas.segments) {
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
        // A missile crossing a column where a jet is flying is the hit that
        // removes the jet, so the pair is never both lit.
        'jet_lane0_col4 <-> missile_lane0_dot0',
        'jet_lane0_col4 <-> missile_lane0_dot1',
        'jet_lane1_col4 <-> missile_lane1_dot0',
        'jet_lane1_col4 <-> missile_lane1_dot1',
        'jet_lane2_col4 <-> missile_lane2_dot0',
        'jet_lane2_col4 <-> missile_lane2_dot1',
        // A jet reaching the G line has taken the player's ship - game over.
        'jet_lane0_col5 <-> launcher_lane0',
        'jet_lane1_col5 <-> launcher_lane1',
        'jet_lane2_col5 <-> launcher_lane2',
        'jet_lane0_col5 <-> explosion_lane0',
        'jet_lane1_col5 <-> explosion_lane1',
        'jet_lane2_col5 <-> explosion_lane2',
        // The burst marks where the ship was: the ship segment goes out and the
        // explosion comes on, which is what the reference photograph catches.
        'launcher_lane0 <-> explosion_lane0',
        'launcher_lane1 <-> explosion_lane1',
        'launcher_lane2 <-> explosion_lane2',
        // Both occupy the far zone's centre lane.
        'jet_lane1_col0 <-> battleship',
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
  // layout.ts CELL: the field's width over COLUMN_COUNT, and the cell band's
  // height over LANE_COUNT. The band is FIELD_BAND_FRACTION of the frame, not the
  // whole frame, so the cell is far shorter than the rectangle v1 handed down.
  const CELL = { width: 36.3, height: 17.68 };

  const boundsOf = (id: string) => getSegmentById(id as SegmentId).bounds;
  const jetIds = Array.from({ length: 3 }, (_, lane) =>
    Array.from({ length: 6 }, (_, col) => `jet_lane${lane}_col${col}`),
  ).flat();

  /** A path with its bounds origin subtracted: the outline, position removed. */
  const outlineOf = (id: string) => {
    const seg = getSegmentById(id as SegmentId);
    return seg.path.replace(
      /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g,
      (_m, x: string, y: string) =>
        `${(Number(x) - seg.bounds.x).toFixed(3)},${(Number(y) - seg.bounds.y).toFixed(3)}`,
    );
  };

  // Measured off assets/reference/tube-closeup-score0.webp, the first frame that
  // shows the tube lit at a readable scale. Each axis is a ratio against a
  // printed feature on the same axis (sprite width over printed cell width,
  // sprite height over lane pitch) so the handheld perspective cancels: a lit
  // jet is ~0.54 of a cell wide and ~0.61 of the lane pitch tall, and the unlit
  // ghost in every cell reads wider still. The v2.12 atlas drew it at 0.42 x
  // 0.38, which left the field reading as mostly bare glass instead of the woven
  // tapestry of nearly-touching shapes the real tube shows.
  it('gives every jet the photographed share of its lane cell', () => {
    for (const id of jetIds) {
      const b = boundsOf(id);
      expect(b.width / CELL.width, `${id} width`).toBeGreaterThanOrEqual(0.55);
      expect(b.width / CELL.width, `${id} width`).toBeLessThanOrEqual(0.75);
      expect(b.height / CELL.height, `${id} height`).toBeGreaterThanOrEqual(0.45);
      expect(b.height / CELL.height, `${id} height`).toBeLessThanOrEqual(0.65);
    }
  });

  it('draws every jet as one aircraft plan-form: wider along the flight axis', () => {
    for (const id of jetIds) {
      const b = boundsOf(id);
      // Nose points along +x, so a fighter silhouette is longer than its span.
      expect(b.width, `${id}`).toBeGreaterThan(b.height);
    }
  });

  it('allows a distinct jet outline per column and none finer than that', () => {
    // Replaces the assertion that all 18 jets share one translated outline. That
    // was the opposite of the truth: the jet silhouette CHANGES from column to
    // column so that a jet stepping toward the missile station appears to beat
    // its wings, and the animation is built into the physical phosphor segments
    // rather than produced by the program (owner-confirmed;
    // assets/reference/sprites/README.md section 3b).
    //
    // What is still an invariant is that the wing-beat is a function of column
    // alone - the three lanes of a column carry the same shape, translated down
    // the lattice - so the atlas may hold at most one outline per column. The
    // 18 jets currently share one outline because the two action photographs
    // legibly prove the variation exists without being sharp enough to recover
    // each of the six shapes; this test permits the per-column outlines without
    // asserting that they have arrived. See ATLAS-COORDINATES.md, "The jet
    // silhouette varies by column".
    const columnOutlines = new Set<string>();
    for (let col = 0; col < 6; col += 1) {
      const perColumn = new Set([0, 1, 2].map((lane) => outlineOf(`jet_lane${lane}_col${col}`)));
      expect(perColumn.size, `column ${col} lanes`).toBe(1);
      columnOutlines.add([...perColumn][0]);
    }
    expect(columnOutlines.size).toBeLessThanOrEqual(6);
  });

  // The player's ship, measured off assets/reference/sprites/battleship-cyan-lit.png
  // (the filename is a misnomer kept for commit-history continuity): ~0.44 of a
  // cell wide and ~0.54 of the lane pitch tall.
  it("keeps the player's ship inside its cell and smaller than a jet", () => {
    const jet = boundsOf('jet_lane0_col5');
    for (let lane = 0; lane < 3; lane += 1) {
      const b = boundsOf(`launcher_lane${lane}`);
      expect(b.width / CELL.width, `launcher_lane${lane} width`).toBeLessThanOrEqual(0.55);
      expect(b.height / CELL.height, `launcher_lane${lane} height`).toBeLessThanOrEqual(0.5);
      // A jet that reaches the capture line takes it, so it must not out-mass one.
      expect(b.width * b.height, `launcher_lane${lane} area`).toBeLessThan(jet.width * jet.height);
    }
  });

  it("draws the player's ship as a hull, superstructure and keel, not one block", () => {
    // Three bands separated by dark glass, not a solid body and not the rack of
    // pointed rails the v2.12 atlas drew here. The rails were a gun battery at
    // the field's right-hand edge; the photographs show a ship-like silhouette -
    // a long hull with a raised superstructure - inside the field near the G
    // line, and the owner confirmed that is the object the player controls.
    for (let lane = 0; lane < 3; lane += 1) {
      const path = getSegmentById(`launcher_lane${lane}` as SegmentId).path;
      expect(path.match(/M/g)?.length, `launcher_lane${lane}`).toBe(3);
    }
  });

  it('stacks the two missile bursts vertically, the upper one broader', () => {
    // Owner-reported and confirmed in tube-closeup-score10.webp: the fired
    // missile is two cyan starbursts one directly above the other in the same
    // column, not two dots side by side, and the two are not identical.
    for (let lane = 0; lane < 3; lane += 1) {
      const upper = boundsOf(`missile_lane${lane}_dot0`);
      const lower = boundsOf(`missile_lane${lane}_dot1`);
      expect(upper.y + upper.height, `lane ${lane} stacking`).toBeLessThan(lower.y);
      expect(upper.width, `lane ${lane} upper width`).toBeGreaterThan(lower.width);
      // Same column: their horizontal spans overlap.
      expect(upper.x, `lane ${lane} column`).toBeLessThan(lower.x + lower.width);
      expect(lower.x, `lane ${lane} column`).toBeLessThan(upper.x + upper.width);
    }
  });

  it('draws both missile bursts and the explosion as spiky, not round', () => {
    // A circle is two arc commands; a burst is a many-sided polygon. The v2.12
    // atlas drew round dots.
    const spiky = [
      'missile_lane0_dot0',
      'missile_lane0_dot1',
      'missile_lane1_dot0',
      'missile_lane1_dot1',
      'missile_lane2_dot0',
      'missile_lane2_dot1',
      'explosion_lane0',
      'explosion_lane1',
      'explosion_lane2',
    ];
    for (const id of spiky) {
      const path = getSegmentById(id as SegmentId).path;
      expect(path, id).not.toMatch(/[aA] /);
      expect(path.match(/L /g)?.length ?? 0, `${id} vertices`).toBeGreaterThanOrEqual(11);
    }
  });

  it("puts the explosion over the player's ship position in every lane", () => {
    for (let lane = 0; lane < 3; lane += 1) {
      const ship = boundsOf(`launcher_lane${lane}`);
      const burst = boundsOf(`explosion_lane${lane}`);
      const centre = (b: typeof ship) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      expect(centre(burst).x, `lane ${lane} x`).toBeCloseTo(centre(ship).x, 3);
      expect(centre(burst).y, `lane ${lane} y`).toBeCloseTo(centre(ship).y, 3);
      // The burst throws wider than the ship it consumes.
      expect(burst.width, `lane ${lane} width`).toBeGreaterThan(ship.width);
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

  it('has the two-burst missile in every lane', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      expect(ids.has(`missile_lane${lane}_dot0`)).toBe(true);
      expect(ids.has(`missile_lane${lane}_dot1`)).toBe(true);
    }
    expect(countMatching(/^missile_/)).toBe(EXPECTED_SEGMENT_COUNTS.missile);
  });

  it("has the player's ship in every lane position", () => {
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

  it('has an explosion per lane, the SCORE label, and the battleship', () => {
    for (let lane = 0; lane < 3; lane += 1) expect(ids.has(`explosion_lane${lane}`)).toBe(true);
    expect(countMatching(/^explosion_/)).toBe(EXPECTED_SEGMENT_COUNTS.explosion);
    expect(ids.has('score_label')).toBe(true);
    expect(ids.has('battleship')).toBe(true);
  });

  it('has no lives display, because the unit has none', () => {
    // Owner-confirmed: the machine cannot show remaining lives. Damage is
    // signalled only by the two- and three-beep warnings, which is why the
    // warning sequence carries so much weight in docs/evidence/audio-reference.md.
    // `life_0..2` were phantom segments - the same class of fault as the phantom
    // ground line removed in #32 - and the three white marks they were traced
    // from are printed paint on the overlay, drawn by silkscreen.ts.
    expect(countMatching(/^life/)).toBe(0);
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
    expect(red.has('explosion_lane0')).toBe(true);
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
