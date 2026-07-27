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
    // Two units of latitude on the right-hand edge, and it is a stated
    // disagreement rather than slack. PLAYFIELD comes from the lit close-ups
    // and the cell lattice from the bare tube, measured independently; the
    // player's cell runs to the field border and its launcher ends about 1.6
    // units past where the close-ups put that border. That is 5% of a cell
    // between two sources, not a sprite in the wrong place.
    const EDGE_SLACK = 2;
    for (const s of atlas.segments) {
      expect(s.bounds.x, s.id).toBeGreaterThanOrEqual(PLAYFIELD.x);
      expect(s.bounds.x + s.bounds.width, s.id).toBeLessThanOrEqual(
        PLAYFIELD.x + PLAYFIELD.width + EDGE_SLACK,
      );
      expect(s.bounds.y, s.id).toBeGreaterThanOrEqual(PLAYFIELD.y);
      expect(s.bounds.y + s.bounds.height, s.id).toBeLessThanOrEqual(
        PLAYFIELD.y + PLAYFIELD.height,
      );
    }
  });

  it('never lets a segment reach into another cell', () => {
    // What this used to assert - that the segments whose boxes intersect are
    // exactly those naming the same cell - was itself a belief, of the kind
    // ATLAS-COORDINATES.md now calls a constraint promoted from a choice. It
    // was true while the sprites were centred on their cells by construction.
    // Traced from the bare tube they are where the tube prints them: the
    // aircraft in the left half of its cell, the bursts and the dart in the
    // right, and whether any particular pair touches is a fact about the
    // artwork rather than a rule the atlas should enforce.
    //
    // The invariant that survives is the one that matters, and it is the
    // stronger half: **nothing reaches out of its own cell**. A sprite that
    // grew into its neighbour, or that was placed one cell out, breaks this -
    // and a one-cell error is the failure the seventh grid existed to make
    // detectable in the first place.
    const CELL_W = 31.114;
    const FIELD_X = 95.832;
    /** The cell a segment is drawn in, or null for the score readout. */
    const cellOf = (id: string): number | null => {
      const column = /_col([0-6])/.exec(id);
      if (column) return Number(column[1]);
      // The battleship's cell also holds the sea it sits on and the burst
      // behind it; the player's cell holds the launcher and its own burst.
      if (id.startsWith('battleship_') || id.startsWith('sea_')) return 0;
      if (id.startsWith('launcher_') || id.startsWith('explosion_')) return 6;
      if (id.startsWith('capture_')) return 6;
      return null;
    };
    for (const segment of atlas.segments) {
      const cell = cellOf(segment.id);
      if (cell === null) continue;
      const left = FIELD_X + cell * CELL_W;
      const right = left + CELL_W;
      // Half a cell of latitude either side: the printed sprites are wider than
      // the cell they nominally belong to - the bursts run right up to the
      // divider and the battleship is drawn wide - but none of them reaches the
      // cell beyond the one next door.
      expect(segment.bounds.x, `${segment.id} left`).toBeGreaterThan(left - CELL_W / 2);
      expect(segment.bounds.x + segment.bounds.width, `${segment.id} right`).toBeLessThan(
        right + CELL_W / 2,
      );
    }
    // And the score readout shares no glass with the playfield at all, which is
    // what separating the SCORE box from the distance columns guarantees.
    const field = atlas.segments.filter((s) => cellOf(s.id) !== null);
    const score = atlas.segments.filter((s) => cellOf(s.id) === null);
    for (const a of score) {
      for (const b of field) {
        const overlap =
          a.bounds.x < b.bounds.x + b.bounds.width && b.bounds.x < a.bounds.x + a.bounds.width;
        expect(overlap, `${a.id} <-> ${b.id}`).toBe(false);
      }
    }
  });

  it('sits the aircraft left of centre in its cell, where the print puts them', () => {
    // The frame, asserted rather than assumed - and this is the assertion whose
    // absence let the atlas be built on the wrong one.
    //
    // The lattice was originally phased on jet centroids, which takes the
    // artwork to be centred in its cell. It is not. The printed cell boundaries
    // measure at n + 0.66 of that lattice on five boundaries, each a triple of
    // dark runs - one cell's right rule, the gutter, the next cell's left rule -
    // so the printed centres are at n + 0.16 and the aircraft sit about 0.16 of
    // a cell left of them. Phasing on the sprites normalised that away, and
    // every test still passed, because "inside its own cell" and "within a
    // quarter of a cell of the lattice" are both true under a uniform shift.
    //
    // So the offset itself is pinned. A regeneration that re-centres the
    // sprites - which is what happens if anyone re-derives the lattice from the
    // artwork again - fails here rather than passing quietly.
    const CELL_W = 31.114;
    const FIELD_X = 95.832;
    for (let col = 1; col <= 5; col += 1) {
      const centre = FIELD_X + (col + 0.5) * CELL_W;
      for (let lane = 0; lane < 3; lane += 1) {
        const b = getSegmentById(`jet_lane${lane}_col${col}` as SegmentId).bounds;
        const offset = b.x + b.width / 2 - centre;
        expect(offset, `jet_lane${lane}_col${col} sits left of centre`).toBeLessThan(-1.5);
        expect(offset, `jet_lane${lane}_col${col} is not a cell out`).toBeGreaterThan(-6.5);
      }
    }
  });

  it('puts every jet inside its own cell, on the printed lattice', () => {
    // The jets are no longer centred on the column centre: they are where the
    // photograph has them, and the tube does not print them dead centre. What
    // must still hold is that each one is inside the cell it names - a sprite
    // half a cell out would put the whole atlas one cell wrong, which is the
    // error the seventh grid existed to make detectable.
    const CELL_W = 31.114;
    const FIELD_X = 95.832;
    for (let col = 1; col <= 5; col += 1) {
      const centre = FIELD_X + (col + 0.5) * CELL_W;
      for (let lane = 0; lane < 3; lane += 1) {
        const b = getSegmentById(`jet_lane${lane}_col${col}` as SegmentId).bounds;
        expect(b.x, `jet_lane${lane}_col${col} left`).toBeGreaterThan(centre - CELL_W);
        expect(b.x + b.width, `jet_lane${lane}_col${col} right`).toBeLessThan(centre + CELL_W);
        expect(b.x + b.width / 2 - centre, `jet_lane${lane}_col${col} offset`).toBeLessThan(
          CELL_W / 2,
        );
      }
    }
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

  it('gives every one of the fifteen jet cells its own outline', () => {
    // Replaces the parity model, which replaced the single translated outline.
    // Each was the best available reading at the time and each was too coarse.
    //
    // The video could only separate two poses, and did so honestly - thirteen
    // per-cell crops clustered cleanly on the parity of (column + lane). The
    // teardown photographs show the three lanes of a *single* cell carrying
    // three different aircraft: `cell2.jpg` has the middle lane as a symmetric
    // level-winged delta with a forked twin tail and the two outer lanes raked
    // in opposite directions. Two poses was a floor, as it was recorded to be.
    //
    // So the assertion is that the atlas carries what the glass does: fifteen
    // cells, fifteen distinct outlines, none shared with another cell. A model
    // that collapses them - a parity, a per-column rule, one shape translated -
    // fails this, which is the point.
    const outlines = JET_CELLS.flatMap((col) =>
      [0, 1, 2].map((lane) => ({ id: `jet_lane${lane}_col${col}`, shape: outlineOf(`jet_lane${lane}_col${col}`) })),
    );
    expect(outlines).toHaveLength(15);
    for (let i = 0; i < outlines.length; i += 1) {
      for (let j = i + 1; j < outlines.length; j += 1) {
        expect(
          sameOutline(outlines[i]!.shape, outlines[j]!.shape),
          `${outlines[i]!.id} and ${outlines[j]!.id} are the same shape`,
        ).toBe(false);
      }
    }
  });

  it('draws every jet as an aircraft in plan, nose along the flight axis', () => {
    // Whatever the fifteen outlines differ in, they are all the same object
    // seen from above, flying the same way: longer along the direction of
    // travel than across it, and filling about half a cell.
    for (const id of jetIds) {
      const b = boundsOf(id);
      expect(b.width, `${id} is longer than it is broad`).toBeGreaterThan(b.height);
      expect(b.width / CELL.width, `${id} width`).toBeGreaterThan(0.45);
      expect(b.width / CELL.width, `${id} width`).toBeLessThan(0.6);
    }
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

  it("draws the player's ship as one object, which is what the tube prints", () => {
    // This asserted three bands - hull, superstructure, keel - separated by dark
    // glass, read off the lit close-up where bloom breaks a single shape into
    // bright patches. The bare tube shows one connected object per lane. The
    // three bands were an artefact of looking at a lit sprite through smoked
    // glass, and the assertion froze them.
    for (let lane = 0; lane < 3; lane += 1) {
      const path = getSegmentById(`launcher_lane${lane}` as SegmentId).path;
      expect(path.match(/M /g)?.length, `launcher_lane${lane}`).toBe(1);
    }
  });

  it('draws the same missile dart, cell by cell, at the size it was measured', () => {
    // The video recorded "one outline, five placements" as a negative result -
    // fifteen crops measuring 23-28 x 9-12 px, a spread it put down to bloom.
    // Traced off the bare tube each cell gives its own outline, and at this
    // scale the differences are small enough that they could be the artwork or
    // could be the tracing. **Neither is asserted here.** What is asserted is
    // what both sources agree on and what a wrong component assignment would
    // break: every one of the fifteen is a dart of the measured size.
    //
    // That size is also the independent check on the assignment. The three
    // white shapes in a jet cell are located by position rather than ranked by
    // size, and this converts each traced dart back to the video's own pixels -
    // 23.9 x 9.6 against the catalogue's 26 x 12 for the missile in flight.
    for (let col = 1; col <= 5; col += 1) {
      for (let lane = 0; lane < 3; lane += 1) {
        const b = boundsOf(`missile_lane${lane}_col${col}`);
        const videoWide = (b.width / CELL.width) * 74.5;
        const videoTall = (b.height / CELL.height) * 44;
        expect(videoWide, `missile_lane${lane}_col${col} width`).toBeGreaterThan(20);
        expect(videoWide, `missile_lane${lane}_col${col} width`).toBeLessThan(30);
        expect(videoTall, `missile_lane${lane}_col${col} height`).toBeGreaterThan(7);
        expect(videoTall, `missile_lane${lane}_col${col} height`).toBeLessThan(14);
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

  it("prints the player's two losses as different bursts, beside the ship", () => {
    // This asserted the burst was centred on the launcher, on the reasoning
    // that a burst marks where the ship was. The tube does not do that: the
    // cell prints the ship and two bursts side by side, all three at fixed
    // positions, and lights whichever the event calls for.
    //
    // The two bursts are two different losses, which the owner settled: one is
    // a jet reaching the capture line, the other is being hit by the colon.
    // They are close in area and clearly different in shape - the capture burst
    // deeper, the rocket burst flatter - and each is consistent across its own
    // three lanes.
    for (let lane = 0; lane < 3; lane += 1) {
      const ship = boundsOf(`launcher_lane${lane}`);
      const capture = boundsOf(`capture_lane${lane}`);
      const rocket = boundsOf(`explosion_lane${lane}`);
      // The capture burst is the one to the ship's left; that is the
      // discriminator the lit photograph gave, and it does not depend on
      // reading a lane off a photograph that spans three.
      expect(capture.x + capture.width / 2, `capture_lane${lane} is left of the ship`).toBeLessThan(
        ship.x + ship.width / 2,
      );
      // Deeper than the rocket burst, which is the shape difference between them.
      expect(capture.height, `capture_lane${lane} is the deeper burst`).toBeGreaterThan(
        rocket.height,
      );
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
        // Two dots one above the other, so the pair is much taller than it is
        // wide - about 0.11 of a cell across and 0.68 of the lane pitch down.
        expect(dot.height, `${id} is taller than wide`).toBeGreaterThan(dot.width * 2.5);
        expect(dot.width / 31.114, `${id} width`).toBeLessThan(0.16);
        // It straddles the fuselage at the nose, so it spans as much of the
        // lane as the aircraft does - it is narrow, not small.
        const jet = boundsOf(`jet_lane${lane}_col${col}`);
        expect(dot.width, `${id} width against the jet`).toBeLessThan(jet.width * 0.3);
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
      // Half again as wide as a jet and not as deep, which is the comparison
      // both the video and the bare tube make. Where it sits is asserted by the
      // cell-containment test rather than as a distance from the jet: both are
      // now drawn where the tube prints them, so a gap between two of them is
      // an observation about the artwork and not a rule.
      expect(ship.width, `battleship_lane${lane} width`).toBeGreaterThan(jet.width * 1.2);
      // Against the deepest aircraft in the neighbouring cell, not against the
      // one in the matching lane. The fifteen jets are fifteen shapes and they
      // differ most in depth - the level poses run half again as deep as the
      // raked ones - so a per-lane comparison would be asserting which pose the
      // tube happens to print in that lane.
      const deepestJet = Math.max(
        ...[0, 1, 2].map((other) => boundsOf(`jet_lane${other}_col1`).height),
      );
      expect(ship.height, `battleship_lane${lane} height`).toBeLessThan(deepestJet);
      // The sea sits under the hull, in the same cell, and is wider than it is
      // deep - two rows of wave glyphs rather than a block.
      const sea = boundsOf(`sea_lane${lane}`);
      expect(sea.y, `sea_lane${lane} below the hull`).toBeGreaterThan(ship.y);
      expect(sea.width, `sea_lane${lane}`).toBeGreaterThan(sea.height);
      expect(
        getSegmentById(`sea_lane${lane}` as SegmentId).path.match(/M /g)?.length ?? 0,
        `sea_lane${lane} wave glyphs`,
      ).toBeGreaterThan(3);
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
      expect(ids.has(`sea_lane${lane}`)).toBe(true);
      expect(ids.has(`battleship_burst_lane${lane}`)).toBe(true);
    }
    expect(countMatching(/^explosion_/)).toBe(EXPECTED_SEGMENT_COUNTS.explosion);
    expect(countMatching(/^battleship_lane/)).toBe(EXPECTED_SEGMENT_COUNTS.battleship);
    expect(countMatching(/^sea_/)).toBe(EXPECTED_SEGMENT_COUNTS.sea);
    expect(countMatching(/^battleship_burst_/)).toBe(EXPECTED_SEGMENT_COUNTS.battleshipBurst);
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
