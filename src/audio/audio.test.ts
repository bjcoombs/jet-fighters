import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioEngine,
  EFFECTS,
  clipEffects,
  type AudioDriver,
  type ClipEffect,
  type EffectName,
  type EffectSpec,
  type ToneEffect,
} from './audio.js';
import { AUDIO_MODULE } from './index.js';

/** Records every driver call so the pure engine can be asserted on. */
class FakeDriver implements AudioDriver {
  ready = false;
  muted = false;
  startCount = 0;
  clips: { name: EffectName; effect: ClipEffect }[] = [];
  tones: ToneEffect[] = [];

  async start(): Promise<void> {
    this.startCount += 1;
    this.ready = true;
  }
  isReady(): boolean {
    return this.ready;
  }
  playClip(name: EffectName, effect: ClipEffect): void {
    this.clips.push({ name, effect });
  }
  playTone(effect: ToneEffect): void {
    this.tones.push(effect);
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}

describe('EFFECTS manifest', () => {
  const names: EffectName[] = [
    'missileFire',
    'jetMarch',
    'battleshipBuzz',
    'explosion',
    'gameOver',
  ];

  it('defines exactly the five game effects', () => {
    expect(Object.keys(EFFECTS).sort()).toEqual([...names].sort());
  });

  it('gives every effect a valid, in-range spec', () => {
    for (const name of names) {
      const spec: EffectSpec = EFFECTS[name];
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(1);
      if (spec.kind === 'clip') {
        expect(spec.url).toMatch(/^audio\/.+\.(wav|mp3)$/);
      } else {
        expect(spec.type).toBe('square');
        expect(spec.steps.length).toBeGreaterThan(0);
        expect(spec.attackMs).toBeGreaterThanOrEqual(0);
        expect(spec.releaseMs).toBeGreaterThan(0);
        for (const step of spec.steps) {
          expect(step.freq).toBeGreaterThan(0);
          expect(step.durationMs).toBeGreaterThan(0);
        }
      }
    }
  });

  it('extracts missile fire and game over as clip effects, others synthesized', () => {
    expect(EFFECTS.missileFire.kind).toBe('clip');
    expect(EFFECTS.gameOver.kind).toBe('clip');
    expect(EFFECTS.jetMarch.kind).toBe('tone');
    expect(EFFECTS.battleshipBuzz.kind).toBe('tone');
    expect(EFFECTS.explosion.kind).toBe('tone');
  });

  it('models the battleship buzz at a distinctly lower pitch than the jet march', () => {
    const battleship = EFFECTS.battleshipBuzz as ToneEffect;
    const march = EFFECTS.jetMarch as ToneEffect;
    expect(battleship.steps[0].freq).toBeLessThan(march.steps[0].freq);
  });
});

describe('clipEffects', () => {
  it('returns only the file-backed effects with their urls', () => {
    const clips = clipEffects();
    expect(clips.map((c) => c.name).sort()).toEqual(['gameOver', 'missileFire']);
    for (const c of clips) {
      expect(c.url).toBe((EFFECTS[c.name] as ClipEffect).url);
    }
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

  it('routes clip effects to playClip with their spec', () => {
    engine.playMissileFire();
    engine.playGameOver();
    expect(driver.clips.map((c) => c.name)).toEqual(['missileFire', 'gameOver']);
    expect(driver.clips[0].effect).toBe(EFFECTS.missileFire);
    expect(driver.tones).toHaveLength(0);
  });

  it('routes synthesized effects to playTone with their spec', () => {
    engine.playJetMarch();
    engine.playBattleshipBuzz();
    engine.playExplosion();
    expect(driver.tones).toEqual([
      EFFECTS.jetMarch,
      EFFECTS.battleshipBuzz,
      EFFECTS.explosion,
    ]);
    expect(driver.clips).toHaveLength(0);
  });
});

describe('AudioEngine gesture gating', () => {
  it('soft-fails silently before the driver is ready', () => {
    const driver = new FakeDriver();
    driver.ready = false;
    const engine = new AudioEngine(driver);

    engine.playMissileFire();
    engine.playJetMarch();

    expect(driver.clips).toHaveLength(0);
    expect(driver.tones).toHaveLength(0);
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
    expect(driver.clips).toHaveLength(0);
    expect(driver.tones).toHaveLength(0);
  });

  it('resumes playing after unmute', () => {
    engine.setMuted(true);
    engine.playMissileFire();
    engine.setMuted(false);
    engine.playMissileFire();
    expect(driver.clips.map((c) => c.name)).toEqual(['missileFire']);
  });
});

describe('audio module scaffold marker', () => {
  it('retains its placeholder marker for main.ts wiring', () => {
    expect(AUDIO_MODULE).toBe('audio');
  });
});
