// Pure, deterministic game-state types for the Jet Fighters simulation.
// No DOM, no timers, no Web APIs - these describe the model that render/,
// input/, and audio/ consume through explicit interfaces.

/** The three launcher/jet lanes: 0 = top, 1 = middle, 2 = bottom. */
export type Lane = 0 | 1 | 2;

/**
 * Distance column across the playfield.
 * 0 = battleship / far zone, increasing toward the player.
 * The last column (`gridColumns - 1`) is the G line / capture line where the
 * launcher sits and where a jet reaching it captures the launcher.
 */
export type Column = number;

/** A discrete grid cell occupied by an entity. */
export interface Position {
  readonly lane: Lane;
  readonly column: Column;
}

/** A single jet in the attacking squadron. */
export interface Jet extends Position {
  readonly alive: boolean;
}

/** The attacking squadron of jets that steps toward the player, Invader-style. */
export interface Squadron {
  /** All jets in the current wave, including dead ones (until respawn). */
  readonly jets: readonly Jet[];
  /** 1-based wave counter; each cleared squadron respawns faster. */
  readonly waveNumber: number;
  /** Effective cadence: ticks between squadron steps (recomputed as jets thin out). */
  readonly ticksPerStep: number;
  /** Ticks elapsed since the last squadron step. */
  readonly stepCounter: number;
}

/** The battleship that makes random crossings of the far zone (column 0). */
export interface Battleship {
  readonly visible: boolean;
  readonly lane: Lane;
  /** Remaining ticks of the current crossing's visible window (0 when hidden). */
  readonly crossingTicks: number;
}

/** The player's missile - one in flight at a time, travels toward the far side. */
export type Missile = Position;

/** A jet rocket travelling down its lane toward the player. */
export type Rocket = Position;

/** The player's missile launcher. */
export interface Launcher {
  readonly lane: Lane;
  /** Remaining launchers (lives); the game ends at 0. */
  readonly lives: number;
}

/** Skill dial: 1 (easiest) to 3 (fastest). */
export type SkillLevel = 1 | 2 | 3;

/** Top-level game phase, driven by the power switch and end conditions. */
export type GamePhase = 'OFF' | 'PLAYING' | 'GAME_OVER' | 'WIN';

/** The complete, self-contained game state. Pure and serializable. */
export interface GameState {
  readonly phase: GamePhase;
  readonly skillLevel: SkillLevel;
  readonly score: number;
  /** Simulation tick counter since the current game started. */
  readonly tick: number;
  readonly launcher: Launcher;
  readonly missile: Missile | null;
  readonly squadron: Squadron;
  readonly battleship: Battleship;
  readonly rockets: readonly Rocket[];
  /** Seedable PRNG state - lives in GameState so replays are deterministic. */
  readonly rngState: number;
  /** Number of distance columns (0 .. gridColumns - 1). */
  readonly gridColumns: number;
}

/** The intent layer: every player/hardware action the logic consumes. */
export type GameInput =
  | { readonly type: 'POWER_ON'; readonly seed: number }
  | { readonly type: 'POWER_OFF' }
  | { readonly type: 'MOVE_LANE'; readonly lane: Lane }
  | { readonly type: 'FIRE' }
  | { readonly type: 'SET_SKILL'; readonly level: SkillLevel };
