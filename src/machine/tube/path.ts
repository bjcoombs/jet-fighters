// SVG path data -> canvas drawing commands.
//
// Segment outlines in atlas.json are SVG `path` strings (M, L, H, V, A, Z; the
// round rocket and missile dots are relative arc pairs). The browser's `Path2D`
// would parse them, but it does not exist in Node, and the acceptance contract
// drives this layer headlessly - so the parse happens here instead, once, and
// the same code path runs in the browser and under Vitest.
//
// Parsing is pure: string in, command list out. Arcs are converted to centre
// parameterisation at parse time (SVG spec F.6.5), so the drawing side is a flat
// switch with no geometry in it. Coordinates stay in atlas units; the renderer
// applies the atlas -> canvas transform to the context, not to the points.

/** A parsed path command, in atlas units. Arcs are centre-parameterised. */
export type PathCommand =
  | { readonly type: 'move'; readonly x: number; readonly y: number }
  | { readonly type: 'line'; readonly x: number; readonly y: number }
  | {
      readonly type: 'cubic';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'quad';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly rotation: number;
      readonly startAngle: number;
      readonly endAngle: number;
      readonly counterclockwise: boolean;
    }
  | { readonly type: 'close' };

/**
 * The subset of `CanvasRenderingContext2D` a traced path needs.
 *
 * Declared structurally so tests can record calls without a canvas, and so this
 * module has no DOM dependency of its own.
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const WHITESPACE = /^[\s,]+/;

/** Cursor over a path string, reading numbers, flags, and command letters. */
class Scanner {
  private index = 0;

  constructor(private readonly source: string) {}

  skipSeparators(): void {
    const rest = this.source.slice(this.index);
    const match = WHITESPACE.exec(rest);
    if (match) {
      this.index += match[0].length;
    }
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.index >= this.source.length;
  }

  /** The next character if it is a command letter, else undefined. */
  peekCommand(): string | undefined {
    this.skipSeparators();
    const char = this.source[this.index];
    return char !== undefined && /[A-Za-z]/.test(char) ? char : undefined;
  }

  takeCommand(): string {
    const char = this.peekCommand();
    if (char === undefined) {
      throw new SyntaxError(`expected a path command at offset ${this.index} in '${this.source}'`);
    }
    this.index += 1;
    return char;
  }

  /** True while the next token is a number - i.e. the command repeats. */
  hasNumber(): boolean {
    this.skipSeparators();
    return NUMBER.test(this.source.slice(this.index));
  }

  number(): number {
    this.skipSeparators();
    const match = NUMBER.exec(this.source.slice(this.index));
    if (!match) {
      throw new SyntaxError(`expected a number at offset ${this.index} in '${this.source}'`);
    }
    this.index += match[0].length;
    return Number(match[0]);
  }

  /**
   * An arc's large-arc / sweep flag. SVG allows these to run together with the
   * following coordinate ("a1 1 0 0110 10"), so they are read one character at a
   * time rather than as numbers.
   */
  flag(): boolean {
    this.skipSeparators();
    const char = this.source[this.index];
    if (char !== '0' && char !== '1') {
      throw new SyntaxError(`expected an arc flag (0 or 1) at offset ${this.index} in '${this.source}'`);
    }
    this.index += 1;
    return char === '1';
  }
}

/** Angle from `(ux, uy)` to `(vx, vy)`, signed, per SVG spec F.6.5.4. */
function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (lengths === 0) {
    return 0;
  }
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(Math.min(1, Math.max(-1, dot / lengths)));
}

/**
 * Convert an SVG endpoint-parameterised arc to the centre parameterisation
 * `ctx.ellipse` wants (SVG spec F.6.5). Returns a straight line command for the
 * degenerate cases the spec calls out: zero radius, or coincident endpoints.
 */
export function arcToEllipse(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathCommand {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return { type: 'line', x: x2, y: y2 };
  }

  let radiusX = Math.abs(rx);
  let radiusY = Math.abs(ry);
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Scale the radii up if they are too small to span the endpoints (F.6.6).
  const lambda = (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    radiusX *= scale;
    radiusY *= scale;
  }

  const numerator =
    radiusX * radiusX * radiusY * radiusY -
    radiusX * radiusX * y1p * y1p -
    radiusY * radiusY * x1p * x1p;
  const denominator = radiusX * radiusX * y1p * y1p + radiusY * radiusY * x1p * x1p;
  const factor = Math.sqrt(Math.max(0, numerator / denominator)) * (largeArc === sweep ? -1 : 1);

  const cxp = (factor * (radiusX * y1p)) / radiusY;
  const cyp = (-factor * (radiusY * x1p)) / radiusX;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const ux = (x1p - cxp) / radiusX;
  const uy = (y1p - cyp) / radiusY;
  const vx = (-x1p - cxp) / radiusX;
  const vy = (-y1p - cyp) / radiusY;

  const startAngle = angleBetween(1, 0, ux, uy);
  let sweepAngle = angleBetween(ux, uy, vx, vy);
  if (!sweep && sweepAngle > 0) {
    sweepAngle -= 2 * Math.PI;
  } else if (sweep && sweepAngle < 0) {
    sweepAngle += 2 * Math.PI;
  }

  return {
    type: 'ellipse',
    cx,
    cy,
    rx: radiusX,
    ry: radiusY,
    rotation: phi,
    startAngle,
    endAngle: startAngle + sweepAngle,
    counterclockwise: sweepAngle < 0,
  };
}

/**
 * Parse SVG path data into drawing commands.
 *
 * Supports the commands the atlas uses (M, L, H, V, A, Z) plus C and Q, in both
 * absolute and relative form. Anything else throws: a path the renderer cannot
 * draw exactly is an atlas defect, and silently dropping it would leave a
 * segment invisible on the tube with nothing to show for it.
 */
export function parsePath(d: string): readonly PathCommand[] {
  const scanner = new Scanner(d);
  const commands: PathCommand[] = [];

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let previous = '';

  while (!scanner.atEnd()) {
    // A repeated coordinate set continues the previous command; an implicit
    // repeat of M is a lineto, per the SVG grammar.
    let command: string;
    if (scanner.peekCommand() !== undefined) {
      command = scanner.takeCommand();
    } else if (previous === '') {
      throw new SyntaxError(`path data must start with a command: '${d}'`);
    } else {
      command = previous === 'M' ? 'L' : previous === 'm' ? 'l' : previous;
    }
    previous = command;

    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case 'M': {
        const nx = scanner.number();
        const ny = scanner.number();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        startX = x;
        startY = y;
        commands.push({ type: 'move', x, y });
        break;
      }
      case 'L': {
        const nx = scanner.number();
        const ny = scanner.number();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        commands.push({ type: 'line', x, y });
        break;
      }
      case 'H': {
        const nx = scanner.number();
        x = relative ? x + nx : nx;
        commands.push({ type: 'line', x, y });
        break;
      }
      case 'V': {
        const ny = scanner.number();
        y = relative ? y + ny : ny;
        commands.push({ type: 'line', x, y });
        break;
      }
      case 'C': {
        const x1 = scanner.number();
        const y1 = scanner.number();
        const x2 = scanner.number();
        const y2 = scanner.number();
        const nx = scanner.number();
        const ny = scanner.number();
        commands.push({
          type: 'cubic',
          x1: relative ? x + x1 : x1,
          y1: relative ? y + y1 : y1,
          x2: relative ? x + x2 : x2,
          y2: relative ? y + y2 : y2,
          x: relative ? x + nx : nx,
          y: relative ? y + ny : ny,
        });
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        break;
      }
      case 'Q': {
        const x1 = scanner.number();
        const y1 = scanner.number();
        const nx = scanner.number();
        const ny = scanner.number();
        commands.push({
          type: 'quad',
          x1: relative ? x + x1 : x1,
          y1: relative ? y + y1 : y1,
          x: relative ? x + nx : nx,
          y: relative ? y + ny : ny,
        });
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        break;
      }
      case 'A': {
        const rx = scanner.number();
        const ry = scanner.number();
        const rotation = scanner.number();
        const largeArc = scanner.flag();
        const sweep = scanner.flag();
        const nx = scanner.number();
        const ny = scanner.number();
        const endX = relative ? x + nx : nx;
        const endY = relative ? y + ny : ny;
        commands.push(arcToEllipse(x, y, rx, ry, rotation, largeArc, sweep, endX, endY));
        x = endX;
        y = endY;
        break;
      }
      case 'Z': {
        commands.push({ type: 'close' });
        x = startX;
        y = startY;
        break;
      }
      default:
        throw new SyntaxError(`unsupported SVG path command '${command}' in '${d}'`);
    }

    // Z takes no parameters, so it can never repeat implicitly.
    if (command.toUpperCase() === 'Z') {
      previous = '';
    }
  }

  return commands;
}

/**
 * Issue a parsed path to a canvas context (or any {@link PathSink}).
 *
 * Does not call `beginPath` or paint: the caller decides whether several
 * segments share one path and whether the result is filled or stroked.
 */
export function tracePath(sink: PathSink, commands: readonly PathCommand[]): void {
  for (const command of commands) {
    switch (command.type) {
      case 'move':
        sink.moveTo(command.x, command.y);
        break;
      case 'line':
        sink.lineTo(command.x, command.y);
        break;
      case 'cubic':
        sink.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
        break;
      case 'quad':
        sink.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
        break;
      case 'ellipse':
        sink.ellipse(
          command.cx,
          command.cy,
          command.rx,
          command.ry,
          command.rotation,
          command.startAngle,
          command.endAngle,
          command.counterclockwise,
        );
        break;
      case 'close':
        sink.closePath();
        break;
    }
  }
}

const cache = new Map<string, readonly PathCommand[]>();

/**
 * {@link parsePath}, memoised by path string.
 *
 * The renderer traces all 71 segments twice per frame (ghost layer and active
 * layer); re-parsing the same strings 142 times a frame would be the one
 * genuinely hot allocation in the draw loop. The atlas is static data, so the
 * cache is unbounded by construction.
 */
export function parsePathCached(d: string): readonly PathCommand[] {
  const hit = cache.get(d);
  if (hit) {
    return hit;
  }
  const parsed = parsePath(d);
  cache.set(d, parsed);
  return parsed;
}
