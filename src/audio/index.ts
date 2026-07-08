// Public surface of the audio subsystem (PRD R6).
// The engine and effect table live in ./audio; this file is the import point for
// the rest of the app.

export type {
  AudioSystem,
  AudioDriver,
  EffectName,
  EffectSpec,
  ToneStep,
  NoiseSpec,
} from './audio.js';
export { createAudioSystem, AudioEngine, EFFECTS } from './audio.js';

// Retained scaffold marker so the placeholder wiring in main.ts keeps compiling
// until the integration task (PRD R7) replaces it.
export const AUDIO_MODULE = 'audio' as const;
