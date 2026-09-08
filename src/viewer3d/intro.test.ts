import { describe, expect, it } from 'vitest';

import { INTRO, INTRO_TOTAL_MS, introAt } from './intro.js';

describe('the opening', () => {
  it('stands on the tube, fully exploded, through the hold', () => {
    for (const t of [0, INTRO.holdMs / 2, INTRO.holdMs - 1]) {
      expect(introAt(t)).toEqual({ amount: 1, pull: 0, seating: false, done: false });
    }
  });

  it('pulls back while the board gathers, and only the board', () => {
    const mid = introAt(INTRO.holdMs + INTRO.pullMs / 2);
    expect(mid.pull).toBeGreaterThan(0);
    expect(mid.pull).toBeLessThan(1);
    expect(mid.amount).toBeGreaterThan(0.5);
    expect(mid.amount).toBeLessThan(1);
    expect(mid.seating).toBe(false);
    const end = introAt(INTRO.holdMs + INTRO.pullMs);
    expect(end.pull).toBe(1);
    expect(end.amount).toBe(0.5);
    expect(end.seating).toBe(true);
  });

  it('seats the lid last and is then done', () => {
    const late = introAt(INTRO_TOTAL_MS - 1);
    expect(late.seating).toBe(true);
    expect(late.done).toBe(false);
    expect(late.amount).toBeGreaterThan(0);
    expect(late.amount).toBeLessThan(0.5);
    expect(introAt(INTRO_TOTAL_MS)).toEqual({ amount: 0, pull: 1, seating: true, done: true });
  });

  it('never moves a part back out: the slider only falls', () => {
    let last = 1;
    for (let t = 0; t <= INTRO_TOTAL_MS + 100; t += 25) {
      const { amount } = introAt(t);
      expect(amount).toBeLessThanOrEqual(last + 1e-12);
      last = amount;
    }
  });
});
