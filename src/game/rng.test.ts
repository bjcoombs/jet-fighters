import { describe, it, expect } from 'vitest';
import { nextInt, nextRandom, seedRng } from './rng.js';

describe('rng (Mulberry32)', () => {
  it('produces values in [0, 1)', () => {
    let state = seedRng(12345);
    for (let i = 0; i < 1000; i += 1) {
      const draw = nextRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      state = draw.state;
    }
  });

  it('is deterministic for a given seed', () => {
    const runFrom = (seed: number): number[] => {
      let state = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const draw = nextRandom(state);
        out.push(draw.value);
        state = draw.state;
      }
      return out;
    };
    expect(runFrom(42)).toEqual(runFrom(42));
  });

  it('produces different sequences for different seeds', () => {
    const first = nextRandom(seedRng(1)).value;
    const second = nextRandom(seedRng(2)).value;
    expect(first).not.toBe(second);
  });

  it('nextInt stays within [0, bound) and advances state', () => {
    let state = seedRng(7);
    for (let i = 0; i < 500; i += 1) {
      const result = nextInt(state, 3);
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThan(3);
      expect(Number.isInteger(result.value)).toBe(true);
      expect(result.state).not.toBe(state);
      state = result.state;
    }
  });
});
