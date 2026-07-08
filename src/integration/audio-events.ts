// State-diff -> audio event mapper (PRD R6 + R7).
//
// The game logic is a pure reducer with no sound; audio is driven entirely by
// comparing the previous and next GameState. This module is that comparison,
// kept pure (no AudioSystem, no Web APIs) so every mapping rule is unit-testable.
// main.ts calls diffAudioEvents on each state transition and hands the result to
// playAudioEvents, which is the only DOM/Web-Audio-touching part.

import type { AudioSystem } from '../audio/index.js';
import { BATTLESHIP_SCORE } from '../game/index.js';
import type { GameState } from '../game/index.js';

/**
 * A sound the game should play, derived from a state transition. `missileFire`
 * covers both firing and a missile striking a jet or the battleship (owner-
 * confirmed: the same beep), matching {@link AudioSystem.playMissileFire}.
 */
export type AudioEvent =
  | { readonly type: 'missileFire' }
  | { readonly type: 'jetMarch' }
  | { readonly type: 'battleshipBuzz' }
  | { readonly type: 'launcherHit'; readonly hitNumber: 1 | 2 }
  | { readonly type: 'gameOver' }
  | { readonly type: 'win' };

/** True when a squadron step (march) happened between prev and next. */
function marched(prev: GameState, next: GameState): boolean {
  // A step resets stepCounter to 0 after moving the formation. Exclude fresh
  // waves (waveNumber changes on respawn, which is not a march step) and the
  // first tick (stepCounter starts at 0, so 0 -> non-zero is not a step).
  return (
    next.phase === 'PLAYING' &&
    prev.squadron.waveNumber === next.squadron.waveNumber &&
    prev.squadron.stepCounter !== 0 &&
    next.squadron.stepCounter === 0
  );
}

/** True when the player's missile hit a jet this transition. */
function jetKilled(prev: GameState, next: GameState): boolean {
  const a = prev.squadron.jets;
  const b = next.squadron.jets;
  // Same wave and roster: an index flipping alive -> dead is a kill. A respawn
  // (different wave) or a differing roster length is never a kill.
  if (prev.squadron.waveNumber !== next.squadron.waveNumber) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[i].alive && !b[i].alive) return true;
  }
  return false;
}

/** True when the missile destroyed the battleship this transition. */
function battleshipKilled(prev: GameState, next: GameState): boolean {
  return (
    prev.battleship.visible &&
    !next.battleship.visible &&
    next.score - prev.score >= BATTLESHIP_SCORE
  );
}

/**
 * Derive the audio events for a single state transition. Order is stable and
 * deterministic; several events can fire in one transition (for example a march
 * step in the same tick that a rocket takes a life).
 */
export function diffAudioEvents(prev: GameState, next: GameState): AudioEvent[] {
  const events: AudioEvent[] = [];

  // Missile launched: no missile before, one in flight now (from a FIRE input).
  if (prev.missile === null && next.missile !== null) {
    events.push({ type: 'missileFire' });
  }

  // Missile struck a jet or the battleship: same beep as firing.
  if (jetKilled(prev, next) || battleshipKilled(prev, next)) {
    events.push({ type: 'missileFire' });
  }

  // Squadron marched a step.
  if (marched(prev, next)) {
    events.push({ type: 'jetMarch' });
  }

  // Battleship crossing appeared.
  if (!prev.battleship.visible && next.battleship.visible) {
    events.push({ type: 'battleshipBuzz' });
  }

  // Launcher hit by a rocket: two beeps on the first loss, three on the second.
  if (prev.launcher.lives === 3 && next.launcher.lives === 2) {
    events.push({ type: 'launcherHit', hitNumber: 1 });
  } else if (prev.launcher.lives === 2 && next.launcher.lives === 1) {
    events.push({ type: 'launcherHit', hitNumber: 2 });
  }

  // Entered an end state.
  if (prev.phase !== 'WIN' && next.phase === 'WIN') {
    events.push({ type: 'win' });
  } else if (prev.phase !== 'GAME_OVER' && next.phase === 'GAME_OVER') {
    events.push({ type: 'gameOver' });
  }

  return events;
}

/** Play a list of derived audio events through the audio system. */
export function playAudioEvents(audio: AudioSystem, events: readonly AudioEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'missileFire':
        audio.playMissileFire();
        break;
      case 'jetMarch':
        audio.playJetMarch();
        break;
      case 'battleshipBuzz':
        audio.playBattleshipBuzz();
        break;
      case 'launcherHit':
        audio.playLauncherHit(event.hitNumber);
        break;
      case 'gameOver':
        audio.playGameOver();
        break;
      case 'win':
        audio.playWin();
        break;
    }
  }
}
