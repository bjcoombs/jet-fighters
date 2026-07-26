import { describe, expect, it } from 'vitest';

import { loadAtlas } from './atlas.js';
import { arcToEllipse, parsePath, parsePathCached, tracePath, type PathSink } from './path.js';

/** Records every call a traced path makes, so no canvas is needed. */
function recordingSink(): PathSink & { calls: string[] } {
  const calls: string[] = [];
  const round = (n: number): number => Number(n.toFixed(4));
  return {
    calls,
    moveTo: (x, y) => calls.push(`moveTo(${round(x)},${round(y)})`),
    lineTo: (x, y) => calls.push(`lineTo(${round(x)},${round(y)})`),
    bezierCurveTo: (...args) => calls.push(`bezierCurveTo(${args.map(round).join(',')})`),
    quadraticCurveTo: (...args) => calls.push(`quadraticCurveTo(${args.map(round).join(',')})`),
    ellipse: (...args) => calls.push(`ellipse(${args.slice(0, 4).map(Number).map(round).join(',')})`),
    closePath: () => calls.push('closePath()'),
  };
}

describe('parsePath', () => {
  it('parses absolute move and line', () => {
    expect(parsePath('M 10,20 L 30,40')).toEqual([
      { type: 'move', x: 10, y: 20 },
      { type: 'line', x: 30, y: 40 },
    ]);
  });

  it('parses relative move and line against the current point', () => {
    expect(parsePath('m 10,20 l 5,-5')).toEqual([
      { type: 'move', x: 10, y: 20 },
      { type: 'line', x: 15, y: 15 },
    ]);
  });

  it('treats a repeated moveto coordinate pair as a lineto', () => {
    expect(parsePath('M 0,0 1,1 2,2')).toEqual([
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 1, y: 1 },
      { type: 'line', x: 2, y: 2 },
    ]);
  });

  it('repeats an implicit command for further coordinate sets', () => {
    expect(parsePath('M 0,0 L 1,1 2,2')).toEqual([
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 1, y: 1 },
      { type: 'line', x: 2, y: 2 },
    ]);
  });

  it('parses horizontal and vertical lines, holding the other axis', () => {
    expect(parsePath('M 5,5 H 20 V 30 h -5 v -10')).toEqual([
      { type: 'move', x: 5, y: 5 },
      { type: 'line', x: 20, y: 5 },
      { type: 'line', x: 20, y: 30 },
      { type: 'line', x: 15, y: 30 },
      { type: 'line', x: 15, y: 20 },
    ]);
  });

  it('returns the current point to the subpath start after a close', () => {
    expect(parsePath('M 10,10 L 20,20 Z l 5,0')).toEqual([
      { type: 'move', x: 10, y: 10 },
      { type: 'line', x: 20, y: 20 },
      { type: 'close' },
      { type: 'line', x: 15, y: 10 },
    ]);
  });

  it('parses multiple subpaths - the SCORE label is 22 of them', () => {
    const commands = parsePath('M 0,0 H 2 V 2 Z M 5,5 H 7 V 7 Z');
    expect(commands.filter((c) => c.type === 'move')).toHaveLength(2);
    expect(commands.filter((c) => c.type === 'close')).toHaveLength(2);
  });

  it('parses cubic and quadratic curves in both forms', () => {
    expect(parsePath('M 0,0 C 1,2 3,4 5,6')).toContainEqual({
      type: 'cubic',
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
      x: 5,
      y: 6,
    });
    expect(parsePath('M 10,10 q 1,2 3,4')).toContainEqual({
      type: 'quad',
      x1: 11,
      y1: 12,
      x: 13,
      y: 14,
    });
  });

  it('accepts exponent, leading-dot, and sign-separated numbers', () => {
    expect(parsePath('M .5,-.5 L 1e1,2E1')).toEqual([
      { type: 'move', x: 0.5, y: -0.5 },
      { type: 'line', x: 10, y: 20 },
    ]);
  });

  it('rejects an unsupported command rather than dropping it silently', () => {
    expect(() => parsePath('M 0,0 T 5,5')).toThrow(SyntaxError);
  });

  it('rejects path data that does not start with a command', () => {
    expect(() => parsePath('10,10 L 20,20')).toThrow(SyntaxError);
  });

  it('rejects a truncated command', () => {
    expect(() => parsePath('M 10')).toThrow(SyntaxError);
  });

  it('rejects a malformed arc flag', () => {
    expect(() => parsePath('M 0,0 a 3,3 0 5,0 6,0')).toThrow(SyntaxError);
  });
});

describe('arcToEllipse', () => {
  it('converts a half-circle arc to its centre parameterisation', () => {
    // The atlas draws round dots as two half-circle relative arcs.
    const arc = arcToEllipse(0, 0, 3, 3, 0, true, false, 6, 0);
    expect(arc.type).toBe('ellipse');
    if (arc.type !== 'ellipse') return;
    expect(arc.cx).toBeCloseTo(3, 6);
    expect(arc.cy).toBeCloseTo(0, 6);
    expect(arc.rx).toBeCloseTo(3, 6);
    expect(arc.ry).toBeCloseTo(3, 6);
    expect(Math.abs(arc.endAngle - arc.startAngle)).toBeCloseTo(Math.PI, 6);
    expect(arc.counterclockwise).toBe(true);
  });

  it('sweeps the other way when the sweep flag is set', () => {
    const arc = arcToEllipse(0, 0, 3, 3, 0, true, true, 6, 0);
    if (arc.type !== 'ellipse') throw new Error('expected an ellipse');
    expect(arc.counterclockwise).toBe(false);
    expect(arc.endAngle - arc.startAngle).toBeCloseTo(Math.PI, 6);
  });

  it('scales radii up when they are too small to span the endpoints', () => {
    const arc = arcToEllipse(0, 0, 1, 1, 0, false, true, 10, 0);
    if (arc.type !== 'ellipse') throw new Error('expected an ellipse');
    expect(arc.rx).toBeCloseTo(5, 6);
    expect(arc.ry).toBeCloseTo(5, 6);
  });

  it('degenerates to a straight line for a zero radius or coincident endpoints', () => {
    expect(arcToEllipse(0, 0, 0, 3, 0, false, false, 4, 4)).toEqual({ type: 'line', x: 4, y: 4 });
    expect(arcToEllipse(2, 2, 3, 3, 0, false, false, 2, 2)).toEqual({ type: 'line', x: 2, y: 2 });
  });
});

describe('tracePath', () => {
  it('issues one sink call per command, in order', () => {
    const sink = recordingSink();
    tracePath(sink, parsePath('M 0,0 L 10,0 Z'));
    expect(sink.calls).toEqual(['moveTo(0,0)', 'lineTo(10,0)', 'closePath()']);
  });

  it('traces a round dot as two elliptical arcs about one centre', () => {
    const sink = recordingSink();
    tracePath(sink, parsePath('M 119.03,118 a 4.032,4.032 0 1,0 8.064,0 a 4.032,4.032 0 1,0 -8.064,0 Z'));
    // Out along the top half and back along the bottom half of one circle, so
    // both arcs share a centre - the dot's centre, 4.032 right of the start.
    expect(sink.calls).toEqual([
      'moveTo(119.03,118)',
      'ellipse(123.062,118,4.032,4.032)',
      'ellipse(123.062,118,4.032,4.032)',
      'closePath()',
    ]);
  });
});

describe('parsePathCached', () => {
  it('returns the identical command list for a repeated path string', () => {
    const first = parsePathCached('M 1,1 L 2,2 Z');
    const second = parsePathCached('M 1,1 L 2,2 Z');
    expect(second).toBe(first);
  });
});

describe('the shipped atlas', () => {
  it('parses every segment path without error', () => {
    for (const segment of loadAtlas().segments) {
      expect(() => parsePath(segment.path), segment.id).not.toThrow();
      expect(parsePath(segment.path).length, segment.id).toBeGreaterThan(0);
    }
  });

  it('traces every segment inside its declared bounds', () => {
    // Each segment's `bounds` is the axis-aligned box of its path, and consumers
    // (the ghost layer's glow radius, the renderer's culling) trust it without
    // re-parsing. A path that escapes its box would draw outside the tube.
    for (const segment of loadAtlas().segments) {
      const commands = parsePath(segment.path);
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const include = (x: number, y: number): void => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      };
      for (const command of commands) {
        switch (command.type) {
          case 'move':
          case 'line':
            include(command.x, command.y);
            break;
          case 'ellipse':
            include(command.cx - command.rx, command.cy - command.ry);
            include(command.cx + command.rx, command.cy + command.ry);
            break;
          default:
            break;
        }
      }
      const b = segment.bounds;
      // atlas.json carries coordinates rounded to 3 dp, so a box edge can sit a
      // rounding step inside the path point that produced it.
      const epsilon = 5e-3;
      expect(minX, segment.id).toBeGreaterThanOrEqual(b.x - epsilon);
      expect(minY, segment.id).toBeGreaterThanOrEqual(b.y - epsilon);
      expect(maxX, segment.id).toBeLessThanOrEqual(b.x + b.width + epsilon);
      expect(maxY, segment.id).toBeLessThanOrEqual(b.y + b.height + epsilon);
    }
  });
});
