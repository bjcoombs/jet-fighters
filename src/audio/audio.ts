// Web Audio sound engine for Jet Fighters (PRD R6).
//
// Two playback paths:
//   - "clip" effects play short buffers decoded from files extracted and cleaned
//     from the reference recording (assets/reference/gameplay-audio.m4a).
//   - "tone" effects are synthesized live with an OscillatorNode square wave, the
//     period-authentic waveform for the original unit's piezo speaker. These stand
//     in for effects that could not be isolated cleanly from the room-noise-heavy
//     recording; their frequencies are matched to the reference spectrogram.
//
// The engine (routing, mute, gesture gating) is pure and unit-tested against an
// injected AudioDriver stub. The WebAudioDriver at the bottom is the thin, untested
// boundary that owns the AudioContext and the actual decode/schedule calls.

/** The five game sound effects. */
export type EffectName =
  | 'missileFire'
  | 'jetMarch'
  | 'battleshipBuzz'
  | 'explosion'
  | 'gameOver';

/** An effect backed by a decoded audio file. */
export interface ClipEffect {
  readonly kind: 'clip';
  /** Path relative to the served base URL (e.g. `audio/missile-fire.wav`). */
  readonly url: string;
  /** Playback gain, 0..1. */
  readonly gain: number;
}

/** One step of a synthesized tone: a frequency held for a duration. */
export interface ToneStep {
  readonly freq: number;
  readonly durationMs: number;
}

/** An effect synthesized from oscillator steps. */
export interface ToneEffect {
  readonly kind: 'tone';
  readonly type: OscillatorType;
  readonly steps: readonly ToneStep[];
  /** Peak gain, 0..1. */
  readonly gain: number;
  /** Attack ramp to peak gain, milliseconds. */
  readonly attackMs: number;
  /** Release ramp to silence after the last step, milliseconds. */
  readonly releaseMs: number;
}

export type EffectSpec = ClipEffect | ToneEffect;

/**
 * The effect table: which sound each game event makes.
 *
 * Extracted from the reference recording (clip):
 *   - missileFire: isolated ~1.5 kHz blip from the sparse early section (~7.33 s).
 *   - gameOver:    the ~1.7 s melodic end jingle the unit plays as the recording ends (~120.4 s).
 *
 * Synthesized square waves (tone), frequency-matched to the reference spectrogram,
 * because these events only occur inside the dense, room-noise-contaminated section
 * and could not be isolated cleanly:
 *   - jetMarch:       a short step buzz; the marching rhythm comes from the game
 *                     re-triggering it per step (~620 Hz march fundamental).
 *   - battleshipBuzz: a distinctly lower, sustained buzz (~300 Hz) per the "lower pitch" rule.
 *   - explosion:      a fast descending crash (1.2 kHz -> 300 Hz).
 */
export const EFFECTS: Record<EffectName, EffectSpec> = {
  missileFire: { kind: 'clip', url: 'audio/missile-fire.wav', gain: 0.9 },
  gameOver: { kind: 'clip', url: 'audio/game-over.mp3', gain: 0.85 },
  jetMarch: {
    kind: 'tone',
    type: 'square',
    steps: [{ freq: 620, durationMs: 70 }],
    gain: 0.28,
    attackMs: 1,
    releaseMs: 25,
  },
  battleshipBuzz: {
    kind: 'tone',
    type: 'square',
    steps: [{ freq: 300, durationMs: 380 }],
    gain: 0.32,
    attackMs: 2,
    releaseMs: 40,
  },
  explosion: {
    kind: 'tone',
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
  },
};

/** The subset of effects that load from files, used to preload/decode buffers. */
export function clipEffects(
  effects: Record<EffectName, EffectSpec> = EFFECTS,
): { name: EffectName; url: string }[] {
  return (Object.keys(effects) as EffectName[])
    .filter((name): name is EffectName => effects[name].kind === 'clip')
    .map((name) => ({ name, url: (effects[name] as ClipEffect).url }));
}

/**
 * The thin decode/play boundary the engine drives. The real implementation owns
 * the AudioContext; tests inject a stub. Every method must be safe to call before
 * the context exists (soft-fail), so the engine never has to guard timing.
 */
export interface AudioDriver {
  /** Create/resume the AudioContext and begin decoding clips. Call on a user gesture. */
  start(): Promise<void>;
  /** True once the context is running and clips are ready to play without delay. */
  isReady(): boolean;
  /** Play a preloaded clip immediately. No-op if not ready. */
  playClip(name: EffectName, effect: ClipEffect): void;
  /** Play a synthesized tone immediately. No-op if the context is not running. */
  playTone(effect: ToneEffect): void;
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
    const spec = this.effects[name];
    if (spec.kind === 'clip') {
      this.driver.playClip(name, spec);
    } else {
      this.driver.playTone(spec);
    }
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
 * user gesture and preloads clips then. Pass a driver to inject a stub in tests.
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
  private readonly buffers = new Map<EffectName, AudioBuffer>();
  private readonly rawClips = new Map<EffectName, ArrayBuffer>();
  private starting: Promise<void> | null = null;
  private muted = false;
  private detachGestures: (() => void) | null = null;
  private readonly base: string;

  constructor() {
    this.base = resolveBaseUrl();
    // Eagerly fetch the raw clip bytes (allowed without a gesture); decode later.
    void this.prefetchClips();
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

  private async prefetchClips(): Promise<void> {
    if (typeof fetch === 'undefined') return;
    await Promise.all(
      clipEffects().map(async ({ name, url }) => {
        try {
          const res = await fetch(this.base + url);
          this.rawClips.set(name, await res.arrayBuffer());
        } catch {
          // Missing clip: the effect simply stays silent.
        }
      }),
    );
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
    await this.decodeClips();
    // Context is running and clips are decoded; gesture listeners are done.
    this.detachGestures?.();
    this.detachGestures = null;
  }

  private async decodeClips(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      [...this.rawClips.entries()].map(async ([name, bytes]) => {
        if (this.buffers.has(name)) return;
        try {
          // slice() so the ArrayBuffer stays reusable if decode is retried.
          const buf = await this.ctx!.decodeAudioData(bytes.slice(0));
          this.buffers.set(name, buf);
        } catch {
          // Undecodable clip: stays silent.
        }
      }),
    );
  }

  isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  playClip(name: EffectName, effect: ClipEffect): void {
    const buffer = this.buffers.get(name);
    if (!this.ctx || !this.muteGain || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = effect.gain;
    src.connect(gain).connect(this.muteGain);
    src.start();
  }

  playTone(effect: ToneEffect): void {
    if (!this.ctx || !this.muteGain) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = effect.type;

    // Schedule each step's frequency as a stair-step.
    let t = t0;
    for (const step of effect.steps) {
      osc.frequency.setValueAtTime(step.freq, t);
      t += step.durationMs / 1000;
    }
    const end = t;

    const gain = this.ctx.createGain();
    const attack = effect.attackMs / 1000;
    const release = effect.releaseMs / 1000;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(effect.gain, t0 + attack);
    gain.gain.setValueAtTime(effect.gain, end);
    gain.gain.linearRampToValueAtTime(0, end + release);

    osc.connect(gain).connect(this.muteGain);
    osc.start(t0);
    osc.stop(end + release);
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

function resolveBaseUrl(): string {
  // import.meta.env.BASE_URL is Vite's served base (e.g. `/jet-fighters/`).
  const base = import.meta.env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : base + '/';
}
