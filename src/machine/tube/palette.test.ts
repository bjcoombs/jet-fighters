import { describe, expect, it } from 'vitest';

import { loadAtlas } from './atlas.js';
import type { Rgb } from './palette.js';
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

/**
 * The three faults a critique found by comparing our render against photographs
 * of the lit unit: the full-drive endpoint washed almost to white, cyan rendered
 * ice-blue where the real phosphor is blue-green, and a bloom wider than the
 * sprite casting it.
 *
 * Each is pinned below as an invariant rather than as a literal colour, so the
 * palette can still be tuned by eye but cannot drift back. The photographs are
 * hand-held webp with a warm cast, so absolute RGB is not a reliable target and
 * nothing here asserts one - channel *ordering* and *relative saturation* are
 * what survive a colour cast, and those are what is asserted.
 */
describe('phosphor invariants measured from the lit unit', () => {
  /** Saturation as HSV defines it: how far the colour is from grey. White is 0. */
  function saturation(c: Rgb): number {
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    return max === 0 ? 0 : (max - min) / max;
  }

  function channelsAt(region: 'cyan' | 'red', brightness: number): Rgb {
    const [r, g, b] = channelsOf(segmentFill(region, brightness));
    return { r, g, b };
  }

  /** 0, 0.05 ... 1 - the whole ramp segmentFill can be asked for. */
  const RAMP = Array.from({ length: 21 }, (_, i) => i / 20);

  // The hottest 1% of the hue-filtered phosphor in the sprite crops measures
  // 0.52 saturation (jet-lit.png) and 0.57 (explosion-red-lit.png) for red, and
  // 0.29 for cyan even where the photograph's green channel is clipped at 255.
  // Those are floors on the real thing, so the floor asserted here sits below
  // them: the claim is that a lit segment is a saturated colour, not a pale one.
  const MIN_SATURATION = 0.25;

  it('keeps the full-drive endpoint saturated rather than washing it to white', () => {
    // The original fault: hot was #dffcff (0.125 saturation) and #ffc9a8
    // (0.341), so a full-duty segment rendered pale cream or near-white. No
    // white centre appears in any photograph of the lit tube.
    const washedOut = (['cyan', 'red'] as const).filter(
      (region) => saturation(TUBE_PALETTE[region].hot) <= MIN_SATURATION,
    );
    expect(washedOut).toEqual([]);
  });

  it('never renders a lit segment as near-white at any brightness', () => {
    // segmentFill walks dim -> hot, so the whole ramp has to stay off white, not
    // just the endpoint - a segment at 0.9 duty is on screen as often as one at 1.
    for (const region of ['cyan', 'red'] as const) {
      const pale = RAMP.filter((b) => saturation(channelsAt(region, b)) <= MIN_SATURATION);
      expect(pale).toEqual([]);
    }
  });

  it('keeps red the more saturated phosphor, as it measures in every band', () => {
    expect(saturation(TUBE_PALETTE.red.hot)).toBeGreaterThan(saturation(TUBE_PALETTE.cyan.hot));
  });

  it('renders cyan as blue-green (G > B), not ice-blue', () => {
    // The second fault: every v1 cyan value had B > G. Every hue-filtered
    // phosphor band in assets/reference/sprites/{score-lives,missile-lit,
    // battleship-cyan-lit}.png and in both tube-closeup-*.webp has G > B - by +5
    // at the clipped highlights and +14 to +17 through the mid-tones. A warm
    // colour cast cannot reorder two channels, so this ordering is the reliable
    // target where the absolute values are not.
    const { dim, hot, glow, ghost } = TUBE_PALETTE.cyan;
    const shades = { dim, hot, glow, ghost };
    expect(Object.entries(shades).filter(([, c]) => c.b >= c.g).map(([name]) => name)).toEqual([]);
    // Green also leads red - it is the dominant channel of the pair.
    expect(Object.entries(shades).filter(([, c]) => c.g <= c.r).map(([name]) => name)).toEqual([]);
  });

  it('holds G > B across the whole cyan brightness ramp', () => {
    const iceBlue = RAMP.filter((b) => {
      const c = channelsAt('cyan', b);
      return c.g <= c.b || c.g <= c.r;
    });
    expect(iceBlue).toEqual([]);
  });

  it('gives red the small positive G-B that reads as brick red-salmon', () => {
    // Measured G-B is +8 to +10 in the lit sprite crops. A negative G-B would
    // push the attackers toward magenta; a large one toward orange.
    const hot = TUBE_PALETTE.red.hot;
    expect(hot.g).toBeGreaterThan(hot.b);
    expect(hot.g - hot.b).toBeLessThan(40);
  });

  it('blooms as a fringe at the segment edge, not a halo around the sprite', () => {
    // The third fault: glowScale was 0.5 cyan / 0.35 red, so the largest red
    // segment (extent 22.2 atlas units) bloomed 7.8 units - wider than the jet
    // casting it - and the score digits' bloom filled the gaps between their
    // segments, rendering them as fat continuous rectangles. The photographs
    // show crisp shapes with at most a 1-2px fringe.
    //
    // The tube is 363 atlas units wide and renders at roughly 1.33 device px per
    // unit on a 2x display, so ~2 atlas units of bloom is already the top of that
    // 1-2px band. Extents are the largest each region has in atlas.json.
    const largestExtent = { cyan: 12.07, red: 22.21 };
    for (const region of ['cyan', 'red'] as const) {
      expect(glowRadius(region, 1, largestExtent[region])).toBeLessThan(2.5);
    }
  });

  it('keeps the bloom small against the segment casting it, whatever its size', () => {
    // As a fraction, so it holds if the atlas geometry changes: the halo stays a
    // rim on the segment and never becomes a second sprite.
    for (const region of ['cyan', 'red'] as const) {
      expect(glowRadius(region, 1, 100)).toBeLessThan(20);
    }
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
