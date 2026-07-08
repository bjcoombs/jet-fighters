import { describe, expect, it } from 'vitest';
import type { Point } from './sprites.js';
import {
  BATTLESHIP_SHAPE,
  DIGIT_SEGMENTS,
  JET_SHAPE,
  LAUNCHER_SHAPE,
  LIFE_DART_SHAPE,
  PALETTE,
  SEGMENT_KEYS,
  segmentsForDigit,
} from './sprites.js';

const SHAPES: Record<string, readonly Point[]> = {
  JET_SHAPE,
  BATTLESHIP_SHAPE,
  LAUNCHER_SHAPE,
  LIFE_DART_SHAPE,
};

describe('sprite geometry tables', () => {
  it('defines closeable polygons', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      expect(shape.length, name).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every point inside the normalized unit box', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      for (const p of shape) {
        expect(Math.abs(p.x), name).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(p.y), name).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  it('points the jet and life dart nose to the right (+x extreme)', () => {
    const jetNose = JET_SHAPE.reduce((m, p) => Math.max(m, p.x), -1);
    const dartNose = LIFE_DART_SHAPE.reduce((m, p) => Math.max(m, p.x), -1);
    expect(jetNose).toBeCloseTo(0.5);
    expect(dartNose).toBeCloseTo(0.5);
  });
});

describe('segmentsForDigit', () => {
  it('returns a boolean per segment in SEGMENT_KEYS order', () => {
    const seg = segmentsForDigit(8);
    expect(seg).toHaveLength(SEGMENT_KEYS.length);
    expect(seg.every((s) => s === true)).toBe(true);
  });

  it('lights only b and c for 1', () => {
    const seg = segmentsForDigit(1);
    const lit = SEGMENT_KEYS.filter((_, i) => seg[i]);
    expect(lit).toEqual(['b', 'c']);
  });

  it('omits the middle segment for 0 and 7', () => {
    const g = SEGMENT_KEYS.indexOf('g');
    expect(segmentsForDigit(0)[g]).toBe(false);
    expect(segmentsForDigit(7)[g]).toBe(false);
  });

  it('matches the DIGIT_SEGMENTS table for every digit', () => {
    for (let d = 0; d <= 9; d += 1) {
      const seg = segmentsForDigit(d);
      const lit = new Set(DIGIT_SEGMENTS[d]);
      SEGMENT_KEYS.forEach((key, i) => {
        expect(seg[i], `digit ${d} segment ${key}`).toBe(lit.has(key));
      });
    }
  });

  it('distinguishes 6 from 5 and 9 from 3 by exactly one segment', () => {
    const diff = (a: number, b: number) =>
      segmentsForDigit(a).filter((s, i) => s !== segmentsForDigit(b)[i]).length;
    expect(diff(6, 5)).toBe(1); // 6 adds segment e
    expect(diff(9, 3)).toBe(1); // 9 adds segment f
  });
});

describe('palette', () => {
  it('uses the faint ghost alpha for unlit phosphor', () => {
    expect(PALETTE.ghost).toContain('0.08');
  });

  it('separates attacker (amber) and defender (cyan) colours', () => {
    expect(PALETTE.amber).not.toBe(PALETTE.cyan);
  });
});
