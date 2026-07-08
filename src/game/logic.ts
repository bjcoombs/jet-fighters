// Pure, deterministic game logic for Jet Fighters.
//
// Every function returns a NEW GameState and never mutates its inputs. The RNG
// state is threaded through GameState, so the same seed always produces the same
// run. No DOM, no timers, no Web APIs, no Math.random.

import {
  BATTLESHIP_CROSSING_TICKS,
  BATTLESHIP_SCORE,
  BATTLESHIP_SPAWN_CHANCE,
  CENTER_LANE,
  GRID_COLUMNS,
  LANE_COUNT,
  MAX_LIVES,
  MIN_TICKS_PER_STEP,
  MISSILE_SPEED,
  ROCKET_SPEED,
  SKILL_CONFIG,
  SQUADRON_RANKS,
  THINOUT_SPEEDUP,
  WAVE_SPEEDUP,
  WIN_SCORE,
} from './constants.js';
import { nextInt, nextRandom, seedRng } from './rng.js';
import type {
  Battleship,
  GameInput,
  GamePhase,
  GameState,
  Jet,
  Lane,
  Rocket,
  SkillLevel,
  Squadron,
} from './types.js';

// --- Scoring ---------------------------------------------------------------

/**
 * Points for destroying a jet at the given column: 3 nearest the battleship
 * zone, 2 in the middle, 1 nearest the player. Scales to any grid width by
 * splitting the flying zone (columns 1 .. gridColumns-2) into thirds.
 */
export function getScoreForColumn(column: number, gridColumns: number): 1 | 2 | 3 {
  const first = 1;
  const last = gridColumns - 2;
  const clamped = Math.max(first, Math.min(last, column));
  const width = last - first + 1;
  const rel = clamped - first; // 0 = nearest the battleship zone
  const third = width / 3;
  if (rel < third) return 3;
  if (rel < 2 * third) return 2;
  return 1;
}

// --- Squadron helpers ------------------------------------------------------

function deadCount(squadron: Squadron): number {
  return squadron.jets.reduce((n, jet) => (jet.alive ? n : n + 1), 0);
}

/** Effective cadence given skill, wave depth, and how thinned-out the squadron is. */
function effectiveTicksPerStep(
  skillLevel: SkillLevel,
  waveNumber: number,
  deadJets: number,
): number {
  const base = SKILL_CONFIG[skillLevel].baseTicksPerStep - (waveNumber - 1) * WAVE_SPEEDUP;
  return Math.max(base - deadJets * THINOUT_SPEEDUP, MIN_TICKS_PER_STEP);
}

/** Build a fresh wave of jets: SQUADRON_RANKS ranks across every lane. */
function spawnJets(): Jet[] {
  const jets: Jet[] = [];
  for (let rank = 0; rank < SQUADRON_RANKS; rank += 1) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      jets.push({ lane: lane as Lane, column: 1 + rank, alive: true });
    }
  }
  return jets;
}

function createSquadron(skillLevel: SkillLevel, waveNumber: number): Squadron {
  return {
    jets: spawnJets(),
    waveNumber,
    ticksPerStep: effectiveTicksPerStep(skillLevel, waveNumber, 0),
    stepCounter: 0,
  };
}

// --- State construction ----------------------------------------------------

/** A fresh, ready-to-play game state for the given seed and skill level. */
export function createInitialState(seed: number, skillLevel: SkillLevel): GameState {
  return {
    phase: 'PLAYING',
    skillLevel,
    score: 0,
    tick: 0,
    launcher: { lane: CENTER_LANE, lives: MAX_LIVES },
    missile: null,
    squadron: createSquadron(skillLevel, 1),
    battleship: { visible: false, lane: 0, crossingTicks: 0 },
    rockets: [],
    rngState: seedRng(seed),
    gridColumns: GRID_COLUMNS,
  };
}

/** A powered-off (dark screen) state, preserving the skill dial setting. */
export function createOffState(skillLevel: SkillLevel = 1): GameState {
  return {
    phase: 'OFF',
    skillLevel,
    score: 0,
    tick: 0,
    launcher: { lane: CENTER_LANE, lives: MAX_LIVES },
    missile: null,
    squadron: createSquadron(skillLevel, 1),
    battleship: { visible: false, lane: 0, crossingTicks: 0 },
    rockets: [],
    rngState: 0,
    gridColumns: GRID_COLUMNS,
  };
}

// --- Input handling --------------------------------------------------------

/** Apply a single input intent, returning a new state. Never mutates `state`. */
export function applyInput(state: GameState, input: GameInput): GameState {
  switch (input.type) {
    case 'POWER_ON':
      // Power-cycle to start: the switch only starts a game from OFF. After
      // GAME_OVER / WIN you must POWER_OFF first (slide off, then on again).
      if (state.phase !== 'OFF') return state;
      return createInitialState(input.seed, state.skillLevel);

    case 'POWER_OFF':
      return createOffState(state.skillLevel);

    case 'SET_SKILL':
      // The rotary dial can be turned in any phase.
      return { ...state, skillLevel: input.level };

    case 'MOVE_LANE':
      if (state.phase !== 'PLAYING') return state;
      return { ...state, launcher: { ...state.launcher, lane: input.lane } };

    case 'FIRE':
      if (state.phase !== 'PLAYING' || state.missile !== null) return state;
      return {
        ...state,
        missile: { lane: state.launcher.lane, column: state.gridColumns - 1 },
      };

    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}

// --- Simulation step -------------------------------------------------------

/**
 * Advance the simulation by one tick, returning a new state. Only runs while
 * PLAYING; in any other phase the state is returned unchanged.
 */
export function tick(state: GameState): GameState {
  if (state.phase !== 'PLAYING') return state;

  let rngState = state.rngState;
  let score = state.score;

  // 1. Battleship crossing: advance the visible window or maybe start one.
  let battleship: Battleship;
  if (state.battleship.visible) {
    const remaining = state.battleship.crossingTicks - 1;
    if (remaining <= 0) {
      battleship = { visible: false, lane: 0, crossingTicks: 0 };
    } else {
      battleship = {
        visible: true,
        lane: battleshipLane(remaining),
        crossingTicks: remaining,
      };
    }
  } else {
    const draw = nextRandom(rngState);
    rngState = draw.state;
    if (draw.value < BATTLESHIP_SPAWN_CHANCE) {
      battleship = {
        visible: true,
        lane: battleshipLane(BATTLESHIP_CROSSING_TICKS),
        crossingTicks: BATTLESHIP_CROSSING_TICKS,
      };
    } else {
      battleship = state.battleship;
    }
  }

  // 2. Missile: move toward the far side and resolve its collisions.
  let missile = state.missile;
  let jets = state.squadron.jets;
  if (missile) {
    const oldColumn = missile.column;
    const newColumn = oldColumn - MISSILE_SPEED;
    const lane = missile.lane;

    // Hit the player-most alive jet in the swept range [newColumn, oldColumn].
    let hitIndex = -1;
    let hitColumn = -1;
    for (let i = 0; i < jets.length; i += 1) {
      const jet = jets[i];
      if (!jet.alive || jet.lane !== lane) continue;
      if (jet.column >= newColumn && jet.column <= oldColumn && jet.column > hitColumn) {
        hitColumn = jet.column;
        hitIndex = i;
      }
    }

    if (hitIndex >= 0) {
      score += getScoreForColumn(hitColumn, state.gridColumns);
      jets = jets.map((jet, i) => (i === hitIndex ? { ...jet, alive: false } : jet));
      missile = null;
    } else if (newColumn <= 0) {
      // Reached the far zone: score the battleship if it is crossing this lane.
      if (battleship.visible && battleship.lane === lane) {
        score += BATTLESHIP_SCORE;
        battleship = { visible: false, lane: 0, crossingTicks: 0 };
      }
      missile = null; // spent (hit or missed)
    } else {
      missile = { lane, column: newColumn };
    }
  }

  // 3. Rockets: move toward the player; a rocket reaching the launcher lane
  //    at the player column destroys a launcher (loses a life).
  const playerColumn = state.gridColumns - 1;
  let lives = state.launcher.lives;
  const nextRockets: Rocket[] = [];
  for (const rocket of state.rockets) {
    const column = rocket.column + ROCKET_SPEED;
    if (column >= playerColumn) {
      if (rocket.lane === state.launcher.lane) {
        lives -= 1;
      }
      // reached the player edge - consumed whether it hit or missed the lane
      continue;
    }
    nextRockets.push({ lane: rocket.lane, column });
  }

  // 4. Squadron stepping: step the whole formation forward on cadence, then
  //    recompute cadence as the survivors thin out.
  const dead = deadCount({ ...state.squadron, jets });
  let stepCounter = state.squadron.stepCounter + 1;
  let ticksPerStep = effectiveTicksPerStep(state.skillLevel, state.squadron.waveNumber, dead);
  if (stepCounter >= ticksPerStep) {
    stepCounter = 0;
    jets = jets.map((jet) => (jet.alive ? { ...jet, column: jet.column + 1 } : jet));
  }

  // 5. Jets fire rockets down their lane at random.
  {
    const draw = nextRandom(rngState);
    rngState = draw.state;
    const living = jets.filter((jet) => jet.alive);
    if (living.length > 0 && draw.value < SKILL_CONFIG[state.skillLevel].rocketFireChance) {
      const pick = nextInt(rngState, living.length);
      rngState = pick.state;
      const shooter = living[pick.value];
      nextRockets.push({ lane: shooter.lane, column: shooter.column });
    }
  }

  let squadron: Squadron = {
    jets,
    waveNumber: state.squadron.waveNumber,
    ticksPerStep,
    stepCounter,
  };

  let phase: GamePhase = state.phase;

  // 6. Capture: any alive jet reaching the G line ends the game immediately.
  const captured = jets.some((jet) => jet.alive && jet.column >= playerColumn);

  // 7. Squadron cleared: respawn the next wave, faster.
  if (!captured && jets.every((jet) => !jet.alive)) {
    squadron = createSquadron(state.skillLevel, state.squadron.waveNumber + 1);
    ticksPerStep = squadron.ticksPerStep;
  }

  // 8. Resolve end conditions. Win takes precedence, then capture, then lives.
  if (score >= WIN_SCORE) {
    score = WIN_SCORE;
    phase = 'WIN';
  } else if (captured) {
    phase = 'GAME_OVER';
  } else if (lives <= 0) {
    phase = 'GAME_OVER';
  }

  return {
    phase,
    skillLevel: state.skillLevel,
    score,
    tick: state.tick + 1,
    launcher: { lane: state.launcher.lane, lives },
    missile,
    squadron,
    battleship,
    rockets: nextRockets,
    rngState,
    gridColumns: state.gridColumns,
  };
}

/** Lane a crossing battleship occupies given the ticks left in its window. */
function battleshipLane(crossingTicks: number): Lane {
  const elapsed = BATTLESHIP_CROSSING_TICKS - crossingTicks;
  const perLane = BATTLESHIP_CROSSING_TICKS / LANE_COUNT;
  const lane = Math.min(LANE_COUNT - 1, Math.floor(elapsed / perLane));
  return lane as Lane;
}
