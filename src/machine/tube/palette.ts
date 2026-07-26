// Tube colour: the two phosphor regions, the filter overlay tint, and how
// brightness modulates them.
//
// Pure colour arithmetic - no canvas, no DOM. The renderer asks for a fill
// string given a region and a brightness; everything about *what* the tube looks
// like is decided here, so it can be tuned against the reference photos without
// touching the drawing pipeline.
//
// Provenance. The tube is a cyan/red two-phosphor Futaba DM-series unit
// (docs/prd/jet-fighters-v2.md R5, Technical Context); colour is a fixed
// property of each segment, from patterned phosphor plus a filter overlay, and
// the atlas records it as `colorRegion: 'cyan' | 'red'`. Two other sources name
// the attacker colour differently and neither is authoritative: v1's
// src/render/sprites.ts PALETTE calls it `amber` (#ff9a2e), and the Task Master
// description for this task says 'amber' as well. See ATLAS-COORDINATES.md,
// "Colour regions". This module renders the PRD's red.
//
// Values below are copied from v1 rather than imported: task 11 deletes
// src/render/, and an import would break with it (the same reason the atlas
// copied its geometry). Each carries its source.

import type { ColorRegion } from './atlas-schema.js';

/** An 8-bit RGB triple. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * One phosphor region's appearance.
 *
 * A driven VFD segment does not simply get more opaque as it brightens: the
 * emission washes toward the phosphor's white point, which is why the lit
 * segments in device-front-lit.jpg have pale centres inside a saturated halo.
 * `dim` is the colour just above the noise floor, `hot` the colour at full
 * drive, and the renderer interpolates between them by brightness.
 */
export interface PhosphorColors {
  /** Emission colour at low brightness - the saturated phosphor hue. */
  readonly dim: Rgb;
  /** Emission colour at full drive, washed toward the phosphor's white point. */
  readonly hot: Rgb;
  /** Bloom colour used for the glow pass - the saturated hue, never the wash. */
  readonly glow: Rgb;
  /**
   * Unlit phosphor under the filter overlay. Faintly visible on the real tube
   * from ambient light alone, and a large part of why the screen reads as a VFD
   * rather than as sprites on black.
   */
  readonly ghost: Rgb;
  /** Glow radius at full brightness, as a fraction of the segment's extent. */
  readonly glowScale: number;
}

/**
 * Cyan region: player missile, launchers, SCORE readout and label, reserve
 * marks. `dim` and `glow` are v1's PALETTE.cyan / cyanGlow (#5fe0ec / #22c8de),
 * traced from the reference photos; `glowScale` is v1's GLOW.cyan.
 */
const CYAN: PhosphorColors = {
  dim: { r: 0x5f, g: 0xe0, b: 0xec },
  hot: { r: 0xdf, g: 0xfc, b: 0xff },
  glow: { r: 0x22, g: 0xc8, b: 0xde },
  ghost: { r: 0x7a, g: 0xa8, b: 0xac },
  glowScale: 0.5,
};

/**
 * Red region: jets, jet rockets, battleship - everything the machine attacks
 * with. `dim` is #ff5a3c, the red used in ATLAS-COORDINATES.md's atlas preview
 * snippet; `glowScale` is v1's GLOW.amber (the attacker colour reads dimmer than
 * cyan on the real tube, so it blooms less).
 */
const RED: PhosphorColors = {
  dim: { r: 0xff, g: 0x5a, b: 0x3c },
  hot: { r: 0xff, g: 0xc9, b: 0xa8 },
  glow: { r: 0xff, g: 0x2d, b: 0x10 },
  ghost: { r: 0x96, g: 0x60, b: 0x50 },
  glowScale: 0.35,
};

/** The two phosphor regions of the tube. */
export const TUBE_PALETTE: Readonly<Record<ColorRegion, PhosphorColors>> = {
  cyan: CYAN,
  red: RED,
};

/** Scope background - the dark glass. v1 PALETTE.background. */
export const BACKGROUND = '#050505';

/** Printed silkscreen overlay: border, ruler, labels, arc text. v1 PALETTE.silkscreen. */
export const SILKSCREEN = 'rgba(232, 230, 222, 0.85)';

/**
 * Opacity of the unlit-phosphor ghost layer.
 *
 * v1 used a single neutral `rgba(120, 120, 120, 0.08)` for every ghost. The
 * alpha is kept; the colour is now per region, because the filter overlay tints
 * the unlit phosphor it sits over. A judgement call tuned by eye - the ghost
 * must be legible as a matrix without competing with a lit segment.
 */
export const GHOST_ALPHA = 0.08;

/**
 * Brightness below which the active layer skips a segment entirely.
 *
 * A drawing threshold, not a duty threshold: below this the segment is dimmer
 * than the ghost already drawn underneath it, so the pass would compose nothing
 * visible. Duty itself is never thresholded - it reaches the renderer as the
 * real fraction the board accumulated.
 */
export const MIN_VISIBLE_BRIGHTNESS = 0.004;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Linear interpolation between two colours; `t` is clamped to 0..1. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

/** A CSS colour string. Alpha is clamped and trimmed to 3 dp. */
export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(clamp01(alpha).toFixed(3))})`;
}

/**
 * Fill colour for a lit segment at the given brightness.
 *
 * Two things move with brightness: the hue washes from `dim` toward `hot`, and
 * the alpha rises, so a segment at half brightness composes as a genuinely
 * dimmer segment against the dark glass rather than a smaller one. Both are
 * continuous in brightness - that continuity is the visible shimmer.
 */
export function segmentFill(region: ColorRegion, brightness: number): string {
  const colors = TUBE_PALETTE[region];
  const level = clamp01(brightness);
  // The wash lags the alpha (squared) so only near-full drive goes pale, which
  // is how the lit segments read in device-front-lit.jpg.
  return rgba(mix(colors.dim, colors.hot, level * level), level);
}

/** Bloom colour for a lit segment. Saturated, and it fades out with brightness. */
export function glowFill(region: ColorRegion, brightness: number): string {
  return rgba(TUBE_PALETTE[region].glow, clamp01(brightness));
}

/** Glow radius in pixels for a segment of `extentPx`, at the given brightness. */
export function glowRadius(region: ColorRegion, brightness: number, extentPx: number): number {
  return extentPx * TUBE_PALETTE[region].glowScale * clamp01(brightness);
}

/** Fill colour for the unlit-phosphor ghost layer of a region. */
export function ghostFill(region: ColorRegion): string {
  return rgba(TUBE_PALETTE[region].ghost, GHOST_ALPHA);
}
