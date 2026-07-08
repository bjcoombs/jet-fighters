import { describe, expect, it } from 'vitest';
import {
  CASE_VIEWBOX,
  clipPathMarkup,
  projectScope,
  SCOPE_ASPECT,
  SCOPE_BOUNDS,
  SCOPE_CIRCLE,
  SCOPE_RECT,
  scopeWindowMarkup,
  screenBoxPercent,
} from './geometry.js';

describe('SCOPE_BOUNDS', () => {
  it('is the union bounding box of the circle and the left rectangle', () => {
    expect(SCOPE_BOUNDS.x).toBe(Math.min(SCOPE_RECT.x, SCOPE_CIRCLE.cx - SCOPE_CIRCLE.r));
    expect(SCOPE_BOUNDS.y).toBe(Math.min(SCOPE_RECT.y, SCOPE_CIRCLE.cy - SCOPE_CIRCLE.r));
    expect(SCOPE_BOUNDS.x + SCOPE_BOUNDS.width).toBe(
      Math.max(SCOPE_RECT.x + SCOPE_RECT.width, SCOPE_CIRCLE.cx + SCOPE_CIRCLE.r),
    );
    expect(SCOPE_BOUNDS.y + SCOPE_BOUNDS.height).toBe(
      Math.max(SCOPE_RECT.y + SCOPE_RECT.height, SCOPE_CIRCLE.cy + SCOPE_CIRCLE.r),
    );
  });

  it('exposes the matching aspect ratio', () => {
    expect(SCOPE_ASPECT).toBeCloseTo(SCOPE_BOUNDS.width / SCOPE_BOUNDS.height);
  });
});

describe('projectScope', () => {
  it('uses a single uniform scale so the circle stays round', () => {
    const g = projectScope(SCOPE_ASPECT * 300, 300);
    // Distances scale by the same factor in x and y.
    expect(g.circle.r / SCOPE_CIRCLE.r).toBeCloseTo(g.scale);
    expect(g.rect.width / SCOPE_RECT.width).toBeCloseTo(g.scale);
    expect(g.bounds.width).toBeCloseTo(SCOPE_ASPECT * 300);
    expect(g.bounds.height).toBeCloseTo(300);
  });

  it('anchors the bounding box at the origin', () => {
    const g = projectScope(400, 400);
    expect(g.bounds.x).toBe(0);
    expect(g.bounds.y).toBe(0);
  });

  it('keeps the circle right edge flush with the bounds right edge', () => {
    // The circle's right extreme defines the bounding-box right edge.
    const g = projectScope(SCOPE_ASPECT * 300, 300);
    expect(g.circle.cx + g.circle.r).toBeCloseTo(g.bounds.width);
  });
});

describe('screenBoxPercent', () => {
  it('places the .jf-screen box at the bounds fraction of the case', () => {
    const box = screenBoxPercent();
    expect(parseFloat(box.left)).toBeCloseTo((SCOPE_BOUNDS.x / CASE_VIEWBOX.width) * 100, 3);
    expect(parseFloat(box.top)).toBeCloseTo((SCOPE_BOUNDS.y / CASE_VIEWBOX.height) * 100, 3);
    expect(parseFloat(box.width)).toBeCloseTo((SCOPE_BOUNDS.width / CASE_VIEWBOX.width) * 100, 3);
    expect(parseFloat(box.height)).toBeCloseTo((SCOPE_BOUNDS.height / CASE_VIEWBOX.height) * 100, 3);
    expect(box.left.endsWith('%')).toBe(true);
  });
});

describe('clipPathMarkup', () => {
  it('emits a rect + ellipse union derived from the same geometry', () => {
    const svg = clipPathMarkup('test-clip');
    expect(svg).toContain('id="test-clip"');
    expect(svg).toContain('clipPathUnits="objectBoundingBox"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<ellipse');
    // Ellipse centre-x = circle centre expressed as a fraction of the box width.
    const ecx = (SCOPE_CIRCLE.cx - SCOPE_BOUNDS.x) / SCOPE_BOUNDS.width;
    expect(svg).toContain(`cx="${Number(ecx.toFixed(4))}"`);
  });
});

describe('scopeWindowMarkup', () => {
  it('draws the black window circle and rectangle at the master coordinates', () => {
    const svg = scopeWindowMarkup();
    expect(svg).toContain(`cx="${SCOPE_CIRCLE.cx}"`);
    expect(svg).toContain(`cy="${SCOPE_CIRCLE.cy}"`);
    expect(svg).toContain(`r="${SCOPE_CIRCLE.r}"`);
    expect(svg).toContain('fill="#050505"');
  });

  it('grows the rim outside the black window', () => {
    const grow = 8;
    const svg = scopeWindowMarkup(grow);
    expect(svg).toContain(`r="${SCOPE_CIRCLE.r + grow}"`);
  });
});
