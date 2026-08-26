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
| `assets/reference/gameplay-audio.m4a` | events at ~7.30 s, ~38.31 s, ~41.89 s, ~54 s, ~120.5-122.4 s | missile fire, battleship buzz, win jingle, and the [625 Hz tone](#the-625-hz-tone-that-is-there) |
| `assets/reference/loss-audio.m4a` | events at ~27.4 s, ~85.86-86.99 s | launcher-hit warning beeps, loss sound |
| `assets/reference/battleship-arrival.m4a`, `battleship-interval.m4a` | one recording, trimmed twice; arrivals at 0.32-4.37 s and 20.12-23.92 s | battleship buzz - the only sound isolated from everything else the machine does |
| `assets/reference/skill3-video-audio.m4a` | 23.24 s; tone episodes at 1.10, 14.10 and 17.70 s | the audio track of the owner's skill-3 video, extracted 2026-08-26 |

**The last row is a second machine-session, not a second analysis of the same
one**, which is why it is worth its size. The owner recorded 23.2 s of video at
30 fps with the unit visibly set to skill 3; the audio is extracted here so that
figures drawn from it are re-derivable from this repository, and the 33 MB video
itself is not committed. Where a finding rests on the picture rather than the
sound - what the tube was showing at a given moment - this document says so and
names the timestamp, because that part cannot be re-derived here.

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

## jetMarch - withdrawn as evidence, still in the ROM

**There is no per-step march sound.** This section used to record one, at
600-650 Hz with a 70 ms step, marked *Measured* off `gameplay-audio.m4a` at
~66 s, and the ROM emits a 71.8 ms note per squadron step on the strength of it.

**The evidence for it is withdrawn here. The `jm_beep` note is still in
`asm/jetfighter.asm`**, and the gap between those two sentences is deliberate:
removing it turns out to break something else that was also measured. See
[what removing it costs](#what-removing-it-costs) at the end of this section,
which is written so that whoever does the removal starts from the measurement
rather than from this section's conclusion.

**Owner-reported**, verbatim, 2026-08-26, playing the physical unit:

> "the jet fighters do not beep as they go from left to right"

and, asked whether he meant only that there was no discrete per-step beep rather
than no sound at all:

> "no marching sound"

| Field | Value | Source |
| --- | --- | --- |
| `jetMarch.dominantHzRange` | 600-650 Hz | **Withdrawn as a march.** The band holds a real sound; it is not this one. See below. |
| `jetMarch.synthesizedHz` | 620 Hz | Withdrawn - Synthesized (v1) |
| `jetMarch.testBandHz` | 585-660 Hz | Withdrawn - Test bound (v1) |
| `jetMarch.stepDurationMs` | 70 ms | Withdrawn - Synthesized (v1), never a measurement |
| `jetMarch.timestampSec` | ~66 | Withdrawn - see below |

### What the recordings say

`tools/probe/drives/march-tone-identity.ts` re-derives every figure here, from
`gameplay-audio.m4a` - the file the entry came from - and from
`skill3-video-audio.m4a`, which is a different session on the same machine.

**At the cited ~66 s there is no note.** The periodic events there are broadband
transients: across ten consecutive events the dominant frequency reads 1513,
648, 1087, 1508, 1344, 687, 1311, 1531, 1246 and 1304 Hz, a spread of **883 Hz**.
A 627 Hz note lasting 71.8 ms reads one frequency at every event. A 3-8 ms
transient reads whatever the window happened to catch, which is this.

**And ~66 s is not where the band's energy is.** Scoring every 40 ms window of
the file for how far 600-650 Hz stands above the median of eight equal-width
control bands, the peak within a second of 66 s is **16.6 dB** against **48.3 dB**
for the file, and 66 s sits at the file's own 90th percentile (10.1 dB). The
nearest genuine tone in that band is **37.2 s away**.

**One test in the original brief for this work does not survive, and is recorded
because it looked decisive.** Comparing 600-650 Hz energy at an event against
the same band 100 ms later returns a large *positive* excess at 9 of the 10
events at 66 s - up to +55 dB - which reads as "the march is there". It is an
artefact of density: events at 66 s land about 100 ms apart, so the reference
window falls in the gap *after* the event rather than on quiet floor, and any
transient beats it. The same test on the sparser skill-3 video returns negative
excesses (-9.1, -11.0, -2.6, -5.5, +0.6, -1.9, -1.7 dB) for the same reason in
reverse. **A statistic whose answer depends on how busy the neighbouring 100 ms
was is not measuring the event.**

### The 625 Hz tone that is there

The band is not empty, and calling the old entry a mis-analysis of clicks would
be wrong. Both recordings carry a genuine **625 Hz tone**:

| Field | Value | Source |
| --- | --- | --- |
| `deviceTone625.fundamentalHz` | **625 Hz** | Measured (partial spacing, two recordings) |
| `deviceTone625.partialsObserved` | 625 / 1252 / 1877 / 2509 / 3129 / 3755 Hz (gameplay); 625 / 1251 / 1875 / 2499 / 3125 / 3749 Hz (video) | Measured |
| `deviceTone625.durationMs` | **405, 416, 417** (gameplay); **414, 416** (video); **699, 649** (`IMG_6113` t=120) | Measured, unbroken run within 12 dB of each episode's own peak |
| `deviceTone625.continuity` | continuous - no gap anywhere in an episode | Measured |
| `deviceTone625.episodeCount` | 3 in 130 s; 2 in 23 s; 2 in the 20 s at `IMG_6113` t=120 | Measured |
| `deviceTone625.partialExcessDb` | **15.2-20.5 dB** over the neighbourhood, harmonics 2-6 | Measured |
| `deviceTone625.trigger` | **unknown** | See `open-questions.md` §15 |
| `deviceTone625.method` | narrow-line excess to locate, harmonic comb to confirm, narrow-band envelope for continuity | - |

**This is not the sound `open-questions.md` §16 identifies as the blanking
source, and the two were nearly conflated.** §16 measures 25 tonal runs of
130-210 ms in the same 600-650 Hz band. Put through one instrument
(`march-tone-identity.ts` §3c) the two populations share a fundamental and
nothing else:

| | this 625 Hz tone | §16's runs |
| --- | --- | --- |
| unbroken run | 405-699 ms | 126-155 ms |
| harmonic comb, **same 100 ms window for both** | **17.4 dB** | 6.6 dB |
| partials 2-6 over their neighbourhood | **15.2-20.5 dB** | 1.8-7.1 dB |
| fundamental | 626 Hz, spread 9 Hz | 625 Hz, spread 26 Hz |

Room silence scores 4.7 dB on that comb, so §16's runs are barely tonal by this
measure while this tone is emphatically so. Two things are worth saying about
that table rather than leaving it to be read. The comb is scored over **the same
window length for both**, because a shorter window scores lower on a comb
whatever it holds and would manufacture exactly this gap. And the partial
*excess* is given because a partial-ratio table cannot fail - it reports the
nearest peak to each multiple, and in noise there is always one - so the ratios
agree for both populations and mean nothing on their own.

**The discriminator is §16's own control window.** `IMG_6113` t=120 blanks
**0.0%** and holds two of the longest tones measured anywhere, 699 and 649 ms,
and not one short event. t=210 and t=340 blank 13.2% and 16.7% and hold sixteen
short events and one long tone. So this tone can be present with no blanking at
all. Whatever darkens the owner's display, it is not this.

Four things make this the machine rather than the room:

- **It has a harmonic series.** Six consecutive multiples, with the 6th at
  3750 Hz sitting in the piezo resonance the [battleshipBuzz](#battleshipbuzz)
  section measures at 3.7-4.5 kHz. On the harmonic-comb score it reads 10.9 to
  17.8 dB where room silence in the same file reads 4.7 dB.
- **It is not the clicks.** Two of the video's tone episodes - 14.10-14.51 s and
  17.70-18.11 s - fall *inside* the 3.2 s and 4.6 s silences in that recording's
  click train. Whatever those clicks are, and the owner has since suggested they
  may be his own thumb on the controls, the tone is a separate thing.
- **It is absent from the isolated battleship recording**, where the same
  detector finds no sustained tone across 24 s containing two full arrivals.

**A fourth point was drafted here and withdrawn on checking, which is worth
recording because it was persuasive.** The video's frames do show the score
readout unlit throughout 14.10-14.51 s and lit again at 14.63 s, and that reads
exactly like `note` refusing to sweep the tube for the length of a burst -
[vfd-appearance.md](vfd-appearance.md) §5 measures that behaviour, so it would
have been a tidy confirmation. **It does not survive its control.** Sampled
every 0.2-0.5 s, the readout is also unlit from 13.70 s - four tenths of a
second *before* the tone starts - and from 17.00 s to the end of the video at
23.2 s, a six-second stretch containing one 410 ms episode. Darkness in this
recording is not specific to the tone, so it is not evidence about the tone.

And four things make it **not a march**, which is the question this section
exists to answer:

1. It is continuous. Every episode is an unbroken 405-417 ms run on an envelope
   smoothed at 60 Hz, which settles in about 6 ms and would resolve a 25 ms gap
   between 70 ms beeps if there were one.
2. 410 ms is not 70 ms.
3. Three episodes in 130 s and two in 23 s is not a step cadence.
4. None of them is anywhere near 66 s.

**What game event fires it is unresolved** and is recorded in
`open-questions.md` §15 with what would settle it, together with a score reading
taken across one episode. The band is kept in this
document under its own name rather than deleted, because a real sound that
nobody has identified is worth more written down than forgotten.

### What removing it costs

The removal was written, assembled and measured before being held back, so this
is a report rather than a worry. `jm_beep`, the four `SND_MARCH_*` constants,
`NIB_J_MOVED` - which nothing else reads - and the `jm_lane_done` branch all
come out cleanly; the ROM assembles at 1619 words with no change in page
pressure. Two things then break, and neither can be fixed by relaxing a bound.

**1. The emulated tube stops blinking.** `note` parks the sweep for the whole of
every burst, so on this machine as on the real one every sound is a blink. At
71.8 ms per squadron step the march note was by a wide margin the emulator's
main source of that. Without it:

| Probe | Dark-frame fraction with `jm_beep` | Without it | Its own measured floor |
| --- | --- | --- | --- |
| `tools/probe/sweep-timing.test.ts` | passes | 1.55% | 3% |
| `tools/probe/blank-to-glass.test.ts` | passes | 0.73% | 2% |

And the real unit runs the other way. `vfd-appearance.md` §5 measures **complete
whole-display blanking on 14-17% of all frames during active play**, in runs of
**4-5 frames (133-167 ms)**, at roughly one per 1.1 s, and calls it "the loudest
thing this document has to say about the look". Removing the march leaves the
emulator with almost no blanking source at all while the machine it copies
blinks constantly.

**That is not an argument for keeping the march**, because 133-167 ms was never
71.8 ms - the observed blank runs never matched the note that was supposed to
cause them - and it is not the 625 Hz tone's 410 ms either. What it says is that
**something on that unit sounds for about 150 ms roughly once a second during
play, and the owner has told us it is not the jets marching.** That is
`open-questions.md` §16.

**2. Three battleship constants need re-deriving, and they do not behave as
their comments say.** Sweeps run about 12% more often without the note, so any
sweep-counted duration shrinks in wall time: the boat's arrival falls to
**3.486 s** against the 3.5-4.5 s bound taken from the owner's isolated
recording. `BSHIP_STEP`, `BSHIP_GAP` and `BSHIP_OPEN` all carry "MEASURED off
the running machine" comments for exactly this reason, so re-deriving them is
expected work. What is not expected is that raising `BSHIP_STEP` from 65 to 73
sweeps - the +12% the arithmetic asks for - moves the measured arrival from
3.4861 s to **3.4866 s**. Whatever bounds that duration is not the constant
whose comment says it does, and finding out what does is its own piece of work.

So the removal is correct on the evidence in this section and is not a tidy-up.
It should be done deliberately, with the blanking question owned rather than
inherited.

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
| `battleshipBuzz.constraint` | must be below **625 Hz**, the tone that band turned out to hold | Owner-confirmed rule, **reference point restated** - see below |
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

**The constraint outlived the thing it was stated against.** It was put to the
owner as "the buzz sits below the march", he confirmed it, and the march has
since been withdrawn. What he confirmed was a *relation between two sounds he
can hear*, not an arithmetic fact about a band that no longer describes
anything, so it is restated against the sound that band does hold - the 625 Hz
tone in [jetMarch](#the-625-hz-tone-that-is-there) - rather than deleted. At a
93.4 Hz repetition rate against 625 Hz the constraint is satisfied with 2.7
octaves to spare, so nothing in the ROM turns on it either way. It is kept
because withdrawing a confirmed observation on the grounds that its landmark
moved would be discarding testimony to tidy a document.

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

### The five stages are a spectral trajectory. They are not notes.

**This matters, and it was found while trying to test the owner's claim that the
loss sound is a four-note melody.** The table above reads as a tune - five
pitches, five durations - and the ROM plays it as one. Nobody had asked whether
the recording carries a pitch there at all. It does not.

The test is a harmonic comb: the mean level at the first eight multiples of a
candidate fundamental, minus the mean level 55 Hz either side of each. A tone
with a harmonic series scores high; noise scores near zero however loud it is.
The score means nothing on its own, so controls from the same recordings are
scored in the same pass (`tools/probe/drives/loss-warning-partials.ts`,
section 7):

| Window | Best f0 | Comb score |
| --- | --- | --- |
| **CONTROL** the win jingle, a known tone | 1249 Hz | **+12.9 dB** |
| **CONTROL** the 625 Hz tone, a known tone | 1251 Hz | **+10.9 dB** |
| **CONTROL** room silence, `gameplay-audio.m4a` | 859 Hz | +4.7 dB |
| **CONTROL** room silence, `loss-audio.m4a` | 714 Hz | +6.8 dB |
| loss +80 ms, the opening peak | 560 Hz | +4.6 dB |
| loss +135 ms | 758 Hz | +5.4 dB |
| loss +315 ms, the body peak | 503 Hz | +6.3 dB |
| loss +405 ms, the body | 417 Hz | +5.5 dB |
| loss +535 ms, the tail | 304 Hz | +4.6 dB |
| loss +915 ms, the tail | 194 Hz | +4.9 dB |
| the launcher-hit warning's first beep | 784 Hz | +5.0 dB |

**Every part of the loss sound scores at or below room silence.** The ruler is
working - it separates a known tone from a known silence by 8.2 dB in the same
file - and it finds nothing to separate here.

The `collapseHzRange` of 80-97 Hz was checked a second way, because it is the
one stage a comb should find easily if it is real: a 92 Hz square or pulse drive
puts a 92 Hz comb under the piezo resonance, which is exactly how
[battleshipBuzz](#battleshipbuzz) was measured at 93.4 Hz in this same document.
Scored directly across the collapse, the 92 Hz comb reads **+2.4, +1.7, -0.7,
-1.4 and -2.2 dB**. It is not there.

**What is real is the trajectory.** The dominant bin and the spectral centroid
do move the way the table says - the opening's centroid falls from ~890 Hz to
106 Hz over about 50 ms, the body sits at 250-600 Hz with its dominant bin at
90-300 Hz, and the tail's centroid climbs into the recording's own 1400-1700 Hz
whine as it decays. So the five rows are a fair description of **where a noise
burst's energy sits over time**. They are not five notes, and quoting them as
pitches is the same substitution the preamble of this document warns about,
made in the other direction: a reading standing in for a note nobody heard.

Counted on its envelope instead - 60-6000 Hz, smoothed at 40 Hz, a maximum
counting when 3 dB of dip separates it from the last - the sound has **8 maxima
within 25 dB of its peak and 16 counting the tail**:

| Offset from onset (ms) | Level (dB re peak) | Centroid (Hz) |
| --- | --- | --- |
| 80 | -11.7 | 106 |
| 135 | -20.6 | 860 |
| 315 | **-0.1** | 307 |
| 380 | -2.3 | 260 |
| 405 | -3.3 | 324 |
| 535 | -21.7 | 1103 |
| 755 | -21.4 | 1207 |
| 915 | -22.8 | 1453 |

Neither 4 nor 5. Grouped by the dips that separate them, what the envelope shows
is a rise to a first peak whose centroid falls as it goes, a low stretch, a much
louder body, and a long decaying tail of small bumps. That is an envelope, not a
tune.

**No ROM change is proposed here.** The five-stage `gameOver` sequence produces a
descending buzz of roughly the right length and roughly the right energy
distribution, and this analysis gives no measured target to replace it with -
"play noise instead" is not a specification a `note` loop can be written from.
What changes is what this document claims: the stage frequencies are recorded as
*where the energy was*, not as notes the machine played.

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
| `launcherHitWarning.perBeepDominantHz` | **withdrawn**: 269, 319, 744 was one window placement out of many, and the reading swings ~1 kHz when the window moves | **Not a determined quantity** - see below |
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

**Owner-reported**, verbatim, 2026-08-26, asked to be precise about how many
notes:

> "every hit of the three lives plays the sound, the end of game has the full
> melody, the loss of the first life has part of the melody, the second life
> loss has a bit more and the final has all"

> "first hit: two notes. Second hit: three notes. Last and final hit: 4 notes.
> Each tune is an extension of the last"

The second account is specific enough to predict something, and it **agrees with
what was already Owner-confirmed** rather than competing with it: two beeps on
the first hit and three on the second are exactly the note counts a two-note and
a three-note prefix would produce. Under his account `beepCountHit1` and
`beepCountHit2` are not counts of a repeated note at all - they are counts of
*different* notes. The count testimony and the melody testimony fit together;
what does not fit is the measurement.

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
`assets/reference/loss-audio.m4a`. **Nothing runs it automatically** - `npm test` never
reaches `tools/probe/drives/`, and it needs `ffmpeg` on PATH to decode the m4a, which it
checks for and names. Every figure in this section is printed by that drive; where a
figure is not, this section says so.

Decoded to mono 48 kHz; 10 ms Hann windows - `beepDurationMs` above - zero-padded to
65536, giving 0.73 Hz bins. **The bin grid is not the uncertainty**: a 10 ms Hann
mainlobe is ~400 Hz wide, so each reading below carries its own -3 dB span and those
spans are the honest error bars. Spectra are divided by the mean of nine background
windows taken from the gaps between and before the beeps, and read over 150-1350 Hz:
above the recording's table rumble, below the continuous 1400-1700 Hz whine. The whine
is what "whine-notched" means above; in the five quietest 200 ms windows of the file it
peaks at 1463-1631 Hz, **15.3 to 20.6 dB** over the median level of the surrounding
1000-2200 Hz (drive section 5b).

**n = 1.** A shape-based sweep of all 88 s - a zero-phase 300-1300 Hz envelope at 1 ms
frames, bursts being runs of 4-16 ms more than 15 dB over the median of the 500 ms
around them, isolated if no other burst-level energy falls within 12 ms either side,
grouped at 25-50 ms spacing - returns **one** beep group in play, the one at 27.383 s
this document already cites: three bursts, 43 and 32 ms apart. The rest of the
recording is dense overlapping play. One further group sits at 86.143 s, which is
*inside* the loss sound (`gameOver.timestampRangeSec` 85.86-86.99) rather than a
warning.

That count is not perfectly threshold-stable, and the drive prints the grid rather than
the one setting: the 27.383 s group is returned at every threshold from +11 to +19 dB,
but a second two-burst candidate near 28.05-28.07 s appears at +13, +17 and +19 dB and
not at +11 or +15. It has not been examined and nothing here rests on it.

**Two in 88 seconds is not a blind detector, and that was worth checking rather
than assuming.** A full game has three life losses; finding one warning could
mean the recording lacks them or that the sweep cannot see them. Pointed at
`gameplay-audio.m4a` - identical envelope, identical floor, identical burst and
grouping rules - the same detector returns 31, 27, 22, 15 and 7 candidate groups
at the +11 to +19 dB settings (drive section 9). It sees plenty. What it cannot
do is tell a launcher-hit warning from any other pair of clicks 25-50 ms apart,
so a count in a dense file is a count of candidates. **n = 1 is a limit on what
could be *isolated* in `loss-audio.m4a`, not a census of the warnings the
machine played**, and no threshold will turn it into one.

So every figure below is a sample of size one, and the beep *counts* in the table above
remain Owner-confirmed rather than measured: this recording contains one warning event,
not one of each kind. **A claim about a progression across three life-losses cannot be
tested from a single instance of one of them**, and the sections below are careful not
to pretend otherwise.

#### Per-beep, never pooled

| Beep | Window start (s) | Dominant Hz | -3 dB span | Excess over background | LOW-MID |
| --- | --- | --- | --- | --- | --- |
| 1 | 27.3850 | **269** | 196-344 | +29.6 dB | -1.5 dB |
| 2 | 27.4270 | **319** | 231-523 | +19.8 dB | -13.7 dB |
| 3 | 27.4580 | **744** | 675-837 | +18.3 dB | -12.2 dB |

Onset to onset: 42.0 ms and 31.0 ms - spectral peak centres, which is why they differ
by a millisecond from the 43 and 32 ms the 1 ms envelope sweep above reports for the
same three beeps. The group spans 73 ms, 88 ms including beep 3's decay. LOW-MID is the 80-110 Hz level minus the 420-560 Hz level - the collapse band
against the opening band.

**They do not descend.** The prefix model requires 466 -> 92 -> 240 Hz. The reading
rises, and beep 2 - the one that would have to *be* the 92 Hz collapse - sits at 319 Hz
with 13.7 dB **less** energy in the collapse band than in the opening band.

Beep 3 is the least trustworthy of the three, on the two figures the drive prints for
it: the lowest excess over background (+18.3 dB against beep 1's +29.6) and the
shortest run in the isolation sweep (5 ms, against 9 and 7 ms). Its 744 Hz should not
be quoted as a clean figure. That does not rescue the prefix model either way - a weak
reading cannot be moved *down* to 92 Hz by being weak.

*Corrected*: an earlier revision of this section said the sweep rejected beep 3 because
another event at ~27.451 s overlapped its attack. **That does not reproduce.** The
committed sweep calls all three beeps isolated and finds no separate burst between beep
2 and beep 3. The original claim came from a script that was never committed, which is
exactly the failure `tools/probe/drives/README.md` exists to prevent.

**These three numbers do not replace `dominantHzRange`, and are not a correction of
it.** They sit lower than the pooled 455 / 455 / 544 for reasons that are all method
and not disagreement: this pass divides by a background where v1 did not, restricts to
150-1350 Hz where v1 read the whole spectrum, and reports the strongest partial of a
10 ms *transient* rather than of the event. A piezo click that short is broadband -
look at the -3 dB spans, which run 148 to 292 Hz wide - so its "dominant" is a weak
pitch estimate by construction. **What the per-beep pass is good for is the shape of
the sequence, not the value of any one beep**, and the shape is what the question was
about. The 455-545 Hz acceptance band in the summary below stands unchanged.

#### Neither reading was right: the quantity is not determined

The paragraph above says the two figures differ "for reasons that are all method",
and stops there. Pushed on, that turns out to understate it. **Move the analysis
window and the reading moves with it, by about a kilohertz.**

The same three beeps, read at five window lengths and processing choices and at
seven window placements relative to each beep's own spectral peak - 35 readings
per beep, all off the same recording (drive section 6):

| Beep | Range across its 35 readings | Spread |
| --- | --- | --- |
| 1 | 150 - 1239 Hz | **1088 Hz** |
| 2 | 154 - 1350 Hz | **1196 Hz** |
| 3 | 418 - 1118 Hz | **699 Hz** |

Shifting the window by 2 ms - a fifth of a beep - takes beep 1 from 920 Hz to
315 Hz. Both quoted figure sets sit inside the swing: 269 / 319 / 744 is one
row of that table and 455 / 455 / 544 is a different one.

**So there was never a discrepancy between two measurements to resolve.** A
10 ms Hann mainlobe is about 400 Hz wide and these beeps are broadband clicks
shorter than that window; "the dominant" is then decided by where the window
lands, whether a background is divided out and how wide a band is searched,
rather than by the beep. **This recording does not carry a per-beep pitch for the
warning, and no choice of method will make it carry one.** The harmonic-comb
score agrees: beep 1 reads +5.0 dB, against +4.7 dB for room silence and
+12.9 dB for a known tone.

The rest of the analysis is unaffected, and that is deliberate. The LOW-MID
statistic, the event-shape fractions and the arithmetic below all avoid the
dominant entirely - which is why the conclusion they support survives the
figure that motivated it being withdrawn.

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

#### The four-note description against the ROM's five stages

The owner describes a **four**-note melody played in full on the third hit. The
ROM plays **five** stages. That looked like a tension to resolve by deciding
which of the five is a decay tail rather than a note.

**It is not resolvable, because the premise is wrong on the measurement side.**
The loss sound in this recording carries no pitch at all - see
[the five stages are a spectral trajectory](#the-five-stages-are-a-spectral-trajectory-they-are-not-notes),
where every part of it scores at or below room silence on a comb that separates a
known tone from silence by 8.2 dB in the same file. Counted on its envelope
rather than by pitch it has 8 maxima within 25 dB of its peak and 16 counting the
tail. **The recording cannot say whether the melody is four notes or five,
because it does not show a melody.**

That is not evidence against the owner. He is describing what he hears through
his ears in a room; this is a phone microphone measuring what reached it through
a small piezo, and a four-note tune played fast on a hard-clipped square wave can
reach a microphone as a noise burst. What it does mean is that the four-versus-five
question needs a recording made to answer it, and this one is not that.

#### The conflict, stated

**The measurement and the testimony conflict, and this section prefers neither.** What
is measured is narrower than the question: *in this recording*, the warning event at
27.383 s is a train of short, roughly equal, separated beeps - the repetition model -
and not a growing prefix of the loss melody. The owner, playing a physical unit,
reports a growing prefix. One recording of one event cannot decide between a
misdescription and a different machine.

`launcherHitWarning.isLossThemePrefix`, stated as the verdict this section is
required to give:

> **The progressive-melody hypothesis cannot be tested from these recordings.**
> They contain one warning event out of the three kinds the hypothesis is about;
> the warning's per-beep pitch is not a determined quantity in them; and the loss
> sound they carry has no measurable pitch to take a prefix of. What the
> recordings *do* say is narrower and unchanged: this one event is a train of
> short separated beeps, not a growing prefix.

**What would settle it**, in order of how much it would settle:

1. **An isolated recording of a first hit and of a second hit**, made
   deliberately, the way `battleshipBuzz` was settled - each in a quiet room, the
   unit close to the microphone, one event per file. Under the prefix model the
   two files differ by an appended note; under the repetition model they differ
   by one more copy of the same one. That comparison needs no pitch estimate at
   all, which is why it works where everything above fails.
2. **The same for the third hit**, which would settle the note count directly.
3. Failing a quiet room, **three separate recordings of the same hit** would at
   least turn n = 1 into n = 3 and let the beep spacing be averaged.

**No ROM change is proposed** - not because the testimony has been refuted, but because
nothing here gives a measured target to change it *to*. `SND_WARN_*` and the `lw_beep`
loop stand as they are, and the entry in the table above stays "owner says yes; the
recording says no" rather than collapsing to either.

**If a recording of the kind above supports the owner**, the change it would
justify is specific and is written down here so that it does not have to be
re-derived: `game_over` would gain an entry point taking a stage count, `lw_beep`
would be replaced by a call to it with 2 or 3 rather than by its own note loop,
and `SND_WARN_*` would go the way `SND_MARCH_*` has. That is a smaller change
than it sounds, because `gameOver` already walks its stages in order. It is not
being made now because the evidence for it is one man's memory of a sound and
this project's rule is that a ROM change needs a measurement to aim at.

Both accounts are kept because the owner is describing a real unit and this analysis
cannot say which of these is true:

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
| `battleshipBuzz` | 79-111 Hz repetition rate, and below 625 Hz | ~4.0 s, continuous |
| `win` | 750 / 937 / 1248 Hz arpeggio, resolving up to 1868 | ~1.88 s |
| `gameOver` | 455-545 -> 80-97 -> 200-280 -> ~147 Hz | ~1.13 s |
| `launcherHitWarning` | 455-545 Hz | ~10 ms per beep, 25-28 ms gaps |

`jetMarch` is gone from this table because the sound is gone from the ROM. The
625 Hz tone that band turned out to hold is not an acceptance target: nothing in
the program emits it, because nobody knows what emits it on the real unit.

Per PRD R7, each sound constant in the ROM source (`asm/jetfighter.asm`) must cite
its row here in a comment.
