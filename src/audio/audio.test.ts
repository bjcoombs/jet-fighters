import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioEngine,
  EFFECTS,
  launcherHitBeeps,
  WARNING_BEEP_HZ,
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
  'win',
  'gameOver',
];

/** Peak (highest) frequency across a recipe's steps. */
function peakFreq(spec: EffectSpec): number {
  return Math.max(...spec.steps.map((s) => s.freq));
}

describe('EFFECTS manifest', () => {
  it('defines exactly the five named static effects', () => {
    expect(Object.keys(EFFECTS).sort()).toEqual([...ALL_NAMES].sort());
  });

  it('no longer defines a separate explosion effect', () => {
    expect(EFFECTS).not.toHaveProperty('explosion');
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
        if (step.gapMs !== undefined) {
          expect(step.gapMs).toBeGreaterThanOrEqual(0);
        }
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
});

describe('win jingle (gameplay-audio.m4a tail)', () => {
  it('is a multi-note melody spanning several pitches', () => {
    const win = EFFECTS.win;
    expect(win.steps.length).toBeGreaterThanOrEqual(3);
    const pitches = new Set(win.steps.map((s) => s.freq));
    expect(pitches.size).toBeGreaterThanOrEqual(3);
  });

  it('is a bright, high-register jingle (well above the loss sound)', () => {
    expect(peakFreq(EFFECTS.win)).toBeGreaterThan(peakFreq(EFFECTS.gameOver));
  });

  it('plays legato - no inter-note gaps (the piezo glides between pitches)', () => {
    for (const step of EFFECTS.win.steps) {
      expect(step.gapMs ?? 0).toBe(0);
    }
  });
});

describe('loss sound (loss-audio.m4a) as gameOver', () => {
  it('descends from its opening pitch into a low buzz', () => {
    const loss = EFFECTS.gameOver;
    expect(loss.steps.length).toBeGreaterThan(1);
    expect(loss.steps[0].freq).toBeGreaterThan(
      loss.steps[loss.steps.length - 1].freq,
    );
  });

  it('opens at the warning-beep pitch (warnings reuse the loss opening note)', () => {
    expect(EFFECTS.gameOver.steps[0].freq).toBe(WARNING_BEEP_HZ);
  });

  it('carries a dark noise rasp and is the only effect that does', () => {
    const withNoise = ALL_NAMES.filter((n) => EFFECTS[n].noise !== undefined);
    expect(withNoise).toEqual(['gameOver']);
    const noise = EFFECTS.gameOver.noise!;
    expect(noise.gain).toBeGreaterThan(0);
    expect(noise.durationMs).toBeGreaterThan(0);
    expect(noise.lowpassHz).toBeGreaterThan(0);
  });
});

describe('launcherHitBeeps', () => {
  it('warns with two beeps on the first hit, three on the second', () => {
    expect(launcherHitBeeps(1).steps).toHaveLength(2);
    expect(launcherHitBeeps(2).steps).toHaveLength(3);
  });

  it('beeps all sound at the warning pitch (the loss opening note)', () => {
    for (const hit of [1, 2] as const) {
      for (const step of launcherHitBeeps(hit).steps) {
        expect(step.freq).toBe(WARNING_BEEP_HZ);
      }
    }
  });

  it('separates the beeps with a silent gap, but not after the last', () => {
    const steps = launcherHitBeeps(2).steps;
    expect(steps[0].gapMs).toBeGreaterThan(0);
    expect(steps[1].gapMs).toBeGreaterThan(0);
    expect(steps[steps.length - 1].gapMs ?? 0).toBe(0);
  });

  it('is a valid, in-range spec', () => {
    const spec = launcherHitBeeps(1);
    expect(spec.type).toBe('square');
    expect(spec.gain).toBeGreaterThan(0);
    expect(spec.gain).toBeLessThanOrEqual(1);
    expect(spec.releaseMs).toBeGreaterThan(0);
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

  it('routes each named play method to playEffect with its spec', () => {
    engine.playMissileFire();
    engine.playJetMarch();
    engine.playBattleshipBuzz();
    engine.playGameOver();
    engine.playWin();
    expect(driver.effects).toEqual([
      EFFECTS.missileFire,
      EFFECTS.jetMarch,
      EFFECTS.battleshipBuzz,
      EFFECTS.gameOver,
      EFFECTS.win,
    ]);
  });

  it('routes launcher hits to the matching beep train', () => {
    engine.playLauncherHit(1);
    engine.playLauncherHit(2);
    expect(driver.effects.map((e) => e.steps.length)).toEqual([2, 3]);
  });
});

describe('AudioEngine gesture gating', () => {
  it('soft-fails silently before the driver is ready', () => {
    const driver = new FakeDriver();
    driver.ready = false;
    const engine = new AudioEngine(driver);

    engine.playMissileFire();
    engine.playLauncherHit(1);
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
    engine.playLauncherHit(2);
    engine.playGameOver();
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
