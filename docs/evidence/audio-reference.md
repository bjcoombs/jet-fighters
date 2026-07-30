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

**One section is not v1's and does not answer to this provenance: `battleshipBuzz`.**
It was measured during v2 from recordings the owner made of his unit for the
purpose, and it supersedes the v1 figures rather than transcribing them. It is
the only sound in this file isolated from everything else the machine does.

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
  step, warning beeps) and for the noise rolloff of the loss sound.
- **Harmonic product spectrum** - multiplying downsampled copies of the magnitude
  spectrum to collapse harmonics onto the fundamental. Needed for the win jingle,
  because the piezo's fundamental is weak relative to its partials: the fundamentals
  were recovered from the partial series (partials 1500 and 2250 imply a 750 Hz
  fundamental; 940 / 1880 / 2820 imply 940; 1240 and 2480 imply 1240).

A third technique, **harmonic-comb periodicity**, was added for the battleship
buzz, whose energy sits at the transducer's resonance rather than at its own
repetition rate; neither of the two above can read it. See that section.

The piezo speaker is driven as a square wave. All bands below are the fundamental
unless stated as a partial or as a noise rolloff.

## Recordings

| File | Duration cited | Sounds it establishes |
| --- | --- | --- |
| `assets/reference/gameplay-audio.m4a` | events at ~7.30 s, ~38.31 s, ~41.89 s, ~54 s, ~66 s, ~120.5-122.4 s | missile fire, battleship buzz, jet march, win jingle |
| `assets/reference/loss-audio.m4a` | events at ~27.4 s, ~85.86-86.99 s | launcher-hit warning beeps, loss sound |
| `assets/reference/battleship-arrival.m4a`, `battleship-interval.m4a` | one recording, trimmed twice; arrivals at 0.32-4.37 s and 20.12-23.92 s | battleship buzz - the only sound isolated from everything else the machine does |

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

**This section was rewritten when the owner supplied an isolated recording.** It
previously recorded that the buzz *could not* be isolated from either reference
recording and that a narrow-band figure might be the wrong shape of answer
entirely. Both of those were right, and the recording settles them: the buzz is
not a tone in the 230-300 Hz band. The v1 figures that used to head this section
are kept below, under [what the old numbers were measuring](#what-the-old-numbers-were-measuring),
because what they were actually reading turns out to be identifiable.

### The recording

| File | What it is |
| --- | --- |
| `assets/reference/battleship-arrival.m4a` | 4.46 s, one arrival |
| `assets/reference/battleship-interval.m4a` | 24.17 s, two arrivals and the gap between them |

**They are one recording, not two.** The arrival clip is the interval clip's
first 4.46 s, offset by 0.149 s: cross-correlation gives a gain of 1.000 and a
Pearson r of 0.9955 over the overlap, with a 9.5% residual that is AAC re-encode
noise. Anything derived from them is a sample of size one, and this document
says so wherever it matters.

The owner, sending them: *"this is the sound, notice its 4s long the boat
appears for 4s then disappears if you haven't hit it"*, and *"the second audio
... is longer as this show how long between it arriving again"*.

### Method, and why the obvious methods fail

Comparing *levels* in a narrow band fails, and failed repeatedly before these
files existed: the buzz is quieter than the march and missile sounds that
overlap it, and the interval clip's loud middle section is 15-20 dB above its
quiet ends. A level-based detector finds the loud parts, which are not the boat.

Comparing *spectral shape* against a template taken from the arrival clip also
fails, and fails in a way worth recording because it looks like it works. Cosine
similarity of the mean normalised 250-8000 Hz spectrum does return two blocks
about four seconds long and about 19.8 s apart - but the first block is the
template's own source audio, so it matches by construction, and the second is
matched on being *quiet* rather than on being the boat. Run against the loud
middle it reports nothing, and against the trailing silence it reports a hit.
**One of its two blocks is circular and the other is a false positive**, and it
happens to land on the right answer.

What works is **periodicity**. The buzz is a pulse train with a low repetition
rate and a comb of harmonics reaching to 9 kHz. For each 0.34 s window, scan
f0 over 75-115 Hz, take the mean level at the comb's harmonics minus the mean
level at the half-way points between them, over 3200-5800 Hz and after
flattening the resonance envelope. That score is immune to level, immune to the
template problem, and has an internal control - the anti-comb - built into it.

It separates cleanly, and the controls are in the same file:

| Window | Score | Reading |
| --- | --- | --- |
| Arrival, 0.32-4.37 s | +8 to +15 dB | the boat |
| Second arrival, 20.12-23.92 s | +8 to +15 dB | the boat |
| Quiet gap, 4.5-6.4 s | +2.5 to +7 dB | floor |
| Loud game section, 6.5-19.5 s | +3 to +6 dB | floor, despite being 20 dB louder |

The loud section scoring at the floor is the control that matters: the detector
is not finding energy, and it is not finding quiet.

### What it measures

| Field | Value | Source |
| --- | --- | --- |
| `battleshipBuzz.repetitionHz` | **93.4 Hz** | Measured (comb fit, arrival clip) |
| `battleshipBuzz.repetitionRangeHz` | **79-111 Hz**, wandering within one arrival | Measured (per-window f0 track) |
| `battleshipBuzz.durationSec` | **4.05 s** and **3.80 s** | Measured (two arrivals) |
| `battleshipBuzz.intervalSec` | **19.80 s** onset to onset | Measured, n = 1 |
| `battleshipBuzz.continuity` | continuous: 3 of 162 25 ms windows below peak-20 dB | Measured |
| `battleshipBuzz.constraint` | must be below `jetMarch.dominantHzRange` | Owner-confirmed rule |
| `battleshipBuzz.recording` | `battleship-arrival.m4a`, `battleship-interval.m4a` | - |
| `battleshipBuzz.method` | harmonic-comb periodicity, 75-115 Hz, with anti-comb control | - |

Energy distribution as recorded, over the first arrival:

| Band | Share |
| --- | --- |
| 60-150 Hz | 4.0% |
| 150-300 Hz | 2.0% |
| 300-600 Hz | 1.5% |
| 600-1200 Hz | 2.1% |
| 1200-2400 Hz | 2.7% |
| **2400-4800 Hz** | **60.8%** |
| **4800-9600 Hz** | **26.6%** |
| 9600-16000 Hz | 0.3% |

### 87% of the energy is above 2.4 kHz and the sound is still low

This is the reading the numbers most invite getting wrong, and it contradicts
the owner-confirmed rule that the buzz sits *below* the 640 Hz march if it is
taken at face value.

It is not a contradiction, because **energy and pitch are different questions**.
The comb spacing is 93.4 Hz, and every harmonic of it is present - even and odd
score equally, so the drive is a pulse train rather than a symmetric square. A
pulse train's *pitch* is its repetition rate. Where its energy lands is decided
by whatever it is driving, and a small piezo has a hard mechanical resonance in
the 3.7-4.5 kHz region: the peaks in this recording cluster at 3721, 3800, 3917,
4017, 4107, 4204, 4298, 4389 and 4485 Hz - a 93 Hz comb sitting under a
resonance, not a set of tones.

So the 2.4-9.6 kHz energy is a property of **the owner's transducer and phone**,
not of the waveform the microcontroller produces. What the ROM has to reproduce
is the 93.4 Hz repetition rate on the D14 pin; the resonance belongs to a
speaker the emulator does not model. Contract criterion V5 compares reconstructed
pin edges, so this is the right end of the chain to target.

The 79-111 Hz *wander* is the second thing that is not noise. It moves the same
way in both arrivals - starting near 100-106 Hz and drifting to 80-88 Hz - and
that is what a buzz clocked off a display sweep does, because a sweep is however
long the program's between-sweep work took. A delay-loop tone would be as stable
as the crystal. This is the strongest evidence for the mechanism the ROM now
uses, and it was found by looking for a repetition period rather than a spectral
peak.

### What the old numbers were measuring

| Field | Value | Source |
| --- | --- | --- |
| `battleshipBuzz.dominantHzRange` | 230-300 Hz | **Superseded.** See below. |
| `battleshipBuzz.strongestCleanReadHz` | 300 Hz (fractional confidence 0.68) | Superseded |
| `battleshipBuzz.synthesizedHz` | 300 Hz | Synthesized (v1) |
| `battleshipBuzz.durationMs` | 380 ms | Synthesized (v1) - never a measurement |

Two of these can now be accounted for rather than merely withdrawn.

The **230-300 Hz band** was read off `gameplay-audio.m4a` at a moment when the
boat was present, in a dense passage, at a stated fractional confidence of 0.68.
The isolated recording has no component there at all: 150-300 Hz carries 2.0% of
the sound's energy and 300-600 Hz carries 1.5%. Whatever the v1 pass locked onto
in that band, it was not the buzz.

The **100 / 200 / 300 Hz components** visible in the isolated clips are **mains
hum**, and this is checkable rather than asserted: they are present at the same
level in a silent stretch of the same recording, at ratios of 1.0x, 1.2x and
1.0x. A 50 Hz supply puts harmonics exactly there. The old
`strongestCleanReadHz` of 300 Hz is one of them, which is the likeliest
explanation for a "clean read" in a passage where the boat could not otherwise
be separated.

The **380 ms** was a v1 synthesis carried forward as though it were measured -
the row above always said `Synthesized (v1)`, and three revisions of the ROM
nonetheless tuned a note length to it. The sound is 4.0 s.

### What is still open

- **The interval is n = 1.** 19.80 s is one gap, from one take. It contradicts
  the video's inference of one crossing every 51 s (eight lane-0 episodes over
  407.9 s in `assets/reference/sprites/README.md`) by a factor of 2.6. The
  recording is preferred because it measures the machine's own sound directly
  and because the video's detection pass is known to drop episodes - its lane
  split is 8 / 2 / 7 - but one interval cannot establish a mean. **What would
  settle it**: two minutes of the unit recorded the same way, counting arrivals
  rather than timing one gap.
- **Whether the appearance outlasts the sound.** The owner's sentence covers the
  boat, not just the buzz - "the boat appears for 4s then disappears" - and the
  video's one traced descent is 9.3 s, whose last lane alone is 5.8 s, longer
  than its other two together. The ROM treats appearance and sound as the same
  4 s. **What would falsify it**: a video of one crossing showing the boat lit
  materially longer than the buzz lasts.
- **Whether the drive is really a pulse train**, or a square whose asymmetry
  comes from the transducer. Even and odd harmonics score within 0.5 dB of each
  other, which favours a pulse train, but a piezo's mechanical response is not
  symmetric either and the recording cannot separate the two.

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

### What the TMS1370 can actually play, and why the top note is 1190 Hz

The measurements above stand. **The machine cannot play one of them**, and that is a
property of the note generator rather than a defect in the ROM or an error in the
reading.

`note` builds a half-period from a nested loop - outer count `NIB_HALF_O`, inner count
`NIB_HALF_I`. With the outer count zero, which all three win notes use, the full period
is `4 * I + 25` instructions. That reproduces every figure the ROM states beside these
constants:

| I | period (instructions) | pitch | against the measurement |
| --- | --- | --- | --- |
| 13 | 77 | 758 Hz | 750 measured, 1.1% high |
| 9 | 61 | 956 Hz | 940 measured, 1.7% high |
| 6 | 49 | **1190 Hz** | **1240 measured, 4.0% low** |
| 5 | 45 | 1296 Hz | 1240 measured, 4.5% high |

So the two pitches reachable either side of the measured 1240 Hz are 1190 and 1296.
**1190 is the closest this machine can play**, and the gap between neighbouring pitches
at that end of the range is 8.5% - the inner count is an integer, and the steps get
coarser as it falls. The first two notes land inside 2% because `I` is larger there and
the quantisation is correspondingly finer.

This is why `tools/probe/speaker-bands.test.ts` bounds the third note at +/-5% where the
other two use +/-3%: a +/-3% band on 1240 Hz is 1203-1277, which this note generator
cannot enter from either side. **The band follows the hardware; the measurement it is
derived from is unchanged.**

Recorded because that band was written at +/-3% and never reached - the jingle needs 199
points and no scenario in that suite got there - so nothing ever failed on a bound the
machine could not meet. `tools/probe/win-jingle.test.ts` now reaches it.

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
| `battleshipBuzz` | 79-111 Hz repetition rate, and below `jetMarch` | ~4.0 s, continuous |
| `win` | 750 / 940 / 1240 Hz (v1 played the third note at 1244) | ~1.83 s |
| `gameOver` | 455-545 -> 80-97 -> 200-280 -> ~147 Hz | ~1.13 s |
| `launcherHitWarning` | 455-545 Hz | ~10 ms per beep, 25-28 ms gaps |

Per PRD R7, each sound constant in the ROM source (`asm/jetfighter.asm`) must cite
its row here in a comment.
