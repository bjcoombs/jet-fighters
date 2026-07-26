// A small real-signal FFT, written here rather than taken from a package.
//
// The project ships zero runtime dependencies (PRD, CLAUDE.md) and acceptance
// criterion V5 has to reconstruct the D14 waveform and take its FFT headlessly
// in Node, so the transform has to exist inside the repo and outside any audio
// API. It is deliberately plain: an iterative radix-2 Cooley-Tukey, a Hann
// window, and enough peak interpolation to read a fundamental off a bin grid
// coarser than the tolerance the measured bands demand.
//
// Pure: no AudioContext, no DOM, no timers.

/** Complex spectrum as split real and imaginary halves. */
export interface Spectrum {
  readonly real: Float64Array;
  readonly imag: Float64Array;
}

/** True for powers of two, the only lengths the radix-2 transform accepts. */
export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/** Largest power of two that is at most `n`. */
export function floorPowerOfTwo(n: number): number {
  if (n < 1) {
    return 0;
  }
  return 2 ** Math.floor(Math.log2(n));
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 *
 * `real` and `imag` must be the same power-of-two length and are overwritten
 * with the transform.
 */
export function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (imag.length !== n) {
    throw new RangeError(`real and imag must match: ${n} vs ${imag.length}`);
  }
  if (!isPowerOfTwo(n)) {
    throw new RangeError(`length must be a power of two: ${n}`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = real[i + k];
        const ai = imag[i + k];
        const br = real[i + k + len / 2];
        const bi = imag[i + k + len / 2];
        const tr = br * cr - bi * ci;
        const ti = br * ci + bi * cr;
        real[i + k] = ar + tr;
        imag[i + k] = ai + ti;
        real[i + k + len / 2] = ar - tr;
        imag[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Transform a real signal. Length must be a power of two. */
export function fft(samples: ArrayLike<number>): Spectrum {
  const n = samples.length;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    real[i] = samples[i];
  }
  fftInPlace(real, imag);
  return { real, imag };
}

/** Hann window of length `n`, for leakage control on a non-periodic slice. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i += 1) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

/**
 * Magnitude spectrum of a real signal, bins 0 to n/2 inclusive.
 *
 * The signal is truncated to the largest power of two it contains and
 * Hann-windowed unless `window` is false. Bin `k` sits at
 * `k * sampleRate / n` hertz.
 */
export function magnitudeSpectrum(
  samples: ArrayLike<number>,
  options: { readonly window?: boolean } = {},
): Float64Array {
  const n = floorPowerOfTwo(samples.length);
  if (n < 2) {
    throw new RangeError(`need at least 2 samples, got ${samples.length}`);
  }
  const windowed = new Float64Array(n);
  const w = options.window === false ? null : hannWindow(n);
  for (let i = 0; i < n; i += 1) {
    windowed[i] = w ? samples[i] * w[i] : samples[i];
  }
  const { real, imag } = fft(windowed);
  const half = n / 2;
  const mags = new Float64Array(half + 1);
  for (let k = 0; k <= half; k += 1) {
    mags[k] = Math.hypot(real[k], imag[k]);
  }
  return mags;
}

/** Hertz per bin for a spectrum of `binCount` bins (n/2 + 1) at `sampleRate`. */
export function binWidthHz(binCount: number, sampleRate: number): number {
  return sampleRate / (2 * (binCount - 1));
}

export interface PeakOptions {
  /** Ignore bins below this frequency. Defaults to 20 Hz, killing the DC lobe. */
  readonly minHz?: number;
  /** Ignore bins above this frequency. Defaults to Nyquist. */
  readonly maxHz?: number;
  /** Hann-window the slice. Defaults to true. */
  readonly window?: boolean;
}

/**
 * Frequency of the strongest partial in hertz.
 *
 * The peak bin is refined by parabolic interpolation over its neighbours in the
 * log-magnitude domain, which is what makes a coarse transform usable: at 48 kHz
 * a 4096-point FFT has 11.7 Hz bins, and the win jingle's 1240 Hz reading has to
 * be told apart from the 1244 Hz note label 4 Hz away.
 *
 * Returns 0 when the slice carries no energy above `minHz`.
 */
export function dominantFrequency(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: PeakOptions = {},
): number {
  const mags = magnitudeSpectrum(samples, { window: options.window });
  const width = binWidthHz(mags.length, sampleRate);
  const minHz = options.minHz ?? 20;
  const maxHz = options.maxHz ?? sampleRate / 2;
  const first = Math.max(1, Math.ceil(minHz / width));
  const last = Math.min(mags.length - 1, Math.floor(maxHz / width));

  let peak = -1;
  let best = 0;
  for (let k = first; k <= last; k += 1) {
    if (mags[k] > best) {
      best = mags[k];
      peak = k;
    }
  }
  if (peak < 0 || best <= 0) {
    return 0;
  }

  let offset = 0;
  if (peak > 0 && peak < mags.length - 1) {
    const tiny = Number.MIN_VALUE;
    const a = Math.log(mags[peak - 1] + tiny);
    const b = Math.log(mags[peak] + tiny);
    const c = Math.log(mags[peak + 1] + tiny);
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      offset = (0.5 * (a - c)) / denom;
      if (!Number.isFinite(offset) || Math.abs(offset) > 0.5) {
        offset = 0;
      }
    }
  }
  return (peak + offset) * width;
}

/**
 * Magnitude at a given frequency, interpolated between the two nearest bins.
 *
 * Used by the spectral tests to compare a square wave's harmonics against its
 * fundamental without depending on where the bin grid happens to fall.
 */
export function magnitudeAt(
  mags: ArrayLike<number>,
  hz: number,
  sampleRate: number,
): number {
  const width = binWidthHz(mags.length, sampleRate);
  const pos = hz / width;
  const lo = Math.floor(pos);
  if (lo < 0 || lo >= mags.length - 1) {
    return 0;
  }
  const frac = pos - lo;
  return mags[lo] * (1 - frac) + mags[lo + 1] * frac;
}
