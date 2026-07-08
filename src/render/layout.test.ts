import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, LANE_COUNT, WIN_SCORE } from '../game/index.js';
import {
  cellExtent,
  columnToX,
  computePlayfield,
  laneToY,
  rulerTicks,
  splitScoreDigits,
} from './layout.js';

const W = 800;
const H = 600;
const pf = computePlayfield(W, H);

describe('computePlayfield', () => {
  it('places the playfield inside the canvas', () => {
    expect(pf.x).toBeGreaterThan(0);
    expect(pf.y).toBeGreaterThan(0);
    expect(pf.x + pf.width).toBeLessThanOrEqual(W);
    expect(pf.y + pf.height).toBeLessThanOrEqual(H);
  });

  it('scales with canvas size', () => {
    const doubled = computePlayfield(W * 2, H * 2);
    expect(doubled.width).toBeCloseTo(pf.width * 2);
    expect(doubled.height).toBeCloseTo(pf.height * 2);
  });
});

describe('columnToX', () => {
  it('orders columns left-to-right within the playfield', () => {
    const first = columnToX(0, GRID_COLUMNS, pf);
    const last = columnToX(GRID_COLUMNS - 1, GRID_COLUMNS, pf);
    expect(first).toBeGreaterThan(pf.x);
    expect(last).toBeLessThan(pf.x + pf.width);
    expect(last).toBeGreaterThan(first);
  });

  it('is monotonic across all columns', () => {
    const xs = Array.from({ length: GRID_COLUMNS }, (_, c) => columnToX(c, GRID_COLUMNS, pf));
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it('supports fractional columns between cells', () => {
    const one = columnToX(1, GRID_COLUMNS, pf);
    const two = columnToX(2, GRID_COLUMNS, pf);
    const mid = columnToX(1.5, GRID_COLUMNS, pf);
    expect(mid).toBeGreaterThan(one);
    expect(mid).toBeLessThan(two);
    expect(mid).toBeCloseTo((one + two) / 2);
  });
});

describe('laneToY', () => {
  it('orders lanes top-to-bottom and stays inside the playfield', () => {
    const top = laneToY(0, LANE_COUNT, pf);
    const bottom = laneToY(LANE_COUNT - 1, LANE_COUNT, pf);
    expect(top).toBeGreaterThan(pf.y);
    expect(bottom).toBeLessThan(pf.y + pf.height);
    expect(bottom).toBeGreaterThan(top);
  });

  it('centres the middle lane', () => {
    expect(laneToY(1, LANE_COUNT, pf)).toBeCloseTo(pf.y + pf.height / 2);
  });
});

describe('cellExtent', () => {
  it('partitions the playfield into grid x lane cells', () => {
    const cell = cellExtent(GRID_COLUMNS, LANE_COUNT, pf);
    expect(cell.width * GRID_COLUMNS).toBeCloseTo(pf.width);
    expect(cell.height * LANE_COUNT).toBeCloseTo(pf.height);
  });
});

describe('rulerTicks', () => {
  it('marks 10 at the far zone and G at the capture line', () => {
    const ticks = rulerTicks(GRID_COLUMNS);
    expect(ticks.map((t) => t.label)).toEqual(['10', '3', '2', '1', 'G']);
    expect(ticks[0].column).toBe(0);
    expect(ticks[ticks.length - 1].column).toBe(GRID_COLUMNS - 1);
  });

  it('keeps tick columns strictly increasing', () => {
    const cols = rulerTicks(GRID_COLUMNS).map((t) => t.column);
    for (let i = 1; i < cols.length; i += 1) {
      expect(cols[i]).toBeGreaterThan(cols[i - 1]);
    }
  });
});

describe('splitScoreDigits', () => {
  it('splits a multi-digit score with no leading zeros', () => {
    expect(splitScoreDigits(142)).toEqual([1, 4, 2]);
    expect(splitScoreDigits(7)).toEqual([7]);
    expect(splitScoreDigits(40)).toEqual([4, 0]);
  });

  it('renders zero as a single digit', () => {
    expect(splitScoreDigits(0)).toEqual([0]);
  });

  it('caps at the win score', () => {
    expect(splitScoreDigits(WIN_SCORE)).toEqual([1, 9, 9]);
    expect(splitScoreDigits(1000)).toEqual([1, 9, 9]);
  });

  it('clamps and floors negatives and fractions', () => {
    expect(splitScoreDigits(-5)).toEqual([0]);
    expect(splitScoreDigits(12.9)).toEqual([1, 2]);
  });
});
