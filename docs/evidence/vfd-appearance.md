# VFD appearance reference

How the real CGL "Jet Fighters" vacuum fluorescent tube behaves - refresh, persistence,
brightness and blanking - measured from video of the owner's unit being played.

This is a specification for `src/machine/tube/`. It changes no code. Section
[Where the renderer diverges](#where-the-renderer-diverges) lists the actionable gaps.

## Provenance

Single source: `IMG_6113.mov`, the owner's recording of the physical unit mid-game.
1920x1080 HEVC, 12,237 frames, 407.9 s, iPhone 13 Pro Max. **Not committed** - 580 MB.
Referenced by path only.

All figures below come from four independently sampled 600-frame windows starting at
t = 25 s, 120 s, 210 s and 340 s. Every number is stated with the number of windows it
was reproduced in. Anything measured once is labelled as such.

Method notes that matter for reproducing this:

- Phosphor is isolated by **colour excess**, not luminance. `R - max(G, B)` for red,
  `min(G, B) - R` for cyan, threshold 40. Sunlight glare on the glass swamps luminance
  and the red case body swamps a naive red-channel test.
- The red case is excluded by a **tube-interior mask**: a pixel counts only if its
  `max(R, G, B)` drops below 70 at some point in the window. The case never goes dark;
  the tube does. Skipping this mask inflates every red count by ~130,000 pixels per
  frame and was an error made once during this work before it was caught.
- Elements are found as connected components of the pixels that ever switch, then
  reduced to a **core mask** - the pixels lit whenever the element is fully lit. Without
  it, a fully lit glyph reads as only ~60% lit, because its anti-aliased edge pixels
  never cross the threshold. That artifact looks exactly like a partially scanned
  segment and is not one.

---

## 1. The time base: this video is 30 fps real time, not 240 fps

**This is the correction on which every other figure here depends.** The brief for this
work stated the capture was 240 fps, so each frame was 1/240 s of real time. It is not.
Each frame is **1/30 s = 33.33 ms**, and the recording is 6 min 48 s of real play, not
51 s.

Three independent lines of evidence:

**The container is uniformly 30 fps.** Video packet PTS spacing is exactly 1/30 s across
the file (media timescale 2400, 80 units per frame). There is no 240 fps media being
retimed by an edit list.

**The audio is not pitch-shifted.** A 240 fps slow-motion export carries audio slowed by
the same 8x, which drops its pitch by three octaves. Measured against
`docs/evidence/audio-reference.md`:

| Moment in this video | Measured dominant | Reference band | Verdict |
| --- | --- | --- | --- |
| t = 210 s | 585-634 Hz | `jetMarch.dominantHzRange` 600-650 Hz | at pitch |
| t = 402 s | 2250 Hz | `win` F#5 second partial, 2250 Hz | at pitch |
| t = 4 s | 460-545 Hz | `gameOver.openingHzRange` 455-545 Hz | at pitch |

Every sound sits in its measured band. Nothing is an octave low, let alone three.

**The picture and the sound are synchronous at 1:1.** The tube goes fully dark in bursts
(section 5). Correlating the per-frame "tube dark" indicator against per-frame audio RMS,
frame for frame, at both candidate time bases:

| Window | r at 1:1 (30 fps) | r at 8:1 (240 fps) |
| --- | --- | --- |
| t = 210 s | **+0.62** at lag +2 frames | +0.09, no localised peak |
| t = 340 s | **+0.62** at lag +2 frames | +0.04, no localised peak |
| t = 25 s | +0.24 at lag +2 frames | +0.11, no localised peak |
| t = 120 s | no dark frames in window | - |

The 1:1 correlation is a single sharp peak, at the same lag, in two independent windows.
Conditioned rather than correlated, the same fact:

```
P(tube dark | speaker loud)  = 0.37 (t=210 s), 0.46 (t=340 s)
P(tube dark | speaker quiet) = 0.04 (t=210 s), 0.04 (t=340 s)
```

A 10x contrast, reproduced. That cannot arise if the picture ran 8x slower than the
sound.

**Consequence.** 33.33 ms between samples is longer than one sweep of the tube. This
video **cannot** resolve the sweep directly; it can only see it aliased. Everything in
section 2 is an aliasing argument, and is bracketed accordingly. Anyone re-deriving
timings from this file must use 33.33 ms per frame.

**Side effect worth recording:** the squadron advances one column per **18 frames =
600 ms**, measured on the top row at t=210 s and the bottom row at t=340 s. This does not
agree with the 205.1 ms per step taken from the owner's audio. 600 ms is close to 3x
205.1 ms, so the likeliest reading is that the march sound pulses about three times per
column of travel - but that is inference, not measurement, and it is flagged in
[What could not be determined](#what-could-not-be-determined).

---

## 2. The refresh

### What is directly observed

A continuously driven element - the SCORE legend and the score digits, whose content is
static for many seconds - reads **lit in 61-66% of frames** (7 elements, 2 windows, 600
frames each). It is never at an intermediate level for more than one frame at a time.

The on/off sequence is not random. Its autocorrelation peaks at **lag 3 frames**
(r = 0.17 to 0.66, with weaker peaks at lags 6 and 11), reproduced in both windows. Run
lengths are strongly non-geometric: ON runs of 1 and 2 frames dominate (84 and 82
occurrences in 600 frames) with almost none of length 3+; OFF runs are 151 of length 1
against 17 of length 2. Independent sampling would give a geometric distribution. This is
a beat.

The beat's spectral peak is at **f_beat = 10.6 to 12.5 Hz**, with a half-power width of
**5 to 11 Hz**.

### What that implies for the sweep rate

Sampling a display of frequency `f_sweep` at 30 Hz aliases it to
`f_beat = |f_sweep - 30n|`. Inverting, with f_beat = 10.6-12.5 Hz:

Each `n` admits **two disjoint intervals**, `30n + f_beat` and `30n - f_beat`, not one
contiguous range:

| n | f_sweep = 30n - f_beat | f_sweep = 30n + f_beat |
| --- | --- | --- |
| 1 | 17.5 - 19.4 Hz | 40.6 - 42.5 Hz |
| 2 | 47.5 - 49.4 Hz | 70.6 - 72.5 Hz |
| 3 | 77.5 - 79.4 Hz | 100.6 - 102.5 Hz |
| 4 | 107.5 - 109.4 Hz | 130.6 - 132.5 Hz |

An earlier revision of this table merged adjacent intervals into contiguous brackets
("41 - 49", "70 - 79"). That was wrong and overstated the coverage: the gaps between
these intervals are excluded by the measurement, not admitted by it.

**A single sampling rate cannot choose between these.** What it can do is rule things out.

**The sweep is not 64.5 Hz.** That is the figure `asm/jetfighter.asm` currently produces
(6190 cycles at 400 kHz, from `DWELL_OUTER`/`DWELL_INNER` = 15). A 64.5 Hz sweep sampled
at 30 Hz beats at |64.5 - 60| = **4.5 Hz**, a 6.7-frame period. The observed beat is
10.6-12.5 Hz, a 2.4-2.9 frame period - 2.4x to 2.8x too fast. 64.5 Hz sits in the gap
between the 47.5-49.4 and 70.6-72.5 intervals and is excluded by both.

**The nearest admissible interval to what the ROM does today is 70.6 - 72.5 Hz**, about
9-12% faster than 64.5 Hz. That is the interval to target absent better evidence, and it
is consistent with the ROM comment's own uncorrected estimate of "~68 Hz".

One caveat on how narrow to read these intervals. They bracket the **mean** sweep rate,
derived from the position of the beat's peak. The next section shows the sweep is not
frequency-stable, so individual passes range either side of that mean. The intervals
constrain where the centre sits; they do not claim every pass falls inside one.

### The sweep is not frequency-stable

The beat's half-power width of 5-11 Hz is the finding, not noise. A crystal-stable sweep
observed over 600 samples would give a line of width ~0.05 Hz, so a width two orders of
magnitude wider means **the sweep is genuinely not periodic**.

Quantifying it needs care, and an earlier revision of this section got it wrong. Because
`f_beat = |f_sweep - 30n|`, a width in the beat is the *same absolute width in Hz* in the
sweep. Against the 70.6-72.5 Hz candidate, 5-11 Hz is a **full-width** spread of 7% to
15%, i.e. **+/-3.5% to +/-7.5%** about the centre - and only if the whole width is taken
to be period variation. Some of it is not: a finite 600-sample window, drift in the
oscillator over 20 s, and the varying camera exposure all broaden the peak independently.

So the defensible statement is the weaker one: **the observed spectral spread is
consistent with pass-to-pass period variation of up to roughly +/-7%, and rules out a
stable period.** Do not quote a single jitter figure from this document.

This is expected and should be preserved: the sweep is a software loop on a 4-bit MCU
interleaved with game logic, so a pass that does more work is a longer pass. Our
`src/machine/board/display.ts` already derives the frame period from the ROM rather than
imposing one, which is the right architecture. The measurement confirms it.

### Grids are strobed in horizontal order

Co-occurrence between pairs of elements - `P(both lit | either lit)`, computed only over
frames where both are being displayed - decays monotonically with horizontal separation
(36 pairs across all four windows, r = -0.55 against |dx|):

| horizontal separation | co-occurrence |
| --- | --- |
| 0 - 30 px | 0.86 |
| 30 - 90 px | 0.82 |
| 160 - 240 px | 0.62 |
| 240 - 330 px | 0.50 |
| 450 - 600 px | 0.43 |

Two readings follow. First, **the grids are enabled in left-to-right (or right-to-left)
screen order** - if the scan order were scrambled relative to position, co-occurrence
would be flat in |dx|. Second, the camera's exposure window spans a **contiguous run of
grid slots**, and a wide one: even elements at opposite ends of the tube (~600 px, the
full playfield width) still co-occur 43% of the time.

### The duty cycle cannot be measured from this video

The 61-66% appearance rate is not the duty cycle. It is

```
P(element reads lit) = (T_on + T_exposure) / T_sweep
```

and the video gives no independent handle on `T_exposure`. The figure is **consistent
with** ten grids at ~10% duty and a camera exposure of ~0.53 sweeps (~7 ms at 74 Hz,
i.e. 1/140 s - an unremarkable exposure for a scene with this much sun on it). It is
equally consistent with other splits. Treat the ten-grid ~9.5% duty that
`display.ts`/`ports.ts` implement as **unrefuted by this video, not confirmed by it**.

What *is* confirmed is that `T_on + T_exposure` is well over half the sweep period, which
independently requires the exposure to be long - a short-exposure capture of a 10% duty
sweep would show elements lit in ~10% of frames, not 63%.

---

## 3. Persistence

**The phosphor extinguishes far faster than we model it.**

The measurement: take frames where an element is still being driven by the ROM (it is lit
in neighbouring frames) but reads dark - the exposure missed that grid's slot. The light
remaining in those frames, normalised so 1.0 is the driven level and 0.0 the dark floor,
is the phosphor's residual between refreshes.

| Window | red residual | cyan residual |
| --- | --- | --- |
| t = 25 s | 14.7% | 4.5% |
| t = 120 s | 14.4% | (1 element only - excluded) |
| t = 210 s | 20.7% | 3.2% |
| t = 340 s | 13.4% | 3.3% |

Cyan: **3.2 - 4.5%**, from 1,300-1,500 dark samples per window. Red: **13 - 21%**, from
200+ samples per window. Both reproduced in every window that had enough data.

Converting to a time constant requires assuming the off-time. Taking the 70.6-72.5 Hz
candidate
(sweep ~13.5 ms) and ~10% duty, the off-time is ~12 ms, and the exposure averages the
decay across it, so the expected residual is `(tau/T_off)(1 - e^(-T_off/tau))`. Solving:

| | measured residual | implied tau | implied "ms to 10%" |
| --- | --- | --- | --- |
| cyan | 3.5% | **~0.4 ms** | **~1.0 ms** |
| red | 15.5% | **~1.9 ms** | **~4.4 ms** |

The tau figures move with the assumed sweep rate; the residual percentages do not. **Quote
the residuals, derive the tau.**

The renderer's `decayTimeMs: 15` corresponds to tau = 6.51 ms. That is **3x too slow for
red and 15x too slow for cyan**.

The rise time cannot be measured here at all. 33.33 ms sampling cannot see a 2-5 ms rise.
`riseTimeMs: 4` is neither confirmed nor refuted.

---

## 4. Brightness

**Load: no supply sag.** Relative brightness of a lit segment against the number of
elements lit in the same frame, normalised per element:

| elements lit simultaneously | red | cyan |
| --- | --- | --- |
| 1 - 2 | - | 0.99 |
| 3 | 0.97 | 1.01 |
| 4 | 0.98 | 0.99 |
| 5 | 0.99 | 1.01 |
| 6 | 0.98 | 1.01 |
| 7 - 12 | 0.99 | 0.98 |

Flat within 3% over the full range, both colours. **A real tube's supply does sag under
load; this one does not, measurably.** The expected mechanism is that the grids are
strobed one at a time, so the instantaneous anode load barely changes with how many
segments are lit overall. Do not add a sag term.

**Along a segment: uniform.** Fitting a top-to-bottom brightness gradient inside each lit
glyph gives a normalised slope of -0.007 (t=210 s) and -0.041 (t=340 s) against a
per-observation spread of 0.12-0.14. There is no consistent gradient and the two windows
disagree in magnitude. A lit segment is uniform along its height, and no rolling-shutter
banding is resolvable across the ~130 image rows the tube occupies.

**Across the tube: a left-to-right gradient exists, and should not be modelled.** Peak
cyan excess rises with x in both windows - 58 to 98 at t=210 s, 53 to 102 at t=340 s,
r = +0.86 and +0.88. It reproduces with the camera in two different positions, so it is
fixed to the tube, not the frame. But the tube sits behind a curved smoked filter inside a
circular window, viewed off-axis, and **this video cannot separate a real emission
gradient from that optical path**. Red gives r = +0.78 in one window and -0.65 in the
other (4 points), i.e. no signal. Leave it out until there is a head-on reference shot.

---

## 5. What a human actually sees

Two separate effects, and only one of them is visible.

**The multiplex is invisible.** At 41 Hz or above with an on-window covering more than
half of each period, the sweep is at or above flicker fusion. Integrating the video's
frames to emulate longer visual integration, on the static score block, and **excluding**
windows touched by a blanking event:

| integration | CoV (t=210 s) | CoV (t=340 s) |
| --- | --- | --- |
| 33 ms (1 frame) | 0.53 | 0.42 |
| 100 ms | 0.21 | 0.25 |
| 200 ms | 0.15 | 0.21 |
| 500 ms | 0.06 | 0.14 |

The violent frame-to-frame variation is the camera undersampling the sweep. It collapses
under integration. A person sees the score as steady.

**The blanking is very visible, and it is the loudest thing this document has to say
about the look.** The tube goes **completely dark, whole-display, for 4 to 5 frames -
133 to 167 ms - every time the speaker sounds.** Occasionally longer: one 27-frame
(900 ms) blank at t=340 s.

| Window | frames blanked | dark-run lengths (frames) |
| --- | --- | --- |
| t = 25 s | 39 / 600 (6.5%) | 1x15, 2x1, 5x1, 6x1, 11x1 |
| t = 120 s | 0 / 600 | - |
| t = 210 s | 83 / 600 (13.8%) | 1x4, 4x11, 5x7 |
| t = 340 s | 100 / 600 (16.7%) | 1x4, 4x7, 5x7, 6x1, 27x1 |

Including the same figures from section 1: `P(dark | speaker loud) = 0.37-0.46` against
`P(dark | quiet) = 0.04`.

The mechanism is not in doubt. The HMCS44 bit-bangs the speaker in timed delay loops;
while it is doing that it is not sweeping the tube, so the tube goes out. A 150 ms
blackout is nowhere near flicker fusion. **On the real machine, every sound is also a
visible blink of the entire display, and the two are locked together.** The window at
t=120 s, with no blanking at all, is a quiet stretch - which is the control.

So the perceived result is: a rock-steady display that **blinks off in time with every
beep**, and holds dark for roughly as long as the beep lasts.

---

## Where the renderer diverges

Read against `src/machine/tube/phosphor.ts`, `renderer.ts`, `palette.ts`,
`src/machine/board/display.ts` and `asm/jetfighter.asm`. **No code was changed by this
task.** Ordered by how much each one changes what the owner sees.

**D1 - Nothing ever blanks the display. (Section 5.) FIXED.**
`renderer.draw()` (`renderer.ts:219-232`) unconditionally paints background, ghost layer,
active layer and silkscreen every call; `blank()` (`renderer.ts:243`) only zeroes the
phosphor field and is only called on a power transition (`main.ts:104`). There is no path
by which a sound darkens the tube. The real machine blanks fully for 133-167 ms on every
sound, 14-17% of all frames during active play.

**Correction, made when this was implemented.** The prescription originally written here -
that `asm/jetfighter.asm`'s sound routines must stop refreshing the grids, after which the
existing `display.ts` frame machinery would blank the tube on its own - was half wrong,
and the half that was wrong is the half that would have fixed it.

*The ROM already stops.* `sweep` drops each grid with `REDY` after its dwell, so all ten
are low when the sweep ends, and `tick` -> `play_sound` -> `note_loop` runs between sweeps
touching only D14. Driving the machine headlessly and tapping D0-D9, the intervals with no
grid driven at all are 71.0-72.2 ms for a march note (70.4 ms of tone), 141.7 ms for a
two-beep launcher warning and 636.9 ms for the loss sequence. The blank already tracks the
sound one-for-one; there was no interleaving to remove.
`tools/probe/sweep-timing.test.ts` now pins this.

*What stops it reaching the glass is the observation surface.* `Display.getFrame()` returns
the most recently *completed* frame period, and a period completes only when a grid rises
that has already risen (`display.ts:112-115`). No grid rises during a blank, so no period
completes, so `Board.getLitSegments()` (`board.ts:176-181`) hands `main.ts` the last fully
lit sweep for the whole blank and `renderer.draw` paints it. The one effect that does
survive is a dilution: the frame that *contains* a sound spans one sweep plus the blank, so
its duty falls from 0.090 to about 0.016 and the renderer shows a single ~30%-brightness
frame *after* the sound. A dip, once the blink is over, rather than the blink.

*No ROM change can close that*, and the reason is structural rather than a missing trick: a
"last completed frame" is stale by construction while the sweep is stalled. Forcing a
boundary from the ROM closes the frame either before the blank - leaving the same lit frame
on screen through it - or after it, one diluted frame late. Reporting a dark tube *during*
the blank requires the observation surface to consult the live tube.

*What was done.* `Display.getObservedFrame(cycle)` answers the viewer's question - what is
on the glass now - and `Board.getLitSegments()`, which is what `main.ts` draws, returns it.
While the sweep is running it is the last completed frame period, exactly as before. Once
the drive has been gone longer than `REFRESH_TIMEOUT_CYCLES` it reports what is true: no
grid driven, so no segment lit, so every duty zero. The phosphor downstream turns that into
the decay a tube shows when its electrons stop. Nothing in the renderer changed and nothing
in the machine knows a sound is playing - the tube is dark because nothing is driving it,
which is the same reason the real one is.

The threshold is 2000 cycles, 5 ms. It is not a tuning choice, and the margin either side
of it is wide. Two independent runs driving the ROM and timing every interval with no grid
driven - 82 s of played and unattended game (n = 36,624) and a separate 20 s run
(n = 13,453) - give:

| interval | cycles |
| --- | --- |
| between grids, and between sweeps | 13 - 707 |
| shortest sound blank (launcher warning) | 16,990 (42.5 ms) |
| a march note | 28,415 (71.0 ms) |
| the loss sequence | 254,754 (636.9 ms) |

**Nothing at all falls between 707 and 16,990**, in either run. 2000 sits 2.8x above the
longest gap a running sweep makes and 8.5x below the shortest a sound makes.

An earlier revision of this paragraph said 13-660 and "the shortest a sound can produce is
~4045 (the 10 ms warning beep)", making 2000 look like half the shortest blank rather than
an eighth of it. No interval near 4045 was observed in either run: the sweep does not
resume between the warning's two beeps, so the shortest blank is the whole 42.5 ms
sequence. The constant is unchanged - only the evidence for it was wrong, and in the
direction that would have made a future reader think it was marginal.

The stalled interval also comes out of the frame period it fell in
(`PwmAccumulator.exclude`). Duty is a segment's share of a *refresh* period and a stall is
not refresh time; left in the denominator it put the sweeps either side of a note at 18% of
their real duty, which is the dilution described above. Ordinary variation - a pass that
runs long because there is more on the tube - stays in the denominator, because a slower
sweep really is dimmer.

*Measured through the renderer's own read path*, sampling `getLitSegments()` at the 60 Hz
cadence `main.ts` reads at, across a 67.9 ms march note:

| read, relative to the note | lit segments | peak duty | brightness |
| --- | --- | --- | --- |
| -26.0 ms | 9 | 0.0890 | 1.00 |
| -9.5 ms | 9 | 0.0890 | 0.93 |
| +7.5 ms | 0 | 0 | **0.00** |
| +24.0 ms | 0 | 0 | **0.00** |
| +40.5 ms | 0 | 0 | **0.00** |
| +57.5 ms | 0 | 0 | **0.00** |
| +74.0 ms | 9 | 0.0977 | 0.99 |
| +90.5 ms | 9 | 0.0889 | 0.93 |

Every read inside the note is dark, and the tube comes back at full level rather than the
dim frame. Before the period exclusion that +74.0 ms read was 0.0147, a sixth of normal.
`tools/probe/sweep-timing.test.ts` asserts this on every march-length note in the run
rather than on the 637 ms loss sequence alone - a long blank passes on a change that leaves
the common short one lit.

*What is still approximate.* The tube goes dark up to 5 ms into a blank rather than at the
instant the sweep stops, because that is what the threshold costs. Against a 68 ms note it
is 7% of the blank, and the phosphor's own decay - 0.97 ms for cyan and 4.29 ms for red to
10% after D2 and D3 - is of the same order, so the visible onset is a fade of a few
milliseconds either way.

**D2 - Phosphor decay is 3x to 15x too slow. (Section 3.)**
`PHOSPHOR.decayTimeMs = 15` (`phosphor.ts:55-60`), i.e. tau = 15/ln(10) = 6.51 ms.
Measured: cyan ~1.0 ms to 10%, red ~4.4 ms to 10%. The source comment already flags these
as "judgement calls, not measurements" - they now have measurements.

**D3 - Red and cyan share one decay constant; they should not. (Sections 3, 6 below.)**
`PhosphorField` is built with a single `constants` object and `advance()` never consults
`segment.colorRegion` (`phosphor.ts:166-171`). The measured inter-refresh residual is
13-21% for red against 3.2-4.5% for cyan, reproduced in every window - red persists
roughly 4x longer. `PhosphorConstants` needs to be keyed by `ColorRegion`.

**D4 - The sweep rate is outside the measured bracket. (Section 2.) FIXED.**
`asm/jetfighter.asm:418-428` produced a 6190-cycle sweep = 15.5 ms = 64.5 Hz at the
400 kHz oscillator. A 64.5 Hz sweep beats at 4.5 Hz against a 30 Hz camera; the video
shows 10.6-12.5 Hz. The admissible intervals are disjoint - 40.6-42.5, 47.5-49.4,
70.6-72.5, 77.5-79.4, 100.6-102.5, 107.5-109.4, 130.6-132.5 Hz - and **70.6-72.5 Hz** is
the one adjacent to the current value. Changing this means changing
`DWELL_OUTER`/`DWELL_INNER`, not the TypeScript.

Done: 15/15 -> 14/13, with one NOP added inside the dwell's outer pass. The two nibbles
alone reach only 69.5, 70.2 and 71.8 Hz on a played game - either side of the interval,
because the reachable rungs are 1.8 Hz apart and the interval is 1.9 Hz wide - and the pad
is what reaches its middle. The mean is 71.5 Hz over the sound-free sweeps of a game being
played, which is the population this interval is a statement about;
`docs/evidence/timing-analysis.md` records the same figure for two other populations,
because the spread between them is wider than the interval and quoting one without the
others would overstate the precision. Every sweep-denominated cadence constant in the ROM
moved with the rate, so the milliseconds each one stands for are unchanged.

**D5 - Sweep-period jitter: keep it. (Section 2.)**
`display.ts:112-115` closes a frame when an already-driven grid rises again, so the period
is whatever the ROM took. The measured spectral spread is consistent with real jitter of
up to ~+/-7% and rules out a stable period (section 2). This
is right. Do not replace it with a fixed period while fixing D4. Kept: the retuned ROM's
sound-free sweeps still span 5514-5709 cycles on a played game, because the between-sweep
game work varies with what is on the tube, and the sound blanks are on top of that.

**D6 - Supply sag: correctly absent. (Section 4.)**
`power.ts` is a binary on/off state with no load term, and nothing in `renderer.ts` scales
brightness by how many segments are lit. The measurement says brightness is flat within
3% from 1 to 12 simultaneous segments. **Confirmed, no change.** If anyone proposes adding
sag "for realism", this is the evidence against.

**D7 - Positional brightness: leave unmodelled. (Section 4.)**
`renderer.ts:181-202` uses only `field.brightnessAt(index)` and the colour region;
geometry affects bloom radius but never brightness. The video shows a left-to-right cyan
gradient of 1.7-1.9x, but it cannot be separated from the smoked filter and off-axis
viewing. **Confirmed as the right call for now**, revisit only with a head-on reference.

**D8 - `riseTimeMs: 4` is unverified.** 33.33 ms sampling cannot see a 2-5 ms rise. Not
refuted; not confirmed. Label it as such rather than citing this document for it.

**D9 - Alpha is linear in brightness (`palette.ts:179-183`, `rgba(..., level)`), while the
dim-to-hot hue wash is quadratic (`level * level`).** No measurement here either way, but
it means any residual brightness oscillation in the pipeline reaches the eye at full
amplitude. Relevant if D2 and D4 do not fully settle the look.

---

## What could not be determined

Stated plainly so nobody cites this document for these.

- **The sweep rate, uniquely.** 30 fps aliases a 40-140 Hz display. Seven disjoint
  intervals survive (section 2); 64.5 Hz is excluded, but 70.6-72.5 Hz is a preference
  for adjacency to the current value, not a measurement.
  Resolving it needs a genuine high-frame-rate capture, or a photodiode on the tube.
- **The per-grid duty cycle, and the number of grids.** Only `T_on + T_exposure` is
  observable and the exposure is unknown (section 2). The ten-grid ~9.5% model is
  consistent with the data and not established by it.
- **The rise time.** See D8.
- **Whether the left-to-right brightness gradient is the tube or the glass.** See D7.
- **Absolute brightness.** Everything here is a ratio. The video is auto-exposed and the
  glass carries a smoked filter of unknown density.
- **Whether red genuinely persists 4x longer than cyan, or the codec inflates it.**
  The asymmetry is reproduced in all four windows and is large, so it is very unlikely to
  be an artifact - but HEVC chroma handling and sensor demosaic could raise a red floor
  that a cyan floor would not see. A second capture in a different codec would close this.
- **The march cadence discrepancy.** The video shows 600 ms per column of squadron travel;
  the audio reference records 205.1 ms per march step. 600 / 205.1 = 2.93. Whether the
  sound pulses ~3x per column, or the two were measured on different skill levels, is not
  resolved here. Sprite motion is another task's subject; this is recorded only because
  the 18-frame figure was used as a time-base cross-check.
