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

// ---------------------------------------------------------------------------
// Reference-measurement locks (PRD R6 / task v1.12).
//
// Each recipe's key numbers are asserted against values measured directly from
// the reference recordings by windowed-FFT / harmonic-partial analysis, so any
// future drift away from the ground truth fails CI. Provenance per figure:
//   - missileFire:   isolated blips at gameplay-audio.m4a ~7.30/38.31/41.89 s -
//                    dominant ~1480-1632 Hz, main transient ~10 ms, total ~20 ms.
//   - jetMarch:      recurring step buzz ~600-650 Hz (gameplay-audio.m4a ~66 s).
//   - battleshipBuzz: low-buzz band, strongest clean read 300 Hz (frac 0.68) at
//                    ~54 s, band spread ~230-300 Hz; must stay below the march.
//   - win:           gameplay-audio.m4a ~120.5-122.4 s - fundamentals recovered
//                    from partials: F#5 750, A#5 940, D#6 1244 Hz; a three-fold
//                    [F#5,A#5,D#6] arpeggio resolving to a long A#5, ~1.83 s.
//   - gameOver/loss: loss-audio.m4a ~85.86-86.99 s (~1.13 s) - opening ~455-545 Hz
//                    transient collapsing to an ~80-97 Hz buzz, body ~200-280 Hz,
//                    dark noise (rolloff mostly 400-1150 Hz).
//   - warning beep:  loss opening + discrete triple-beep at ~27.4 s - ~455-545 Hz,
//                    ~10 ms beeps spaced ~25-28 ms apart.
// ---------------------------------------------------------------------------

const REFERENCE = {
  missileFire: { peakFreqHz: 1520, freqTolPct: 8, totalMsMin: 8, totalMsMax: 35 },
  jetMarch: { freqHz: 620, freqBandHz: [585, 660] as const },
  battleshipBuzz: { freqBandHz: [225, 315] as const },
  win: {
    fundamentalsHz: [750, 940, 1244] as const,
    freqTolPct: 2,
    arpeggio: [750, 940, 1244] as const, // F#5, A#5, D#6
    repeats: 3,
    finalHz: 940, // resolves to a long A#5
    totalMsRange: [1600, 2100] as const,
  },
  gameOver: {
    openingHz: 466,
    openingBandHz: [455, 545] as const,
    floorMaxHz: 175, // low rasp the descent ends on
    totalMsRange: [1000, 1250] as const,
    noiseLowpassMaxHz: 1150, // dark: measured rolloff mostly 400-1150 Hz
  },
  warningBeep: {
    freqBandHz: [455, 545] as const,
    beepMsMax: 20,
    gapMsRange: [18, 45] as const,
  },
} as const;

const within = (value: number, target: number, tolPct: number): boolean =>
  Math.abs(value - target) <= (target * tolPct) / 100;

const totalStepMs = (spec: EffectSpec): number =>
  spec.steps.reduce((s, x) => s + x.durationMs + (x.gapMs ?? 0), 0);

/** Effective audible length: the tone tail or the layered noise tail, whichever is longer. */
const effectiveMs = (spec: EffectSpec): number =>
  Math.max(
    spec.steps.reduce((s, x) => s + x.durationMs + (x.gapMs ?? 0), 0) +
      spec.releaseMs,
    spec.noise?.durationMs ?? 0,
  );

describe('reference-measurement locks', () => {
  it('missileFire: ~1520 Hz blip, ~20 ms total (very short piezo transient)', () => {
    const spec = EFFECTS.missileFire;
    const peak = Math.max(...spec.steps.map((s) => s.freq));
    expect(
      within(peak, REFERENCE.missileFire.peakFreqHz, REFERENCE.missileFire.freqTolPct),
    ).toBe(true);
    const total = totalStepMs(spec);
    expect(total).toBeGreaterThanOrEqual(REFERENCE.missileFire.totalMsMin);
    expect(total).toBeLessThanOrEqual(REFERENCE.missileFire.totalMsMax);
  });

  it('jetMarch: step buzz within the measured 585-660 Hz band', () => {
    const f = EFFECTS.jetMarch.steps[0].freq;
    const [lo, hi] = REFERENCE.jetMarch.freqBandHz;
    expect(f).toBeGreaterThanOrEqual(lo);
    expect(f).toBeLessThanOrEqual(hi);
  });

  it('battleshipBuzz: low buzz within the measured band and below the march', () => {
    const f = EFFECTS.battleshipBuzz.steps[0].freq;
    const [lo, hi] = REFERENCE.battleshipBuzz.freqBandHz;
    expect(f).toBeGreaterThanOrEqual(lo);
    expect(f).toBeLessThanOrEqual(hi);
    expect(f).toBeLessThan(EFFECTS.jetMarch.steps[0].freq);
  });

  it('win: note fundamentals match the measured F#5/A#5/D#6 pitches', () => {
    const pitches = [...new Set(EFFECTS.win.steps.map((s) => s.freq))].sort(
      (a, b) => a - b,
    );
    expect(pitches).toHaveLength(REFERENCE.win.fundamentalsHz.length);
    for (const target of REFERENCE.win.fundamentalsHz) {
      expect(
        pitches.some((p) => within(p, target, REFERENCE.win.freqTolPct)),
      ).toBe(true);
    }
  });

  it('win: three-fold [F#5,A#5,D#6] arpeggio resolving to a long final A#5', () => {
    const steps = EFFECTS.win.steps;
    const { arpeggio, repeats, finalHz } = REFERENCE.win;
    expect(steps).toHaveLength(arpeggio.length * repeats + 1);
    for (let i = 0; i < arpeggio.length * repeats; i += 1) {
      expect(steps[i].freq).toBe(arpeggio[i % arpeggio.length]);
    }
    const last = steps[steps.length - 1];
    expect(last.freq).toBe(finalHz);
    // The resolution note is held longest.
    const longest = Math.max(...steps.map((s) => s.durationMs));
    expect(last.durationMs).toBe(longest);
  });

  it('win: total length within the measured ~1.83 s envelope', () => {
    const total = totalStepMs(EFFECTS.win);
    const [lo, hi] = REFERENCE.win.totalMsRange;
    expect(total).toBeGreaterThanOrEqual(lo);
    expect(total).toBeLessThanOrEqual(hi);
  });

  it('gameOver: opening pitch, low-rasp floor and ~1.13 s length match the loss recording', () => {
    const spec = EFFECTS.gameOver;
    const [lo, hi] = REFERENCE.gameOver.openingBandHz;
    expect(spec.steps[0].freq).toBe(REFERENCE.gameOver.openingHz);
    expect(spec.steps[0].freq).toBeGreaterThanOrEqual(lo);
    expect(spec.steps[0].freq).toBeLessThanOrEqual(hi);
    expect(spec.steps[spec.steps.length - 1].freq).toBeLessThanOrEqual(
      REFERENCE.gameOver.floorMaxHz,
    );
    const [tlo, thi] = REFERENCE.gameOver.totalMsRange;
    expect(effectiveMs(spec)).toBeGreaterThanOrEqual(tlo);
    expect(effectiveMs(spec)).toBeLessThanOrEqual(thi);
    expect(spec.noise!.lowpassHz).toBeLessThanOrEqual(
      REFERENCE.gameOver.noiseLowpassMaxHz,
    );
  });

  it('warning beep: pitch, short beep length and gap match the loss opening', () => {
    const [lo, hi] = REFERENCE.warningBeep.freqBandHz;
    expect(WARNING_BEEP_HZ).toBeGreaterThanOrEqual(lo);
    expect(WARNING_BEEP_HZ).toBeLessThanOrEqual(hi);
    const spec = launcherHitBeeps(2);
    const [glo, ghi] = REFERENCE.warningBeep.gapMsRange;
    for (const step of spec.steps) {
      expect(step.durationMs).toBeLessThanOrEqual(REFERENCE.warningBeep.beepMsMax);
    }
    // Every gap except the last is a short inter-beep silence in the measured range.
    for (const step of spec.steps.slice(0, -1)) {
      expect(step.gapMs ?? 0).toBeGreaterThanOrEqual(glo);
      expect(step.gapMs ?? 0).toBeLessThanOrEqual(ghi);
    }
  });
});

// ---------------------------------------------------------------------------
// PCM render cross-check. The recipes are pure data, so rather than run the Web
// Audio boundary we render each square-wave step list to PCM here and recover the
// pitch by Goertzel scan - proving the recipe -> synthesized-tone -> measured-pitch
// loop closes (a unit/typo error in a step frequency would surface as a mismatch).
// ---------------------------------------------------------------------------

const RENDER_SR = 8000;

/** Render a square-wave step list (envelope/gaps as silence) to mono PCM. */
function renderSquare(steps: readonly { freq: number; durationMs: number; gapMs?: number }[]): Float64Array {
  const seg = steps.map((s) => ({
    n: Math.round((RENDER_SR * s.durationMs) / 1000),
    g: Math.round((RENDER_SR * (s.gapMs ?? 0)) / 1000),
    freq: s.freq,
  }));
  const total = seg.reduce((a, s) => a + s.n + s.g, 0);
  const out = new Float64Array(total);
  let idx = 0;
  let phase = 0;
  for (const s of seg) {
    const inc = s.freq / RENDER_SR;
    for (let i = 0; i < s.n; i += 1) {
      phase = (phase + inc) % 1;
      out[idx] = phase < 0.5 ? 1 : -1;
      idx += 1;
    }
    idx += s.g; // gap stays silent (0)
  }
  return out;
}

/** Goertzel power of pcm[a..b) at frequency f. */
function goertzel(pcm: Float64Array, a: number, b: number, f: number): number {
  const w = (2 * Math.PI * f) / RENDER_SR;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = a; i < b; i += 1) {
    s0 = pcm[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** Dominant fundamental of pcm[a..b) by a 60-3000 Hz Goertzel scan. */
function detectPitch(pcm: Float64Array, a: number, b: number): number {
  let best = 0;
  let bestP = -1;
  for (let f = 60; f <= 3000; f += 1) {
    const p = goertzel(pcm, a, b, f);
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  return best;
}

describe('PCM render cross-check (recipe -> tone -> measured pitch)', () => {
  const cases: { name: EffectName }[] = [
    { name: 'missileFire' },
    { name: 'win' },
    { name: 'gameOver' },
  ];

  for (const { name } of cases) {
    it(`${name}: every rendered step's pitch matches its recipe frequency`, () => {
      const spec = EFFECTS[name];
      const pcm = renderSquare(spec.steps);
      let cursor = 0;
      for (const step of spec.steps) {
        const n = Math.round((RENDER_SR * step.durationMs) / 1000);
        const g = Math.round((RENDER_SR * (step.gapMs ?? 0)) / 1000);
        // Analyse the steady middle of the step to avoid boundary phase noise.
        const pad = Math.floor(n * 0.15);
        const a = cursor + pad;
        const b = cursor + n - pad;
        if (b - a > RENDER_SR / step.freq) {
          const detected = detectPitch(pcm, a, b);
          expect(Math.abs(detected - step.freq) / step.freq).toBeLessThan(0.03);
        }
        cursor += n + g;
      }
    });
  }
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
