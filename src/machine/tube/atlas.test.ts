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

  it('overlaps exactly the segments that share a cell, and nothing else', () => {
    // Two phosphor segments sharing glass must be mutually exclusive in play,
    // and on this tube the things that can share glass are the things drawn in
    // the same cell: a jet and the missile that kills it, the burst it leaves,
    // the launcher and the burst that marks its destruction, the battleship and
    // the far cell's own occupants.
    //
    // The assertion is an equality between two independent derivations, not a
    // list of tolerated pairs. The left side is read off the geometry - which
    // bounding boxes actually intersect. The right side is read off the ids -
    // which segments name the same (lane, column). A shape that grows into its
    // neighbour's cell fails, and so does one that shrinks out of its own.
    const family = (id: string) =>
      id.replace(/_?(lane|col|digit)[0-9a-g]+/g, '').replace(/_seg[a-g]/, '');
    /** The (lane, column) cell a segment is drawn in, or null if it has none. */
    const cell = (id: string): string | null => {
      const lane = /_lane([0-2])/.exec(id)?.[1];
      if (lane === undefined) return null;
      const column = /_col([0-5])/.exec(id)?.[1];
      if (column !== undefined) return `${lane}-${column}`;
      // The launcher and the burst that replaces it stand on the G line, which
      // is cell 6; the battleship has cell 0 to itself.
      if (id.startsWith('battleship_')) return `${lane}-0`;
      return `${lane}-6`;
    };
    const found: string[] = [];
    const expected: string[] = [];
    for (let i = 0; i < atlas.segments.length; i += 1) {
      for (let j = i + 1; j < atlas.segments.length; j += 1) {
        const a = atlas.segments[i];
        const b = atlas.segments[j];
        if (family(a.id) === family(b.id)) continue;
        const pair = `${a.id} <-> ${b.id}`;
        const overlap =
          a.bounds.x < b.bounds.x + b.bounds.width &&
          b.bounds.x < a.bounds.x + a.bounds.width &&
          a.bounds.y < b.bounds.y + b.bounds.height &&
          b.bounds.y < a.bounds.y + a.bounds.height;
        if (overlap) found.push(pair);
        const shared = cell(a.id);
        // The colon is deliberately offset toward the player, clear of the
        // aircraft that fired it, so it overlaps none of its own cell-mates.
        // It used to reach the battleship, which was drawn in the same cell as
        // the far jet column; the battleship has a cell of its own now.
        // See ATLAS-COORDINATES.md, assumption 6.
        const colon = a.id.startsWith('rocket_') !== b.id.startsWith('rocket_');
        if (!colon && shared !== null && shared === cell(b.id)) expected.push(pair);
      }
    }
    expect(found.sort()).toEqual(expected.sort());
    // Stated on its own because it is the placement decision, not a consequence
    // of the cell rule: the colon touches nothing at all.
    expect(found.filter((pair) => pair.includes('rocket_'))).toEqual([]);
    // The score readout shares no glass with anything, which is what the atlas
    // separated the SCORE box from the distance columns to guarantee.
    expect(found.filter((pair) => pair.includes('score'))).toEqual([]);
  });

  it('lays the jets out on a regular 5 x 3 lattice', () => {
    const centre = (id: string) => {
      const b = getSegmentById(id as SegmentId).bounds;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const step = centre('jet_lane0_col2').x - centre('jet_lane0_col1').x;
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 2; col < 6; col += 1) {
        const dx = centre(`jet_lane${lane}_col${col}`).x - centre(`jet_lane${lane}_col${col - 1}`).x;
        expect(dx, `lane ${lane} col ${col}`).toBeCloseTo(step, 3);
      }
      // Lanes share the same column x positions.
      expect(centre(`jet_lane${lane}_col3`).x).toBeCloseTo(centre('jet_lane0_col3').x, 3);
    }
    const laneStep = centre('jet_lane1_col1').y - centre('jet_lane0_col1').y;
    expect(centre('jet_lane2_col1').y - centre('jet_lane1_col1').y).toBeCloseTo(laneStep, 3);
  });
});

describe('sprite proportions', () => {
  // The distance-column cell the playfield sprites live in: the field is 80% of
  // the printed playfield width split six ways, its height split three ways.
  // See ATLAS-COORDINATES.md, "Relationship to src/render/layout.ts".
  // layout.ts CELL: the field's width over COLUMN_COUNT, and the cell band's
  // height over LANE_COUNT. The band is FIELD_BAND_FRACTION of the frame, not the
  // whole frame, so the cell is far shorter than the rectangle v1 handed down.
  const CELL = { width: 31.114, height: 17.68 };

  const boundsOf = (id: string) => getSegmentById(id as SegmentId).bounds;
  /** Cells 1-5. Neither end cell carries a jet. */
  const JET_CELLS = [1, 2, 3, 4, 5];
  const jetIds = Array.from({ length: 3 }, (_, lane) =>
    JET_CELLS.map((col) => `jet_lane${lane}_col${col}`),
  ).flat();

  /** A path with its bounds origin subtracted: the outline, position removed. */
  const outlineOf = (id: string): readonly (readonly [number, number])[] => {
    const seg = getSegmentById(id as SegmentId);
    return [...seg.path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(
      (m) => [Number(m[1]) - seg.bounds.x, Number(m[2]) - seg.bounds.y] as const,
    );
  };

  /** Two outlines are the same shape when every vertex lands within a milliunit. */
  const sameOutline = (
    a: readonly (readonly [number, number])[],
    b: readonly (readonly [number, number])[],
  ) =>
    a.length === b.length &&
    a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-3 && Math.abs(p[1] - b[i]![1]) < 1e-3);

  // Measured off the gameplay video's thirteen per-cell jet crops
  // (assets/reference/sprites/video/jet-col*-lane*.png), each the accumulated
  // union of the scan slots over a window in which the jet was stationary. Each
  // axis is a ratio against the phosphor lattice on the same axis - sprite width
  // over the 74.5 px column pitch, sprite height over the 44 px lane pitch - so
  // the camera's drift cancels. The two poses do not have the same proportions:
  // the level pose measures 36 x 28 px (0.48 x 0.64 of a cell) and the raked one
  // 39 x 20 (0.52 x 0.45), which is most of what makes them read as different
  // aircraft attitudes rather than as one shape jittering.
  it('gives every jet the share of its lane cell the video measured', () => {
    for (const id of jetIds) {
      const b = boundsOf(id);
      expect(b.width / CELL.width, `${id} width`).toBeGreaterThanOrEqual(0.45);
      expect(b.width / CELL.width, `${id} width`).toBeLessThanOrEqual(0.6);
      expect(b.height / CELL.height, `${id} height`).toBeGreaterThanOrEqual(0.4);
      expect(b.height / CELL.height, `${id} height`).toBeLessThanOrEqual(0.7);
    }
  });

  it('draws every jet as one aircraft plan-form: wider along the flight axis', () => {
    for (const id of jetIds) {
      const b = boundsOf(id);
      // Nose points along +x, so a fighter silhouette is longer than its span.
      expect(b.width, `${id}`).toBeGreaterThan(b.height);
    }
  });

  it('lays the two jet poses out on the parity of (column + lane)', () => {
    // Replaces the assertion that all 18 jets share one translated outline, and
    // the weaker one that succeeded it - that the atlas *may* hold up to one
    // outline per column. Both were wrong in the same direction: they described
    // what the atlas was allowed to contain rather than what the tube does.
    //
    // The gameplay video settles it. Thirteen per-cell crops, clustered by
    // intersection-over-union, fall into two groups with no member ambiguous:
    // every cell whose (column + lane) is even carries the level-winged pose and
    // every odd one the raked pose. Within a group the crops agree at IoU ~0.85
    // and across groups at ~0.6-0.7. Stepping between the two is the wing-beat
    // the owner described, and it is built into the phosphor, not produced by
    // the program - so the atlas has to carry both shapes, in the right cells.
    //
    // This is an equality on the whole 5 x 3 lattice: exactly two outlines, each
    // in exactly the cells the parity names. A third outline fails it, and so
    // does putting the right two shapes in the wrong cells.
    //
    // Two poses is the floor, not the count. The teardown photographs show the
    // three lanes of a single cell carrying three different outlines, so this
    // is what the video could establish and not what the glass holds; retracing
    // against the photographs is what replaces it.
    const level = outlineOf('jet_lane0_col1');
    const raked = outlineOf('jet_lane1_col1');
    expect(sameOutline(level, raked), 'the two poses are different shapes').toBe(false);
    for (const col of JET_CELLS) {
      for (let lane = 0; lane < 3; lane += 1) {
        const isLevel = (col + lane) % 2 === 1;
        expect(
          sameOutline(outlineOf(`jet_lane${lane}_col${col}`), isLevel ? level : raked),
          `jet_lane${lane}_col${col} carries the ${isLevel ? 'level' : 'raked'} pose`,
        ).toBe(true);
      }
    }
  });

  it('draws the two jet poses at the attitudes the video measured', () => {
    // The level pose is the taller, shorter one and the raked pose the longer,
    // flatter one - 36 x 28 px against 39 x 20. If the two outlines were ever
    // swapped between parities this is what would catch it, because the
    // proportions travel with the shape.
    const level = boundsOf('jet_lane0_col1');
    const raked = boundsOf('jet_lane1_col1');
    expect(level.height, 'level pose is the deeper one').toBeGreaterThan(raked.height);
    expect(raked.width, 'raked pose is the longer one').toBeGreaterThan(level.width);
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

  it('flies the same missile dart in every cell it crosses', () => {
    // The video's negative result, and it constrains the atlas: unlike the jet,
    // the dart does not change with position. Fifteen crops
    // (video/player-missile-col*-lane*.png) measure 23-28 x 9-12 px, a spread of
    // a pixel or two of bloom around one shape. One outline, fifteen placements.
    const first = outlineOf('missile_lane0_col1');
    for (let col = 1; col <= 5; col += 1) {
      for (let lane = 0; lane < 3; lane += 1) {
        expect(
          sameOutline(outlineOf(`missile_lane${lane}_col${col}`), first),
          `missile_lane${lane}_col${col}`,
        ).toBe(true);
      }
    }
  });

  it('points the missile dart left, the way the player fires', () => {
    // Owner's point 1: we are the defenders on the right and our shot travels
    // right to left. The dart's point is at its left end and its flared tail at
    // its right, so the silhouette itself carries the direction of travel - the
    // widest part of the shape sits in its right-hand half.
    const dart = getSegmentById('missile_lane1_col3' as SegmentId);
    const xs = [...dart.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    const mid = dart.bounds.x + dart.bounds.width / 2;
    const spread = (side: (x: number) => boolean) => {
      const ys = xs.filter((p) => side(p.x)).map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread((x) => x > mid), 'tail half').toBeGreaterThan(spread((x) => x < mid));
  });

  it('stacks the jet-kill burst as two blobs in one segment, upper broader', () => {
    // Two spiky cyan blobs one above the other, their jagged edges facing away
    // from each other, the upper broader than the lower
    // (video/jet-kill-burst-col*-lane*.png). One segment, two sub-paths: the
    // pair is never seen half-lit, so the machine has no reason to address the
    // blobs separately, and one address is what makes the family fit the tube.
    for (const col of JET_CELLS) {
      for (let lane = 0; lane < 3; lane += 1) {
        const id = `burst_lane${lane}_col${col}`;
        const path = getSegmentById(id as SegmentId).path;
        expect(path.match(/M /g)?.length, `${id} sub-paths`).toBe(2);
      }
    }
    // Measured on the sub-paths of one segment: the upper blob is the wider.
    const path = getSegmentById('burst_lane0_col1' as SegmentId).path;
    const halves = path.split('M ').filter((part) => part.trim().length > 0);
    const extent = (part: string) => {
      const xs = [...part.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      return {
        width: Math.max(...xs.map((p) => p.x)) - Math.min(...xs.map((p) => p.x)),
        top: Math.min(...xs.map((p) => p.y)),
        bottom: Math.max(...xs.map((p) => p.y)),
      };
    };
    const upper = extent(halves[0]);
    const lower = extent(halves[1]);
    expect(upper.bottom, 'stacked, not side by side').toBeLessThanOrEqual(lower.top);
    expect(upper.width, 'upper blob is the broader').toBeGreaterThan(lower.width);
  });

  it('draws the bursts and the explosion as spiky, not round', () => {
    // A circle is two arc commands; a burst is a many-sided polygon. The v2.12
    // atlas drew round dots.
    const spiky = [
      'burst_lane0_col1',
      'burst_lane1_col2',
      'burst_lane2_col3',
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

  it("draws the attackers' shot as a colon: two dots, one above the other", () => {
    // Owner's point 3, and now traced: video/attacker-colon-2.png resolves the
    // shot as two red blobs one directly above the other with clear dark glass
    // between them, 8 x 17 px overall. It is therefore taller than it is wide -
    // the one proportion that distinguishes a colon from the single round dot
    // the atlas used to draw here - and it is one segment with two sub-paths,
    // because a machine has no reason to light half a colon.
    for (let lane = 0; lane < 3; lane += 1) {
      for (const col of JET_CELLS) {
        const id = `rocket_lane${lane}_col${col}`;
        const path = getSegmentById(id as SegmentId).path;
        expect(path.match(/M /g)?.length, `${id} sub-paths`).toBe(2);
        expect(path, `${id} is not a circle`).not.toMatch(/[aA] /);
        const dot = boundsOf(id);
        expect(dot.height, `${id} is taller than wide`).toBeGreaterThan(dot.width * 1.5);
        // Subordinate to the aircraft that fires it, in both axes.
        const jet = boundsOf(`jet_lane${lane}_col${col}`);
        expect(dot.width, `${id} width`).toBeLessThan(jet.width * 0.3);
        expect(dot.height, `${id} height`).toBeLessThan(jet.height);
      }
    }
  });

  it('sizes the battleship against the jet the video compares it to', () => {
    // "Half again as wide as a jet and slightly shorter" - 50 x 18 px against
    // the jet's 36-39 x 20-28. Three segments, one per lane: the video finds it
    // in the far cell in any of the three lanes and stationary there, so a
    // crossing is segments lighting rather than a sprite moving.
    for (let lane = 0; lane < 3; lane += 1) {
      const ship = boundsOf(`battleship_lane${lane}`);
      const jet = boundsOf(`jet_lane${lane}_col1`);
      expect(ship.width, `battleship_lane${lane} width`).toBeGreaterThan(jet.width * 1.2);
      expect(ship.height, `battleship_lane${lane} height`).toBeLessThan(jet.height);
      // It has a cell of its own now, one to the far side of the first jet
      // column, so it sits a whole cell pitch left of that column's jet.
      expect(
        jet.x + jet.width / 2 - (ship.x + ship.width / 2),
        `battleship_lane${lane} cell`,
      ).toBeCloseTo(CELL.width, 2);
    }
  });
});

describe('semantic segment coverage', () => {
  const ids = new Set<string>(listAllIds());
  const countMatching = (re: RegExp) => atlas.segments.filter((s) => re.test(s.id)).length;

  it('has a jet in every lane of the five cells that carry one, and no other', () => {
    // Neither end cell has a jet: cell 0 is the battleship's own and cell 6 is
    // the player's, and the teardown photographs show no aircraft printed in
    // either. Two independent sources agree - the bare-tube photographs and the
    // whole-file video measurement, which found the far cell's jet-sized red
    // sightings to be partially-lit battleships.
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 1; col <= 5; col += 1) {
        expect(ids.has(`jet_lane${lane}_col${col}`)).toBe(true);
      }
      expect(ids.has(`jet_lane${lane}_col0`)).toBe(false);
      expect(ids.has(`jet_lane${lane}_col6`)).toBe(false);
    }
    expect(countMatching(/^jet_/)).toBe(EXPECTED_SEGMENT_COUNTS.jet);
  });

  it('has an attacker colon wherever there is a jet to fire it', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 1; col <= 5; col += 1) {
        expect(ids.has(`rocket_lane${lane}_col${col}`)).toBe(true);
      }
      expect(ids.has(`rocket_lane${lane}_col0`)).toBe(false);
      expect(ids.has(`rocket_lane${lane}_col6`)).toBe(false);
    }
    expect(countMatching(/^rocket_/)).toBe(EXPECTED_SEGMENT_COUNTS.rocket);
  });

  it('has the missile dart in every cell it crosses', () => {
    // The five jet cells, and neither end cell: the shot is launched into cell
    // 5 and steps away as far as cell 1.
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 1; col <= 5; col += 1) {
        expect(ids.has(`missile_lane${lane}_col${col}`)).toBe(true);
      }
      expect(ids.has(`missile_lane${lane}_col0`)).toBe(false);
      expect(ids.has(`missile_lane${lane}_col6`)).toBe(false);
    }
    expect(countMatching(/^missile_/)).toBe(EXPECTED_SEGMENT_COUNTS.missile);
  });

  it('has a jet-kill burst wherever there is a jet to kill', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      for (let col = 1; col <= 5; col += 1) {
        expect(ids.has(`burst_lane${lane}_col${col}`)).toBe(true);
      }
      expect(ids.has(`burst_lane${lane}_col0`)).toBe(false);
      expect(ids.has(`burst_lane${lane}_col6`)).toBe(false);
    }
    expect(countMatching(/^burst_/)).toBe(EXPECTED_SEGMENT_COUNTS.burst);
  });

  it("has the player's ship in every lane position", () => {
    for (let lane = 0; lane < 3; lane += 1) {
      expect(ids.has(`launcher_lane${lane}`)).toBe(true);
    }
    expect(countMatching(/^launcher_/)).toBe(EXPECTED_SEGMENT_COUNTS.launcher);
  });

  it('has two full digits and a half-digit, which is what the tube carries', () => {
    // assets/reference/tube-teardown/score-block.jpg: the SCORE legend in its
    // own box, then two digit cells - the left holding a two-stroke half-digit
    // and a full seven-segment digit, the right holding one full digit. The
    // hundreds position is not a seven-segment digit, so the five segments the
    // atlas used to define there were phosphor the glass does not have.
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(ids.has(`score_tens_seg${key}`)).toBe(true);
      expect(ids.has(`score_units_seg${key}`)).toBe(true);
    }
    expect(countMatching(/^score_(tens|units)_/)).toBe(EXPECTED_SEGMENT_COUNTS.score);
    expect(ids.has('score_hundreds')).toBe(true);
    // Two strokes, one address: the readout caps at 199, so the half-digit is
    // only ever wholly lit or wholly dark.
    expect(getSegmentById('score_hundreds' as SegmentId).path.match(/M /g)?.length).toBe(2);
  });

  it('has an explosion per lane, a battleship per lane, and the SCORE label', () => {
    for (let lane = 0; lane < 3; lane += 1) {
      expect(ids.has(`explosion_lane${lane}`)).toBe(true);
      expect(ids.has(`battleship_lane${lane}`)).toBe(true);
    }
    expect(countMatching(/^explosion_/)).toBe(EXPECTED_SEGMENT_COUNTS.explosion);
    expect(countMatching(/^battleship_/)).toBe(EXPECTED_SEGMENT_COUNTS.battleship);
    expect(ids.has('score_label')).toBe(true);
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
    expect(red.has('jet_lane0_col1')).toBe(true);
    expect(red.has('rocket_lane2_col5')).toBe(true);
    expect(red.has('battleship_lane1')).toBe(true);
    expect(cyan.has('launcher_lane1')).toBe(true);
    expect(cyan.has('missile_lane0_col1')).toBe(true);
    expect(cyan.has('burst_lane2_col3')).toBe(true);
    expect(cyan.has('score_tens_sega')).toBe(true);
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
