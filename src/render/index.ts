// Public surface of the VFD screen renderer (PRD R3).
// The rest of the app builds a renderer with createRenderer() and calls the
// returned function once per animation frame with the current GameState. The
// layout math and sprite tables are exported for reuse and testing.

export type { RenderConfig } from './renderer.js';
export { createRenderer } from './renderer.js';

export type { Rect, RulerTick } from './layout.js';
export {
  cellExtent,
  columnToX,
  computePlayfield,
  laneToY,
  PLAYFIELD_FRACTION,
  rulerTicks,
  splitScoreDigits,
} from './layout.js';

export type { Point, SegmentKey } from './sprites.js';
export {
  DIGIT_SEGMENTS,
  GLOW,
  JET_SHAPE,
  PALETTE,
  SEGMENT_KEYS,
  segmentsForDigit,
} from './sprites.js';
