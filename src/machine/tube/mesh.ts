// The control grid: the honeycomb that appears when the tube is magnified.
//
// Between the cathode and the phosphor of a VFD sits a fine etched mesh - the
// control grid - and it is the one piece of the tube's physical structure that
// is visible to the naked eye at close range. The owner describes it as "almost
// a honeycomb lattice"; it is what a magnified photograph of the tube resolves
// into, and it is the reason a lit glyph reads as a dot screen rather than as a
// solid fill. The holes let the light through, the webs between them do not.
//
// **The dot screen and the honeycomb are the same structure.** That is a
// measurement, not an assumption: the same modulation - 10.83 +- 0.27 px pitch
// on a 31.0 +- 0.7 deg axis - is present in the red phosphor, in the cyan
// phosphor, in the dark field between glyphs, and in the loose stipple of cell 6
// that ATLAS-COORDINATES.md could not threshold. One mesh over the whole face,
// seen against four different backings. See docs/evidence/tube-mesh.md for the
// derivation and the numbers.
//
// So one geometry produces both of the appearances the owner named, because the
// mesh is composited multiplicatively: over a lit segment it bites dark holes
// out of the emission and reads as a dot screen, over the ghost layer it reads
// as a faint lattice, and over the unlit glass it does nothing at all, because
// multiplying near-black by anything is still near-black.
//
// Pure geometry and colour - no DOM. The tile needs a surface to draw into and
// the renderer supplies one; where no surface can be had (the Vitest node
// environment, `tools/probe/`) `buildMeshTile` returns null and the renderer
// simply skips the pass, which is also what it does at every ordinary
// magnification.

import { PLAYFIELD } from './layout.js';

/**
 * Row spacing of the mesh in atlas units - the period of the modulation it
 * imposes, and the figure the spectral measurement returns directly.
 *
 * 10.83 px in `assets/reference/tube-teardown/tube-unlit-full.jpg`, where one
 * atlas unit spans 17.2 px (a playfield cell measures 529 px against
 * `layout.ts` CELL.width of 31.11 units). 10.83 / 17.2 = 0.63.
 */
export const MESH_PITCH_UNITS = 0.63;

/**
 * Hole centre to hole centre, in atlas units.
 *
 * The mesh is a triangular lattice of hexagonal holes, so the row spacing is
 * the lattice constant times cos 30: 0.63 / cos 30 = 0.73. On a tube face
 * roughly 60 mm wide that is about 160 um, which is the ordinary pitch of a
 * photo-etched VFD control grid - an independent check that the structure being
 * measured is the grid and not an artefact of the photograph.
 */
export const MESH_SPACING_UNITS = MESH_PITCH_UNITS / Math.cos(Math.PI / 6);

/**
 * Tilt of the mesh's near-horizontal row axis, in degrees.
 *
 * The two modulation axes measure 31 deg and 91 deg - 60.0 deg apart, which is
 * what makes this a hexagonal weave rather than a square one; a square mesh
 * would put them 90 deg apart and the separation is far outside the +-0.7 deg
 * spread of the fit. Rows run perpendicular to the modulation, at 1 deg, 61 deg
 * and 121 deg. The 1 deg is small enough to be invisible on its own and is kept
 * because it costs nothing: it stops the near-horizontal rows from locking to
 * the pixel grid and moireing against it.
 */
export const MESH_AXIS_DEGREES = 1;

/**
 * Web width as a fraction of the hole spacing - how much of the mesh is metal.
 *
 * Not measured. The photograph resolves the mesh's *period* firmly and its duty
 * cycle not at all: at 10.8 px per cycle the lens and the sensor have already
 * smeared the webs into a sinusoid, and what survives is a 2% modulation of the
 * local level whatever the true web width is. 0.22 is the low end of the
 * ordinary range for an etched grid and is what the tile is drawn at; the
 * appearance is tuned by {@link MESH_DEPTH}, which is the honest place for a
 * judgement call to live.
 */
export const MESH_WEB_FRACTION = 0.22;

/**
 * How much of the light a web blocks, at full strength.
 *
 * A judgement, tuned against the teardown crops at matched magnification. The
 * unpowered photograph measures only a 2% modulation of the local level, but
 * that is a photograph of ambient light scattered off a dark tube, where the
 * mesh has little to shadow. On a powered tube the webs are opaque metal in
 * front of a glowing anode, and the reference close-ups of the lit unit show
 * the structure plainly. 0.3 is what matches them.
 */
export const MESH_DEPTH = 0.3;

/**
 * Mesh period, in device pixels, below which the pass is skipped entirely.
 *
 * Under about three device pixels per cycle there is no honeycomb to be had -
 * only a moire of one - so the renderer does not pay for it. At the size the
 * case shell gives the tube this is comfortably below 1x on a 2x display
 * (0.63 units at 2.2 device px per unit is a 1.4 px period), which is the
 * point: nobody pays a frame-rate cost for detail they cannot see.
 */
export const MESH_FADE_IN_PX = 3;

/** Mesh period, in device pixels, at and above which the pass is at full strength. */
export const MESH_FADE_FULL_PX = 6;

/** Largest tile the builder will allocate, per side, in device pixels. */
const MAX_TILE_PX = 256;

/** A surface the mesh tile is drawn into, and the image a pattern can be built from. */
export interface MeshSurface {
  /** A 2D context covering the whole surface, at one unit per device pixel. */
  readonly context: CanvasRenderingContext2D;
  /** The surface itself, as something `createPattern` accepts. */
  readonly image: CanvasImageSource;
}

/** Makes a surface of the given size in device pixels, or null if it cannot. */
export type MeshSurfaceFactory = (widthPx: number, heightPx: number) => MeshSurface | null;

/** One built tile: the image to repeat, and how big it is in device pixels. */
export interface MeshTile {
  readonly image: CanvasImageSource;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * The default surface: an `OffscreenCanvas`, where the platform has one.
 *
 * `OffscreenCanvas` is a bare drawing surface, not a document node - there is no
 * `document` lookup here and nothing in `src/machine/` reaches for one. Node has
 * no such global, so the factory returns null there and the mesh pass is simply
 * absent, which is what keeps the machine layer headless-drivable.
 */
export const defaultMeshSurfaceFactory: MeshSurfaceFactory = (widthPx, heightPx) => {
  const Ctor = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => unknown })
    .OffscreenCanvas;
  if (typeof Ctor !== 'function') return null;
  const surface = new Ctor(widthPx, heightPx) as {
    getContext(kind: string): unknown;
  };
  const context = surface.getContext('2d') as CanvasRenderingContext2D | null;
  if (!context) return null;
  return { context, image: surface as unknown as CanvasImageSource };
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How strongly the mesh should show at a given backing-store scale.
 *
 * `devicePxPerUnit` is the renderer's projection scale times the device pixel
 * ratio - the real resolution the tube is being drawn at, which is what browser
 * zoom, a larger window and a denser display all move. Deriving visibility from
 * it rather than from a setting is what makes the detail appear exactly when
 * there are pixels to carry it.
 *
 * Returns 0 below {@link MESH_FADE_IN_PX} per mesh period and 1 at
 * {@link MESH_FADE_FULL_PX}, with a smoothstep between so the structure arrives
 * gradually across a zoom step instead of popping.
 */
export function meshOpacity(devicePxPerUnit: number): number {
  if (!Number.isFinite(devicePxPerUnit) || devicePxPerUnit <= 0) return 0;
  const periodPx = MESH_PITCH_UNITS * devicePxPerUnit;
  const t = clamp01((periodPx - MESH_FADE_IN_PX) / (MESH_FADE_FULL_PX - MESH_FADE_IN_PX));
  return t * t * (3 - 2 * t);
}

/** Number of lattice cells across a tile, chosen to keep the tile under {@link MAX_TILE_PX}. */
function cellsPerTile(spacingPx: number): number {
  // Height is spacing * sqrt(3) per cell, so height is the binding constraint.
  const limit = Math.floor(MAX_TILE_PX / (spacingPx * Math.SQRT2 * 1.23));
  return Math.max(1, Math.min(32, limit));
}

/**
 * Draw one tileable patch of mesh into a surface from `factory`.
 *
 * The tile is a rectangle of the triangular lattice with its rows axis-aligned;
 * the {@link MESH_AXIS_DEGREES} tilt is applied by the renderer when it fills,
 * so the tile itself stays exactly periodic. White is a hole and passes the
 * light unchanged, grey is a web and multiplies it down by {@link MESH_DEPTH}.
 *
 * Returns null when no surface can be made, or when the scale is too coarse for
 * a tile to mean anything.
 */
export function buildMeshTile(
  devicePxPerUnit: number,
  factory: MeshSurfaceFactory = defaultMeshSurfaceFactory,
): MeshTile | null {
  if (!Number.isFinite(devicePxPerUnit) || devicePxPerUnit <= 0) return null;
  const spacing = MESH_SPACING_UNITS * devicePxPerUnit;
  if (spacing < 2) return null;

  const cells = cellsPerTile(spacing);
  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const widthPx = Math.max(1, Math.round(cells * spacing));
  const heightPx = Math.max(1, Math.round(cells * rowHeight * 2));
  const surface = factory(widthPx, heightPx);
  if (!surface) return null;

  // Draw at the tile's own rounded size rather than the exact one, so the
  // pattern repeats without a seam; the rounding costs under 1% of the pitch at
  // these tile sizes.
  const stepX = widthPx / cells;
  const stepY = heightPx / (cells * 2);
  const ctx = surface.context;

  const web = Math.round(255 * (1 - MESH_DEPTH));
  ctx.fillStyle = `rgb(${web}, ${web}, ${web})`;
  ctx.fillRect(0, 0, widthPx, heightPx);

  // Hexagonal holes on the triangular lattice: the Voronoi cell of the lattice,
  // inset by half a web. Vertices sit at 30 + k*60 degrees, so the flats face
  // the six neighbours.
  const holeRadius = ((stepX * (1 - MESH_WEB_FRACTION)) / Math.sqrt(3)) * 1.0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let row = -1; row <= cells * 2; row += 1) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    for (let col = -1; col <= cells; col += 1) {
      const cx = col * stepX + offset;
      const cy = row * stepY;
      for (let k = 0; k < 6; k += 1) {
        const angle = (Math.PI / 6) * (1 + 2 * k);
        const px = cx + holeRadius * Math.cos(angle);
        const py = cy + holeRadius * Math.sin(angle);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
  ctx.fill();

  return { image: surface.image, widthPx, heightPx };
}

/**
 * The box the mesh covers, in atlas units.
 *
 * The grid spans the printed frame - the same rectangle `layout.ts` derives from
 * the two registered close-ups - and the tube carries structure rather than mesh
 * outside it. Filling the frame instead of the whole canvas is also what keeps
 * the pass cheap: it is a quarter of the viewBox's area.
 */
export const MESH_BOX = PLAYFIELD;
