// Web Audio sound engine for Jet Fighters (PRD R6).
//
// Every effect is synthesized live from an OscillatorNode square wave - the
// period-authentic waveform for the original unit's piezo speaker. No sampled
// clips ship: the reference recording (assets/reference/gameplay-audio.m4a) is
// ground truth we measure and imitate, not audio we bundle.
//
// Each recipe is a pure data definition (square-wave frequency steps, an
// amplitude envelope, and for the explosion a shaped noise burst). Because the
// recipes carry no Web APIs they are fully unit-testable. The engine (routing,
// mute, gesture gating) is likewise pure and tested against an injected
// AudioDriver stub. The WebAudioDriver at the bottom is the thin, untested
// boundary that owns the AudioContext and turns a recipe into scheduled nodes.
//
// Reference provenance (frequencies from a windowed-FFT / harmonic-product-
// spectrum sweep of the recording; timestamps are into gameplay-audio.m4a):
//   - missileFire:    ~1.55 kHz blip, ~70 ms                       (~7.30 s)
//   - jetMarch:       ~620 Hz step buzz, re-triggered per march step (dense section ~70 s)
//   - battleshipBuzz: ~300 Hz sustained low buzz                   (dense section)
//   - explosion:      square descent 1.2 kHz -> 300 Hz + noise crash
//   - gameOver:       melodic jingle, F#5-A#5-D#6 arpeggio x3 resolving
//                     through E6 to A#5, ~1.9 s                     (~120.4 s)
//   - win:            NOT present in the recording. The reference holds a single
//                     melodic vocabulary (the same F#5-A#5-D#6 motif also recurs
//                     at ~12 s and ~28 s), so the win jingle is composed here as
//                     a celebratory ascending fanfare in that same key/timbre,
//                     landing on a held A#6. Confirm against hardware if found.

/** The six game sound effects. */
export type EffectName =
  | 'missileFire'
  | 'jetMarch'
  | 'battleshipBuzz'
  | 'explosion'
  | 'gameOver'
  | 'win';

/** One step of a synthesized tone: a frequency held for a duration. */
export interface ToneStep {
  readonly freq: number;
  readonly durationMs: number;
}

/** A shaped noise burst layered under a tone (the explosion's crash). */
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
 * frequencies under a single attack/release envelope, optionally layered with a
 * noise burst. A single-step recipe is a blip or sustained buzz; a multi-step
 * recipe is a melodic jingle (the oscillator glides between pitches piezo-style).
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
  /** Optional layered noise burst (used by the explosion). */
  readonly noise?: NoiseSpec;
}

// Measured piezo pitches from the reference jingle (Hz, left detuned as heard).
const F5s = 751; // F#5
const A5s = 937; // A#5
const D6s = 1249; // D#6
const E6 = 1284; // E6
const F6s = 1502; // F#6 (octave of F#5)
const A6s = 1874; // A#6 (octave of A#5)

/**
 * The effect table: which sound each game event makes. Every entry is a
 * synthesized square-wave recipe; see the provenance block above for the
 * reference timestamp each one imitates.
 */
export const EFFECTS: Record<EffectName, EffectSpec> = {
  // Sharp high blip, near-steady ~1.55 kHz with a tiny downward chirp for "pew".
  missileFire: {
    type: 'square',
    steps: [
      { freq: 1600, durationMs: 25 },
      { freq: 1500, durationMs: 50 },
    ],
    gain: 0.5,
    attackMs: 1,
    releaseMs: 25,
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
  // Fast descending crash: square glide 1.2 kHz -> 300 Hz plus a dark noise burst.
  explosion: {
    type: 'square',
    steps: [
      { freq: 1200, durationMs: 45 },
      { freq: 820, durationMs: 55 },
      { freq: 520, durationMs: 60 },
      { freq: 300, durationMs: 70 },
    ],
    gain: 0.4,
    attackMs: 1,
    releaseMs: 60,
    noise: { gain: 0.3, durationMs: 220, lowpassHz: 900 },
  },
  // Transcribed end jingle: F#5-A#5-D#6 arpeggio x3, resolving E6 -> A#5 (~1.9 s).
  gameOver: {
    type: 'square',
    steps: [
      { freq: F5s, durationMs: 250 },
      { freq: A5s, durationMs: 150 },
      { freq: D6s, durationMs: 130 },
      { freq: F5s, durationMs: 290 },
      { freq: A5s, durationMs: 110 },
      { freq: D6s, durationMs: 150 },
      { freq: F5s, durationMs: 250 },
      { freq: A5s, durationMs: 110 },
      { freq: D6s, durationMs: 200 },
      { freq: E6, durationMs: 150 },
      { freq: A5s, durationMs: 180 },
    ],
    gain: 0.32,
    attackMs: 4,
    releaseMs: 90,
  },
  // Composed victory fanfare (199 points): the reference's F# vocabulary driven
  // clearly upward - a rising arpeggio landing on a held high A#6.
  win: {
    type: 'square',
    steps: [
      { freq: F5s, durationMs: 110 },
      { freq: A5s, durationMs: 110 },
      { freq: D6s, durationMs: 110 },
      { freq: F6s, durationMs: 130 },
      { freq: D6s, durationMs: 90 },
      { freq: F6s, durationMs: 130 },
      { freq: A6s, durationMs: 360 },
    ],
    gain: 0.34,
    attackMs: 3,
    releaseMs: 110,
  },
};

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
  playMissileFire(): void;
  playJetMarch(): void;
  playBattleshipBuzz(): void;
  playExplosion(): void;
  playGameOver(): void;
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

  private trigger(name: EffectName): void {
    // Skip work while muted; the shared gain node also silences any in-flight tails.
    if (this.muted) return;
    // Before the first user gesture the context is suspended: soft-fail silently.
    if (!this.driver.isReady()) return;
    this.driver.playEffect(this.effects[name]);
  }

  playMissileFire(): void {
    this.trigger('missileFire');
  }

  playJetMarch(): void {
    this.trigger('jetMarch');
  }

  playBattleshipBuzz(): void {
    this.trigger('battleshipBuzz');
  }

  playExplosion(): void {
    this.trigger('explosion');
  }

  playGameOver(): void {
    this.trigger('gameOver');
  }

  playWin(): void {
    this.trigger('win');
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

    // Square-wave oscillator stepped through the recipe's frequencies.
    const osc = this.ctx.createOscillator();
    osc.type = spec.type;
    let t = t0;
    for (const step of spec.steps) {
      osc.frequency.setValueAtTime(step.freq, t);
      t += step.durationMs / 1000;
    }
    const end = t;

    const gain = this.ctx.createGain();
    const attack = spec.attackMs / 1000;
    const release = spec.releaseMs / 1000;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(spec.gain, t0 + attack);
    gain.gain.setValueAtTime(spec.gain, end);
    gain.gain.linearRampToValueAtTime(0, end + release);

    osc.connect(gain).connect(this.muteGain);
    osc.start(t0);
    osc.stop(end + release);

    if (spec.noise) {
      this.playNoise(spec.noise, t0);
    }
  }

  /** Layer a lowpassed, decaying white-noise burst (the explosion's crash). */
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
