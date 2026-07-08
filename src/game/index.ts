// Public surface of the pure, deterministic game logic module (PRD R2).
// No DOM, no timers, no Web APIs - render/, input/, and audio/ consume this
// through the exports below.

export type {
  Battleship,
  Column,
  GameInput,
  GamePhase,
  GameState,
  Jet,
  Lane,
  Launcher,
  Missile,
  Position,
  Rocket,
  SkillLevel,
  Squadron,
} from './types.js';

export {
  BATTLESHIP_SCORE,
  GRID_COLUMNS,
  LANE_COUNT,
  MAX_LIVES,
  SCORE_BANDS,
  SKILL_CONFIG,
  WIN_SCORE,
} from './constants.js';

export { nextInt, nextRandom, seedRng } from './rng.js';

export {
  applyInput,
  createInitialState,
  createOffState,
  getScoreForColumn,
  tick,
} from './logic.js';

// Retained so the placeholder integration in src/main.ts keeps compiling until
// the DOM wiring lands in task 8. Remove when main.ts adopts the real API.
export const GAME_MODULE = 'game' as const;
