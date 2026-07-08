import { describe, it, expect } from 'vitest';
import { createInitialState, type GameState } from '../game/index.js';
import type { AudioSystem } from '../audio/index.js';
import { diffAudioEvents, playAudioEvents, type AudioEvent } from './audio-events.js';

/** A valid PLAYING baseline; tests derive prev/next by overriding fields. */
function base(): GameState {
  return createInitialState(1, 1);
}

/** Shorthand: list of event type tags in emitted order. */
function types(events: readonly AudioEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('diffAudioEvents', () => {
  it('fires missileFire when a missile launches (null -> in flight)', () => {
    const prev = base();
    const next: GameState = { ...prev, missile: { lane: 1, column: 5 } };
    expect(types(diffAudioEvents(prev, next))).toEqual(['missileFire']);
  });

  it('does not fire on a missile being spent (in flight -> null)', () => {
    const prev: GameState = { ...base(), missile: { lane: 1, column: 1 } };
    const next: GameState = { ...prev, missile: null };
    expect(types(diffAudioEvents(prev, next))).toEqual([]);
  });

  it('fires missileFire when a jet is killed (same beep as firing)', () => {
    const prev = base();
    const killed = prev.squadron.jets.map((jet, i) =>
      i === 0 ? { ...jet, alive: false } : jet,
    );
    const next: GameState = {
      ...prev,
      squadron: { ...prev.squadron, jets: killed },
    };
    expect(types(diffAudioEvents(prev, next))).toEqual(['missileFire']);
  });

  it('fires missileFire when the battleship is destroyed', () => {
    const prev: GameState = {
      ...base(),
      battleship: { visible: true, lane: 1, crossingTicks: 10 },
    };
    const next: GameState = {
      ...prev,
      battleship: { visible: false, lane: 0, crossingTicks: 0 },
      score: prev.score + 10,
    };
    expect(types(diffAudioEvents(prev, next))).toEqual(['missileFire']);
  });

  it('does not treat a timed-out battleship crossing as a kill', () => {
    const prev: GameState = {
      ...base(),
      battleship: { visible: true, lane: 1, crossingTicks: 1 },
    };
    const next: GameState = {
      ...prev,
      battleship: { visible: false, lane: 0, crossingTicks: 0 },
      // score unchanged: it simply left the far zone.
    };
    expect(types(diffAudioEvents(prev, next))).toEqual([]);
  });

  it('fires jetMarch when the squadron steps (stepCounter resets to 0)', () => {
    const prev: GameState = {
      ...base(),
      squadron: { ...base().squadron, stepCounter: 44 },
    };
    const next: GameState = {
      ...prev,
      squadron: { ...prev.squadron, stepCounter: 0 },
    };
    expect(types(diffAudioEvents(prev, next))).toEqual(['jetMarch']);
  });

  it('does not fire jetMarch on the first tick (0 -> non-zero)', () => {
    const prev = base(); // stepCounter 0
    const next: GameState = {
      ...prev,
      squadron: { ...prev.squadron, stepCounter: 1 },
    };
    expect(types(diffAudioEvents(prev, next))).toEqual([]);
  });

  it('does not fire jetMarch on a wave respawn', () => {
    const prev: GameState = {
      ...base(),
      squadron: { ...base().squadron, waveNumber: 1, stepCounter: 44 },
    };
    const next: GameState = {
      ...prev,
      squadron: { ...prev.squadron, waveNumber: 2, stepCounter: 0 },
    };
    expect(types(diffAudioEvents(prev, next))).toEqual([]);
  });

  it('fires battleshipBuzz when a crossing appears', () => {
    const prev = base();
    const next: GameState = {
      ...prev,
      battleship: { visible: true, lane: 0, crossingTicks: 24 },
    };
    expect(types(diffAudioEvents(prev, next))).toEqual(['battleshipBuzz']);
  });

  it('fires launcherHit(1) on the first life lost (3 -> 2)', () => {
    const prev = base();
    const next: GameState = {
      ...prev,
      launcher: { ...prev.launcher, lives: 2 },
    };
    expect(diffAudioEvents(prev, next)).toEqual([{ type: 'launcherHit', hitNumber: 1 }]);
  });

  it('fires launcherHit(2) on the second life lost (2 -> 1)', () => {
    const prev: GameState = { ...base(), launcher: { lane: 1, lives: 2 } };
    const next: GameState = { ...prev, launcher: { lane: 1, lives: 1 } };
    expect(diffAudioEvents(prev, next)).toEqual([{ type: 'launcherHit', hitNumber: 2 }]);
  });

  it('does not fire launcherHit on the final life lost (1 -> 0)', () => {
    const prev: GameState = { ...base(), launcher: { lane: 1, lives: 1 } };
    const next: GameState = {
      ...prev,
      launcher: { lane: 1, lives: 0 },
      phase: 'GAME_OVER',
    };
    expect(types(diffAudioEvents(prev, next))).toEqual(['gameOver']);
  });

  it('fires gameOver when entering the GAME_OVER phase', () => {
    const prev = base();
    const next: GameState = { ...prev, phase: 'GAME_OVER' };
    expect(types(diffAudioEvents(prev, next))).toEqual(['gameOver']);
  });

  it('fires win when entering the WIN phase', () => {
    const prev = base();
    const next: GameState = { ...prev, phase: 'WIN', score: 199 };
    expect(types(diffAudioEvents(prev, next))).toEqual(['win']);
  });

  it('emits several events in one transition (march + launcher hit)', () => {
    const prev: GameState = {
      ...base(),
      squadron: { ...base().squadron, stepCounter: 44 },
    };
    const next: GameState = {
      ...prev,
      squadron: { ...prev.squadron, stepCounter: 0 },
      launcher: { ...prev.launcher, lives: 2 },
    };
    expect(types(diffAudioEvents(prev, next))).toEqual(['jetMarch', 'launcherHit']);
  });

  it('emits nothing for an idle transition', () => {
    const prev = base();
    const next: GameState = { ...prev, tick: prev.tick + 1 };
    expect(diffAudioEvents(prev, next)).toEqual([]);
  });
});

/** Records which AudioSystem methods fire, for the playback dispatch test. */
class RecordingAudio implements AudioSystem {
  calls: string[] = [];
  playMissileFire(): void {
    this.calls.push('missileFire');
  }
  playJetMarch(): void {
    this.calls.push('jetMarch');
  }
  playBattleshipBuzz(): void {
    this.calls.push('battleshipBuzz');
  }
  playLauncherHit(hitNumber: 1 | 2): void {
    this.calls.push(`launcherHit:${hitNumber}`);
  }
  playGameOver(): void {
    this.calls.push('gameOver');
  }
  playWin(): void {
    this.calls.push('win');
  }
  setMuted(): void {}
  isMuted(): boolean {
    return false;
  }
}

describe('playAudioEvents', () => {
  it('routes each event to the matching AudioSystem method', () => {
    const audio = new RecordingAudio();
    playAudioEvents(audio, [
      { type: 'missileFire' },
      { type: 'jetMarch' },
      { type: 'battleshipBuzz' },
      { type: 'launcherHit', hitNumber: 2 },
      { type: 'gameOver' },
      { type: 'win' },
    ]);
    expect(audio.calls).toEqual([
      'missileFire',
      'jetMarch',
      'battleshipBuzz',
      'launcherHit:2',
      'gameOver',
      'win',
    ]);
  });
});
