# Re-deriving the probe suites' cadence for the TMS1370

Paths in this document are relative to the repository root.

`docs/prd/jet-fighters-v3.md` R5 names six classes of figure that the v2 probe
suites carried and that the TMS1370 makes wrong. `docs/contract/v3.contract.md`
criterion V14 asks for this record: each class, its new value, and the named
constant or measured band it was derived from.

The short version of why every one of them moved: v2 ran an HMCS44 at 400,000
instructions per second, drawing ten grids once each per sweep. This machine runs
a TMS1370 at about 58,333 instructions per second, drawing nine grids in
twenty-four strobes across four passes. A figure written as a bare number said
nothing about which of those it belonged to, which is exactly how a 400 kHz
constant survives into a machine seven times slower with nothing going red.

## What was measured, and how

Every figure below that is called measured was taken off the real machine -
`asm/jetfighter.asm` running on `src/machine/cpu/tms1370/` through
`tools/probe/tms1370-probe.ts` - rather than counted off a plan. Two runs:

- **3 s of emulated time**, skill 1, lever parked in lane 1, `keepStrobes` on.
- **60 s of emulated time**, skill 1, lever walked between the three lanes and
  the fire button pressed once a lap, `keepStrobes` on. n = 88,571 intervals with
  no grid driven.

| Quantity | Measured | Where it now lives |
| --- | --- | --- |
| Instruction rate | 58,333.33 /s (provisional, see below) | `CYCLE_HZ`, `src/machine/cpu/tms1370/timing.ts` |
| Sweep period | 870 instructions (median), ~67 Hz | `SWEEP_INSTRUCTIONS` = 889, `tms1370-cadence.ts` |
| Strobes per sweep | 24 | `STROBES_PER_SWEEP`, `src/machine/board/o-pla.ts` |
| Grid-high time per strobe | **7 instructions**, on every strobe | `STROBE_DWELL_INSTRUCTIONS`, `tms1370-cadence.ts` |
| Strobe-to-strobe spacing inside a pass | 18 instructions | - |
| Gap between the last strobe of a sweep and the first of the next | 401 to 490 | - |
| Grid-high share of the whole run | 18.7% | - |
| Duty of one lit segment over a sweep | **0.00805**, about 1/124 | `LIT_SEGMENT_DUTY`, `tms1370-cadence.ts` |
| Shortest blank a sound produced | **1,518 instructions** (26.0 ms) | - |
| A march note's blank | ~4,000 to 4,752 | - |

`tools/probe/tms1370-timing.test.ts` holds the two measured constants -
`SWEEP_INSTRUCTIONS` and `STROBE_DWELL_INSTRUCTIONS` - to the running ROM, so a
sweep-loop edit that moved either goes red rather than silently dimming the tube
or misreading every blank.

**Everything here inherits one provisional figure.** `CYCLE_HZ` is MAME's fitted
RC-oscillator approximation divided by the architectural divide-by-six, and it
carries MAME's own stated +/-50 kHz. `docs/research/mp2110-timing-measurement.md`
records that state and the non-circular route out of it. So a horizon stated in
cycles is a duration at the midpoint rate, and the same wall-clock event costs
between 0.86x and 1.14x of it on real silicon. Nothing below is tuned to the
midpoint.

## The six classes

### 1. Raw cycle literals sized at 400 kHz

R5 names six, spread across six files, every one of them a bare number that
silently meant "at 400 kHz". They are now defined once, in
`src/machine/board/tms1370-cadence.ts`, each as a multiple of the measured sweep
or of the instruction rate, and imported everywhere else. V14's rule is that no
occurrence of one of them may be a numeric literal unless the same file also
defines the sweep length it derives from, and that module is the only file where
that is true.

| Constant | v2 (400 kHz) | v3 | Derived from |
| --- | --- | --- | --- |
| `BURST_GAP_CYCLES` | 8,000 | 1,778 | `2 * SWEEP_INSTRUCTIONS` |
| `CAPTURE_WINDOW_CYCLES` | 600,000 | 583,333 | `10 * CYCLE_HZ` |
| `WARNING_CLUSTER_CYCLES` | 80,000 | 29,167 | `0.5 * CYCLE_HZ` |
| `PLAYER_SLICE_CYCLES` | 3,000 | 178 | `SWEEP_INSTRUCTIONS / 5` |
| `STEP_CYCLES` | 200 | 37 | `STROBE_CYCLES`, itself `SWEEP_INSTRUCTIONS / STROBES_PER_SWEEP` |
| `REFRESH_TIMEOUT_CYCLES` | 2,000 | 889 | `SWEEP_INSTRUCTIONS` |

`REFRESH_TIMEOUT_CYCLES` is the one of the six whose *derivation* changed as well
as its value, and the correction is worth stating because the first attempt at it
was wrong in a way no value check would have caught.

It was authored as three sweeps, on the reading "one sweep is the refresh, two is
a sweep that ran long, three means the sweep loop is not running". That measures
the wrong interval. What `Display.refreshGap` times is the gap between one grid
line *falling* and the next *rising*, and on a machine that is sweeping that gap
is 11 instructions inside a pass and never more than 490 between sweeps - it
never approaches a sweep at all. Three sweeps is 2,667, which is **above** the
1,518 the shortest sound blank measures, so the tube would have gone on reading
as lit through every short sound. That is D1 of
`docs/evidence/vfd-appearance.md`, the largest visible divergence the reference
video found, and it is the exact bug the constant exists to prevent.

Nothing at all falls between 490 and 1,518. One sweep is 889: 1.81x above the top
of the first population and 1.71x below the bottom of the second. The geometric
mean of those two bounds is 862, so one sweep really is almost exactly the middle
of the empty band rather than merely inside it.

**This is a tier-1 defence of a tier-3 criterion, which is why it is a defect fix
and not a rescale.** V12 asks the operator to recognise, among other things, "the
sound blanking that makes every beep a visible blink". A refresh timeout above the
shortest sound blank makes that blink structurally invisible to every mechanical
probe in the tree: the tube reads as continuously lit through exactly the event the
contract names, so no automated assertion anywhere can fail on its absence. The old
constant did not only measure the wrong interval. It disarmed the only automated
check on a behaviour a human is later asked to look for, and a build that had lost
the blink entirely would have reached V12 with every tier-1 criterion green.

`src/machine/board/display.ts` no longer defines this constant. It re-exports the
one `tms1370-cadence.ts` derives, because `display.ts` defines no sweep length and
so may not, under V14's rule, carry the literal.

### 2. `battleship-arrival.test.ts`'s 13.46 ms nominal sweep period

**Gone, and re-derived.** 13.46 ms is ten grid dwells at 400 kHz: 5,384 cycles,
which is what a ten-grid sweep cost on the HMCS44. On this machine the sweep is
`SWEEP_INSTRUCTIONS` long and its period is `1000 / SWEEP_HZ` ms, about 15.2 ms
at the midpoint rate - and the file states it that way rather than as a number, so
a change to the sweep moves it.

### 3. `BUZZ_NOMINAL_HZ = 86`

**Gone, and re-derived.** The 86 embedded "ten dwells to a sweep": the ROM ticked
the buzz once per grid dwell and divided, so the constant carried the grid count
inside it. There are nine grids here, drawn in twenty-four strobes, and the ROM
clocks the buzz off strobes rather than grids.

`BUZZ_NOMINAL_HZ` now lives in `tms1370-cadence.ts` as

    (STROBES_PER_SWEEP * SWEEP_HZ) / (2 * BUZZ_STROBE_DIVIDER)

with `BUZZ_STROBE_DIVIDER = 8`, the ROM's own `BUZZ_DIV`: eight strobes between
speaker edges, so a full period is sixteen. Both terms come from this machine -
`STROBES_PER_SWEEP` from the sweep plan in `src/machine/board/o-pla.ts`, `SWEEP_HZ`
from the measured sweep - and neither mentions a grid count.

The value lands at about 98 Hz, inside `docs/evidence/audio-reference.md`'s
measured `battleshipBuzz.repetitionRangeHz` of **79-111 Hz**, and
`src/machine/board/tms1370-cadence.test.ts` asserts both the derivation and the
band. The nominal figure is taken at an idle sweep; the ROM's own runs a little
differently because the buzz slows the sweep it is clocked off, which is the
wander `audio-reference.md` measures and the strongest evidence for the mechanism.

### 4. `game-lifetime.test.ts`'s literal grid list

`getStrobedGrids()` was compared against `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]`. It is
now compared against `GRID_COUNT` - `src/machine/cpu/tms1370/ports.ts`, itself
`R_GRID_LAST - R_GRID_FIRST + 1` - so the expectation is built from the port map
rather than typed out. Nine, on this tube. V14 requires the comparison to be
against `GRID_COUNT` and never against a literal list, wherever it appears.

### 5. `board.cpu.standby`

**Removed.** `standby` is the HMCS40's `SBY` instruction and the core state it
enters: the CPU stops fetching and waits for a timer overflow or an interrupt.
The TMS1000 family has **no equivalent**. There is no such instruction in the
TMS1370's set, no such state in `src/machine/cpu/tms1370/cpu.ts`, and nothing for
an assertion about it to mean.

It is called out in V14 by name, separately from V9's `rg -i hmcs4` sweep, for a
specific reason: the word "standby" contains no reference to Hitachi or to
HMCS40, so a search for the vendor cannot find it. It is an HMCS40 concept wearing
a generic name, and it would have survived a clean vendor grep.

What the assertion was doing - checking that the machine had not wedged, but was
still executing and still sweeping - is now expressed as what it always meant on
this machine: the cycle count and the sweep count still advancing.

### 6. `phosphor.ts`'s `REFERENCE_DUTY`, and `LIT_BRIGHTNESS` with it

This is the class with the most in it, because the figure the renderer needs is
the product of three factors and only one of them was modelled.

`REFERENCE_DUTY` was `0.1`, documented as `1 / GRID_COUNT` while that count was
the HMCS44's ten. It is now `1 / ATLAS_TOPOLOGY.gridCount` = **1/9**, exported,
and derived from the topology rather than written as a fraction. V14 pins the
value; deriving it means a future re-addressing moves it rather than leaving it
asserting a tube we no longer have.

But 1/9 is the **grid** duty, and a grid's share of the sweep is not a segment's.
Two further factors sit on top of it:

| Factor | Value | Source |
| --- | --- | --- |
| `REFERENCE_DUTY` - one grid's share of a sweep | 1/9 | `ATLAS_TOPOLOGY.gridCount`, `src/machine/topology.ts` |
| `STROBES_PER_GRID` - strobes the sweep issues per grid | 24/9 | `STROBES_PER_SWEEP / gridCount`, `src/machine/board/o-pla.ts` |
| `STROBE_DUTY` - the share of its slot a strobe holds the grid up for | 7/37 | `STROBE_DWELL_INSTRUCTIONS / STROBE_CYCLES`, measured |
| `LIT_DUTY` - the product | ~1/127 | `src/machine/tube/phosphor.ts` |

The second factor is the one `docs/research/pla-design.md` flags: a grid cannot
be drawn in one `TDO`, so the sweep makes four passes and a segment is lit only in
the pass its family belongs to. Its share of the sweep is a 24th, not a ninth.

The third factor is the one no plan on paper could supply, and it is the larger of
the two. `strobe` raises the grid with `SETR`, does about seven instructions'
worth of work, and drops it with `RSTR`; the remaining eleven instructions of the
strobe's slot select the next index, and the ~380 that follow the last strobe of a
sweep are the game logic, with every grid low. So the tube is driven for 18.7% of
the sweep and dark for the rest of it. `pla-design.md`'s 1/24 is the share of
**strobes**; this is the share of **time**, and they are not the same question.

Getting this wrong is not cosmetic and it fails quietly. Normalising the measured
1/127 duty against 1/9 renders the tube at 18% of its intended brightness; against
1/24, at 34%. Both are plausible readings of the sweep plan and both draw a dim
tube. `targetBrightness` therefore normalises against `LIT_DUTY`, so a segment the
ROM is driving as hard as it can reads as fully lit, and
`tools/probe/tms1370-timing.test.ts` asserts exactly that against the running
machine.

`LIT_BRIGHTNESS` follows from it. It was `0.8`, set by hand in
`blank-to-glass.test.ts`; it is now exported from `phosphor.ts` as

    targetBrightness(LIT_DUTY / 2, PHOSPHOR.cyan)

which is about **0.637**. The anchor is half drive, which is the boundary
`PhosphorConstants.referenceDuty` already draws in its own documentation: a
segment driven for half its slot lands at half scale and shows it, and the gamma
of 0.65 lifts that to 0.637 of full emission. Above it a tube is being refreshed;
below it either the sweep has stopped and the phosphor is on its way down, or a
frame period closed around a stall and every duty in it collapsed. Those are the
two things the assertions using it exist to separate from a normally lit tube.

## The loss sound and the buzz overlap, and how they are told apart

Not one of the six, but named in R5 alongside them and easy to get wrong.

`docs/evidence/audio-reference.md` gives `gameOver.collapseHzRange` as **80-97 Hz**
and `battleshipBuzz.repetitionRangeHz` as **79-111 Hz**. Those overlap almost
entirely, so a suite that identifies the loss sound by its collapse band alone
will call a battleship crossing a lost game on any silicon.

The loss sound is therefore identified by its **decay floor as well**:
`gameOver.decayFloorHz` is ~147 Hz, the low rasp the descent ends on, and the buzz
has nothing there. Every probe suite that has to tell one from the other uses both.

## Where the seven suites stand

All seven survive as files under `tools/probe/`, each contributing passing tests,
and each drives the TMS1370 machine through `tools/probe/tms1370-probe.ts` rather
than the HMCS44 board.

| Suite | Classes it carried |
| --- | --- |
| `game-lifetime.test.ts` | 1, 4, 5 |
| `launcher-lives.test.ts` | 1 |
| `battleship-arrival.test.ts` | 1, 2, 3 |
| `blank-to-glass.test.ts` | 1, 6 |
| `sweep-timing.test.ts` | 1 |
| `rom-atlas-conformance.test.ts` | - (the PRD records it as carrying clean) |
| `speaker-bands.test.ts` | 1 |

The contract says in terms that deleting a suite rather than re-deriving it
satisfies every grep and every failure check and is the cheapest route to a green
run. None was deleted.
