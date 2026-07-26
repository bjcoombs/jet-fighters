import { describe, it, expect } from 'vitest';
import {
  binWidthHz,
  dominantFrequency,
  fft,
  fftInPlace,
  floorPowerOfTwo,
  hannWindow,
  isPowerOfTwo,
  magnitudeAt,
  magnitudeSpectrum,
} from './spectrum.js';

const SAMPLE_RATE = 48_000;

function sine(hz: number, length: number, sampleRate = SAMPLE_RATE): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

/** Reference DFT, O(n^2), to check the fast transform against. */
function slowDft(samples: ArrayLike<number>): { real: number[]; imag: number[] } {
  const n = samples.length;
  const real: number[] = [];
  const imag: number[] = [];
  for (let k = 0; k < n; k += 1) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = (-2 * Math.PI * k * t) / n;
      re += samples[t] * Math.cos(angle);
      im += samples[t] * Math.sin(angle);
    }
    real.push(re);
    imag.push(im);
  }
  return { real, imag };
}

describe('power-of-two helpers', () => {
  it('recognises powers of two', () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(4096)).toBe(true);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(isPowerOfTwo(2.5)).toBe(false);
  });

  it('floors to the nearest power of two', () => {
    expect(floorPowerOfTwo(1000)).toBe(512);
    expect(floorPowerOfTwo(1024)).toBe(1024);
    expect(floorPowerOfTwo(0)).toBe(0);
  });
});

describe('fft', () => {
  it('matches a direct DFT', () => {
    const samples = sine(1500, 64);
    const fast = fft(samples);
    const slow = slowDft(samples);
    for (let k = 0; k < 64; k += 1) {
      expect(fast.real[k]).toBeCloseTo(slow.real[k], 8);
      expect(fast.imag[k]).toBeCloseTo(slow.imag[k], 8);
    }
  });

  it('transforms a DC signal to a single bin', () => {
    const dc = new Float64Array(16).fill(1);
    const { real, imag } = fft(dc);
    expect(real[0]).toBeCloseTo(16, 10);
    for (let k = 1; k < 16; k += 1) {
      expect(Math.hypot(real[k], imag[k])).toBeCloseTo(0, 10);
    }
  });

  it('places a bin-centred sine exactly on its bin', () => {
    // 8 cycles over 64 samples lands dead on bin 8.
    const n = 64;
    const samples = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      samples[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    }
    const { real, imag } = fft(samples);
    const mags = Array.from({ length: n / 2 + 1 }, (_, k) => Math.hypot(real[k], imag[k]));
    const peak = mags.indexOf(Math.max(...mags));
    expect(peak).toBe(8);
  });

  it('rejects a non-power-of-two length', () => {
    expect(() => fftInPlace(new Float64Array(3), new Float64Array(3))).toThrow(RangeError);
  });

  it('rejects mismatched real and imaginary halves', () => {
    expect(() => fftInPlace(new Float64Array(4), new Float64Array(8))).toThrow(RangeError);
  });
});

describe('hannWindow', () => {
  it('tapers to zero at both ends', () => {
    const w = hannWindow(64);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[63]).toBeCloseTo(0, 12);
    expect(w[32]).toBeGreaterThan(0.99);
  });

  it('degenerates to unity for a single sample', () => {
    expect(Array.from(hannWindow(1))).toEqual([1]);
  });
});

describe('magnitudeSpectrum', () => {
  it('returns n/2 + 1 bins for the largest power of two available', () => {
    expect(magnitudeSpectrum(new Float64Array(1000)).length).toBe(512 / 2 + 1);
  });

  it('rejects a slice too short to transform', () => {
    expect(() => magnitudeSpectrum([1])).toThrow(RangeError);
  });

  it('reports bin width from the sample rate', () => {
    expect(binWidthHz(2049, 48_000)).toBeCloseTo(48_000 / 4096, 10);
  });
});

describe('dominantFrequency', () => {
  it('recovers a pure tone to within a fraction of a bin', () => {
    const hz = 1520; // missileFire centre, docs/evidence/audio-reference.md
    expect(dominantFrequency(sine(hz, 8192), SAMPLE_RATE)).toBeCloseTo(hz, 0);
  });

  it('resolves finer than the raw bin grid', () => {
    // 4096 samples at 48 kHz is an 11.7 Hz grid; 1240 and 1244 Hz sit inside one
    // bin of each other, and audio-reference.md turns on telling them apart.
    const width = binWidthHz(4096 / 2 + 1, SAMPLE_RATE);
    expect(width).toBeGreaterThan(4);
    const measured = dominantFrequency(sine(1240, 4096), SAMPLE_RATE);
    expect(Math.abs(measured - 1240)).toBeLessThan(width / 2);
  });

  it('ignores DC by default', () => {
    const biased = sine(600, 8192).map((v) => v + 5);
    expect(dominantFrequency(biased, SAMPLE_RATE)).toBeCloseTo(600, 0);
  });

  it('honours an explicit search band', () => {
    const mixed = new Float64Array(8192);
    const low = sine(300, 8192);
    const high = sine(1500, 8192);
    for (let i = 0; i < mixed.length; i += 1) {
      mixed[i] = low[i] * 0.4 + high[i];
    }
    expect(dominantFrequency(mixed, SAMPLE_RATE)).toBeCloseTo(1500, 0);
    expect(dominantFrequency(mixed, SAMPLE_RATE, { maxHz: 800 })).toBeCloseTo(300, 0);
  });

  it('returns zero for silence', () => {
    expect(dominantFrequency(new Float64Array(4096), SAMPLE_RATE)).toBe(0);
  });
});

describe('magnitudeAt', () => {
  it('reads the fundamental louder than an absent harmonic', () => {
    const mags = magnitudeSpectrum(sine(1000, 8192));
    const fundamental = magnitudeAt(mags, 1000, SAMPLE_RATE);
    const second = magnitudeAt(mags, 2000, SAMPLE_RATE);
    expect(fundamental).toBeGreaterThan(second * 100);
  });

  it('returns zero outside the spectrum', () => {
    const mags = magnitudeSpectrum(sine(1000, 8192));
    expect(magnitudeAt(mags, 40_000, SAMPLE_RATE)).toBe(0);
  });
});
