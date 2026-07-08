// Tunable constants and scoring bands for the Jet Fighters simulation.
// Calibrated from the PRD (docs/prd/jet-fighters-v1.md, R2) and the printed
// ruler on the original unit: 10 / 3 / 2 / 1 / G.

import type { SkillLevel } from './types.js';

/**
 * Number of distance columns. Column 0 is the battleship / far zone, the last
 * column (index 5) is the G / capture line where the launcher sits, and
 * columns 1..4 are the jet flying zone. The PRD expects 5-7; 6 is used here.
 */
export const GRID_COLUMNS = 6;

/** Number of lanes (top / middle / bottom). */
export const LANE_COUNT = 3;

/** Centre lane the launcher starts in. */
export const CENTER_LANE = 1;

/** Maximum launchers (lives). */
export const MAX_LIVES = 3;

/** Reaching this score wins the game; the score display also caps here. */
export const WIN_SCORE = 199;

/** Points awarded for destroying the battleship. */
export const BATTLESHIP_SCORE = 10;

/** Columns the missile advances toward the far side each tick. */
export const MISSILE_SPEED = 1;

/** Columns a jet rocket advances toward the player each tick. */
export const ROCKET_SPEED = 1;

/** Number of jet ranks per wave; total jets = SQUADRON_RANKS * LANE_COUNT. */
export const SQUADRON_RANKS = 2;

/** Ticks a battleship crossing stays visible while traversing the far zone. */
export const BATTLESHIP_CROSSING_TICKS = 24;

/** Per-tick chance a hidden battleship starts a new crossing. */
export const BATTLESHIP_SPAWN_CHANCE = 0.02;

/** Ticks-per-step removed for each dead jet as the squadron thins out. */
export const THINOUT_SPEEDUP = 4;

/** Ticks-per-step removed per wave beyond the first (each wave respawns faster). */
export const WAVE_SPEEDUP = 4;

/** Floor for the squadron cadence, however thinned-out or deep the wave. */
export const MIN_TICKS_PER_STEP = 5;

/**
 * Per-skill tuning. Higher skill = faster squadron cadence and more aggressive
 * rocket fire, matching the 1/2/3 rotary dial (1 easiest, 3 fastest).
 */
export const SKILL_CONFIG: Record<
  SkillLevel,
  { readonly baseTicksPerStep: number; readonly rocketFireChance: number }
> = {
  1: { baseTicksPerStep: 45, rocketFireChance: 0.03 },
  2: { baseTicksPerStep: 30, rocketFireChance: 0.06 },
  3: { baseTicksPerStep: 18, rocketFireChance: 0.1 },
};

/**
 * Score bands for the jet flying zone, per the printed ruler (nearer the
 * battleship zone scores more): far = 3, middle = 2, near the player = 1.
 * Ranges are inclusive column indices for the default {@link GRID_COLUMNS} grid.
 * {@link getScoreForColumn} is the runtime source of truth and scales to any
 * grid width; this table documents and is verified against the default grid.
 */
export const SCORE_BANDS: readonly {
  readonly points: 1 | 2 | 3;
  readonly minColumn: number;
  readonly maxColumn: number;
}[] = [
  { points: 3, minColumn: 1, maxColumn: 2 },
  { points: 2, minColumn: 3, maxColumn: 3 },
  { points: 1, minColumn: 4, maxColumn: 4 },
];
