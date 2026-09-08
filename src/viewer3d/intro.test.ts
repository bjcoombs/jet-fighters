import { describe, expect, it } from 'vitest';

import { CELL_COUNT, INTRO, INTRO_TOTAL_MS, introAt, introFactor } from './intro.js';

const start = (phase: 'pull' | 'seat' | 'flip' | 'load' | 'close' | 'return'): number => {
  const order = ['hold', 'pull', 'seat', 'flip', 'load', 'close', 'return'] as const;
  const ms = [INTRO.holdMs, INTRO.pullMs, INTRO.seatMs, INTRO.flipMs, INTRO.loadMs, INTRO.closeMs, INTRO.returnMs];
  return ms.slice(0, order.indexOf(phase)).reduce((a, b) => a + b, 0);
};

describe('the opening', () => {
  it('stands on the tube, fully exploded, through the hold', () => {
    for (const t of [0, INTRO.holdMs / 2, INTRO.holdMs - 1]) {
      const f = introAt(t);
      expect(f.phase).toBe('hold');
      expect([f.pull, f.lid, f.body, f.door, ...f.cells]).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
    }
  });

  it('pulls back while the body gathers, and only the body', () => {
    const mid = introAt(start('pull') + INTRO.pullMs / 2);
    expect(mid.phase).toBe('pull');
    expect(mid.pull).toBeGreaterThan(0);
    expect(mid.pull).toBeLessThan(1);
    expect(mid.body).toBeCloseTo(1 - mid.pull, 9);
    expect(mid.lid).toBe(1);
    expect(mid.door).toBe(1);
    expect(mid.cells).toEqual([1, 1, 1, 1]);
  });

  it('seats the lid with the body home and the back still open', () => {
    const f = introAt(start('seat') + INTRO.seatMs / 2);
    expect(f.phase).toBe('seat');
    expect(f.body).toBe(0);
    expect(f.lid).toBeGreaterThan(0);
    expect(f.lid).toBeLessThan(1);
    expect(f.door).toBe(1);
    expect(f.cells).toEqual([1, 1, 1, 1]);
  });

  it('loads the cells one after another, then the door', () => {
    const early = introAt(start('load') + INTRO.loadMs * 0.2);
    expect(early.phase).toBe('load');
    expect(early.cells[0]).toBeLessThan(1);
    expect(early.cells[CELL_COUNT - 1]).toBe(1);
    expect(early.door).toBe(1);
    const late = introAt(start('load') + INTRO.loadMs * 0.95);
    expect(late.cells[0]).toBe(0);
    expect(late.cells[CELL_COUNT - 1]).toBeLessThan(1);
    const closing = introAt(start('close') + INTRO.closeMs / 2);
    expect(closing.phase).toBe('close');
    expect(closing.cells).toEqual([0, 0, 0, 0]);
    expect(closing.door).toBeGreaterThan(0);
    expect(closing.door).toBeLessThan(1);
  });

  it('is done with everything home', () => {
    const f = introAt(INTRO_TOTAL_MS);
    expect(f.done).toBe(true);
    expect([f.lid, f.body, f.door, ...f.cells]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(introAt(start('return') + 1).phase).toBe('return');
  });

  it('never moves a part back out', () => {
    const last: Record<string, number> = {};
    for (let t = 0; t <= INTRO_TOTAL_MS + 100; t += 20) {
      const f = introAt(t);
      for (const name of ['front_shell', 'tms1370', 'battery_door', 'battery_1', 'battery_4']) {
        const v = introFactor(f, name);
        expect(v, `${name} at ${t}`).toBeLessThanOrEqual((last[name] ?? 1) + 1e-12);
        last[name] = v;
      }
    }
  });
});
