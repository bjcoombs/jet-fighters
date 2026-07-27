// A recording stand-in for `CanvasRenderingContext2D`, used by the tube tests.
//
// The rest of src/machine/ is Node-importable and the acceptance contract drives
// it headlessly; the drawing layer is the one part that needs a 2D context, and
// Vitest runs in the node environment with no canvas in it. Rather than pull in
// a DOM shim, the tests hand the renderer this: it records every call along with
// the paint state in force at the time, so a test can assert what was drawn, in
// what order, and in what colour.
//
// Test support only - nothing in the render path imports it.

/** One recorded context call, with the paint state in force when it happened. */
export interface RecordedCall {
  readonly op: string;
  readonly args: readonly number[];
  readonly text?: string;
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly globalAlpha: number;
  readonly shadowColor: string;
  readonly shadowBlur: number;
}

/**
 * What a recorded `createPattern` hands back.
 *
 * The renderer only ever assigns a pattern to `fillStyle` and never inspects it,
 * so a marker is enough to prove one was made and from what.
 */
export interface FakePattern {
  readonly kind: 'pattern';
  readonly repetition: string | null;
}

interface PaintState {
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineCap: string;
  lineJoin: string;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
}

function initialState(): PaintState {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowBlur: 0,
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  };
}

/**
 * A recording 2D context. Assign styles and call drawing methods exactly as on a
 * real context; `calls` accumulates what happened.
 */
export class FakeCanvasContext {
  readonly calls: RecordedCall[] = [];

  private state: PaintState = initialState();
  private readonly stack: PaintState[] = [];

  // --- paint state -----------------------------------------------------------

  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(value: string) {
    this.state.fillStyle = value;
  }

  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: string) {
    this.state.strokeStyle = value;
  }

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    this.state.globalAlpha = value;
  }

  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(value: string) {
    this.state.shadowColor = value;
  }

  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(value: number) {
    this.state.shadowBlur = value;
  }

  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }

  get font(): string {
    return this.state.font;
  }
  set font(value: string) {
    this.state.font = value;
  }

  get textAlign(): string {
    return this.state.textAlign;
  }
  set textAlign(value: string) {
    this.state.textAlign = value;
  }

  get textBaseline(): string {
    return this.state.textBaseline;
  }
  set textBaseline(value: string) {
    this.state.textBaseline = value;
  }

  get lineCap(): string {
    return this.state.lineCap;
  }
  set lineCap(value: string) {
    this.state.lineCap = value;
  }

  get lineJoin(): string {
    return this.state.lineJoin;
  }
  set lineJoin(value: string) {
    this.state.lineJoin = value;
  }

  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(value: string) {
    this.state.globalCompositeOperation = value;
  }

  get imageSmoothingEnabled(): boolean {
    return this.state.imageSmoothingEnabled;
  }
  set imageSmoothingEnabled(value: boolean) {
    this.state.imageSmoothingEnabled = value;
  }

  get imageSmoothingQuality(): string {
    return this.state.imageSmoothingQuality;
  }
  set imageSmoothingQuality(value: string) {
    this.state.imageSmoothingQuality = value;
  }

  // --- drawing ---------------------------------------------------------------

  /**
   * A marker standing in for a `CanvasPattern`. Recorded so a test can prove one
   * was made; the renderer only ever assigns it to `fillStyle`.
   */
  createPattern(_image: unknown, repetition: string | null): FakePattern {
    this.record('createPattern', []);
    return { kind: 'pattern', repetition };
  }

  /** `drawImage`, in either of the argument shapes the renderer uses. */
  drawImage(_image: unknown, ...rest: number[]): void {
    this.record('drawImage', rest);
  }

  save(): void {
    this.record('save', []);
    this.stack.push({ ...this.state });
  }

  restore(): void {
    this.record('restore', []);
    const previous = this.stack.pop();
    if (previous) {
      this.state = previous;
    }
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.record('setTransform', [a, b, c, d, e, f]);
  }

  translate(x: number, y: number): void {
    this.record('translate', [x, y]);
  }

  scale(x: number, y: number): void {
    this.record('scale', [x, y]);
  }

  rotate(angle: number): void {
    this.record('rotate', [angle]);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.record('clearRect', [x, y, w, h]);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', [x, y, w, h]);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.record('strokeRect', [x, y, w, h]);
  }

  beginPath(): void {
    this.record('beginPath', []);
  }

  closePath(): void {
    this.record('closePath', []);
  }

  moveTo(x: number, y: number): void {
    this.record('moveTo', [x, y]);
  }

  lineTo(x: number, y: number): void {
    this.record('lineTo', [x, y]);
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.record('bezierCurveTo', [x1, y1, x2, y2, x, y]);
  }

  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    this.record('quadraticCurveTo', [x1, y1, x, y]);
  }

  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.record('arc', [x, y, r, start, end]);
  }

  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void {
    this.record('ellipse', [x, y, rx, ry, rotation, start, end]);
  }

  fill(): void {
    this.record('fill', []);
  }

  stroke(): void {
    this.record('stroke', []);
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push({ ...this.snapshot(), op: 'fillText', args: [x, y], text });
  }

  private record(op: string, args: readonly number[]): void {
    this.calls.push({ ...this.snapshot(), op, args });
  }

  private snapshot(): Omit<RecordedCall, 'op' | 'args'> {
    return {
      fillStyle: this.state.fillStyle,
      strokeStyle: this.state.strokeStyle,
      globalAlpha: this.state.globalAlpha,
      shadowColor: this.state.shadowColor,
      shadowBlur: this.state.shadowBlur,
    };
  }
}

/** A recording context typed as a real one, plus the recorder itself. */
export function createFakeContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly recorder: FakeCanvasContext;
} {
  const recorder = new FakeCanvasContext();
  return { ctx: recorder as unknown as CanvasRenderingContext2D, recorder };
}

/** A canvas whose `getContext('2d')` hands back a recording context. */
export function createFakeCanvas(cssWidth = 726, cssHeight = 600): {
  readonly canvas: HTMLCanvasElement;
  readonly recorder: FakeCanvasContext;
} {
  const { ctx, recorder } = createFakeContext();
  const canvas = {
    width: cssWidth,
    height: cssHeight,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
    getBoundingClientRect: () => ({ width: cssWidth, height: cssHeight }),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, recorder };
}

/** Every call of one kind, in order. */
export function callsOf(recorder: FakeCanvasContext, op: string): readonly RecordedCall[] {
  return recorder.calls.filter((call) => call.op === op);
}

/** Every distinct fill colour used, in first-use order. */
export function fillColorsUsed(recorder: FakeCanvasContext): readonly string[] {
  const seen: string[] = [];
  for (const call of recorder.calls) {
    const isFill = call.op === 'fill' || call.op === 'fillRect' || call.op === 'fillText';
    if (isFill && typeof call.fillStyle === 'string' && !seen.includes(call.fillStyle)) {
      seen.push(call.fillStyle);
    }
  }
  return seen;
}
