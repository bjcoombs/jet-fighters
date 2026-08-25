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
| Owner-confirmed | A specific claim put to the owner about his unit, which he confirmed. |
| Owner-reported | The owner volunteered it. Recorded verbatim, and **not** corroborated against a recording unless a row says so. |

The last two are not interchangeable. `open-questions.md` §8a is the case that made
the distinction worth drawing: the owner's "the last note is a high note" was a
statement of fact about his machine, was read as a question about ours, and was closed
as faithful against a document that turned out to be wrong. **Where the owner and a
documented figure disagree about what his unit sounds like, re-derive the figure from
the recording before concluding the owner is describing something else.** The
`launcherHitWarning` section below is that rule applied a second time.

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
exists to prevent. The v1 codebase made that substitution twice - for D#6, where the
[win](#win) section records the arithmetic that exposed it, and for the win jingle's
**resolution**, where "the long A#5" stood in for a note nobody measured and put that
note an octave wrong for three revisions of the ROM. The second one was caught by the
owner playing the build, not by this document.

## Method

Two techniques were used, per sound:

- **Windowed FFT** - a Hann-windowed short-time transform over the isolated event,
  taking the dominant bin. Used for the single-pitch sounds (missile blip, march
  step, warning beeps) and for the noise rolloff of the loss sound.
- **Harmonic product spectrum** - multiplying downsampled copies of the magnitude
  spectrum to collapse harmonics onto the fundamental. Used for the win jingle,
  because the piezo's fundamental is weak relative to its partials.

  **Collapsing the harmonics throws away the one thing that identifies a
  fundamental**, which is the spacing between adjacent partials. HPS was not what
  produced the win jingle's error - re-run, it reads the resolution correctly -
  but it cannot expose one either, so the win section now records each note's
  partial series uncollapsed and reads the spacing off it. Where a note matters,
  list the partials.

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

**This section was rewritten when the owner reported that the last note is wrong.**
The three arpeggio notes survived re-measurement within 0.6%. The resolution did
not: it was recorded as 940 Hz and it is **1868 Hz**, an octave above. The
superseded reading and the mechanism that produced it are kept below, under
[the resolution was never measured](#the-resolution-was-never-measured).

| Field | Value | Source |
| --- | --- | --- |
| `win.fundamentalsHz` | **750, 937, 1248** | Measured (partial spacing, n = 3 passes each) |
| `win.partialsObserved` | 751 / 1502 / 2252 / 3003 / 3754 / 4504 / 5254 -> 750; 938 / 1875 / 2813 / 3751 / 4688 / 5626 -> 937; 1249 / 2497 / 3745 / 4994 / 6242 -> 1248 | Measured |
| `win.arpeggio` | ascending, three notes | Measured (note order) |
| `win.repeats` | 3 | Measured |
| `win.resolutionHz` | **1868** | Measured (see below) |
| `win.resolutionPartialsHz` | 1868 / 3735 / 5601 / 7472 - **no energy at 934** | Measured |
| `win.noteDurationsMs` | 222 / 160 / 129 per arpeggio note, 349 resolution | Measured |
| `win.totalDurationSec` | ~1.88 | Measured |
| `win.recording` | `gameplay-audio.m4a` | - |
| `win.timestampRangeSec` | 120.569 - 122.449 | - |
| `win.method` | Adjacent-partial spacing, corroborated by autocorrelation, cepstrum, HPS, a zero-crossing period fit and a harmonic-series refinement | - |

Intervals, which is what a listener hears and what the note quantisation is
chosen against: note 1 to note 2 is +385 cents, note 1 to note 3 is +881, **note
3 to the resolution is +699 - a perfect fifth** - and the resolution sits +1195
cents above note 2, an octave within five cents.

### The resolution was never measured

The v1 pass recorded `win.partialsObserved` as "940 / 1880 / 2820 -> 940". Those
are the **arpeggio's middle note**, and they are correct: it measures 938 / 1875 /
2813 here. The sustained tail's own partials were never taken. It was written
down as "the long A#5" - the note that came before it - and that is a note name
standing in for a reading.

This document's own preamble names the failure:

> Never let a note name overwrite a reading: the substitution is invisible once
> made, and it is the exact failure mode this document exists to prevent.

It happened a second time, in the section that quotes it, and survived because
nobody re-derived that note. It was not an octave error in the harmonic product
spectrum - **HPS itself returns 1868 for the tail**. The method was never run on
it.

**What settles it.** The tail's partials are consecutive integer multiples of
1868 with nothing at 934. A tone carrying every even multiple of 933 and no odd
ones is a tone of 1867 Hz; no square or pulse drive suppresses odd harmonics.
The control is in the same recording 1.3 s earlier:

| Level above local background | 934 Hz | 1868 Hz | 2802 Hz | 3736 Hz | 4670 Hz |
| --- | --- | --- | --- | --- | --- |
| The arpeggio's genuine 937 Hz note | **+31.0 dB** | +23.5 | **+37.6** | +42.0 | **+34.5** |
| The resolution | **+5.3 dB** | +33.2 | +19.2 | +45.4 | +22.1 |

The chain passes a 937 Hz fundamental at +31 dB when there is one. In the tail it
reads +5.3 dB, and 1868 Hz reads +2.2 to +3.5 dB in silence elsewhere in the
file, so +5.3 is the floor. The residual at the odd multiples of 934 is the
note's own amplitude-modulation comb, spaced f0/16 = 116.7 Hz: 934 above the
carrier is exactly eight teeth up, and teeth seven and nine are comparable in
level, which a real harmonic's neighbours are not.

Independently, a zero-crossing period fit over the sustain - the least ambiguous
measurement available for a held note - gives 1871.7 Hz from 1122 crossings with
a 3.2-sample residual, while the 700-1200 Hz band is 28 dB weaker and its fit
residual is 29.4 samples, which is noise. Confirmed on a second decode at 48 kHz.

**Superseded reading**, kept per the v1 style:

| Field | Value | Source |
| --- | --- | --- |
| `win.fundamentalsHz` | 750 (F#5), 940 (A#5), 1240 (D#6) | **Superseded.** 940 and 1240 refined to 937 and 1248. |
| `win.resolutionHz` | 940 (long A#5) | **Superseded.** Never measured; the arpeggio's middle note applied as a label. |
| `win.thirdNoteSynthesizedHz` | 1244 | Synthesized (v1) |
| `win.arpeggio` | [F#5, A#5, D#6] | Superseded - note names, see below |
| `win.totalDurationSec` | ~1.83 | Superseded by 1.88 |
| `win.timestampRangeSec` | 120.5 - 122.4 | Superseded by 120.569 - 122.449 |

The note names are dropped rather than renamed. They were nearest-note labels for
a piezo never tuned to concert pitch, they are what carried the error, and the
ROM targets the measured fundamentals.

### How each fundamental was established

Every note was checked against its own observed partials. **A fundamental is the
spacing between adjacent partials**, and that is the test a collapsed method
cannot fail safely: a series of 940 / 1880 / 2820 and one of 1868 / 3735 / 5601
both reduce to "940 or a multiple of it" under harmonic product spectrum alone,
and only the spacing tells them apart.

| Note | Partials observed | Spacing | Fundamental | Verdict |
| --- | --- | --- | --- | --- |
| 1 | 751, 1502, 2252, 3003, 3754, 4504, 5254, 6005 | 750.6 | 750.0 | **Measured.** Consecutive multiples 1x-8x, no subharmonic energy. |
| 2 | 938, 1875, 2813, 3751, 4688, 5626, 6563 | 937.5 | 936.9 | **Measured.** Consecutive multiples 1x-7x. |
| 3 | 1249, 2497, 3745, 4994, 6242 | 1248.4 | 1247.8 | **Measured.** Consecutive multiples 1x-5x. |
| Resolution | 1868, 3735, 5601, 7472 | 1867 | 1868.0 | **Measured.** Consecutive multiples 1x-4x, and nothing at 934. |

Each arpeggio figure is the mean of the three passes; the standard deviation
across passes is 0.1 Hz or less, so the notes are stable and the passes identical.

Six methods, for the resolution, which is the figure that moved:

| Method | Reads |
| --- | --- |
| Adjacent-partial spacing | 1867 |
| Autocorrelation | 1879 |
| Cepstrum | 1917 (quefrency-limited) |
| Harmonic product spectrum | 1868 |
| Zero-crossing period fit | 1872 |
| Harmonic-series refinement | 1868 |

Note sequence, legato throughout (the piezo glides between notes, no inter-note
gaps were observed):

| # | Measured Hz | Duration (ms) |
| --- | --- | --- |
| 1 | 750 | 222 |
| 2 | 937 | 160 |
| 3 | 1248 | 129 |
| 4 | 750 | 222 |
| 5 | 937 | 160 |
| 6 | 1248 | 129 |
| 7 | 750 | 222 |
| 8 | 937 | 160 |
| 9 | 1248 | 129 |
| 10 | **1868** | 349 |

Total 1880 ms, matching the measured ~1.88 s.

One structural detail, recorded because it corroborates that the tail comes from
the same generator as the arpeggio: every note is amplitude-modulated at an exact
submultiple of its own pitch - f0/8 for notes 1 and 2, f0/16 for note 3 and the
resolution - which is a burst structure, and the same shape the ROM's `NIB_PER`
produces.

### What the TMS1370 can actually play

The measurements above stand. **The machine cannot play two of them**, and that is a
property of the note generator rather than a defect in the ROM or an error in the
reading.

`note` builds a half-period from a nested loop - outer count `NIB_HALF_O`, inner count
`NIB_HALF_I`. The full period is `4 * (O + 1) * (I + 3) + 13` instructions, which
reproduces all nine sound constants the ROM states exactly. With the outer count zero,
which all four win notes use, that is `4 * I + 25`:

| I | period (instructions) | pitch | against the measurement |
| --- | --- | --- | --- |
| 13 | 77 | 758 Hz | 750 measured, 1.0% high |
| 9 | 61 | 956 Hz | 937 measured, 2.1% high |
| 6 | 49 | **1190 Hz** | **1248 measured, 4.6% low** |
| 5 | 45 | 1296 Hz | 1248 measured, 3.9% high |
| 2 | 33 | **1768 Hz** | **1868 measured, 5.4% low** |
| 1 | 29 | 2012 Hz | 1868 measured, 7.7% high |

The inner count is an integer and the steps coarsen as it falls: 8.5% between
neighbours at the top of the arpeggio, 13.8% at the resolution. The first two notes
land inside 2.1% because `I` is larger there and the quantisation is correspondingly
finer. **Exact octaves are unreachable at any `O`** - the period is always odd, so
half of it is never an integer.

**1768 is the closest this machine can play to the resolution**, and there is a second
constraint on that note: `periods = (P + 1) * (B + 1)` caps one `note` call at 256,
which at 1768 Hz is 145 ms against a measured 349. That would make the resolution
shorter than an arpeggio note and stop it reading as a resolution at all, so the ROM
calls `note` twice - 512 periods, 290 ms.

**The top of the arpeggio stays at 1190 although 1296 is now nearer.** Against the old
1240 figure, 1190 was the closer of the two and this section said so; against 1248 the
ordering flips. It is kept for the interval rather than the pitch: the leap from the
top of the arpeggio to the resolution measures +699 cents, 1190 gives +684 and 1296
would give +537. Fifteen cents is inaudible, 162 is over a semitone and a half, and a
wrong interval in the final leap is the class of error the owner heard - a 0.7% shift
in absolute pitch is not. `tools/probe/win-jingle.test.ts` asserts that interval,
because no symmetric band can separate the two candidates.

This is why `tools/probe/speaker-bands.test.ts` bounds the third note at +/-5% and the
resolution at +/-6% where the first two use +/-3%. **The bands follow the hardware; the
measurements they are derived from are independent of them.**

Recorded because that band was written at +/-3% and never reached - the jingle needs 199
points and no scenario in that suite got there - so nothing ever failed on a bound the
machine could not meet. `tools/probe/win-jingle.test.ts` now reaches it.

**Correction recorded during v1**: an earlier transcription included a pass-tone between
the final arpeggio and the resolution. Re-analysis found none - the last arpeggio note
leaps straight to the sustained resolution. Do not reintroduce it.

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
| `launcherHitWarning.dominantPartialsHz` | 455, 455, 544 (whine-notched) | Measured, **pooled - see below** |
| `launcherHitWarning.synthesizedHz` | 466 Hz (A#4) | Synthesized (v1) |
| `launcherHitWarning.beepDurationMs` | ~10 ms measured; 12 ms synthesized | See discrepancy |
| `launcherHitWarning.gapMs` | 25-28 ms | Measured |
| `launcherHitWarning.beepCountHit1` | 2 | Owner-confirmed |
| `launcherHitWarning.beepCountHit2` | 3 | Owner-confirmed |
| `launcherHitWarning.beepCountHit3` | n/a - plays `gameOver` | Owner-confirmed |
| `launcherHitWarning.perBeepDominantHz` | **269, 319, 744** (one 10 ms window per beep) | Measured, n = 1 event |
| `launcherHitWarning.beepsDescend` | **no** - the reading rises, and no beep reaches the 80-97 Hz collapse band | Measured, n = 1 event |
| `launcherHitWarning.isLossThemePrefix` | owner says yes; the recording says no | Owner-reported **vs** Measured - see below |
| `launcherHitWarning.recording` | `loss-audio.m4a` | - |
| `launcherHitWarning.timestampSec` | ~27.4 (discrete triple-beep), plus the loss opening at ~85.86 | - |
| `launcherHitWarning.method` | Windowed FFT; per-beep since 2026-08-25, `tools/probe/drives/loss-warning-partials.ts` | - |

**Discrepancy**: the v1 measurement comments state ~10 ms beeps; the v1 constant
`WARNING_BEEP_MS` is 12 ms. 10 ms is the measured figure, 12 ms is what v1
synthesized. v1 used a 28 ms inter-beep gap, at the top of the measured 25-28 ms
range. Gaps follow every beep except the last.

v1 envelope: peak gain 0.34, 2 ms attack, 40 ms release.

### Is the warning a growing prefix of the loss melody?

**Owner-reported**, verbatim, 2026-08-25, playing the physical unit:

> "we have three lives, after each life is lost we play the sound, its the loosing
> theme progressively being reveiled until upuon the loss of the third life, it plays
> in total and the screen flashes."

That is a different mechanism from the one this document and the ROM describe. Two
models, and they are not distinguishable by the thing most easily checked:

| | Beeps on hit 1 | Beeps on hit 2 | Hit 3 |
| --- | --- | --- | --- |
| **Prefix model** (owner) | `gameOver` stages 1-2 | `gameOver` stages 1-3 | the whole melody |
| **Repetition model** (this document, and the ROM) | 2 copies of one 467 Hz note | 3 copies of it | the whole melody |

**Both predict two beeps then three, so the counts cannot separate them.** The pitch
of the warning already matches `gameOver`'s opening note - 467 Hz against 466 - which
is exactly what the prefix model predicts for the *first* beep, so that agreement is
not evidence either way. What separates them is what the **second** beep is: under the
prefix model it must be `gameOver` stage 2, the collapse into 80-97 Hz.

`dominantPartialsHz` above cannot answer it. Three partials **pooled over a whole
warning event** discard which beep each came from, so 455, 455, 544 is equally
consistent with three equal beeps and with a descent whose stages were sampled out of
order. The question needs one window per beep.

#### Method

`tools/probe/drives/loss-warning-partials.ts`, standalone, run against
`assets/reference/loss-audio.m4a`. Decoded to mono 48 kHz; 10 ms Hann windows -
`beepDurationMs` above - zero-padded to 65536, giving 0.73 Hz bins. **The bin grid is
not the uncertainty**: a 10 ms Hann mainlobe is ~400 Hz wide, so each reading below
carries its own -3 dB span and those spans are the honest error bars. Spectra are
divided by the mean of nine background windows taken from the gaps between and before
the beeps, and read over 150-1350 Hz: above the recording's table rumble, below the
continuous 1400-1700 Hz whine that is present in every quiet stretch of the file at
~24 dB over the local median. That whine is what "whine-notched" means above.

**n = 1.** A shape-based sweep of all 88 s - isolated bursts of 4-16 ms, 15 dB over a
2 s running median, with 12 ms of near-silence on both sides, grouped at 25-50 ms
spacing - returns exactly one beep group inside the gameplay, the one at 27.4 s this
document already cites. The rest of the recording is dense overlapping play. So every
figure below is a sample of size one, and the beep *counts* in the table above remain
Owner-confirmed rather than measured: this recording contains one warning event, not
one of each kind.

#### Per-beep, never pooled

| Beep | Window start (s) | Dominant Hz | -3 dB span | Excess over background | LOW-MID |
| --- | --- | --- | --- | --- | --- |
| 1 | 27.3850 | **269** | 196-344 | +29.6 dB | -1.5 dB |
| 2 | 27.4270 | **319** | 231-523 | +19.8 dB | -13.7 dB |
| 3 | 27.4580 | **744** | 675-837 | +18.3 dB | -12.2 dB |

Onset to onset: 42.0 ms and 31.0 ms. The group spans 73 ms, 88 ms including beep 3's
decay. LOW-MID is the 80-110 Hz level minus the 420-560 Hz level - the collapse band
against the opening band.

**They do not descend.** The prefix model requires 466 -> 92 -> 240 Hz. The reading
rises, and beep 2 - the one that would have to *be* the 92 Hz collapse - sits at 319 Hz
with 13.7 dB **less** energy in the collapse band than in the opening band.

Beep 3 is the least trustworthy of the three: it is the one the isolation sweep
rejects, because another event at ~27.451 s overlaps its attack. That does not rescue
the prefix model - contamination cannot move a reading *down* to 92 Hz - but its 744 Hz
should not be quoted as a clean figure.

**These three numbers do not replace `dominantHzRange`, and are not a correction of
it.** They sit lower than the pooled 455 / 455 / 544 for reasons that are all method
and not disagreement: this pass divides by a background where v1 did not, restricts to
150-1350 Hz where v1 read the whole spectrum, and reports the strongest partial of a
10 ms *transient* rather than of the event. A piezo click that short is broadband -
look at the -3 dB spans, which run 148 to 292 Hz wide - so its "dominant" is a weak
pitch estimate by construction. **What the per-beep pass is good for is the shape of
the sequence, not the value of any one beep**, and the shape is what the question was
about. The 455-545 Hz acceptance band in the summary below stands unchanged.

#### The positive control, which is what makes the negative mean anything

The same method, the same file, run on the loss sound itself. A method that cannot find
the collapse where it is known to be proves nothing about where it is not.

| Offset from loss onset | Dominant Hz | The stage this document already records |
| --- | --- | --- |
| +5 ms | 657 | stage 1, `openingHzRange` 455-545 |
| +15 ms | 224 | the collapse in progress |
| +25 ms | **60** | stage 2, `collapseHzRange` 80-97 |
| +240 ms | 237 | stage 3, `bodyRaspHzRange` 200-280 |

It finds all four. On LOW-MID the loss reads **+30.6, +39.4, +30.5 dB** at 10, 20 and
30 ms past its onset. The warning, at the offsets where its own second beep sits,
reads **-16.9 and -2.2 dB**. Same statistic, same recording, same window length: a
swing of roughly 55 dB on the melody's single most distinctive feature.

#### Event shape, which needs no spectrum at all

300-1300 Hz level per 2 ms frame, as the fraction of each event more than 15 dB below
that event's own peak, over matched 88 ms windows:

| Event | Frames "quiet" | Longest continuous run |
| --- | --- | --- |
| The whole three-beep warning | 73% | 10 ms of 88 ms |
| The loss sound, same length from its onset | 13% | 38 ms of 88 ms |

The warning is mostly silence. The loss sound is not, because a melody played straight
through has no holes in it. And the arithmetic is decisive on its own: **92 Hz has a
period of 10.9 ms, which is longer than a whole warning beep.** A 10 ms burst cannot
contain one cycle of `gameOver`'s stage 2, so no 10 ms beep can be that stage,
whatever a spectrum says.

#### The conflict, stated

**The measurement contradicts the testimony, and the current ROM is right.** The
launcher-hit warning in this recording is a train of short, roughly equal, separated
beeps - the repetition model - and not a growing prefix of the loss melody. **No ROM
change is proposed.** `SND_WARN_*` and the `lw_beep` loop stand as they are.

Both facts are kept here rather than one, because the owner is describing a real unit
and this analysis cannot say which of these is true:

- **He is describing the same phenomenon in different words.** The warning's pitch
  really is `gameOver`'s opening note, the beep count really does grow 2 -> 3 -> whole
  melody, and every sound really does blank the tube (below). "The losing theme
  progressively revealed" is a fair description of *that* from the playing side of the
  case, without any of it being a prefix in the signal.
- **He is describing a different unit or a different revision.** The recording is one
  event from one session on one machine. n = 1 cannot exclude it.

What would settle it is not more analysis of this file: it is an isolated recording of
a first hit and of a second hit, made deliberately, the way `battleshipBuzz` was
settled. Until then this section records both and prefers neither.

#### "and the screen flashes" - already implemented

**Yes, and it is not a separate effect.** `note` (`asm/jetfighter.asm`, page `P_LEAF`)
stops sweeping the tube for the whole of every burst, so on this machine as on the real
one every sound *is* a blink - `docs/evidence/vfd-appearance.md` measures complete
blanking on 14-17% of all frames during play, against 4% while quiet, and records the
mechanism.

The blanks, measured off the running machine and recorded in that document, are
**141.7 ms for a two-beep warning** and **636.9 ms for the loss sequence**;
`tools/probe/blank-to-glass.test.ts` asserts the tube paints nothing for the whole of
every sound, and `Display.getObservedFrame` is what carries the dark tube to the glass.
So the third life already goes dark for roughly four times as long as either warning
before the final score returns - which is the difference in kind the owner's "and the
screen flashes" is pointing at. Nothing is missing and nothing needs adding.

*Not established here*: reading `tick_burst` and `rd_burst`, the starburst
`launcher_down` writes on the player's own grid appears to have nothing left to
decrement its countdown once `tick` starts taking its `tk_ended` arm, which would leave
it lit on the frozen final display. That is a code reading and **was not verified on
the running machine** - driving a game to its third launcher hit headlessly is its own
piece of work. Recorded so it can be checked, not relied on.

---

## Acceptance summary

The bands the v2 machine's reconstructed speaker output must land inside:

| Sound | Band | Duration |
| --- | --- | --- |
| `missileFire` | 1480-1632 Hz | < 150 ms (measured ~20 ms) |
| `jetMarch` | 600-650 Hz | ~70 ms per step |
| `battleshipBuzz` | 79-111 Hz repetition rate, and below `jetMarch` | ~4.0 s, continuous |
| `win` | 750 / 937 / 1248 Hz arpeggio, resolving up to 1868 | ~1.88 s |
| `gameOver` | 455-545 -> 80-97 -> 200-280 -> ~147 Hz | ~1.13 s |
| `launcherHitWarning` | 455-545 Hz | ~10 ms per beep, 25-28 ms gaps |

Per PRD R7, each sound constant in the ROM source (`asm/jetfighter.asm`) must cite
its row here in a comment.
