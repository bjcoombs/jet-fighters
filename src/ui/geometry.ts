// Single source of truth for the scope-window geometry.
//
// The physical Jet Fighters scope is a round radar circle fused with a shorter
// rectangle extending to its left (where SCORE and the left playfield sit). That
// shape is defined ONCE here, in the case's SVG viewBox coordinate space
// (1000 x 460), and every projection of it is derived from these constants:
//   - the SVG black-window graphic and rim  (case.ts, viewBox units)
//   - the clip path applied to the canvas    (case.ts, objectBoundingBox units)
//   - the .jf-screen element's position/size (case.ts, % of the case)
//   - the renderer's layout                   (renderer.ts / layout.ts, canvas px)
// Nothing downstream may invent its own scope geometry - it all flows from here.

/** An axis-aligned rectangle. Units depend on the space (viewBox or pixels). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A circle. Units depend on the space (viewBox or pixels). */
export interface Circle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** The case SVG coordinate space; every master constant below is in these units. */
export const CASE_VIEWBOX = { width: 1000, height: 460 } as const;

/** Radar circle - the dominant round scope. */
export const SCOPE_CIRCLE: Circle = { cx: 533, cy: 222, r: 150 };

/**
 * Left rectangle fused onto the circle (SCORE + the left playfield live here).
 * Its right edge meets the circle centre; its band is centred on the circle.
 */
export const SCOPE_RECT: Rect = { x: 320, y: 150, width: 213, height: 144 };

function unionBounds(circle: Circle, rect: Rect): Rect {
  const minX = Math.min(rect.x, circle.cx - circle.r);
  const minY = Math.min(rect.y, circle.cy - circle.r);
  const maxX = Math.max(rect.x + rect.width, circle.cx + circle.r);
  const maxY = Math.max(rect.y + rect.height, circle.cy + circle.r);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned union bounding box of {@link SCOPE_CIRCLE} and {@link SCOPE_RECT}. */
export const SCOPE_BOUNDS: Rect = unionBounds(SCOPE_CIRCLE, SCOPE_RECT);

/** Aspect ratio (w/h) of the scope bounding box - the canvas/CSS box must match. */
export const SCOPE_ASPECT = SCOPE_BOUNDS.width / SCOPE_BOUNDS.height;

/** The scope geometry projected into a pixel space (e.g. the canvas). */
export interface ScopeGeometry {
  readonly circle: Circle;
  readonly rect: Rect;
  /** Bounding box in the target space; always origin-anchored ({x:0,y:0}). */
  readonly bounds: Rect;
  /** Uniform case-units -> pixel scale used for the projection. */
  readonly scale: number;
}

/**
 * Project the scope so its bounding box fills a `pxWidth` x `pxHeight` box. The
 * scale is a single scalar (uniform x and y) so the circle stays round; callers
 * must size that box to {@link SCOPE_ASPECT}. Returns geometry in pixel
 * coordinates with the bounding box anchored at the origin.
 */
export function projectScope(pxWidth: number, pxHeight: number): ScopeGeometry {
  const scale = Math.min(pxWidth / SCOPE_BOUNDS.width, pxHeight / SCOPE_BOUNDS.height);
  const ox = SCOPE_BOUNDS.x;
  const oy = SCOPE_BOUNDS.y;
  return {
    scale,
    circle: {
      cx: (SCOPE_CIRCLE.cx - ox) * scale,
      cy: (SCOPE_CIRCLE.cy - oy) * scale,
      r: SCOPE_CIRCLE.r * scale,
    },
    rect: {
      x: (SCOPE_RECT.x - ox) * scale,
      y: (SCOPE_RECT.y - oy) * scale,
      width: SCOPE_RECT.width * scale,
      height: SCOPE_RECT.height * scale,
    },
    bounds: {
      x: 0,
      y: 0,
      width: SCOPE_BOUNDS.width * scale,
      height: SCOPE_BOUNDS.height * scale,
    },
  };
}

// --- Case-side derivations (all pure; consumed by case.ts) -------------------

/** Trim a float to 4 dp for compact, deterministic SVG output. */
function f(n: number): string {
  return Number(n.toFixed(4)).toString();
}

/** `.jf-screen` position/size as percentages of the case (CSS left/top/width/height). */
export function screenBoxPercent(): {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
} {
  return {
    left: `${f((SCOPE_BOUNDS.x / CASE_VIEWBOX.width) * 100)}%`,
    top: `${f((SCOPE_BOUNDS.y / CASE_VIEWBOX.height) * 100)}%`,
    width: `${f((SCOPE_BOUNDS.width / CASE_VIEWBOX.width) * 100)}%`,
    height: `${f((SCOPE_BOUNDS.height / CASE_VIEWBOX.height) * 100)}%`,
  };
}

/**
 * The clip path (rect + ellipse union) in objectBoundingBox units of the
 * `.jf-screen` box, derived from the same circle/rect. The ellipse rx/ry differ
 * so the round circle stays round once the box is stretched to its aspect.
 */
export function clipPathMarkup(id: string): string {
  const bb = SCOPE_BOUNDS;
  const rx = (SCOPE_RECT.x - bb.x) / bb.width;
  const ry = (SCOPE_RECT.y - bb.y) / bb.height;
  const rw = SCOPE_RECT.width / bb.width;
  const rh = SCOPE_RECT.height / bb.height;
  const ecx = (SCOPE_CIRCLE.cx - bb.x) / bb.width;
  const ecy = (SCOPE_CIRCLE.cy - bb.y) / bb.height;
  const erx = SCOPE_CIRCLE.r / bb.width;
  const ery = SCOPE_CIRCLE.r / bb.height;
  return `<clipPath id="${id}" clipPathUnits="objectBoundingBox">
      <rect x="${f(rx)}" y="${f(ry)}" width="${f(rw)}" height="${f(rh)}" rx="0.04" ry="0.05"/>
      <ellipse cx="${f(ecx)}" cy="${f(ecy)}" rx="${f(erx)}" ry="${f(ery)}"/>
    </clipPath>`;
}

/**
 * The black scope window plus its raised rim, in viewBox units. The rim is the
 * window grown by `rimGrow`; the black fill is the exact window the canvas is
 * clipped to, so what the renderer paints lands precisely inside it.
 */
export function scopeWindowMarkup(rimGrow = 8): string {
  const c = SCOPE_CIRCLE;
  const r = SCOPE_RECT;
  return `
    <rect x="${f(r.x - rimGrow)}" y="${f(r.y - rimGrow)}" width="${f(r.width + 2 * rimGrow)}"
          height="${f(r.height + 2 * rimGrow)}" rx="18" fill="url(#jf-rim)"/>
    <circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.r + rimGrow)}" fill="url(#jf-rim)"/>
    <rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.width)}" height="${f(r.height)}" rx="14" fill="#050505"/>
    <circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.r)}" fill="#050505"/>`;
}
