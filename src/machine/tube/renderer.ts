// The VFD tube renderer: the board's PWM state painted as a Futaba DM-series
// two-phosphor display.
//
// Pipeline, back to front:
//   1. background - the dark glass
//   2. ghost layer - *every* segment at very low brightness. Unlit phosphor is
//      faintly visible on the real tube from ambient light alone, and it is a
//      large part of why the screen reads as a VFD rather than as sprites on
//      black. The matrix is there whether the machine is running or not.
//   3. active layer - each segment tinted and blended by the brightness its
//      phosphor has actually reached, with a bloom scaled to the same value
//   4. control grid - the tube's honeycomb mesh, multiplied over the phosphor.
//      Only drawn where the backing store is dense enough to resolve it, which
//      at ordinary sizes it is not; see mesh.ts.
//   5. silkscreen - printed on the glass, so it stays visible when the tube is
//      dark, and outside the mesh, which is inside the envelope
//
// Brightness comes from *duty*, never from a lit/unlit boolean. The board hands
// over a real fraction per segment (src/machine/board/pwm.ts); phosphor.ts turns
// that into a brightness that rises and decays over milliseconds. That is where
// the shimmer and the flicker come from, and it is precisely what v1 faked by
// drawing sprites at full brightness.
//
// This is the only module in src/machine/ that touches a 2D context. It owns no
// clock: the caller drives `draw(pwm, dtMs)` and supplies the elapsed time.

import { addressKey, loadAtlas } from './atlas.js';
import type { Segment, SegmentId } from './atlas-schema.js';
import type { PwmFrame, SegmentDuty } from '../board/display.js';
import { VIEWBOX, projectTube, type TubeProjection } from './layout.js';
import {
  BACKGROUND,
  MIN_VISIBLE_BRIGHTNESS,
  ghostFill,
  glowFill,
  glowRadius,
  segmentFill,
} from './palette.js';
import {
  MESH_AXIS_DEGREES,
  MESH_BOX,
  buildMeshTile,
  defaultMeshSurfaceFactory,
  meshOpacity,
  type MeshSurfaceFactory,
  type MeshTile,
} from './mesh.js';
import { parsePathCached, tracePath, type PathCommand } from './path.js';
import { PhosphorField, type PhosphorSet } from './phosphor.js';
import { drawSilkscreen } from './silkscreen.js';

/** Options for {@link createTubeRenderer}. */
export interface TubeRendererOptions {
  /** Phosphor response, one set per colour region. Defaults to `PHOSPHOR` in phosphor.ts. */
  readonly phosphor?: PhosphorSet;
  /**
   * Draw the bloom around lit segments. On by default; off is a diagnostic
   * setting that isolates segment shapes from their glow.
   */
  readonly glow?: boolean;
  /**
   * Where the control-grid mesh tile is drawn. Defaults to an `OffscreenCanvas`
   * where the platform has one and to nothing where it does not, which is what
   * lets the machine layer stay headless. Injectable so a test can supply a
   * recording surface.
   */
  readonly meshSurface?: MeshSurfaceFactory;
  /**
   * Draw the control-grid mesh at all. On by default, and even then only above
   * the magnification at which it resolves; off is a diagnostic setting.
   */
  readonly mesh?: boolean;
}

/** A renderer bound to a canvas. */
export interface TubeRenderer {
  /**
   * Paint one frame.
   *
   * @param pwm  the board's per-segment duty - `display.getFrame()` or the
   *             segment list from it. Duties are real fractions in 0..1.
   * @param dtMs milliseconds since the previous call, for the phosphor
   *             integration. The caller owns the clock.
   */
  draw(pwm: PwmFrame | readonly SegmentDuty[], dtMs: number): void;
  /**
   * Re-size the backing store to `cssWidth` x `cssHeight` logical pixels at the
   * given device pixel ratio and re-derive the projection. All drawing happens
   * in logical pixels; the backing store is `css * dpr` for crisp output.
   */
  resize(cssWidth: number, cssHeight: number, dpr?: number): void;
  /** Blank the phosphor instantly - the power switch going off, not a fade. */
  blank(): void;
  /** Brightness a segment's phosphor has reached, in 0..1. For tests and probes. */
  brightnessOf(id: SegmentId): number;
}

/** A segment with everything the draw loop needs precomputed. */
interface PreparedSegment {
  readonly segment: Segment;
  readonly commands: readonly PathCommand[];
  /** Half the bounds diagonal, in atlas units - the bloom's size reference. */
  readonly extent: number;
}

/** Duty list from either shape of PWM state the board exposes. */
function dutiesOf(pwm: PwmFrame | readonly SegmentDuty[]): readonly SegmentDuty[] {
  return Array.isArray(pwm) ? pwm : (pwm as PwmFrame).segments;
}

/**
 * Build a renderer.
 *
 * Accepts a canvas (the normal path - it owns the backing store and the device
 * pixel ratio) or a bare 2D context, which is how the tests drive it without a
 * DOM. Call {@link TubeRenderer.resize} once before the first draw, and again on
 * every viewport or devicePixelRatio change.
 */
export function createTubeRenderer(
  target: HTMLCanvasElement | CanvasRenderingContext2D,
  options: TubeRendererOptions = {},
): TubeRenderer {
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  if ('getContext' in target) {
    canvas = target;
    context = target.getContext('2d');
  } else {
    context = target;
  }
  if (!context) {
    throw new Error('createTubeRenderer: 2D canvas context unavailable');
  }
  const ctx = context;

  const atlas = loadAtlas();
  const prepared: readonly PreparedSegment[] = atlas.segments.map((segment) => ({
    segment,
    commands: parsePathCached(segment.path),
    extent: Math.hypot(segment.bounds.width, segment.bounds.height) / 2,
  }));

  /** (grid, plate) -> index into `prepared`. Most of the address space is unwired. */
  const indexByAddress = new Map<string, number>();
  const indexById = new Map<string, number>();
  prepared.forEach((entry, index) => {
    indexByAddress.set(addressKey(entry.segment.grid, entry.segment.plate), index);
    indexById.set(entry.segment.id, index);
  });

  // Each segment fades on its own phosphor's constants, so the field is built
  // from the atlas's colour regions rather than from a segment count.
  const field = new PhosphorField(
    prepared.map((entry) => entry.segment.colorRegion),
    options.phosphor,
  );
  const withGlow = options.glow ?? true;
  const withMesh = options.mesh ?? true;
  const meshSurface = options.meshSurface ?? defaultMeshSurfaceFactory;

  // Seeded so a draw before the first resize produces valid output rather than
  // dividing by a zero-sized canvas.
  let cssWidth: number = VIEWBOX.width;
  let cssHeight: number = VIEWBOX.height;
  let pixelRatio = 1;
  let projection: TubeProjection = projectTube(cssWidth, cssHeight);

  // The mesh, and the backing-store scale it was built for. Both are settled in
  // `resize` and never touched per frame: at a fixed magnification the tile is
  // built once and every frame after that is a single pattern fill.
  let meshTile: MeshTile | null = null;
  let meshAlpha = 0;
  let meshPattern: CanvasPattern | null = null;

  /** Device pixels per atlas unit - the real resolution the tube is drawn at. */
  const backingScale = (): number => projection.scale * pixelRatio;

  /**
   * Rebuild the mesh for the current scale, or drop it.
   *
   * Called from `resize` only. Everything the pass needs - whether it runs at
   * all, how strong it is, and how big its tile is - falls out of
   * {@link backingScale}, so browser zoom, a window resize and a move to a
   * denser display all reach it by the same route.
   */
  const rebuildMesh = (): void => {
    meshTile = null;
    meshPattern = null;
    meshAlpha = withMesh ? meshOpacity(backingScale()) : 0;
    if (meshAlpha <= 0) return;
    if (typeof ctx.createPattern !== 'function') return;
    meshTile = buildMeshTile(backingScale(), meshSurface);
    if (!meshTile) {
      meshAlpha = 0;
      return;
    }
    meshPattern = ctx.createPattern(meshTile.image, 'repeat');
    if (!meshPattern) {
      meshTile = null;
      meshAlpha = 0;
      return;
    }
    // Tilt the lattice by rotating the pattern rather than the fill, so the
    // rect stays axis-aligned and nothing is rasterised twice.
    if (typeof meshPattern.setTransform === 'function') {
      const theta = (MESH_AXIS_DEGREES * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      meshPattern.setTransform({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
    }
  };

  const resize = (width: number, height: number, dpr?: number): void => {
    const requested = dpr ?? (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);
    pixelRatio = Number.isFinite(requested) && requested > 0 ? requested : 1;
    cssWidth = width;
    cssHeight = height;
    if (canvas) {
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      // Draw in logical pixels; the backing store is css * dpr.
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
    projection = projectTube(width, height);
    rebuildMesh();
  };

  /** Trace one segment's outline as a fresh path, in atlas units. */
  const tracePathOf = (entry: PreparedSegment): void => {
    ctx.beginPath();
    tracePath(ctx, entry.commands);
  };

  /**
   * Every segment at the unlit-phosphor level, grouped into one path per
   * phosphor region. Grouping keeps the alpha uniform where two segments overlap
   * (the atlas documents five such pairs) instead of doubling it up.
   */
  const drawGhostLayer = (): void => {
    for (const region of ['red', 'cyan'] as const) {
      ctx.beginPath();
      for (const entry of prepared) {
        if (entry.segment.colorRegion === region) {
          tracePath(ctx, entry.commands);
        }
      }
      ctx.fillStyle = ghostFill(region);
      ctx.fill();
    }
  };

  /** Each segment the phosphor is currently emitting, tinted by its brightness. */
  const drawActiveLayer = (): void => {
    // shadowBlur is not affected by the transform, so the bloom radius is
    // converted from atlas units to device pixels here.
    const blurScale = projection.scale * pixelRatio;

    for (let index = 0; index < prepared.length; index += 1) {
      const brightness = field.brightnessAt(index);
      if (brightness < MIN_VISIBLE_BRIGHTNESS) {
        continue;
      }
      const entry = prepared[index];
      const region = entry.segment.colorRegion;

      ctx.fillStyle = segmentFill(region, brightness);
      if (withGlow) {
        ctx.save();
        ctx.shadowColor = glowFill(region, brightness);
        ctx.shadowBlur = glowRadius(region, brightness, entry.extent) * blurScale;
        tracePathOf(entry);
        ctx.fill();
        ctx.restore();
      }
      // A second, unshadowed fill keeps the segment's own shape crisp inside its
      // bloom - the halo spreads, the phosphor edge does not.
      tracePathOf(entry);
      ctx.fill();
    }
  };

  /**
   * The control grid, multiplied over the phosphor.
   *
   * Drawn in device-pixel space so the tile's pixels land on the backing store's
   * one for one - `scale(1/s, 1/s)` inside the projection transform, which needs
   * no assumption about how the caller set the base transform. Multiply is what
   * makes one pass do both jobs: it bites the mesh out of a lit segment as a dot
   * screen, shows as a faint honeycomb over the ghost layer, and leaves the dark
   * glass alone, because near-black times anything is still near-black.
   */
  const drawMeshLayer = (): void => {
    if (!meshPattern || meshAlpha <= 0) return;
    const s = backingScale();
    if (s <= 0) return;
    ctx.save();
    ctx.scale(1 / s, 1 / s);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = meshAlpha;
    ctx.fillStyle = meshPattern;
    ctx.fillRect(MESH_BOX.x * s, MESH_BOX.y * s, MESH_BOX.width * s, MESH_BOX.height * s);
    ctx.restore();
  };

  const draw = (pwm: PwmFrame | readonly SegmentDuty[], dtMs: number): void => {
    // Duty in, brightness out. A segment absent from the frame is a segment at
    // duty 0: it fades on the decay curve rather than snapping to black.
    field.beginFrame();
    for (const entry of dutiesOf(pwm)) {
      const index = indexByAddress.get(addressKey(entry.grid, entry.plate));
      // Unwired addresses are expected: the atlas uses 71 of the 200 the board
      // can drive, and the ROM may strobe plates that reach no phosphor.
      if (index !== undefined) {
        field.setDuty(index, entry.duty);
      }
    }
    field.advance(dtMs);

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.save();
    ctx.translate(projection.offsetX, projection.offsetY);
    ctx.scale(projection.scale, projection.scale);

    drawGhostLayer();
    drawActiveLayer();
    // Inside the envelope, in front of the phosphor: the grid shadows the light
    // the phosphor emits, so it goes over both layers and under the silkscreen.
    drawMeshLayer();
    // Printed on the outside of the glass: on top of everything in the tube, and
    // still there when the tube is dark.
    drawSilkscreen(ctx);

    ctx.restore();
  };

  const brightnessOf = (id: SegmentId): number => {
    const index = indexById.get(id);
    if (index === undefined) {
      throw new Error(`Unknown segment id '${id}' - not present in the atlas`);
    }
    return field.brightnessAt(index);
  };

  return { draw, resize, blank: () => field.reset(), brightnessOf };
}
