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
 * local level whatever the true web width is. 0.3 is within the ordinary range
 * for an etched grid and is what matches the crops at equal magnification once
 * the penumbra has softened it; the strength of the effect is set by
 * {@link MESH_DEPTH}, which is the honest place for a judgement call to live.
 *
 * Together with the penumbra these give a tile 30% peak to peak, attenuating
 * 10% of the light on average.
 */
export const MESH_WEB_FRACTION = 0.3;

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

/**
 * Largest tile the builder will allocate, per side, in device pixels.
 *
 * The tile is a fixed 33 cells (see {@link CELLS_PER_TILE}), so its size grows
 * with the magnification: 1024 is reached at about 15 device pixels per mesh
 * period, which is past anything the case shell's tube can be zoomed to. Beyond
 * it the builder gives up rather than allocate without limit.
 */
const MAX_TILE_PX = 1024;

/**
 * Supersampling factor the tile is drawn at before being reduced, and the mesh
 * period below which it is needed.
 *
 * The mesh arrives at five or six device pixels per cycle, and a hexagon drawn
 * straight in at that size is a square wave: its second harmonic lands on top of
 * the Nyquist frequency and beats against the pixel grid, which measured as a
 * 2.5 px component twice the strength of the 5 px one it was meant to draw.
 * Drawing three times over and reducing puts a real filter in front of it. Once
 * a cell is ten pixels across the canvas's own antialiasing is enough and the
 * larger surface is not worth allocating.
 */
const TILE_SUPERSAMPLE = 3;
const SUPERSAMPLE_BELOW_SPACING_PX = 10;

/**
 * Half-width of the webs' penumbra, as a fraction of the hole spacing.
 *
 * The grid stands off the phosphor, so its shadow has a soft edge whose width is
 * set by that gap and not by the width of the wire. Nothing in the teardown
 * photographs measures the standoff - the tube is photographed face on - so this
 * is set from what the crops look like: at the magnifications the reference
 * resolves, the structure is a stipple that fades into the phosphor, never a
 * hard cell wall. Rendered hard it also beats against the pixel grid, which is
 * the same defect the supersample is there to fix.
 */
const WEB_PENUMBRA_FRACTION = 0.07;

/** A surface the mesh tile is drawn into, and the image a pattern can be built from. */
export interface MeshSurface {
  /** A 2D context covering the whole surface, at one unit per device pixel. */
  readonly context: CanvasRenderingContext2D;
  /** The surface itself, as something `createPattern` accepts. */
  readonly image: CanvasImageSource;
}

/** Makes a surface of the given size in device pixels, or null if it cannot. */
export type MeshSurfaceFactory = (widthPx: number, heightPx: number) => MeshSurface | null;

/** A drawable image and its size in device pixels. */
export interface MeshTile {
  readonly image: CanvasImageSource;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Ceiling on the composed layer, in device pixels.
 *
 * The layer is the mesh box at the current magnification, so at four bytes a
 * pixel eight megapixels is thirty-odd megabytes - reached at about 13 device
 * pixels per mesh period, well past where the structure is already fully
 * legible. Past it the mesh is dropped rather than the allocation made.
 */
const MAX_LAYER_PX = 8_000_000;

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

/**
 * Lattice cells across one tile.
 *
 * Chosen so that the {@link MESH_AXIS_DEGREES} tilt lands *inside* the tile and
 * the tile stays exactly periodic, rather than being applied by rotating the
 * pattern as it is filled. Each row is stepped sideways by one cell width per
 * `2 * CELLS_PER_TILE` rows, so the tilt is
 * `atan(1 / (2 * CELLS_PER_TILE * cos 30))` and the rows still line up where the
 * tile wraps. 33 makes that 1.003 deg, against the 1 deg measured.
 *
 * Rotating the pattern instead is what a `CanvasPattern.setTransform` is for,
 * and it costs: a rotated pattern cannot be tiled by repetition and has to be
 * resampled per pixel, which measured 42 ms a frame against 14 ms unrotated over
 * the same 7 Mpx. The tilt is worth about a pixel of drift across the whole
 * field; it is not worth three times the fill.
 */
const CELLS_PER_TILE = 33;

/**
 * Draw one tileable patch of mesh into a surface from `factory`.
 *
 * Transparent where a hole passes the phosphor untouched, black at
 * {@link MESH_DEPTH} where a web shadows it, with a soft edge between.
 *
 * Returns null when no surface can be made, or when the scale is too coarse or
 * too fine for a tile to be worth having.
 */
export function buildMeshTile(
  devicePxPerUnit: number,
  factory: MeshSurfaceFactory = defaultMeshSurfaceFactory,
): MeshTile | null {
  if (!Number.isFinite(devicePxPerUnit) || devicePxPerUnit <= 0) return null;
  const spacing = MESH_SPACING_UNITS * devicePxPerUnit;
  // Too coarse to draw, or so fine that a 33-cell tile would be an extravagant
  // allocation - the latter is past any magnification the case shell allows.
  if (spacing < 2 || spacing * CELLS_PER_TILE * Math.sqrt(3) > MAX_TILE_PX) return null;

  const cells = CELLS_PER_TILE;
  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const widthPx = Math.max(1, Math.round(cells * spacing));
  const heightPx = Math.max(1, Math.round(cells * rowHeight * 2));
  const ss = spacing < SUPERSAMPLE_BELOW_SPACING_PX ? TILE_SUPERSAMPLE : 1;

  const big = factory(widthPx * ss, heightPx * ss);
  if (!big) return null;

  // Draw at the tile's own rounded size rather than the exact one, so the
  // pattern repeats without a seam; the rounding costs under 1% of the pitch at
  // these tile sizes.
  const stepX = (widthPx / cells) * ss;
  const stepY = (heightPx / (cells * 2)) * ss;
  const ctx = big.context;

  // The tile is *black at varying alpha*, not grey: composited normally, black
  // at alpha a leaves dst * (1 - a), which is exactly the multiplication a
  // shadow performs. Reaching for `globalCompositeOperation = 'multiply'`
  // instead is arithmetically the same and measured 15 ms a frame at 3192 px
  // and 45 ms at 5760 - a separable blend mode takes the canvas off its fast
  // path, where an ordinary source-over pattern fill stays on it.
  ctx.fillStyle = `rgba(0, 0, 0, ${MESH_DEPTH})`;
  ctx.fillRect(0, 0, widthPx * ss, heightPx * ss);

  // Hexagonal holes on the triangular lattice: the Voronoi cell of the lattice,
  // inset by half a web. Vertices sit at 30 + k*60 degrees, so the flats face
  // the six neighbours. Cut out of the black rather than painted over it, so a
  // hole is genuinely transparent and passes the phosphor untouched.
  const holeRadius = (stepX * (1 - MESH_WEB_FRACTION)) / Math.sqrt(3);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // One cell width of sideways drift per tile height is the tilt; see
  // CELLS_PER_TILE. Adding it row by row keeps the wrap exact.
  const tiltPerRow = stepX / (cells * 2);
  for (let row = -1; row <= cells * 2; row += 1) {
    const offset = (row % 2 === 0 ? 0 : stepX / 2) + row * tiltPerRow;
    for (let col = -2; col <= cells + 1; col += 1) {
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

  // The penumbra: the hole edges eaten outward in two graded strokes, so a web
  // goes from full shadow to none across a soft band instead of a pixel. Half of
  // each stroke lands inside the hole, which is already clear.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  const penumbra = WEB_PENUMBRA_FRACTION * stepX;
  for (const [widthScale, alpha] of [
    [2, 0.22],
    [1, 0.4],
  ] as const) {
    ctx.lineWidth = penumbra * 2 * widthScale;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  if (ss === 1) return { image: big.image, widthPx, heightPx };

  const surface = factory(widthPx, heightPx);
  if (!surface) return { image: big.image, widthPx: widthPx * ss, heightPx: heightPx * ss };
  const out = surface.context;
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = 'high';
  out.drawImage(big.image, 0, 0, widthPx * ss, heightPx * ss, 0, 0, widthPx, heightPx);

  return { image: surface.image, widthPx, heightPx };
}

/**
 * Fractions of the printed frame's height the mesh spans, measured down from the
 * top rail. See {@link MESH_BOX}.
 */
export const MESH_BAND_FRACTION = { top: 0.21, bottom: 0.873 } as const;

/**
 * The box the mesh covers, in atlas units.
 *
 * Measured, not assumed, by asking where on the tube the mesh's own signature -
 * power at a 10.83 px period on the 31 deg and 91 deg axes, against the rest of
 * the ring at that radius - rises above the surrounding noise in
 * `tube-unlit-full.jpg`. It does so between y 820 and y 2010 and between x 850
 * and x 5450.
 *
 * Registered against this coordinate space by the printed lane borders, which
 * fall at y 946, 1270, 1579 and 1880 - a 305 px pitch against `layout.ts`'s lane
 * pitch of 17.68 units, so 17.3 px per unit, and the cell band's own top and
 * bottom land on the first and last of them. That puts the mesh at atlas
 * y 106.6 to 174.2: two thirds of the frame's height, centred a little below
 * the cell band, with black glass above and below it. Horizontally it runs
 * x 44.7 to 315.1 against the frame's 41.4 to 313.6, which is the frame's own
 * width to within the measurement, so the box takes the frame there.
 *
 * Filling a measured box rather than the whole canvas is also what keeps the
 * pass affordable: it is a sixth of the viewBox's area.
 */
export const MESH_BOX = {
  x: PLAYFIELD.x,
  y: PLAYFIELD.y + PLAYFIELD.height * MESH_BAND_FRACTION.top,
  width: PLAYFIELD.width,
  height: PLAYFIELD.height * (MESH_BAND_FRACTION.bottom - MESH_BAND_FRACTION.top),
} as const;

/**
 * Compose the whole of {@link MESH_BOX} into one image, at the given scale.
 *
 * This is the per-frame cost, and it is why the layer exists rather than the
 * renderer simply filling the box with the tile pattern every frame. A repeating
 * pattern is a shader: the canvas evaluates it per destination pixel, which at
 * the resolutions this only runs at measured 3.6 ms for the box against 0.16 ms
 * to blit an image of the same size - the same 0.16 ms a plain `fillRect` of it
 * costs. Paying the pattern once per resize and blitting it every frame turns a
 * dropped frame into a rounding error.
 *
 * Returns null when no surface can be had, when the tile cannot be built, or
 * when the layer would exceed {@link MAX_LAYER_PX}.
 */
export function buildMeshLayer(
  devicePxPerUnit: number,
  factory: MeshSurfaceFactory = defaultMeshSurfaceFactory,
): MeshTile | null {
  const tile = buildMeshTile(devicePxPerUnit, factory);
  if (!tile) return null;

  const widthPx = Math.ceil(MESH_BOX.width * devicePxPerUnit);
  const heightPx = Math.ceil(MESH_BOX.height * devicePxPerUnit);
  if (widthPx < 1 || heightPx < 1 || widthPx * heightPx > MAX_LAYER_PX) return null;

  const surface = factory(widthPx, heightPx);
  if (!surface) return null;
  const ctx = surface.context;
  if (typeof ctx.createPattern !== 'function') return null;
  const pattern = ctx.createPattern(tile.image, 'repeat');
  if (!pattern) return null;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, widthPx, heightPx);
  return { image: surface.image, widthPx, heightPx };
}
