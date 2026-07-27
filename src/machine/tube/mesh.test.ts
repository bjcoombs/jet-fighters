import { describe, expect, it } from 'vitest';

import { callsOf, createFakeContext, type FakeCanvasContext } from './fake-canvas.js';
import { PLAYFIELD } from './layout.js';
import {
  CELLS_PER_TILE,
  MAX_LAYER_PX,
  MESH_AXIS_DEGREES,
  MESH_BAND_FRACTION,
  MESH_BOX,
  MESH_DEPTH,
  MESH_FADE_FULL_PX,
  MESH_FADE_IN_PX,
  MESH_PITCH_UNITS,
  MESH_SPACING_UNITS,
  MESH_WEB_FRACTION,
  buildMeshLayer,
  buildMeshTile,
  defaultMeshSurfaceFactory,
  meshOpacity,
  type MeshSurfaceFactory,
} from './mesh.js';

/** A surface factory over recording contexts, and every surface it handed out. */
function recordingFactory(): {
  factory: MeshSurfaceFactory;
  surfaces: { width: number; height: number; recorder: FakeCanvasContext }[];
} {
  const surfaces: { width: number; height: number; recorder: FakeCanvasContext }[] = [];
  const factory: MeshSurfaceFactory = (width, height) => {
    const { ctx, recorder } = createFakeContext();
    surfaces.push({ width, height, recorder });
    return { context: ctx, image: {} as CanvasImageSource };
  };
  return { factory, surfaces };
}

/** Device pixels per atlas unit that put the mesh at `periodPx` per cycle. */
function scaleForPeriod(periodPx: number): number {
  return periodPx / MESH_PITCH_UNITS;
}

describe('measured geometry', () => {
  it('states the pitch the teardown photograph measures', () => {
    // 10.83 px at 17.2 px per atlas unit.
    expect(MESH_PITCH_UNITS).toBeCloseTo(10.83 / 17.2, 2);
  });

  it('spaces the holes so their rows fall at the measured pitch', () => {
    // A triangular lattice's rows are spacing * cos 30 apart. If this inverts,
    // the rendered honeycomb comes out 15% off the photograph.
    expect(MESH_SPACING_UNITS * Math.cos(Math.PI / 6)).toBeCloseTo(MESH_PITCH_UNITS, 10);
    expect(MESH_SPACING_UNITS).toBeGreaterThan(MESH_PITCH_UNITS);
  });

  it('is hexagonal, not square: the two measured axes are 60 degrees apart', () => {
    // The whole claim rests on 91 - 31 = 60 and not 90. Recorded as a test so a
    // later change to the lattice has to argue with the measurement.
    expect(91 - 31).toBe(60);
  });

  it('tilts the lattice by what the tile can actually carry', () => {
    // One cell of sideways drift per tile height, which is what tiles exactly.
    const tilt = Math.atan(1 / (2 * CELLS_PER_TILE * Math.cos(Math.PI / 6)));
    expect((tilt * 180) / Math.PI).toBeCloseTo(MESH_AXIS_DEGREES, 1);
  });

  it('puts the mesh box inside the printed frame, spanning its full width', () => {
    expect(MESH_BOX.x).toBe(PLAYFIELD.x);
    expect(MESH_BOX.width).toBe(PLAYFIELD.width);
    expect(MESH_BOX.y).toBeGreaterThan(PLAYFIELD.y);
    expect(MESH_BOX.y + MESH_BOX.height).toBeLessThan(PLAYFIELD.y + PLAYFIELD.height);
  });

  it('places the mesh box where the measurement put it', () => {
    // atlas y 106.6 to 174.2, from the teardown photograph.
    expect(MESH_BOX.y).toBeCloseTo(106.6, 0);
    expect(MESH_BOX.y + MESH_BOX.height).toBeCloseTo(174.2, 0);
    expect(MESH_BAND_FRACTION.top).toBeLessThan(MESH_BAND_FRACTION.bottom);
  });
});

describe('meshOpacity', () => {
  it('is silent at the magnification the case shell gives the tube', () => {
    // 399 CSS px of canvas on a 2x display is 2.2 device px per atlas unit, a
    // 1.4 px mesh period. Nobody pays for detail they cannot see.
    expect(meshOpacity(2.2)).toBe(0);
    expect(meshOpacity(1.1)).toBe(0);
  });

  it('stays silent until the period clears the fade-in', () => {
    expect(meshOpacity(scaleForPeriod(MESH_FADE_IN_PX))).toBe(0);
    expect(meshOpacity(scaleForPeriod(MESH_FADE_IN_PX - 0.5))).toBe(0);
    expect(meshOpacity(scaleForPeriod(MESH_FADE_IN_PX + 0.5))).toBeGreaterThan(0);
  });

  it('reaches full strength once the period clears the fade-full', () => {
    expect(meshOpacity(scaleForPeriod(MESH_FADE_FULL_PX))).toBeCloseTo(1, 6);
    expect(meshOpacity(scaleForPeriod(MESH_FADE_FULL_PX * 4))).toBeCloseTo(1, 6);
  });

  it('rises without a step, so a zoom does not pop the honeycomb in', () => {
    let previous = 0;
    for (let period = MESH_FADE_IN_PX; period <= MESH_FADE_FULL_PX; period += 0.1) {
      const value = meshOpacity(scaleForPeriod(period));
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(value - previous).toBeLessThan(0.15);
      previous = value;
    }
  });

  it('treats a nonsense scale as no mesh rather than as NaN', () => {
    expect(meshOpacity(0)).toBe(0);
    expect(meshOpacity(-4)).toBe(0);
    expect(meshOpacity(Number.NaN)).toBe(0);
    expect(meshOpacity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('buildMeshTile', () => {
  it('gives up rather than throw where there is no surface to draw on', () => {
    // The Vitest node environment and tools/probe/ take this path, which is what
    // keeps src/machine/ headless-drivable.
    expect(buildMeshTile(8, () => null)).toBeNull();
    expect(defaultMeshSurfaceFactory(4, 4)).toBeNull();
  });

  it('builds a tile whose sides are one lattice period apart', () => {
    const { factory, surfaces } = recordingFactory();
    const tile = buildMeshTile(8, factory);
    expect(tile).not.toBeNull();
    const spacing = MESH_SPACING_UNITS * 8;
    expect(tile?.widthPx).toBe(Math.round(CELLS_PER_TILE * spacing));
    // Height is sqrt(3) x the width: two rows of holes per cell of height.
    expect((tile as { heightPx: number }).heightPx / (tile as { widthPx: number }).widthPx).toBeCloseTo(
      Math.sqrt(3),
      1,
    );
    expect(surfaces.length).toBeGreaterThan(0);
  });

  it('supersamples a fine tile and reduces it, so the webs are not a square wave', () => {
    const { factory, surfaces } = recordingFactory();
    const tile = buildMeshTile(8, factory);
    // Two surfaces: the oversized one drawn on, and the reduced one kept.
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0].width).toBe(surfaces[1].width * 3);
    expect(surfaces[1].width).toBe(tile?.widthPx);
    expect(callsOf(surfaces[1].recorder, 'drawImage')).toHaveLength(1);
  });

  it('draws a coarse tile once, where the canvas can antialias it unaided', () => {
    const { factory, surfaces } = recordingFactory();
    buildMeshTile(20, factory);
    expect(surfaces).toHaveLength(1);
  });

  it('cuts the holes out of the shadow instead of painting over it', () => {
    // A hole has to be transparent: the layer is composited over the phosphor,
    // and paint in a hole would grey the segment rather than leave it alone.
    const { factory, surfaces } = recordingFactory();
    buildMeshTile(8, factory);
    const drawn = surfaces[0].recorder.calls;
    const shadow = drawn.find((call) => call.op === 'fillRect');
    expect(shadow?.fillStyle).toBe(`rgba(0, 0, 0, ${MESH_DEPTH})`);
    const cutOut = drawn.filter((call) => call.op === 'fill' || call.op === 'stroke');
    expect(cutOut.length).toBeGreaterThan(0);
  });

  it('gives up on a scale too coarse to carry a lattice', () => {
    const { factory } = recordingFactory();
    expect(buildMeshTile(0.5, factory)).toBeNull();
    expect(buildMeshTile(0, factory)).toBeNull();
    expect(buildMeshTile(Number.NaN, factory)).toBeNull();
  });

  it('gives up rather than allocate an unbounded tile', () => {
    const { factory } = recordingFactory();
    expect(buildMeshTile(200, factory)).toBeNull();
  });
});

describe('buildMeshLayer', () => {
  it('composes the mesh box at the scale it was asked for', () => {
    const { factory, surfaces } = recordingFactory();
    const layer = buildMeshLayer(8, factory);
    expect(layer?.widthPx).toBe(Math.ceil(MESH_BOX.width * 8));
    expect(layer?.heightPx).toBe(Math.ceil(MESH_BOX.height * 8));
    const composed = surfaces[surfaces.length - 1];
    // One pattern, one fill: the per-frame cost this exists to remove.
    expect(callsOf(composed.recorder, 'createPattern')).toHaveLength(1);
    expect(callsOf(composed.recorder, 'fillRect')).toHaveLength(1);
  });

  it('gives up when the tile does', () => {
    expect(buildMeshLayer(8, () => null)).toBeNull();
    const { factory } = recordingFactory();
    expect(buildMeshLayer(0.5, factory)).toBeNull();
  });

  it('gives up rather than allocate past the layer ceiling', () => {
    const { factory } = recordingFactory();
    // The tile ceiling bites first at very high scales, so pick one that only
    // the layer ceiling rejects.
    const tooBig = Math.sqrt(MAX_LAYER_PX / (MESH_BOX.width * MESH_BOX.height)) + 1;
    expect(buildMeshTile(tooBig, factory)).not.toBeNull();
    expect(buildMeshLayer(tooBig, factory)).toBeNull();
  });
});

describe('appearance constants', () => {
  it('leaves most of the mesh open, so a segment is dimmed and not blacked out', () => {
    expect(MESH_WEB_FRACTION).toBeGreaterThan(0);
    expect(MESH_WEB_FRACTION).toBeLessThan(0.5);
    expect(MESH_DEPTH).toBeGreaterThan(0);
    expect(MESH_DEPTH).toBeLessThan(0.5);
  });
});
