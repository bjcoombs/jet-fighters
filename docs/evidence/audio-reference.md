# Audio reference measurements

Measured spectra and envelopes for every sound the original CGL "Jet Fighters" unit
makes, recovered from the owner's recordings of the physical device.

This file is the **ground truth for v2 acceptance**. The v2 machine emits sound by
toggling the D14 speaker pin in timed delay loops; the reconstructed pin-edge stream
is compared against the bands recorded here (PRD `docs/prd/jet-fighters-v2.md` R3/R7,
acceptance contract `docs/contract/v2.contract.md` criterion V5). No audio event API
is involved in that comparison - only the pin edges.

## Provenance

These values were **not** measured for v2. They were measured during v1 (PR #14,
task v1.12) by windowed-FFT and harmonic-product-spectrum analysis of the two
reference recordings in `assets/reference/`, and were carried as source comments and
test constants in `src/audio/audio.ts` and `src/audio/audio.test.ts`.

Task 11 of the v2 run deletes both of those files. This document was extracted from
them **before** that deletion so the measurements survive the removal of the v1 audio
module. Every figure below is transcribed from the v1 codebase at commit `25f179e`
(branch point of `v2--10--evidence-pipeline`); nothing here is newly derived, and
nothing here is invented.

| Source of a figure | Meaning |
| --- | --- |
| Measured | Read directly off the reference recording by FFT / HPS analysis. |
| Synthesized (v1) | The value v1 chose inside the measured band to drive its oscillator. Reproducible target, not itself a measurement. |
| Test bound (v1) | The tolerance window v1's CI asserted against, wider than the measured band by design. |
| Note label | A musical note name attached to a measured frequency afterwards. Never the source of a number. |

Where the v1 source comment and the v1 test constant disagree, both are recorded and
the discrepancy is flagged. The wider of the two is the safe acceptance window.

**Rule: measured values are recorded as measured; note names are labels applied
afterwards.** A note name like "D#6" carries an equal-tempered frequency (1244.5 Hz)
that has no connection to what the piezo actually emitted - the unit was never tuned
to concert pitch. Where a note name and a measurement disagree, the measurement wins
and both are written down. Never let a note name overwrite a reading: the
substitution is invisible once made, and it is the exact failure mode this document
exists to prevent. The v1 codebase made that substitution once, for D#6 - see the
[win](#win) section for the arithmetic that exposed it.

## Method

Two techniques were used, per sound:

- **Windowed FFT** - a Hann-windowed short-time transform over the isolated event,
  taking the dominant bin. Used for the single-pitch sounds (missile blip, march
  step, battleship buzz, warning beeps) and for the noise rolloff of the loss sound.
- **Harmonic product spectrum** - multiplying downsampled copies of the magnitude
  spectrum to collapse harmonics onto the fundamental. Needed for the win jingle,
  because the piezo's fundamental is weak relative to its partials: the fundamentals
  were recovered from the partial series (partials 1500 and 2250 imply a 750 Hz
  fundamental; 940 / 1880 / 2820 imply 940; 1240 and 2480 imply 1240).

The piezo speaker is driven as a square wave. All bands below are the fundamental
unless stated as a partial or as a noise rolloff.

## Recordings

| File | Duration cited | Sounds it establishes |
| --- | --- | --- |
| `assets/reference/gameplay-audio.m4a` | events at ~7.30 s, ~38.31 s, ~41.89 s, ~54 s, ~66 s, ~120.5-122.4 s | missile fire, battleship buzz, jet march, win jingle |
| `assets/reference/loss-audio.m4a` | events at ~27.4 s, ~85.86-86.99 s | launcher-hit warning beeps, loss sound |

---

## missileFire

A single sharp high blip. **Owner-confirmed**: a missile *hitting* a jet or the
battleship makes the same beep - there is no separate explosion sound - so one
recipe covers both events.

| Field | Value | Source |
| --- | --- | --- |
| `missileFire.dominantHzRange` | **1480-1632 Hz** | Measured |
| `missileFire.centreHz` | 1520 Hz | Measured (dominant bin centre) |
| `missileFire.mainTransientMs` | ~10 ms | Measured |
| `missileFire.totalMs` | ~20 ms | Measured |
| `missileFire.recording` | `gameplay-audio.m4a` | - |
| `missileFire.timestampsSec` | 7.30, 38.31, 41.89 | Isolated, unmasked blips |
| `missileFire.method` | Windowed FFT | - |
| `missileFire.toleranceTestPct` | +/- 8% around 1520 Hz | Test bound (v1) |
| `missileFire.totalMsTestRange` | 8-35 ms | Test bound (v1) |

v1 synthesized this as a square wave stepping 1550 Hz for 7 ms then 1490 Hz for 8 ms
(peak gain 0.5, 1 ms attack, 8 ms release) - both steps sit inside the measured band,
and the small downward step reproduces the blip's audible pitch fall.

Contract criterion V5 asserts the emulated speaker output's dominant frequency falls
inside `missileFire.dominantHzRange` and that the burst is shorter than 150 ms.

## jetMarch

The per-step buzz of the advancing squadron. The marching *rhythm* is not a property
of this sound - the game re-triggers the step - so no cadence is recorded here. See
`timing-analysis.md` for the (currently unmeasured) cadence.

| Field | Value | Source |
| --- | --- | --- |
| `jetMarch.dominantHzRange` | 600-650 Hz | Measured |
| `jetMarch.synthesizedHz` | 620 Hz | Synthesized (v1) |
| `jetMarch.testBandHz` | 585-660 Hz | Test bound (v1) |
| `jetMarch.stepDurationMs` | 70 ms | Synthesized (v1) |
| `jetMarch.recording` | `gameplay-audio.m4a` | - |
| `jetMarch.timestampSec` | ~66 | Recurring step buzz |
| `jetMarch.method` | Windowed FFT | - |

v1 envelope: peak gain 0.28, 1 ms attack, 25 ms release.

## battleshipBuzz

A distinctly lower, sustained buzz. The rule the owner confirmed is *relative*: the
battleship buzz must read lower in pitch than the jet march. That ordering constraint
is stronger evidence than the absolute band, because the dense section of the
recording makes a clean absolute read hard.

| Field | Value | Source |
| --- | --- | --- |
| `battleshipBuzz.dominantHzRange` | 230-300 Hz | Measured (band spread) |
| `battleshipBuzz.strongestCleanReadHz` | 300 Hz (fractional confidence 0.68) | Measured at ~54 s |
| `battleshipBuzz.synthesizedHz` | 300 Hz | Synthesized (v1) |
| `battleshipBuzz.testBandHz` | 225-315 Hz | Test bound (v1) |
| `battleshipBuzz.durationMs` | 380 ms | Synthesized (v1) |
| `battleshipBuzz.constraint` | must be below `jetMarch.dominantHzRange` | Owner-confirmed rule |
| `battleshipBuzz.recording` | `gameplay-audio.m4a` | - |
| `battleshipBuzz.timestampSec` | ~54 | Dense section |
| `battleshipBuzz.method` | Windowed FFT | - |

**Discrepancy**: the v1 source comment in `src/audio/audio.ts` records the band as
~240-300 Hz; the v1 test comment in `src/audio/audio.test.ts` records ~230-300 Hz.
230-300 Hz is used above as the wider, safer window. Both figures describe the same
measurement pass; neither was re-derived here.

v1 envelope: peak gain 0.32, 2 ms attack, 40 ms release.

## win

The melodic jingle played at 199 points, at the tail of the gameplay recording.

| Field | Value | Source |
| --- | --- | --- |
| `win.fundamentalsHz` | 750 (F#5), 940 (A#5), 1240 (D#6) | Measured via HPS |
| `win.partialsObserved` | 1500 & 2250 -> 750; 940 / 1880 / 2820 -> 940; 1240 & 2480 -> 1240 | Measured |
| `win.thirdNoteSynthesizedHz` | 1244 | Synthesized (v1) |
| `win.arpeggio` | [F#5, A#5, D#6] | Measured (note order) |
| `win.repeats` | 3 | Measured |
| `win.resolutionHz` | 940 (long A#5) | Measured |
| `win.totalDurationSec` | ~1.83 | Measured |
| `win.recording` | `gameplay-audio.m4a` | - |
| `win.timestampRangeSec` | 120.5 - 122.4 | - |
| `win.method` | Harmonic product spectrum (fundamentals weak; recovered from partials) | - |

### Which of these three numbers are measurements

Each fundamental was checked against its own observed partials. A genuine fundamental
divides its partials as exact integer multiples; a note-snapped value does not.

| Note | Partials observed | Implied fundamental | Equal-tempered pitch | Verdict |
| --- | --- | --- | --- | --- |
| F#5 | 1500, 2250 | 750 (1500 = 2x750, 2250 = 3x750) | 739.99 Hz | **Measured.** Tempering would put the partials at 1480 / 2220, which is not what was seen. |
| A#5 | 940, 1880, 2820 | 940 (1x, 2x, 3x) | 932.33 Hz | **Measured.** Tempering would put the partials at 1864.7 / 2797. |
| D#6 | 1240, 2480 | 1240 (2480 = 2x1240) | 1244.5 Hz | **Note-snapped.** 2 x 1244 = 2488, not the observed 2480. |

So two of the three are real readings and only D#6 was substituted. That asymmetry is
itself the evidence: had the v1 author measured 1244 Hz, the second partial would have
read 2488 Hz. It read 2480.

The 4 Hz difference is 0.3%, likely inside the FFT bin resolution, so v1's audio was
not audibly wrong - but it is an adjustment rather than a reading, and the two are
listed separately above. **The note names are nearest-note labels for a piezo that
was never tuned to concert pitch** - 750 Hz is 23 cents sharp of F#5 and 940 Hz is 14
cents sharp of A#5. The ROM targets the measured fundamentals, not the tempered ones.

Note sequence as transcribed, legato throughout (the piezo glides between notes, no
inter-note gaps were observed):

| # | Note | Measured Hz | v1 synthesized Hz | Duration (ms) |
| --- | --- | --- | --- | --- |
| 1 | F#5 | 750 | 750 | 200 |
| 2 | A#5 | 940 | 940 | 150 |
| 3 | D#6 | 1240 | 1244 | 150 |
| 4 | F#5 | 750 | 750 | 200 |
| 5 | A#5 | 940 | 940 | 150 |
| 6 | D#6 | 1240 | 1244 | 150 |
| 7 | F#5 | 750 | 750 | 200 |
| 8 | A#5 | 940 | 940 | 150 |
| 9 | D#6 | 1240 | 1244 | 150 |
| 10 | A#5 | 940 | 940 | 330 |

Total 1830 ms, matching the measured ~1.83 s.

**Correction recorded during v1**: an earlier transcription included an E6 pass-tone
before the resolution. Re-analysis of the recording found no E6 - the final
arpeggio's D#6 resolves straight to the sustained A#5. Do not reintroduce it.

v1 envelope: peak gain 0.32, 4 ms attack, 90 ms release.

## gameOver (loss)

The descending buzz near the end of the loss recording, played when the third
launcher is lost or the player is captured at the G line. Its opening note is the
same pitch as the launcher-hit warning beep.

| Field | Value | Source |
| --- | --- | --- |
| `gameOver.totalDurationSec` | ~1.13 | Measured |
| `gameOver.openingHzRange` | 455-545 Hz | Measured |
| `gameOver.openingSynthesizedHz` | 466 Hz (A#4) | Synthesized (v1) |
| `gameOver.openingDurationMs` | ~20-25 ms | Measured |
| `gameOver.collapseHzRange` | 80-97 Hz | Measured |
| `gameOver.collapseWithinMs` | ~30 ms from onset | Measured |
| `gameOver.bodyRaspHzRange` | 200-280 Hz | Measured (loudest section) |
| `gameOver.decayFloorHz` | ~147 Hz | Measured (low rasp the descent ends on) |
| `gameOver.decayFloorMaxTestHz` | 175 Hz | Test bound (v1) |
| `gameOver.noiseRolloffHzRange` | mostly 400-1150 Hz, with intermittent crackle bursts | Measured |
| `gameOver.noiseLowpassMaxTestHz` | 1150 Hz | Test bound (v1) |
| `gameOver.recording` | `loss-audio.m4a` | - |
| `gameOver.timestampRangeSec` | 85.86 - 86.99 | - |
| `gameOver.method` | Windowed FFT (tone) + spectral rolloff (noise layer) | - |

Envelope shape as transcribed - a brief high transient collapsing to a very low buzz,
then a rasp body that decays downward:

| # | Hz | Duration (ms) | Role |
| --- | --- | --- | --- |
| 1 | 466 | 25 | Opening transient (= warning-beep pitch) |
| 2 | 96 | 45 | Sharp collapse to the low buzz |
| 3 | 240 | 180 | Main rasp body, loudest |
| 4 | 196 | 170 | Body drifting down |
| 5 | 147 | 240 | Low decay |

v1 envelope: peak gain 0.4, 2 ms attack, 180 ms release, layered with a decaying
white-noise burst (gain 0.32, 1130 ms, one-pole low-pass at 850 Hz - inside the
measured 400-1150 Hz rolloff).

## launcherHitWarning

**Owner-confirmed**: the player's launcher taking a rocket hit warns with **two beeps
on the first hit** and **three beeps on the second**. The third hit plays the full
`gameOver` sound instead. The beep pitch is the same as the loss sound's opening
note - this is why both read in the same band.

| Field | Value | Source |
| --- | --- | --- |
| `launcherHitWarning.dominantHzRange` | 455-545 Hz | Measured |
| `launcherHitWarning.dominantPartialsHz` | 455, 455, 544 (whine-notched) | Measured |
| `launcherHitWarning.synthesizedHz` | 466 Hz (A#4) | Synthesized (v1) |
| `launcherHitWarning.beepDurationMs` | ~10 ms measured; 12 ms synthesized | See discrepancy |
| `launcherHitWarning.gapMs` | 25-28 ms | Measured |
| `launcherHitWarning.beepCountHit1` | 2 | Owner-confirmed |
| `launcherHitWarning.beepCountHit2` | 3 | Owner-confirmed |
| `launcherHitWarning.beepCountHit3` | n/a - plays `gameOver` | Owner-confirmed |
| `launcherHitWarning.recording` | `loss-audio.m4a` | - |
| `launcherHitWarning.timestampSec` | ~27.4 (discrete triple-beep), plus the loss opening at ~85.86 | - |
| `launcherHitWarning.method` | Windowed FFT | - |

**Discrepancy**: the v1 measurement comments state ~10 ms beeps; the v1 constant
`WARNING_BEEP_MS` is 12 ms. 10 ms is the measured figure, 12 ms is what v1
synthesized. v1 used a 28 ms inter-beep gap, at the top of the measured 25-28 ms
range. Gaps follow every beep except the last.

v1 envelope: peak gain 0.34, 2 ms attack, 40 ms release.

---

## Acceptance summary

The bands the v2 machine's reconstructed speaker output must land inside:

| Sound | Band | Duration |
| --- | --- | --- |
| `missileFire` | 1480-1632 Hz | < 150 ms (measured ~20 ms) |
| `jetMarch` | 600-650 Hz | ~70 ms per step |
| `battleshipBuzz` | 230-300 Hz, and below `jetMarch` | sustained |
| `win` | 750 / 940 / 1240 Hz (v1 played the third note at 1244) | ~1.83 s |
| `gameOver` | 455-545 -> 80-97 -> 200-280 -> ~147 Hz | ~1.13 s |
| `launcherHitWarning` | 455-545 Hz | ~10 ms per beep, 25-28 ms gaps |

Per PRD R7, each sound constant in the ROM source (`asm/jetfighter.asm`) must cite
its row here in a comment.
