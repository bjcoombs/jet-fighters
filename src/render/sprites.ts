// VFD sprite geometry, palette, and drawing primitives.
//
// Shapes are traced from assets/reference/*.jpg and expressed as normalized
// point arrays in a unit box centred on the origin (x right = nose/forward,
// y down). Each draw* helper scales a shape to a cell and paints it; the pure
// geometry tables (shapes, seven-segment map) are unit tested without a canvas.

/** Two-colour VFD palette plus the printed silkscreen white and ghost phosphor. */
export const PALETTE = {
  /** Scope background. */
  background: '#050505',
  /** Warm amber - jets and battleship (the attacker colour). */
  amber: '#ff9a2e',
  amberGlow: '#ff7a00',
  /** Cyan - player missile, launcher, SCORE readout, lives (the defender colour). */
  cyan: '#5fe0ec',
  cyanGlow: '#22c8de',
  /** Printed silkscreen overlay (border, ruler, labels, arc text). */
  silkscreen: 'rgba(232, 230, 222, 0.85)',
  /** Unlit VFD phosphor - every possible segment, barely visible. */
  ghost: 'rgba(120, 120, 120, 0.08)',
} as const;

/** Glow radii as a fraction of a cell's smaller dimension. Cyan reads brighter. */
export const GLOW = {
  amber: 0.35,
  cyan: 0.5,
} as const;

/** A normalized 2D point in the unit sprite box, x in [-0.5, 0.5], y likewise. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Swept-wing jet silhouette pointing right (nose at +x), traced from the amber
 * arrowhead in screen-closeup-gameplay.jpg. Wings sweep back toward the tail.
 */
export const JET_SHAPE: readonly Point[] = [
  { x: 0.5, y: 0 }, // nose
  { x: 0.05, y: -0.13 },
  { x: -0.12, y: -0.45 }, // upper swept wingtip
  { x: -0.05, y: -0.12 },
  { x: -0.5, y: -0.1 }, // upper tail
  { x: -0.5, y: 0.1 }, // lower tail
  { x: -0.05, y: 0.12 },
  { x: -0.12, y: 0.45 }, // lower swept wingtip
  { x: 0.05, y: 0.13 },
];

/**
 * Battleship hull - a long low silhouette with a small bridge, wider than the
 * jets and confined to the far (battleship) zone.
 */
export const BATTLESHIP_SHAPE: readonly Point[] = [
  { x: -0.5, y: 0.12 }, // stern waterline
  { x: -0.42, y: -0.05 },
  { x: -0.12, y: -0.05 },
  { x: -0.1, y: -0.32 }, // bridge
  { x: 0.02, y: -0.32 },
  { x: 0.04, y: -0.05 },
  { x: 0.34, y: -0.05 },
  { x: 0.5, y: 0.12 }, // bow waterline
];

/**
 * Player launcher at the right (missile station) edge - a base with a barrel
 * pointing left into the field.
 */
export const LAUNCHER_SHAPE: readonly Point[] = [
  { x: 0.5, y: -0.4 }, // base back-top
  { x: 0.5, y: 0.4 }, // base back-bottom
  { x: 0.1, y: 0.4 },
  { x: 0.1, y: 0.14 },
  { x: -0.5, y: 0.09 }, // barrel tip (points left, into the field)
  { x: -0.5, y: -0.09 },
  { x: 0.1, y: -0.14 },
  { x: 0.1, y: -0.4 },
];

/** Remaining-launcher (life) indicator - a small right-pointing dart. */
export const LIFE_DART_SHAPE: readonly Point[] = [
  { x: 0.5, y: 0 },
  { x: -0.5, y: -0.4 },
  { x: -0.25, y: 0 },
  { x: -0.5, y: 0.4 },
];

/** Seven-segment order: a b c d e f g (a = top, clockwise, g = middle). */
export const SEGMENT_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

/** Lit segments for each decimal digit. */
export const DIGIT_SEGMENTS: Readonly<Record<number, readonly SegmentKey[]>> = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'],
  1: ['b', 'c'],
  2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'],
  4: ['f', 'g', 'b', 'c'],
  5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'],
  7: ['a', 'b', 'c'],
  8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  9: ['a', 'b', 'c', 'd', 'f', 'g'],
};

/** Whether each of the seven segments is lit for a digit, in {@link SEGMENT_KEYS} order. */
export function segmentsForDigit(digit: number): readonly boolean[] {
  const lit = DIGIT_SEGMENTS[digit] ?? [];
  return SEGMENT_KEYS.map((key) => lit.includes(key));
}

// --- Canvas drawing primitives (exercised at runtime; need a real canvas) ---

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  shape: readonly Point[],
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  shape.forEach((p, i) => {
    const x = cx + p.x * w;
    const y = cy + p.y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Fill a normalized shape centred at (cx, cy) scaled to a w x h box. */
export function fillShape(
  ctx: CanvasRenderingContext2D,
  shape: readonly Point[],
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
): void {
  tracePolygon(ctx, shape, cx, cy, w, h);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Stroke a normalized shape - used for the faint ghost phosphor outlines. */
export function strokeShape(
  ctx: CanvasRenderingContext2D,
  shape: readonly Point[],
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  lineWidth: number,
): void {
  tracePolygon(ctx, shape, cx, cy, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

export function drawJet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  fillShape(ctx, JET_SHAPE, cx, cy, size, size, color);
}

export function drawBattleship(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
): void {
  fillShape(ctx, BATTLESHIP_SHAPE, cx, cy, w, h, color);
}

export function drawLauncher(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
): void {
  fillShape(ctx, LAUNCHER_SHAPE, cx, cy, w, h, color);
}

/** The player's missile: a two-dot cyan trail. `trailX` sits toward the launcher. */
export function drawMissile(
  ctx: CanvasRenderingContext2D,
  headX: number,
  trailX: number,
  cy: number,
  radius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(headX, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(trailX, cy, radius * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

/** A jet rocket travelling back down its lane: a small amber dot. */
export function drawRocket(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** A brief radial explosion burst. `intensity` in (0, 1] scales spokes outward. */
export function drawExplosion(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  intensity: number,
  color: string,
): void {
  const spokes = 8;
  const inner = size * 0.15;
  const outer = size * (0.3 + 0.35 * intensity);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.lineCap = 'round';
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2 + (intensity < 0.5 ? Math.PI / spokes : 0);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
}

/** A right-pointing dart for the remaining-launcher (lives) indicator. */
export function drawLifeDart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  filled: boolean,
): void {
  if (filled) {
    fillShape(ctx, LIFE_DART_SHAPE, cx, cy, w, h, color);
  } else {
    strokeShape(ctx, LIFE_DART_SHAPE, cx, cy, w, h, color, Math.max(1, w * 0.06));
  }
}

/**
 * Draw one seven-segment digit inside the given box. `on` selects the lit
 * colour; unlit segments are painted in `ghost` for the phosphor look.
 */
export function drawSevenSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  digit: number | null,
  onColor: string,
  ghostColor: string,
): void {
  const lit = digit === null ? SEGMENT_KEYS.map(() => false) : segmentsForDigit(digit);
  const t = Math.max(1.5, w * 0.16); // segment thickness
  const midY = y + h / 2;
  // Horizontal segments: a (top), g (middle), d (bottom).
  const horiz: Record<string, number> = { a: y, g: midY - t / 2, d: y + h - t };
  // Vertical segments: [x, topY, height].
  const vert: Record<string, [number, number, number]> = {
    f: [x, y, h / 2],
    b: [x + w - t, y, h / 2],
    e: [x, midY, h / 2],
    c: [x + w - t, midY, h / 2],
  };
  SEGMENT_KEYS.forEach((key, i) => {
    ctx.fillStyle = lit[i] ? onColor : ghostColor;
    if (key === 'a' || key === 'g' || key === 'd') {
      ctx.fillRect(x, horiz[key], w, t);
    } else {
      const [vx, vy, vh] = vert[key];
      ctx.fillRect(vx, vy, t, vh);
    }
  });
}
