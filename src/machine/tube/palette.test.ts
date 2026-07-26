import { describe, expect, it } from 'vitest';

import { loadAtlas } from './atlas.js';
import {
  GHOST_ALPHA,
  MIN_VISIBLE_BRIGHTNESS,
  TUBE_PALETTE,
  ghostFill,
  glowFill,
  glowRadius,
  mix,
  rgba,
  segmentFill,
} from './palette.js';

/** Pull the alpha out of an `rgba(r, g, b, a)` string. */
function alphaOf(css: string): number {
  const match = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/.exec(css);
  if (!match) throw new Error(`not an rgba string: ${css}`);
  return Number(match[1]);
}

/** Pull the channels out of an `rgba(r, g, b, a)` string. */
function channelsOf(css: string): [number, number, number] {
  const match = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),/.exec(css);
  if (!match) throw new Error(`not an rgba string: ${css}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe('TUBE_PALETTE', () => {
  it('covers exactly the two phosphor regions the atlas declares', () => {
    const regions = new Set(loadAtlas().segments.map((s) => s.colorRegion));
    expect([...regions].sort()).toEqual(['cyan', 'red']);
    for (const region of regions) {
      expect(TUBE_PALETTE[region]).toBeDefined();
    }
  });

  it('renders the attacker region red, not v1 amber', () => {
    // The PRD specifies a cyan/red tube; v1's PALETTE called this colour amber
    // (#ff9a2e) and the Task Master description repeats that. See
    // ATLAS-COORDINATES.md, "Colour regions".
    const red = TUBE_PALETTE.red.dim;
    expect(red.r).toBeGreaterThan(red.g);
    expect(red.g).toBeGreaterThan(red.b);
    // Distinctly redder than v1's amber #ff9a2e (green channel 0x9a).
    expect(red.g).toBeLessThan(0x9a);
  });

  it('keeps the two regions clearly distinguishable', () => {
    const cyan = TUBE_PALETTE.cyan.dim;
    const red = TUBE_PALETTE.red.dim;
    expect(cyan.b).toBeGreaterThan(cyan.r);
    expect(red.r).toBeGreaterThan(red.b);
  });

  it('blooms cyan harder than red, as the reference photos show', () => {
    expect(TUBE_PALETTE.cyan.glowScale).toBeGreaterThan(TUBE_PALETTE.red.glowScale);
  });
});

describe('mix', () => {
  it('returns the endpoints at 0 and 1', () => {
    const a = { r: 0, g: 10, b: 20 };
    const b = { r: 100, g: 110, b: 120 };
    expect(mix(a, b, 0)).toEqual(a);
    expect(mix(a, b, 1)).toEqual(b);
  });

  it('interpolates and clamps out-of-range factors', () => {
    const a = { r: 0, g: 0, b: 0 };
    const b = { r: 100, g: 200, b: 40 };
    expect(mix(a, b, 0.5)).toEqual({ r: 50, g: 100, b: 20 });
    expect(mix(a, b, -3)).toEqual(a);
    expect(mix(a, b, 3)).toEqual(b);
  });
});

describe('rgba', () => {
  it('formats a CSS colour with clamped alpha', () => {
    expect(rgba({ r: 1, g: 2, b: 3 }, 0.5)).toBe('rgba(1, 2, 3, 0.5)');
    expect(alphaOf(rgba({ r: 1, g: 2, b: 3 }, 5))).toBe(1);
    expect(alphaOf(rgba({ r: 1, g: 2, b: 3 }, -1))).toBe(0);
    expect(alphaOf(rgba({ r: 1, g: 2, b: 3 }, Number.NaN))).toBe(0);
  });
});

describe('segmentFill', () => {
  it('scales alpha continuously with brightness - the visible shimmer', () => {
    const levels = [0.1, 0.25, 0.5, 0.75, 1];
    const alphas = levels.map((level) => alphaOf(segmentFill('cyan', level)));
    for (let i = 1; i < alphas.length; i += 1) {
      expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
    }
    expect(alphas.at(-1)).toBe(1);
  });

  it('is fully transparent when dark and fully opaque at full drive', () => {
    expect(alphaOf(segmentFill('red', 0))).toBe(0);
    expect(alphaOf(segmentFill('red', 1))).toBe(1);
  });

  it('washes toward the hot colour only near full drive', () => {
    const dim = channelsOf(segmentFill('cyan', 0.2));
    const mid = channelsOf(segmentFill('cyan', 0.6));
    const hot = channelsOf(segmentFill('cyan', 1));
    const distanceFromDim = (c: [number, number, number]): number =>
      Math.abs(c[0] - TUBE_PALETTE.cyan.dim.r);
    expect(distanceFromDim(dim)).toBeLessThan(distanceFromDim(mid));
    expect(distanceFromDim(mid)).toBeLessThan(distanceFromDim(hot));
    expect(hot).toEqual([TUBE_PALETTE.cyan.hot.r, TUBE_PALETTE.cyan.hot.g, TUBE_PALETTE.cyan.hot.b]);
  });

  it('keeps a low-brightness segment on its saturated phosphor hue', () => {
    expect(channelsOf(segmentFill('red', 0.05))).toEqual([
      TUBE_PALETTE.red.dim.r,
      TUBE_PALETTE.red.dim.g,
      TUBE_PALETTE.red.dim.b,
    ]);
  });
});

describe('glowFill and glowRadius', () => {
  it('fades the bloom out with brightness', () => {
    expect(alphaOf(glowFill('cyan', 1))).toBe(1);
    expect(alphaOf(glowFill('cyan', 0.3))).toBe(0.3);
    expect(alphaOf(glowFill('cyan', 0))).toBe(0);
  });

  it('keeps the bloom on the saturated hue rather than the wash', () => {
    expect(channelsOf(glowFill('red', 1))).toEqual([
      TUBE_PALETTE.red.glow.r,
      TUBE_PALETTE.red.glow.g,
      TUBE_PALETTE.red.glow.b,
    ]);
  });

  it('scales the bloom radius with the segment size and brightness', () => {
    expect(glowRadius('cyan', 1, 20)).toBeCloseTo(20 * TUBE_PALETTE.cyan.glowScale, 10);
    expect(glowRadius('cyan', 0.5, 20)).toBeCloseTo(10 * TUBE_PALETTE.cyan.glowScale, 10);
    expect(glowRadius('cyan', 0, 20)).toBe(0);
  });
});

describe('ghostFill', () => {
  it('is faint but present for both regions', () => {
    for (const region of ['cyan', 'red'] as const) {
      expect(alphaOf(ghostFill(region))).toBe(GHOST_ALPHA);
      expect(alphaOf(ghostFill(region))).toBeGreaterThan(0);
    }
  });

  it('carries the region tint from the filter overlay', () => {
    expect(channelsOf(ghostFill('cyan'))).not.toEqual(channelsOf(ghostFill('red')));
  });

  it('stays dimmer than a barely-lit segment', () => {
    // The ghost is the floor; anything the board actually drives must sit above
    // it, otherwise a lit segment would disappear into the matrix.
    expect(GHOST_ALPHA).toBeLessThan(alphaOf(segmentFill('cyan', 0.5)));
    expect(MIN_VISIBLE_BRIGHTNESS).toBeLessThan(GHOST_ALPHA);
  });
});
