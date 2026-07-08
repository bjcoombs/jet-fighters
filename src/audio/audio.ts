// Web Audio sound engine for Jet Fighters (PRD R6).
//
// Every effect is synthesized live from an OscillatorNode square wave - the
// period-authentic waveform for the original unit's piezo speaker. No sampled
// clips ship: the reference recordings are ground truth we measure and imitate,
// not audio we bundle.
//
// Each recipe is a pure data definition (square-wave frequency steps, an
// amplitude envelope, and for the loss sound a shaped noise burst). Because the
// recipes carry no Web APIs they are fully unit-testable. The engine (routing,
// mute, gesture gating) is likewise pure and tested against an injected
// AudioDriver stub. The WebAudioDriver at the bottom is the thin, untested
// boundary that owns the AudioContext and turns a recipe into scheduled nodes.
//
// Owner-confirmed semantics (PRD R6):
//   - Missile fire is a single beep; a missile HITTING a jet/battleship makes the
//     SAME beep (no separate explosion sound), so playMissileFire covers both.
//   - The player's launcher taking a rocket hit warns with two beeps on the first
//     hit and three on the second; the third hit plays the full loss sound.
//   - WIN at 199 points is the melodic jingle at the tail of gameplay-audio.m4a.
//   - LOSS is the descending buzz near the end of loss-audio.m4a; its opening
//     note is the warning-beep pitch.
//
// Reference provenance (frequencies from a windowed-FFT / harmonic-product-
// spectrum sweep; timestamps into the named recording):
//   - missileFire:    ~1.52 kHz blip, ~20 ms (piezo blips are very short: the
//                     measured main transient is ~10 ms) gameplay-audio.m4a ~7.30/38.31 s
//   - jetMarch:       ~620 Hz step buzz (per march step; measured ~600-650 Hz)
//                     gameplay-audio.m4a ~66 s (march cadence is set by the game
//                     re-triggering the step, not by this recipe)
//   - battleshipBuzz: ~300 Hz sustained low buzz (measured low-buzz band ~240-300 Hz)
//                     gameplay-audio.m4a ~54 s dense section
//   - win:            F#5(750)-A#5(940)-D#6(1244) arpeggio x3 resolving to a long
//                     A#5, ~1.83 s                     gameplay-audio.m4a ~120.5 s
//   - gameOver (loss): buzzy descent from the ~390 Hz opening down into a ~145 Hz
//                     rasp + noise, ~1.1 s             loss-audio.m4a ~85.85 s
//   - launcher-hit warning beep: the loss opening tone (measured ~360-409 Hz,
//                     F#4-G#4); synthesized at 392 Hz (G4), two or three beeps.

/** The five named, static game effects. */
export type EffectName =
  | 'missileFire'
  | 'jetMarch'
  | 'battleshipBuzz'
  | 'win'
  | 'gameOver';

/**
 * One step of a synthesized effect: a frequency held for a duration, optionally
 * followed by a silent gap. Steps with no gap glide legato into the next (the
 * piezo just changes pitch); a gap re-articulates the next step as a separate
 * beep (used by the launcher-hit warnings).
 */
export interface ToneStep {
  readonly freq: number;
  readonly durationMs: number;
  /** Silence after this step before the next, milliseconds. Default 0 (legato). */
  readonly gapMs?: number;
}

/** A shaped noise burst layered under a tone (the loss sound's rasp). */
export interface NoiseSpec {
  /** Peak gain of the noise layer, 0..1. */
  readonly gain: number;
  /** Length of the noise burst, milliseconds. */
  readonly durationMs: number;
  /** One-pole low-pass cutoff applied to the white noise, Hz (darker = lower). */
  readonly lowpassHz: number;
}

/**
 * A fully synthesized effect: a square-wave oscillator stepped through a list of
 * frequencies under an attack/release envelope, optionally layered with a noise
 * burst. A single-step recipe is a blip or sustained buzz; a multi-step recipe
 * is a melody or a beep train.
 */
export interface EffectSpec {
  readonly type: OscillatorType;
  readonly steps: readonly ToneStep[];
  /** Peak gain of the tone, 0..1. */
  readonly gain: number;
  /** Attack ramp to peak gain, milliseconds. */
  readonly attackMs: number;
  /** Release ramp to silence after the last step, milliseconds. */
  readonly releaseMs: number;
  /** Optional layered noise burst (used by the loss sound). */
  readonly noise?: NoiseSpec;
}

// Measured piezo pitches from the reference win jingle (Hz). Fundamentals recovered
// from the harmonic partials at gameplay-audio.m4a ~120.5-122.4 s (e.g. partials
// 1500 & 2250 -> 750; 940/1880/2820 -> 940; 1240 & 2480 -> 1244).
const F5s = 750; // F#5
const A5s = 940; // A#5
const D6s = 1244; // D#6

/** Pitch of the launcher-hit warning beep - the loss sound's opening note (~G4). */
export const WARNING_BEEP_HZ = 392;
const WARNING_BEEP_MS = 110;
const WARNING_GAP_MS = 90;

/**
 * The static effect table: which sound each fixed game event makes. Every entry
 * is a synthesized square-wave recipe; see the provenance block above for the
 * reference each imitates. (The launcher-hit warning is dynamic - see
 * launcherHitBeeps - because the beep count depends on which hit it is.)
 */
export const EFFECTS: Record<EffectName, EffectSpec> = {
  // Sharp high blip; missile fire and a missile hitting a target share this beep.
  missileFire: {
    type: 'square',
    steps: [
      { freq: 1550, durationMs: 7 },
      { freq: 1490, durationMs: 8 },
    ],
    gain: 0.5,
    attackMs: 1,
    releaseMs: 8,
  },
  // Short step buzz; the marching rhythm comes from the game re-triggering it.
  jetMarch: {
    type: 'square',
    steps: [{ freq: 620, durationMs: 70 }],
    gain: 0.28,
    attackMs: 1,
    releaseMs: 25,
  },
  // Distinctly lower, sustained buzz per the "lower pitch" rule.
  battleshipBuzz: {
    type: 'square',
    steps: [{ freq: 300, durationMs: 380 }],
    gain: 0.32,
    attackMs: 2,
    releaseMs: 40,
  },
  // WIN jingle: transcribed tail of gameplay-audio.m4a (~120.5-122.4 s). The
  // measured melody is a clean F#5-A#5-D#6 arpeggio repeated three times, then a
  // long A#5 resolution (~1.83 s). The earlier E6 pass-tone was not present in the
  // recording: the final arpeggio's D#6 resolves straight to the sustained A#5.
  // Legato (no gaps): the piezo glides between notes.
  win: {
    type: 'square',
    steps: [
      { freq: F5s, durationMs: 200 },
      { freq: A5s, durationMs: 150 },
      { freq: D6s, durationMs: 150 },
      { freq: F5s, durationMs: 200 },
      { freq: A5s, durationMs: 150 },
      { freq: D6s, durationMs: 150 },
      { freq: F5s, durationMs: 200 },
      { freq: A5s, durationMs: 150 },
      { freq: D6s, durationMs: 150 },
      { freq: A5s, durationMs: 330 },
    ],
    gain: 0.32,
    attackMs: 4,
    releaseMs: 90,
  },
  // LOSS sound: buzzy descent from the ~390 Hz opening into a low ~145 Hz rasp,
  // layered with a dark decaying noise burst. Transcribed from loss-audio.m4a.
  gameOver: {
    type: 'square',
    steps: [
      { freq: 392, durationMs: 90 },
      { freq: 349, durationMs: 90 },
      { freq: 294, durationMs: 100 },
      { freq: 233, durationMs: 110 },
      { freq: 175, durationMs: 140 },
      { freq: 147, durationMs: 360 },
    ],
    gain: 0.4,
    attackMs: 3,
    releaseMs: 200,
    noise: { gain: 0.3, durationMs: 1100, lowpassHz: 700 },
  },
};

/**
 * Build the launcher-hit warning: a train of identical beeps at the loss sound's
 * opening pitch. First hit (1) warns with two beeps, second hit (2) with three.
 * The third hit is the full loss sound (playGameOver), not modelled here.
 */
export function launcherHitBeeps(hitNumber: 1 | 2): EffectSpec {
  const count = hitNumber + 1; // hit 1 -> 2 beeps, hit 2 -> 3 beeps
  const steps: ToneStep[] = Array.from({ length: count }, (_, i) => ({
    freq: WARNING_BEEP_HZ,
    durationMs: WARNING_BEEP_MS,
    // Silence between beeps so they are heard as separate; none after the last.
    gapMs: i < count - 1 ? WARNING_GAP_MS : 0,
  }));
  return { type: 'square', steps, gain: 0.34, attackMs: 2, releaseMs: 40 };
}

/**
 * The thin play boundary the engine drives. The real implementation owns the
 * AudioContext; tests inject a stub. Every method must be safe to call before
 * the context exists (soft-fail), so the engine never has to guard timing.
 */
export interface AudioDriver {
  /** Create/resume the AudioContext. Call on a user gesture. */
  start(): Promise<void>;
  /** True once the context is running and effects play without delay. */
  isReady(): boolean;
  /** Synthesize and play an effect immediately. No-op if the context is not running. */
  playEffect(spec: EffectSpec): void;
  /** Route all output through the shared mute gain (0 when muted). */
  setMuted(muted: boolean): void;
}

/** Public surface consumed by the game/integration layer. */
export interface AudioSystem {
  /** Missile fired, or a missile striking a jet/battleship (same beep). */
  playMissileFire(): void;
  playJetMarch(): void;
  playBattleshipBuzz(): void;
  /** Launcher hit by a rocket: hit 1 = two beeps, hit 2 = three beeps. */
  playLauncherHit(hitNumber: 1 | 2): void;
  /** Third launcher hit / capture: the full loss sound. */
  playGameOver(): void;
  /** Reached 199 points: the win jingle. */
  playWin(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

/**
 * Pure routing + mute + gesture-gating over an injected driver. No Web APIs here,
 * so it is fully unit-testable.
 */
export class AudioEngine implements AudioSystem {
  private muted = false;

  constructor(
    private readonly driver: AudioDriver,
    private readonly effects: Record<EffectName, EffectSpec> = EFFECTS,
  ) {}

  /** Route a spec to the driver, honouring mute and gesture gating. */
  private play(spec: EffectSpec): void {
    // Skip work while muted; the shared gain node also silences any in-flight tails.
    if (this.muted) return;
    // Before the first user gesture the context is suspended: soft-fail silently.
    if (!this.driver.isReady()) return;
    this.driver.playEffect(spec);
  }

  playMissileFire(): void {
    this.play(this.effects.missileFire);
  }

  playJetMarch(): void {
    this.play(this.effects.jetMarch);
  }

  playBattleshipBuzz(): void {
    this.play(this.effects.battleshipBuzz);
  }

  playLauncherHit(hitNumber: 1 | 2): void {
    this.play(launcherHitBeeps(hitNumber));
  }

  playGameOver(): void {
    this.play(this.effects.gameOver);
  }

  playWin(): void {
    this.play(this.effects.win);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.driver.setMuted(muted);
  }

  isMuted(): boolean {
    return this.muted;
  }
}

/**
 * Create the audio system. Does not open an AudioContext immediately (browsers
 * block autoplay); the default driver lazily creates and resumes it on the first
 * user gesture. Pass a driver to inject a stub in tests.
 */
export async function createAudioSystem(
  driver: AudioDriver = new WebAudioDriver(),
): Promise<AudioSystem> {
  return new AudioEngine(driver);
}

// ---------------------------------------------------------------------------
// WebAudioDriver: the untested Web Audio boundary (no AudioContext in vitest's
// node env). Kept deliberately thin; all logic worth testing lives above.
// ---------------------------------------------------------------------------

type WindowWithWebkit = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/** Gesture events after which browsers allow audio to start. */
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Ramp used to gate a beep on/off without a click, seconds. */
const GATE_RAMP = 0.006;

class WebAudioDriver implements AudioDriver {
  private ctx: AudioContext | null = null;
  private muteGain: GainNode | null = null;
  private starting: Promise<void> | null = null;
  private muted = false;
  private detachGestures: (() => void) | null = null;

  constructor() {
    this.attachGestureListeners();
  }

  private attachGestureListeners(): void {
    if (typeof window === 'undefined') return;
    const onGesture = (): void => {
      void this.start();
    };
    for (const evt of GESTURE_EVENTS) {
      window.addEventListener(evt, onGesture, { passive: true });
    }
    this.detachGestures = () => {
      for (const evt of GESTURE_EVENTS) {
        window.removeEventListener(evt, onGesture);
      }
    };
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.open();
    return this.starting;
  }

  private async open(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.muteGain = this.ctx.createGain();
      this.muteGain.gain.value = this.muted ? 0 : 1;
      this.muteGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    // Context is running; gesture listeners are done.
    this.detachGestures?.();
    this.detachGestures = null;
  }

  isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  playEffect(spec: EffectSpec): void {
    if (!this.ctx || !this.muteGain) return;
    const t0 = this.ctx.currentTime;

    // Schedule each step's frequency, accumulating start times across gaps.
    const osc = this.ctx.createOscillator();
    osc.type = spec.type;
    const segs: { start: number; end: number; gap: number }[] = [];
    let t = t0;
    for (const step of spec.steps) {
      const start = t;
      const end = start + step.durationMs / 1000;
      const gap = (step.gapMs ?? 0) / 1000;
      osc.frequency.setValueAtTime(step.freq, start);
      segs.push({ start, end, gap });
      t = end + gap;
    }
    const overallEnd = segs[segs.length - 1].end;

    // Envelope: initial attack to peak, a silent gate across any gaps, final release.
    const gainNode = this.ctx.createGain();
    const g = gainNode.gain;
    const peak = spec.gain;
    const attack = spec.attackMs / 1000;
    const release = spec.releaseMs / 1000;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i];
      if (seg.gap <= 0) continue;
      // Hold, drop to silence for the gap, then ramp back up at the next beep.
      g.setValueAtTime(peak, Math.max(seg.end - GATE_RAMP, t0 + attack));
      g.linearRampToValueAtTime(0, seg.end);
      const next = segs[i + 1].start;
      g.setValueAtTime(0, next);
      g.linearRampToValueAtTime(peak, next + GATE_RAMP);
    }
    g.setValueAtTime(peak, overallEnd);
    g.linearRampToValueAtTime(0, overallEnd + release);

    osc.connect(gainNode).connect(this.muteGain);
    osc.start(t0);
    osc.stop(overallEnd + release);

    if (spec.noise) {
      this.playNoise(spec.noise, t0);
    }
  }

  /** Layer a lowpassed, decaying white-noise burst (the loss sound's rasp). */
  private playNoise(noise: NoiseSpec, t0: number): void {
    if (!this.ctx || !this.muteGain) return;
    const dur = noise.durationMs / 1000;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = noise.lowpassHz;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(noise.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(gain).connect(this.muteGain);
    src.start(t0);
    src.stop(t0 + dur);
  }

  private cachedNoise: AudioBuffer | null = null;

  /** A one-second white-noise buffer, generated once and reused (truncated by play length). */
  private noiseBuffer(): AudioBuffer {
    if (this.cachedNoise) return this.cachedNoise;
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.cachedNoise = buf;
    return buf;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.muteGain) return;
    // Short ramp instead of a hard set to avoid a click.
    const now = this.ctx.currentTime;
    this.muteGain.gain.cancelScheduledValues(now);
    this.muteGain.gain.setValueAtTime(this.muteGain.gain.value, now);
    this.muteGain.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.02);
  }
}
