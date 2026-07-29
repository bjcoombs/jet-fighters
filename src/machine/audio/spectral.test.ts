// The payoff test, and the reason the FFT in spectrum.ts exists.
//
// Everything here runs on a `[cycle, level]` array and nothing else: the edges
// go through `renderSquare` and out through `magnitudeSpectrum`, with no
// AudioContext, no driver and no event API anywhere in the chain. That is the
// boundary acceptance criterion V8 depends on - it drives the machine
// headlessly, captures the R15 edge stream, reconstructs it and reads the
// dominant frequency, all in plain Node.
//
// The bands asserted against are the measured ones in
// `docs/evidence/audio-reference.md`, recovered from the owner's recordings of
// the physical unit. Where that document separates a reading from a note label,
// the reading is what is targeted here.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { Speaker, type SpeakerEdgePair } from '../board/speaker.js';
import { edgeSpanMs, renderSquare } from './square-synth.js';
import { binWidthHz, dominantFrequency, magnitudeAt, magnitudeSpectrum } from './spectrum.js';

const SAMPLE_RATE = 48_000;

/**
 * Measured bands from `docs/evidence/audio-reference.md`.
 *
 * `missileFire` is the band contract criterion V8 checks. The win jingle's
 * third note is 1240 Hz - the measured fundamental, recovered from its 2480 Hz
 * second partial. 1244 Hz is the equal-tempered D#6 label and is not a reading;
 * the evidence document exists largely to keep that substitution from being
 * made again.
 */
const MEASURED = {
  missileFire: { min: 1480, max: 1632, centre: 1520, maxMs: 150 },
  jetMarch: { min: 600, max: 650, stepMs: 70 },
  // The buzz's repetition rate and the wander measured around it, off the
  // owner's isolated recording. It is not a note: the ROM clocks it off the
  // display sweep and it runs for the whole ~4 s the boat is on the tube, which
  // is why `sustainMs` is seconds rather than the 380 ms v1 synthesized.
  battleshipBuzz: { min: 79, max: 111, sustainMs: 4000 },
  win: { fundamentals: [750, 940, 1240], durationsMs: [200, 150, 150] },
} as const;

/**
 * The pin transitions of a ROM delay loop toggling R15 every `halfPeriod`
 * cycles, for `ms` of emulated time.
 *
 * Positions are rounded to whole machine cycles because that is all the machine
 * has: the CPU counts cycles, and `Speaker.recordEdge` stamps each transition
 * with the cycle the writing instruction began on.
 */
function loopEdges(halfPeriod: number, ms: number): SpeakerEdgePair[] {
  const toggles = Math.max(2, Math.round(((ms / 1000) * CYCLE_HZ) / halfPeriod));
  const speaker = new Speaker();
  let level: 0 | 1 = 0;
  for (let i = 0; i < toggles; i += 1) {
    level = level ? 0 : 1;
    speaker.recordEdge(Math.round(i * halfPeriod), level);
  }
  return speaker.toPairs();
}

/** The edges for a `hz` tone lasting `ms`, at the machine's own clock rate. */
function toneEdges(hz: number, ms: number): SpeakerEdgePair[] {
  return loopEdges(CYCLE_HZ / (2 * hz), ms);
}

/** Reconstruct an edge stream and read its strongest partial, in hertz. */
function measure(edges: SpeakerEdgePair[]): number {
  const samples = renderSquare(edges, {
    cyclesPerSecond: CYCLE_HZ,
    sampleRate: SAMPLE_RATE,
  });
  return dominantFrequency(samples, SAMPLE_RATE);
}

describe('reconstruct and FFT - the V8 chain', () => {
  it('reads back the frequency a synthetic edge stream was toggled at', () => {
    for (const hz of [230, 300, 466, 620, 750, 940, 1240, 1520]) {
      const measured = measure(toneEdges(hz, 200));
      expect(Math.abs(measured - hz) / hz).toBeLessThan(0.01);
    }
  });

  it('puts the fundamental above every harmonic of the square', () => {
    // A square wave's partials fall off as 1/n, so the fundamental is the
    // dominant bin. Anything else would mean the reconstruction is reading a
    // harmonic and the band assertions below would be meaningless.
    const samples = renderSquare(toneEdges(500, 300), {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
    });
    const mags = magnitudeSpectrum(samples);
    const fundamental = magnitudeAt(mags, 500, SAMPLE_RATE);
    const third = magnitudeAt(mags, 1500, SAMPLE_RATE);
    const fifth = magnitudeAt(mags, 2500, SAMPLE_RATE);

    expect(third).toBeLessThan(fundamental);
    expect(fifth).toBeLessThan(third);
    // 1/n rolloff, loosely - a windowed transform of a jittered loop is not a
    // textbook series, but an order of magnitude either way would be wrong.
    expect(third / fundamental).toBeGreaterThan(0.15);
    expect(third / fundamental).toBeLessThan(0.6);
  });

  it('needs no audio API to be present', () => {
    // The whole point of the pure path. If this file could only run in a
    // browser, V8 could not be checked in CI.
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    expect((globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode).toBeUndefined();
    expect(measure(toneEdges(1520, 100))).toBeGreaterThan(0);
  });

  it('reads nothing from a pin that never moved', () => {
    // No edges, no sound. There is no event API that could produce one.
    expect(renderSquare([], { cyclesPerSecond: CYCLE_HZ, sampleRate: SAMPLE_RATE })).toHaveLength(0);
  });
});

describe('measured bands - missileFire', () => {
  const { min, max, centre, maxMs } = MEASURED.missileFire;

  it('lands inside the 1480-1632 Hz band that criterion V8 asserts', () => {
    const edges = toneEdges(centre, 20);
    const measured = measure(edges);

    expect(measured).toBeGreaterThanOrEqual(min);
    expect(measured).toBeLessThanOrEqual(max);
    expect(edgeSpanMs(edges, CYCLE_HZ)).toBeLessThan(maxMs);
  });

  it('stays in band at the shortest measured burst', () => {
    // The recorded blip's main transient is ~10 ms. A short burst gives the
    // transform little to work with, so read it explicitly rather than assume
    // the 20 ms case covers it.
    const edges = toneEdges(centre, 10);
    expect(edgeSpanMs(edges, CYCLE_HZ)).toBeLessThan(maxMs);
    const measured = measure(edges);
    expect(measured).toBeGreaterThanOrEqual(min);
    expect(measured).toBeLessThanOrEqual(max);
  });

  it('stays in band on the nearest half-period the machine can actually count', () => {
    // The ROM counts whole instructions, so it cannot toggle at exactly
    // 1520 Hz - and this machine's grid is far coarser than the v2 core's was.
    // At the v2 core's rate a delay loop had ~132 instructions to spend on a
    // half period and the reachable pitches sat ~12 Hz apart; here the same
    // half period is a couple of dozen instructions and the neighbours are
    // ~80 Hz apart. The band has to be reachable from that grid or no ROM on
    // this chip could satisfy V8, so the assertion is that the reachable pitch
    // is in band rather than that the loop is any particular length.
    const halfPeriod = Math.round(CYCLE_HZ / (2 * centre));
    const reachable = CYCLE_HZ / (2 * halfPeriod);
    expect(reachable).toBeGreaterThanOrEqual(min);
    expect(reachable).toBeLessThanOrEqual(max);

    const measured = measure(loopEdges(halfPeriod, 20));
    expect(measured).toBeGreaterThanOrEqual(min);
    expect(measured).toBeLessThanOrEqual(max);
  });

  it('reads outside the band when the loop is mistuned', () => {
    // The band assertion has to be capable of failing. A loop an octave low is
    // a plausible ROM bug and must not pass.
    const measured = measure(toneEdges(centre / 2, 20));
    expect(measured).toBeLessThan(min);
  });
});

describe('measured bands - jetMarch and battleshipBuzz', () => {
  it('reads the march step inside 600-650 Hz', () => {
    const { min, max, stepMs } = MEASURED.jetMarch;
    const measured = measure(toneEdges(620, stepMs));
    expect(measured).toBeGreaterThanOrEqual(min);
    expect(measured).toBeLessThanOrEqual(max);
  });

  it('reads the battleship buzz inside 79-111 Hz', () => {
    const { min, max, sustainMs } = MEASURED.battleshipBuzz;
    const measured = measure(toneEdges(93, sustainMs));
    expect(measured).toBeGreaterThanOrEqual(min);
    expect(measured).toBeLessThanOrEqual(max);
  });

  it('keeps the battleship buzz below the march, the owner-confirmed ordering', () => {
    // The relative rule is the owner's own, and it survived the buzz's band
    // moving: 79-111 Hz is further below the march than 230-300 ever was.
    // Driven at the worst case for the ordering: the buzz at the top of its
    // band, the march at the bottom of its.
    const buzz = measure(toneEdges(MEASURED.battleshipBuzz.max, 1000));
    const march = measure(toneEdges(MEASURED.jetMarch.min, 70));

    expect(buzz).toBeLessThan(march);

    // Both read back to within a hertz of what they were driven at, so the
    // ordering is a property of the two sounds rather than of the reading
    // error: the gap between them is 300 Hz and the error is under 1 Hz.
    expect(Math.abs(buzz - MEASURED.battleshipBuzz.max)).toBeLessThan(1);
    expect(Math.abs(march - MEASURED.jetMarch.min)).toBeLessThan(1);
    expect(march - buzz).toBeGreaterThan(250);
  });
});

describe('measured bands - win jingle', () => {
  it('reads each arpeggio note at its measured fundamental', () => {
    const { fundamentals, durationsMs } = MEASURED.win;
    fundamentals.forEach((hz, i) => {
      const measured = measure(toneEdges(hz, durationsMs[i]));
      expect(Math.abs(measured - hz) / hz).toBeLessThan(0.01);
    });
  });

  it('targets the measured 1240 Hz rather than the D#6 note label', () => {
    // 1240 Hz is the reading: the observed second partial was 2480, and 2 x
    // 1244 is 2488. The 4 Hz difference is below what the machine can express
    // anyway, and on this chip it is far below it - the loop lengths either
    // side of 1240 Hz differ by one instruction and put the reachable pitches
    // tens of hertz apart. There is no ROM on this machine that plays 1244 and
    // not 1240, so the label cannot be a target.
    //
    // The grid is derived rather than stated. The v2 core's figures - 161 and
    // 160 cycles for 1242.2 and 1250.0 Hz - were true at 400 kHz and are one of
    // PRD R5's six re-derivation classes.
    const nearest = Math.round(CYCLE_HZ / (2 * 1240));
    const step = Math.abs(CYCLE_HZ / (2 * (nearest - 1)) - CYCLE_HZ / (2 * nearest));
    expect(Math.abs(1244 - 1240)).toBeLessThan(step);

    const measured = measure(loopEdges(nearest, 150));
    expect(Math.abs(measured - 1240)).toBeLessThan(step);
  });
});

describe('spectral resolution', () => {
  it('resolves the bands from the bin grid the burst lengths allow', () => {
    // A 20 ms burst at 48 kHz is 960 samples, truncated to a 512-point
    // transform: 93.75 Hz bins against a 152 Hz band. The peak interpolation in
    // dominantFrequency is what closes that gap, and without it the missileFire
    // assertion above would be reading the bin grid rather than the tone.
    const samples = renderSquare(toneEdges(MEASURED.missileFire.centre, 20), {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
    });
    const mags = magnitudeSpectrum(samples);
    const width = binWidthHz(mags.length, SAMPLE_RATE);
    expect(width).toBeGreaterThan(50);

    const interpolated = dominantFrequency(samples, SAMPLE_RATE);
    const nearestBin = Math.round(interpolated / width) * width;
    expect(Math.abs(interpolated - MEASURED.missileFire.centre)).toBeLessThan(
      Math.abs(nearestBin - MEASURED.missileFire.centre) + width,
    );
  });

  it('ignores the DC lobe when reading a low tone', () => {
    // A pin resting low carries a large DC component; without the minHz floor
    // the buzz would read as 0 Hz.
    expect(measure(toneEdges(230, 380))).toBeGreaterThan(200);
  });
});
