// VFD screen renderer (PRD R3). A pure projection of GameState onto a canvas:
// no game logic, no timers, no input. createRenderer() returns a draw function
// that paints one frame per call, layering back-to-front:
//   1. black scope background
//   2. ghost phosphor (every unlit VFD cell, faint)
//   3. active elements from state (amber attackers, cyan defender)
//   4. cyan SCORE readout and remaining-launcher indicators
//   5. white silkscreen overlay (painted on the glass - shown even when OFF)
//   6. glow on lit elements (applied via shadowBlur while drawing 3-4)

import type { GameState, Lane } from '../game/index.js';
import { BATTLESHIP_SCORE, LANE_COUNT, MAX_LIVES } from '../game/index.js';
import type { Rect } from './layout.js';
import {
  cellExtent,
  columnToX,
  computePlayfield,
  laneToY,
  rulerTicks,
  splitScoreDigits,
} from './layout.js';
import {
  drawBattleship,
  drawExplosion,
  drawJet,
  drawLauncher,
  drawLifeDart,
  drawMissile,
  drawRocket,
  drawSevenSegment,
  GLOW,
  PALETTE,
} from './sprites.js';

export interface RenderConfig {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

/** How many render frames an explosion burst persists after a hit. */
const EXPLOSION_FRAMES = 6;

interface Burst {
  readonly cx: number;
  readonly cy: number;
  framesLeft: number;
}

/** True while the VFD is powered - VFD layers render, OFF shows only silkscreen. */
function isPowered(phase: GameState['phase']): boolean {
  return phase !== 'OFF';
}

function withGlow(
  ctx: CanvasRenderingContext2D,
  color: string,
  blur: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

/**
 * Render-side transition detector: compares the previous and current states to
 * find where a hit just landed (a jet died, or the battleship vanished on a
 * score bump). This is presentation only - the game logic owns all rules; there
 * is no explosion field in GameState to read, so bursts are derived from state
 * deltas as the task specifies.
 */
function detectHits(prev: GameState | null, curr: GameState, playfield: Rect): Burst[] {
  if (!prev) return [];
  const bursts: Burst[] = [];
  const scoreRose = curr.score > prev.score;

  const a = prev.squadron;
  const b = curr.squadron;
  if (a.waveNumber === b.waveNumber && a.jets.length === b.jets.length) {
    for (let i = 0; i < b.jets.length; i += 1) {
      if (a.jets[i].alive && !b.jets[i].alive) {
        bursts.push({
          cx: columnToX(b.jets[i].column, curr.gridColumns, playfield),
          cy: laneToY(b.jets[i].lane, LANE_COUNT, playfield),
          framesLeft: EXPLOSION_FRAMES,
        });
      }
    }
  }

  if (prev.battleship.visible && !curr.battleship.visible && scoreRose) {
    // Only when the score jumped by the battleship's value - a crossing that
    // simply timed out (no points) must not spark an explosion.
    if (curr.score - prev.score >= BATTLESHIP_SCORE) {
      bursts.push({
        cx: columnToX(0, curr.gridColumns, playfield),
        cy: laneToY(prev.battleship.lane, LANE_COUNT, playfield),
        framesLeft: EXPLOSION_FRAMES,
      });
    }
  }

  return bursts;
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, w, h);
}

function drawGhostLayer(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playfield: Rect,
  cell: { width: number; height: number },
): void {
  const jetSize = Math.min(cell.width, cell.height) * 0.7;
  // A faint jet at every lane/column cell - the unlit phosphor grid.
  for (let lane = 0 as Lane; lane < LANE_COUNT; lane += 1) {
    const cy = laneToY(lane, LANE_COUNT, playfield);
    for (let col = 0; col < state.gridColumns; col += 1) {
      const cx = columnToX(col, state.gridColumns, playfield);
      drawJet(ctx, cx, cy, jetSize, PALETTE.ghost);
    }
  }
  // Ghost of the SCORE readout (all segments) and the life darts.
  drawScoreReadout(ctx, state, playfield, cell, true);
  drawLives(ctx, state, playfield, cell, true);
}

function drawActiveElements(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  bursts: readonly Burst[],
  playfield: Rect,
  cell: { width: number; height: number },
): void {
  const jetSize = Math.min(cell.width, cell.height) * 0.7;
  const amberBlur = jetSize * GLOW.amber;
  const cyanBlur = jetSize * GLOW.cyan;

  // Battleship (amber) in the far-left zone.
  if (state.battleship.visible) {
    const cx = columnToX(0, state.gridColumns, playfield);
    const cy = laneToY(state.battleship.lane, LANE_COUNT, playfield);
    withGlow(ctx, PALETTE.amberGlow, amberBlur, () =>
      drawBattleship(ctx, cx, cy, cell.width * 1.5, cell.height * 0.7, PALETTE.amber),
    );
  }

  // Attacking jets (amber).
  withGlow(ctx, PALETTE.amberGlow, amberBlur, () => {
    for (const jet of state.squadron.jets) {
      if (!jet.alive) continue;
      const cx = columnToX(jet.column, state.gridColumns, playfield);
      const cy = laneToY(jet.lane, LANE_COUNT, playfield);
      drawJet(ctx, cx, cy, jetSize, PALETTE.amber);
    }
  });

  // Jet rockets travelling back down their lanes (amber).
  withGlow(ctx, PALETTE.amberGlow, amberBlur, () => {
    for (const rocket of state.rockets) {
      const cx = columnToX(rocket.column, state.gridColumns, playfield);
      const cy = laneToY(rocket.lane, LANE_COUNT, playfield);
      drawRocket(ctx, cx, cy, jetSize * 0.18, PALETTE.amber);
    }
  });

  // Player missile (cyan two-dot trail); trail points toward the launcher (right).
  if (state.missile) {
    const headX = columnToX(state.missile.column, state.gridColumns, playfield);
    const cy = laneToY(state.missile.lane, LANE_COUNT, playfield);
    withGlow(ctx, PALETTE.cyanGlow, cyanBlur, () =>
      drawMissile(ctx, headX, headX + cell.width * 0.4, cy, jetSize * 0.14, PALETTE.cyan),
    );
  }

  // Launcher (cyan) at the right edge in its lane.
  {
    const cx = columnToX(state.gridColumns - 1, state.gridColumns, playfield);
    const cy = laneToY(state.launcher.lane, LANE_COUNT, playfield);
    withGlow(ctx, PALETTE.cyanGlow, cyanBlur, () =>
      drawLauncher(ctx, cx, cy, cell.width * 0.7, cell.height * 0.8, PALETTE.cyan),
    );
  }

  // Explosion bursts (cyan) where hits landed.
  for (const burst of bursts) {
    const intensity = burst.framesLeft / EXPLOSION_FRAMES;
    withGlow(ctx, PALETTE.cyanGlow, cyanBlur, () =>
      drawExplosion(ctx, burst.cx, burst.cy, jetSize * 1.4, intensity, PALETTE.cyan),
    );
  }
}

/** Layout box for the SCORE label + digits, at the left of the playfield. */
function scoreLayout(playfield: Rect, cell: { width: number; height: number }) {
  const labelY = playfield.y + playfield.height * 0.24;
  const digitH = cell.height * 0.6;
  const digitW = digitH * 0.6;
  const gap = digitW * 0.3;
  const x = playfield.x + cell.width * 0.25;
  const digitsY = labelY + digitH * 0.35;
  return { x, labelY, digitsY, digitW, digitH, gap };
}

function drawScoreReadout(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playfield: Rect,
  cell: { width: number; height: number },
  ghost: boolean,
): void {
  const L = scoreLayout(playfield, cell);
  const color = ghost ? PALETTE.ghost : PALETTE.cyan;

  if (!ghost) {
    ctx.fillStyle = PALETTE.cyan;
    ctx.font = `${Math.round(L.digitH * 0.42)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SCORE', L.x, L.labelY);
  }

  // Always three digit cells so the ghost shows a full 8.8.8 phosphor block;
  // lit digits are right-aligned within them.
  const digits = ghost ? [null, null, null] : splitScoreDigits(state.score);
  const slots = 3;
  const litStart = slots - digits.length;
  const glow = ghost ? 0 : L.digitH * GLOW.cyan;
  for (let i = 0; i < slots; i += 1) {
    const dx = L.x + i * (L.digitW + L.gap);
    const digit = ghost
      ? 8 // ghost shows every segment lit faintly
      : i >= litStart
        ? digits[i - litStart]
        : null;
    const paint = () =>
      drawSevenSegment(ctx, dx, L.digitsY, L.digitW, L.digitH, digit, color, PALETTE.ghost);
    if (glow > 0 && digit !== null) withGlow(ctx, PALETTE.cyanGlow, glow, paint);
    else paint();
  }
}

function drawLives(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playfield: Rect,
  cell: { width: number; height: number },
  ghost: boolean,
): void {
  const w = cell.width * 0.45;
  const h = cell.height * 0.35;
  const x = playfield.x + playfield.width - w * 0.9;
  const spacing = h * 1.5;
  const first = laneToY(1, LANE_COUNT, playfield) - spacing;
  const glow = h * GLOW.cyan;
  for (let i = 0; i < MAX_LIVES; i += 1) {
    const cy = first + i * spacing;
    const remaining = i < state.launcher.lives;
    if (ghost) {
      drawLifeDart(ctx, x, cy, w, h, PALETTE.ghost, false);
    } else if (remaining) {
      withGlow(ctx, PALETTE.cyanGlow, glow, () =>
        drawLifeDart(ctx, x, cy, w, h, PALETTE.cyan, true),
      );
    } else {
      drawLifeDart(ctx, x, cy, w, h, PALETTE.ghost, false);
    }
  }
}

function drawDottedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  gap: number,
  radius: number,
): void {
  ctx.fillStyle = PALETTE.silkscreen;
  for (let x = x1; x <= x2; x += gap) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  fontPx: number,
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.silkscreen;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = (fontPx * 0.66) / radius; // angular advance per character
  const start = -Math.PI / 2 - (step * (text.length - 1)) / 2;
  for (let i = 0; i < text.length; i += 1) {
    const angle = start + i * step;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawSilkscreen(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  w: number,
  h: number,
  playfield: Rect,
  cell: { width: number; height: number },
): void {
  const line = Math.max(1, Math.min(w, h) * 0.003);
  ctx.strokeStyle = PALETTE.silkscreen;
  ctx.fillStyle = PALETTE.silkscreen;
  ctx.lineWidth = line;

  // Arc title across the top of the round scope.
  drawArcText(
    ctx,
    'COAST SIDE MISSILE STATION RADAR SIGHT SCREEN',
    w / 2,
    h * 0.52,
    h * 0.3,
    Math.round(h * 0.03),
  );

  // Playfield border.
  ctx.strokeRect(playfield.x, playfield.y, playfield.width, playfield.height);

  // Top ruler: dotted line + labels with L-brackets.
  const rulerY = playfield.y - cell.height * 0.12;
  drawDottedLine(
    ctx,
    playfield.x,
    playfield.x + playfield.width,
    playfield.y,
    cell.width * 0.14,
    line * 1.3,
  );
  const labelPx = Math.round(cell.height * 0.5);
  ctx.font = `bold ${labelPx}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const tick of rulerTicks(state.gridColumns)) {
    const x = columnToX(tick.column, state.gridColumns, playfield);
    ctx.fillText(tick.label, x, rulerY);
    // L-bracket dropping to the top border.
    const bx = x + labelPx * 0.7;
    ctx.beginPath();
    ctx.moveTo(bx, rulerY - labelPx * 0.7);
    ctx.lineTo(bx, playfield.y);
    ctx.stroke();
  }

  // Side edge ticks (lane separators along the border).
  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const y = playfield.y + (lane / LANE_COUNT) * playfield.height;
    ctx.beginPath();
    ctx.moveTo(playfield.x, y);
    ctx.lineTo(playfield.x + cell.width * 0.2, y);
    ctx.moveTo(playfield.x + playfield.width - cell.width * 0.2, y);
    ctx.lineTo(playfield.x + playfield.width, y);
    ctx.stroke();
  }

  // Zone labels below the playfield.
  const zonePx = Math.round(cell.height * 0.34);
  ctx.font = `${zonePx}px sans-serif`;
  ctx.textAlign = 'center';
  const midY = playfield.y + playfield.height + cell.height * 0.5;
  const lowY = playfield.y + playfield.height + cell.height * 0.9;
  ctx.fillText('JET FIGHTER FLYING ZONE', playfield.x + playfield.width * 0.5, midY);
  ctx.fillText('BATTLE SHIP ZONE', playfield.x + playfield.width * 0.2, lowY);
  ctx.fillText('MISSILE STATION ZONE', playfield.x + playfield.width * 0.78, lowY);
}

/**
 * Build a renderer bound to a canvas. The returned function draws a single
 * frame for the supplied GameState; call it once per animation frame.
 */
export function createRenderer(config: RenderConfig): (state: GameState) => void {
  const { canvas, width, height } = config;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('createRenderer: 2D canvas context unavailable');
  }

  const playfield = computePlayfield(width, height);

  let prev: GameState | null = null;
  const bursts: Burst[] = [];

  return (state: GameState): void => {
    const grid = cellExtent(state.gridColumns, LANE_COUNT, playfield);

    // Advance existing bursts and fold in any new hits this frame.
    for (const b of bursts) b.framesLeft -= 1;
    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      if (bursts[i].framesLeft <= 0) bursts.splice(i, 1);
    }
    if (isPowered(state.phase)) {
      bursts.push(...detectHits(prev, state, playfield));
    } else {
      bursts.length = 0;
    }

    drawBackground(ctx, width, height);

    if (isPowered(state.phase)) {
      drawGhostLayer(ctx, state, playfield, grid);
      drawActiveElements(ctx, state, bursts, playfield, grid);
      drawScoreReadout(ctx, state, playfield, grid, false);
      drawLives(ctx, state, playfield, grid, false);
    }

    // Silkscreen is printed on the glass - always visible, drawn on top.
    drawSilkscreen(ctx, state, width, height, playfield, grid);

    prev = state;
  };
}
