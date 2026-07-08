import { describe, it, expect } from 'vitest';
import {
  applyInput,
  createInitialState,
  createOffState,
  getScoreForColumn,
  tick,
} from './logic.js';
import {
  BATTLESHIP_SPAWN_CHANCE,
  GRID_COLUMNS,
  MAX_LIVES,
  SCORE_BANDS,
  SKILL_CONFIG,
  SQUADRON_RANKS,
  WIN_SCORE,
} from './constants.js';
import { nextRandom, seedRng } from './rng.js';
import type { GameState, Jet, Lane } from './types.js';

// --- Helpers ---------------------------------------------------------------

const jet = (lane: number, column: number, alive = true): Jet => ({
  lane: lane as Lane,
  column,
  alive,
});

/** Fresh PLAYING state with the given overrides shallow-merged in. */
function playing(overrides: Partial<GameState> = {}): GameState {
  return { ...createInitialState(1, 1), ...overrides };
}

// --- Scoring ---------------------------------------------------------------

describe('getScoreForColumn', () => {
  it('awards 3 nearest the battleship, 2 in the middle, 1 nearest the player', () => {
    // Default grid: flying zone is columns 1..4.
    expect(getScoreForColumn(1, GRID_COLUMNS)).toBe(3);
    expect(getScoreForColumn(2, GRID_COLUMNS)).toBe(3);
    expect(getScoreForColumn(3, GRID_COLUMNS)).toBe(2);
    expect(getScoreForColumn(4, GRID_COLUMNS)).toBe(1);
  });

  it('clamps out-of-zone columns into the flying zone', () => {
    expect(getScoreForColumn(0, GRID_COLUMNS)).toBe(3); // battleship column clamps to nearest band
    expect(getScoreForColumn(GRID_COLUMNS - 1, GRID_COLUMNS)).toBe(1); // G line clamps down
  });

  it('agrees with the documented SCORE_BANDS on the default grid', () => {
    for (const band of SCORE_BANDS) {
      for (let column = band.minColumn; column <= band.maxColumn; column += 1) {
        expect(getScoreForColumn(column, GRID_COLUMNS)).toBe(band.points);
      }
    }
  });

  it('scales the bands to a wider grid', () => {
    // Flying zone 1..7 (grid width 9) splits into thirds.
    expect(getScoreForColumn(1, 9)).toBe(3);
    expect(getScoreForColumn(4, 9)).toBe(2);
    expect(getScoreForColumn(7, 9)).toBe(1);
  });
});

// --- State construction ----------------------------------------------------

describe('createInitialState', () => {
  it('starts a fresh PLAYING game centred with full lives and no score', () => {
    const state = createInitialState(123, 2);
    expect(state.phase).toBe('PLAYING');
    expect(state.skillLevel).toBe(2);
    expect(state.score).toBe(0);
    expect(state.tick).toBe(0);
    expect(state.launcher.lives).toBe(MAX_LIVES);
    expect(state.missile).toBeNull();
    expect(state.rockets).toEqual([]);
    expect(state.gridColumns).toBe(GRID_COLUMNS);
    expect(state.squadron.jets).toHaveLength(SQUADRON_RANKS * 3);
    expect(state.squadron.jets.every((j) => j.alive)).toBe(true);
    expect(state.squadron.waveNumber).toBe(1);
  });

  it('createOffState is a dark, non-playing state that keeps the skill dial', () => {
    const off = createOffState(3);
    expect(off.phase).toBe('OFF');
    expect(off.skillLevel).toBe(3);
  });
});

// --- Determinism -----------------------------------------------------------

describe('determinism', () => {
  it('produces identical runs from the same seed', () => {
    const run = (): GameState => {
      let s = createInitialState(777, 2);
      for (let i = 0; i < 300; i += 1) s = tick(s);
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('produces identical runs under an identical input sequence', () => {
    const run = (): GameState => {
      let s = createInitialState(555, 3);
      for (let i = 0; i < 200; i += 1) {
        if (i % 20 === 0) s = applyInput(s, { type: 'FIRE' });
        if (i % 15 === 0) s = applyInput(s, { type: 'MOVE_LANE', lane: (i % 3) as Lane });
        s = tick(s);
      }
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('different seeds diverge', () => {
    const run = (seed: number): GameState => {
      let s = createInitialState(seed, 2);
      for (let i = 0; i < 100; i += 1) s = tick(s);
      return s;
    };
    expect(JSON.stringify(run(1))).not.toBe(JSON.stringify(run(2)));
  });
});

// --- Input handling in every phase -----------------------------------------

describe('applyInput', () => {
  it('ignores gameplay inputs while OFF but honours POWER_ON and SET_SKILL', () => {
    const off = createOffState(1);
    expect(applyInput(off, { type: 'FIRE' })).toEqual(off);
    expect(applyInput(off, { type: 'MOVE_LANE', lane: 2 })).toEqual(off);
    expect(applyInput(off, { type: 'POWER_OFF' }).phase).toBe('OFF');

    const skilled = applyInput(off, { type: 'SET_SKILL', level: 3 });
    expect(skilled.skillLevel).toBe(3);
    expect(skilled.phase).toBe('OFF');

    const on = applyInput(skilled, { type: 'POWER_ON', seed: 42 });
    expect(on.phase).toBe('PLAYING');
    expect(on.skillLevel).toBe(3); // dial setting carried into the new game
  });

  it('moves the launcher and fires one missile at a time while PLAYING', () => {
    const state = playing();
    const moved = applyInput(state, { type: 'MOVE_LANE', lane: 2 });
    expect(moved.launcher.lane).toBe(2);

    const fired = applyInput(moved, { type: 'FIRE' });
    expect(fired.missile).toEqual({ lane: 2, column: GRID_COLUMNS - 1 });

    // A second fire is ignored while a missile is in flight.
    const firedAgain = applyInput(fired, { type: 'FIRE' });
    expect(firedAgain).toBe(fired);
  });

  it('ignores a redundant POWER_ON while already PLAYING', () => {
    const state = playing();
    expect(applyInput(state, { type: 'POWER_ON', seed: 9 })).toBe(state);
  });

  it('ignores gameplay inputs after GAME_OVER / WIN', () => {
    for (const phase of ['GAME_OVER', 'WIN'] as const) {
      const ended = playing({ phase });
      expect(applyInput(ended, { type: 'FIRE' })).toBe(ended);
      expect(applyInput(ended, { type: 'MOVE_LANE', lane: 0 })).toBe(ended);
      expect(applyInput(ended, { type: 'POWER_ON', seed: 1 })).toBe(ended); // must power-cycle
    }
  });

  it('power-cycles to restart a fresh game after GAME_OVER', () => {
    const ended = playing({ phase: 'GAME_OVER', score: 42 });
    const off = applyInput(ended, { type: 'POWER_OFF' });
    expect(off.phase).toBe('OFF');
    const restarted = applyInput(off, { type: 'POWER_ON', seed: 5 });
    expect(restarted.phase).toBe('PLAYING');
    expect(restarted.score).toBe(0);
    expect(restarted.launcher.lives).toBe(MAX_LIVES);
  });
});

// --- tick: phase gating ----------------------------------------------------

describe('tick phase gating', () => {
  it('is a no-op unless PLAYING', () => {
    for (const phase of ['OFF', 'GAME_OVER', 'WIN'] as const) {
      const state = playing({ phase });
      expect(tick(state)).toBe(state);
    }
  });

  it('advances the tick counter while PLAYING', () => {
    expect(tick(playing()).tick).toBe(1);
  });

  it('does not mutate the input state', () => {
    const state = playing();
    const snapshot = JSON.stringify(state);
    tick(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

// --- Missile movement and collisions ---------------------------------------

describe('missile', () => {
  it('advances toward the far side each tick', () => {
    const state = playing({
      missile: { lane: 1, column: 4 },
      squadron: { ...playing().squadron, jets: [jet(0, 1)] }, // no jet in the missile lane
    });
    expect(tick(state).missile).toEqual({ lane: 1, column: 3 });
  });

  it('destroys a jet and scores by column band, then is spent', () => {
    const state = playing({
      missile: { lane: 1, column: 3 },
      // spectator jet keeps the squadron from clearing / respawning
      squadron: { ...playing().squadron, jets: [jet(1, 2), jet(2, 1)] },
    });
    const next = tick(state);
    expect(next.score).toBe(getScoreForColumn(2, GRID_COLUMNS)); // hit at column 2 => 3
    expect(next.missile).toBeNull();
    const hit = next.squadron.jets.find((j) => j.lane === 1);
    expect(hit?.alive).toBe(false);
    expect(next.squadron.jets.find((j) => j.lane === 2)?.alive).toBe(true);
  });

  it('scores 10 for the battleship when it reaches the far zone', () => {
    const state = playing({
      missile: { lane: 0, column: 1 },
      battleship: { visible: true, lane: 0, crossingTicks: 24 },
      squadron: { ...playing().squadron, jets: [jet(1, 1), jet(2, 1)] }, // clear lane 0
    });
    const next = tick(state);
    expect(next.score).toBe(10);
    expect(next.missile).toBeNull();
    expect(next.battleship.visible).toBe(false);
  });

  it('is spent (missed) when it reaches the far zone with no target', () => {
    const state = playing({
      missile: { lane: 0, column: 1 },
      battleship: { visible: false, lane: 0, crossingTicks: 0 },
      squadron: { ...playing().squadron, jets: [jet(1, 1)] },
    });
    const next = tick(state);
    expect(next.missile).toBeNull();
    expect(next.score).toBe(0);
  });
});

// --- Squadron stepping and thin-out ----------------------------------------

describe('squadron stepping', () => {
  it('steps the whole formation forward once the cadence elapses', () => {
    const sq = playing().squadron;
    const state = playing({
      squadron: { ...sq, jets: [jet(0, 1), jet(1, 1)], stepCounter: sq.ticksPerStep - 1 },
    });
    const next = tick(state);
    expect(next.squadron.jets.every((j) => j.column === 2)).toBe(true);
    expect(next.squadron.stepCounter).toBe(0);
  });

  it('does not step before the cadence elapses', () => {
    const sq = playing().squadron;
    const state = playing({ squadron: { ...sq, jets: [jet(0, 1)], stepCounter: 0 } });
    const next = tick(state);
    expect(next.squadron.jets[0].column).toBe(1);
    expect(next.squadron.stepCounter).toBe(1);
  });

  it('speeds up as jets are thinned out', () => {
    const sq = playing().squadron;
    const full = tick(playing({ squadron: { ...sq, jets: [jet(0, 1), jet(1, 1), jet(2, 1)] } }));
    const thinned = tick(
      playing({ squadron: { ...sq, jets: [jet(0, 1), jet(1, 1, false), jet(2, 1, false)] } }),
    );
    expect(thinned.squadron.ticksPerStep).toBeLessThan(full.squadron.ticksPerStep);
  });

  it('respawns the next wave faster once the squadron is cleared', () => {
    const sq = playing().squadron;
    const state = playing({ squadron: { ...sq, jets: [jet(0, 1, false)], waveNumber: 1 } });
    const next = tick(state);
    expect(next.squadron.waveNumber).toBe(2);
    expect(next.squadron.jets).toHaveLength(SQUADRON_RANKS * 3);
    expect(next.squadron.jets.every((j) => j.alive)).toBe(true);
    // Wave 2 cadence is faster than a fresh wave 1.
    expect(next.squadron.ticksPerStep).toBeLessThan(playing().squadron.ticksPerStep);
  });
});

// --- End conditions --------------------------------------------------------

describe('end conditions', () => {
  it('is instant GAME_OVER when a jet reaches the G line (capture)', () => {
    const sq = playing().squadron;
    const state = playing({
      squadron: { ...sq, jets: [jet(1, GRID_COLUMNS - 1), jet(0, 1)] },
    });
    expect(tick(state).phase).toBe('GAME_OVER');
  });

  it('loses a life when a rocket reaches the launcher lane at the player column', () => {
    const state = playing({
      launcher: { lane: 1, lives: 3 },
      rockets: [{ lane: 1, column: GRID_COLUMNS - 2 }],
      squadron: { ...playing().squadron, jets: [jet(0, 1, false)] }, // no jets => no new rockets
    });
    const next = tick(state);
    expect(next.launcher.lives).toBe(2);
    expect(next.rockets).toEqual([]);
  });

  it('a rocket in a different lane is harmless', () => {
    const state = playing({
      launcher: { lane: 1, lives: 3 },
      rockets: [{ lane: 0, column: GRID_COLUMNS - 2 }],
      squadron: { ...playing().squadron, jets: [jet(0, 1, false)] },
    });
    const next = tick(state);
    expect(next.launcher.lives).toBe(3);
    expect(next.rockets).toEqual([]);
  });

  it('ends the game when the last launcher is destroyed', () => {
    const state = playing({
      launcher: { lane: 1, lives: 1 },
      rockets: [{ lane: 1, column: GRID_COLUMNS - 2 }],
      squadron: { ...playing().squadron, jets: [jet(0, 1, false)] },
    });
    const next = tick(state);
    expect(next.launcher.lives).toBe(0);
    expect(next.phase).toBe('GAME_OVER');
  });

  it('wins and caps the score at 199', () => {
    const state = playing({
      score: WIN_SCORE - 5,
      missile: { lane: 0, column: 1 },
      battleship: { visible: true, lane: 0, crossingTicks: 24 },
      squadron: { ...playing().squadron, jets: [jet(1, 1), jet(2, 1)] },
    });
    const next = tick(state);
    expect(next.score).toBe(WIN_SCORE); // 194 + 10 = 204, capped
    expect(next.phase).toBe('WIN');
  });
});

// --- Battleship crossings --------------------------------------------------

describe('battleship crossing', () => {
  it('counts down the visible window and disappears at the end', () => {
    const state = playing({
      battleship: { visible: true, lane: 2, crossingTicks: 1 },
      squadron: { ...playing().squadron, jets: [jet(0, 1, false)] },
    });
    expect(tick(state).battleship.visible).toBe(false);
  });

  it('traverses all three lanes across a full crossing', () => {
    let state = playing({
      battleship: { visible: true, lane: 0, crossingTicks: 24 },
      squadron: { ...playing().squadron, jets: [jet(0, 1, false)] },
    });
    const lanesSeen = new Set<number>();
    for (let i = 0; i < 24 && state.battleship.visible; i += 1) {
      lanesSeen.add(state.battleship.lane);
      // Respawn keeps jets alive after clearing; force them dead so the run
      // stays PLAYING purely to observe the crossing.
      state = tick(state);
      state = { ...state, squadron: { ...state.squadron, jets: [jet(0, 1, false)] } };
    }
    expect(lanesSeen).toEqual(new Set([0, 1, 2]));
  });

  it('starts a crossing when the RNG draw falls under the spawn chance', () => {
    // Find a seed whose first draw triggers a spawn (deterministic search).
    let seed = 0;
    while (nextRandom(seedRng(seed)).value >= BATTLESHIP_SPAWN_CHANCE) {
      seed += 1;
      if (seed > 100000) throw new Error('no spawning seed found');
    }
    const state = playing({
      rngState: seedRng(seed),
      battleship: { visible: false, lane: 0, crossingTicks: 0 },
    });
    expect(tick(state).battleship.visible).toBe(true);
  });
});

// --- Skill levels ----------------------------------------------------------

describe('skill levels', () => {
  it('higher skill means a faster base cadence', () => {
    expect(SKILL_CONFIG[1].baseTicksPerStep).toBeGreaterThan(SKILL_CONFIG[2].baseTicksPerStep);
    expect(SKILL_CONFIG[2].baseTicksPerStep).toBeGreaterThan(SKILL_CONFIG[3].baseTicksPerStep);
  });

  it('a fresh squadron adopts the skill cadence', () => {
    expect(createInitialState(1, 1).squadron.ticksPerStep).toBe(SKILL_CONFIG[1].baseTicksPerStep);
    expect(createInitialState(1, 3).squadron.ticksPerStep).toBe(SKILL_CONFIG[3].baseTicksPerStep);
  });
});
