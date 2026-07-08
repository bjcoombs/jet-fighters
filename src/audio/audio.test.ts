import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioEngine,
  EFFECTS,
  type AudioDriver,
  type EffectName,
  type EffectSpec,
} from './audio.js';
import { AUDIO_MODULE } from './index.js';

/** Records every driver call so the pure engine can be asserted on. */
class FakeDriver implements AudioDriver {
  ready = false;
  muted = false;
  startCount = 0;
  effects: EffectSpec[] = [];

  async start(): Promise<void> {
    this.startCount += 1;
    this.ready = true;
  }
  isReady(): boolean {
    return this.ready;
  }
  playEffect(spec: EffectSpec): void {
    this.effects.push(spec);
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}

const ALL_NAMES: EffectName[] = [
  'missileFire',
  'jetMarch',
  'battleshipBuzz',
  'explosion',
  'gameOver',
  'win',
];

/** Peak (highest) frequency across a recipe's steps. */
function peakFreq(spec: EffectSpec): number {
  return Math.max(...spec.steps.map((s) => s.freq));
}

describe('EFFECTS manifest', () => {
  it('defines exactly the six game effects', () => {
    expect(Object.keys(EFFECTS).sort()).toEqual([...ALL_NAMES].sort());
  });

  it('gives every effect a valid, in-range synthesized spec', () => {
    for (const name of ALL_NAMES) {
      const spec: EffectSpec = EFFECTS[name];
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(1);
      expect(spec.type).toBe('square');
      expect(spec.steps.length).toBeGreaterThan(0);
      expect(spec.attackMs).toBeGreaterThanOrEqual(0);
      expect(spec.releaseMs).toBeGreaterThan(0);
      for (const step of spec.steps) {
        expect(step.freq).toBeGreaterThan(0);
        expect(step.durationMs).toBeGreaterThan(0);
      }
    }
  });

  it('synthesizes every effect - no clip/file-backed specs remain', () => {
    for (const name of ALL_NAMES) {
      expect(EFFECTS[name]).not.toHaveProperty('url');
      expect(EFFECTS[name]).not.toHaveProperty('kind');
    }
  });

  it('models the battleship buzz at a distinctly lower pitch than the jet march', () => {
    expect(EFFECTS.battleshipBuzz.steps[0].freq).toBeLessThan(
      EFFECTS.jetMarch.steps[0].freq,
    );
  });

  it('models the missile fire as a short high blip (~1.5 kHz, well under 150 ms)', () => {
    const missile = EFFECTS.missileFire;
    const total = missile.steps.reduce((s, x) => s + x.durationMs, 0);
    expect(total).toBeLessThan(150);
    expect(peakFreq(missile)).toBeGreaterThan(1200);
  });

  it('gives the explosion a downward pitch sweep and a noise crash', () => {
    const ex = EFFECTS.explosion;
    expect(ex.steps.length).toBeGreaterThan(1);
    expect(ex.steps[0].freq).toBeGreaterThan(ex.steps[ex.steps.length - 1].freq);
    expect(ex.noise).toBeDefined();
    expect(ex.noise!.gain).toBeGreaterThan(0);
    expect(ex.noise!.durationMs).toBeGreaterThan(0);
    expect(ex.noise!.lowpassHz).toBeGreaterThan(0);
  });

  it('is the only effect carrying a noise layer', () => {
    const withNoise = ALL_NAMES.filter((n) => EFFECTS[n].noise !== undefined);
    expect(withNoise).toEqual(['explosion']);
  });
});

describe('jingles', () => {
  it('models game over as a multi-note melodic jingle', () => {
    const jingle = EFFECTS.gameOver;
    expect(jingle.steps.length).toBeGreaterThanOrEqual(3);
    // Uses more than one distinct pitch (it is a melody, not a sustained buzz).
    const pitches = new Set(jingle.steps.map((s) => s.freq));
    expect(pitches.size).toBeGreaterThanOrEqual(3);
  });

  it('models win as a multi-note jingle that climbs to a celebratory peak', () => {
    const win = EFFECTS.win;
    expect(win.steps.length).toBeGreaterThanOrEqual(3);
    // Clearly ascending: it ends higher than it begins...
    expect(win.steps[win.steps.length - 1].freq).toBeGreaterThan(
      win.steps[0].freq,
    );
    // ...and peaks above the game-over jingle for a triumphant finish.
    expect(peakFreq(win)).toBeGreaterThan(peakFreq(EFFECTS.gameOver));
  });
});

describe('AudioEngine routing', () => {
  let driver: FakeDriver;
  let engine: AudioEngine;

  beforeEach(() => {
    driver = new FakeDriver();
    engine = new AudioEngine(driver);
    driver.ready = true;
  });

  it('routes each play method to playEffect with its spec', () => {
    engine.playMissileFire();
    engine.playJetMarch();
    engine.playBattleshipBuzz();
    engine.playExplosion();
    engine.playGameOver();
    engine.playWin();
    expect(driver.effects).toEqual([
      EFFECTS.missileFire,
      EFFECTS.jetMarch,
      EFFECTS.battleshipBuzz,
      EFFECTS.explosion,
      EFFECTS.gameOver,
      EFFECTS.win,
    ]);
  });
});

describe('AudioEngine gesture gating', () => {
  it('soft-fails silently before the driver is ready', () => {
    const driver = new FakeDriver();
    driver.ready = false;
    const engine = new AudioEngine(driver);

    engine.playMissileFire();
    engine.playWin();

    expect(driver.effects).toHaveLength(0);
  });
});

describe('AudioEngine mute state machine', () => {
  let driver: FakeDriver;
  let engine: AudioEngine;

  beforeEach(() => {
    driver = new FakeDriver();
    engine = new AudioEngine(driver);
    driver.ready = true;
  });

  it('starts unmuted', () => {
    expect(engine.isMuted()).toBe(false);
  });

  it('reflects and forwards mute changes to the driver', () => {
    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
    expect(driver.muted).toBe(true);

    engine.setMuted(false);
    expect(engine.isMuted()).toBe(false);
    expect(driver.muted).toBe(false);
  });

  it('plays nothing while muted', () => {
    engine.setMuted(true);
    engine.playMissileFire();
    engine.playExplosion();
    engine.playWin();
    expect(driver.effects).toHaveLength(0);
  });

  it('resumes playing after unmute', () => {
    engine.setMuted(true);
    engine.playWin();
    engine.setMuted(false);
    engine.playWin();
    expect(driver.effects).toEqual([EFFECTS.win]);
  });
});

describe('audio module scaffold marker', () => {
  it('retains its placeholder marker for main.ts wiring', () => {
    expect(AUDIO_MODULE).toBe('audio');
  });
});
