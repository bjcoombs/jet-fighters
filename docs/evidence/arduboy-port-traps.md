# What an Arduboy port has to get right

Measurements and traps gathered while writing `docs/prd/jet-fighters-arduboy.md` and
`docs/contract/arduboy.contract.md`. Three systematic passes over the modules the port
reimplements, seven adversarial reviews of the contract, and one internal-consistency
audit produced roughly 180 behaviours and 19 contract defects; what survives here is the
part that is about **the port** rather than about the contract's wording, because the
wording will be rewritten and these facts will not.

Everything below was measured against this repository at the commit that added this file,
or read off the cited source. Figures without a citation were measured; the method is
stated where it matters. Paths are relative to the repo root.

## The headline: the machine is smaller than the device

| Resource | TMS1370 / MP2110 | Arduboy (ATmega32u4) | Ratio |
| --- | --- | --- | --- |
| Program store | 2048 x 8 bits = 2 KB | 32 KB flash, 28,672 after Caterina | 14x |
| Data store | 128 nibbles = 64 bytes | 2560 bytes SRAM | 40x |
| Instruction rate | 58,333/s | 16,000,000/s | 274x |
| Display | 9 x 12 = 108 cells, 94 populated | 128 x 64 = 8192 pixels | 76x |

A baseline PlatformIO build carrying the 2048-byte ROM array, the 32-entry PLA, a 9x12
duty table, 64 bytes of machine RAM, the Arduino framework, USB CDC and Arduboy2's
display core measures **5,838 of 28,672 bytes of flash and 365 of 2,560 bytes of SRAM**
(avr-gcc 7.3.0, `board = leonardo`, `Arduboy2@^6.0.0`, 2026-09-20).

**The budget closes on all three axes.** SRAM: 1,024 frame buffer + 216 duty table +
~64 machine RAM + ~100 core state and input + ~150-200 Arduino/CDC = **about 1,580 of
2,560**, leaving ~1,000 for stack. Flash: the atlas rasterizes to **1,093 bytes** with
its tables (769 of bitmaps, 324 for a 108-entry cell table; 1,003 if identical
rasterizations are shared). Cycles: a sweep is 243,840 ATmega cycles; SPI 16,384 +
buffer clear ~3,100 + duty scan ~1,000 + ~45 sprite blits ~13,500 = **13.9%**, leaving
**233 AVR cycles per emulated instruction**. Comfortable for an `-O2` interpreter.

## Traps

Each of these passes a naive implementation and a naive test.

### The ROM image is indexed by physical address, not source order

`tools/tmsasm/output.ts`'s `romImage()` writes `image[word.address]`, where the address is
`chapter << 10 | page << 6 | LFSR_SEQUENCE[ordinal]`. A generator emitting instructions in
source or ordinal order **regenerates byte-identically on every run**, matches the word
count and the PLA slot count, and ships a ROM whose program counter walks into the wrong
words. `tools/tmsasm/output.ts:26-35` prints both `ORD` and `OFF` on every listing row,
including the five of sixty-four where they agree, precisely so a reader can tell a
correct assembler from a linear one without reassembling. Spot-check the generated header
against listing rows where the two columns disagree.

Unwritten words are `0x00`, which decodes as `MNEA` so a runaway counter walks quietly
(`src/machine/cpu/tms1370/memory.ts:49-59`). Flash's erased state is `0xFF`, which is
`CALL` and writes outputs. Fill the array explicitly; do not rely on the linker.

### The blink is two mechanisms, and the obvious trace format hides it

The display going dark during a note comes from **two** places, and porting only the first
yields a panel that never blinks:

1. `PwmAccumulator.exclude` takes a stall out of the frame's denominator so it does not
   corrupt the duties (`src/machine/board/pwm.ts:118-142`).
2. `Display.getObservedFrame()` returns an **empty segment list** once the gap since the
   last drive exceeds `REFRESH_TIMEOUT_CYCLES` (`src/machine/board/display.ts:333-343`),
   reached through `Board.getLitSegments()` (`src/machine/board/board.ts:299-304`).

A renderer triggered only on a closed sweep sees neither: the ROM parks the sweep, no
frame closes, no render fires, and the panel holds the pre-note image. The real unit is
dark 14-17% of play (`docs/evidence/vfd-appearance.md`). A second trigger on
`isRefreshing()` is what produces the blink.

`tools/probe/machine-probe.ts:329-346` builds its snapshots from `getFrame()` and says why
in its own comment: `getLitSegments()` "answers the viewer's question instead - what is on
the glass at this instant - and the answer is nothing while the ROM has the sweep parked".
**A conformance trace inherited from that format cannot express the blink.** Compare the
observed frame.

### Duty must cross any comparison as an integer pair

avr-gcc makes `double` 32 bits. A duty compared as a floating fraction against a host's
64-bit double is unsatisfiable exactly, so it degrades in practice to comparing which
cells were lit - and which cells were lit is what every accumulator error leaves alone.
Carry `activeCycles` and the frame period separately (`src/machine/board/pwm.ts:25-31`).

### The frame closes on the sweep wrapping, not on a grid repeating

Grid 0 rising **after the highest grid has been strobed**
(`src/machine/board/display.ts:105-135`). The plausible alternative - a grid rises that has
already risen this frame - is wrong here: the ROM makes four passes over the glass and
reaches grid 0 in three of them, so that rule calls every pass a frame and hands the
renderer one segment family at a time. A port whose frame count is a multiple of the
reference's has this bug.

### The accumulator's other three rules

The interval that just ended credits to the state driven **across** it, before the new
state is recorded (`pwm.ts:159-171`). The driven state **carries across** a frame
boundary - closing a frame does not turn the tube off (`pwm.ts:144-157`). And the
exclusion is bounded on both sides: only a no-grid interval longer than
`REFRESH_TIMEOUT_CYCLES` comes out, measured from the falling edge and applied on the
resume edge; ordinary sweep variation stays in, because a slower sweep really is dimmer.

**A grid mask is still the right model, but not for the reason it first appears.**
Measured over 300,000 consecutive cycles of the running ROM: two grids are high for
**0 cycles**. `SETR`/`RSTR` move one R pin per instruction, so a transition goes
high -> none -> high. An index-modelling board is indistinguishable from a mask-modelling
one on this ROM. Use the mask as a structural property, not as a testable falsifier.

### The sweep length is a distribution, and 889 is a different observable

`SWEEP_INSTRUCTIONS = 889` is defined as the cycles between successive grid-0 rises in the
near pass, **before exclusion** (`src/machine/board/tms1370-cadence.ts`). The `PwmFrame`
period is exclusion-adjusted. Measured over 30 s of emulated idle (n=1,843 frames): median
frame period **875**, min 489, max 1,251; median max per-segment duty **0.008000** = 7/875
against `LIT_SEGMENT_DUTY` = 7/889 = 0.007874. The two disagree by 1.6% because they are
not the same quantity. Under play at skill 3 the period spreads further. Do not assert
equality with the constant on the frame observable.

### The cycle coordinate needs defining before any trace is compared

The count is zeroed at the INIT reset, and reset's own R clear and O index-0 write are
stamped cycle 0 and cost nothing (`src/machine/cpu/tms1370/cpu.ts:205-215`). One emulated
instruction advances it by exactly one, so the count is **instructions retired**, not
oscillator pulses. A pin event carries the count at the instant the writing instruction
**began** - the value before its cost is added (`src/machine/board/board.ts:117-126`). A
port that stamps at the instruction's end, or counts pulses, produces a trace isomorphic
to the reference and repairable with a one-line calibration, after which the field means
two different instants on the two sides.

An input scheduled at cycle N is applied at the **first instruction boundary at or after
N**, because `Board.step` overshoots by at most one instruction.

### Boot

`RAM_POWER_ON_FILL = 0x0a`, deliberately non-zero so the ROM's clear loop costs real
instruction time and produces a visible garbage flash (`src/machine/board/power.ts:30-38`).
Power-on order is: fill RAM, reset the core, then clear display and speaker, because the
cycle counter rewinds to 0 and the accumulator's own accounting must rewind with it
(`power.ts:111-122`).

Measured boot: **first grid driven at cycle 908; first frame closes at cycle 1,754**, one
whole sweep later. Before the first close, `Board.getLitSegments()` routes to a live
sample that is empty - there is no `_lastFrame` yet. Anything that needs a non-empty
pre-first-sweep frame must use `Display.sample(cycle)` (`display.ts:268`).

Nothing may stand in front of this - no boot logo.

### Sprite geometry does not survive the scale

At the PRD's layout factor of `128/212.75 = 0.6017`, rasterized 4x oversampled at half
coverage:

| family | box | set pixels |
| --- | --- | --- |
| rocket (x15) | ~2 x 8 | **0-3**, three empty |
| sea (x3) | — | **0-1** |
| missile (x15) | — | 6-11 |

**A rocket is not a thin ribbon: it is two disconnected subpaths** - two dots with an
8.8-unit gap. So is every burst; `capture` has 12-13 subpaths, `sea` and `score_label`
seven. Any rule scoped on "mean width" or a medial axis behaves unintuitively across the
atlas: measured as half the path perimeter, the under-one-pixel test fires on **50 of 94**
segments, including 15 of 16 score segments and only 2 jets, and it **splits three
families mid-lane** (jet lane 0 fires on col 2 alone; missile lane 2 on cols 1-2).

Coverage of the bounding box: rockets **12.9-17.0%**, sea ~9-11%, jets 32-46%, score
segments **72-87%**. Rocket bounding boxes are **1.75-2.16 px** wide.

Distinct rasterizations: **69 of 94**. Jets are **12 distinct of 15** - there is a
wing-beat on `(column + lane)` parity, a tall silhouette against a short one. Rockets
collapse to 4, missiles to 12. Which thin segments come out empty **moves with the pixel
grid origin**, so pin it.

Whatever rule is chosen for sub-pixel features, render the playfield to a PNG and look at
it. Three successive attempts to specify this in prose each produced a rule that was wrong
in a way only measurement revealed.

### Segments never share a cell, but their sprites overlap on screen

All 94 segments occupy 94 distinct `(grid, plate)` cells. Their **bounding boxes** overlap
in 89 pairs. Blit as a union (OR); an overwrite-mode blit erases what is drawn under it -
digits lose strokes, a missile punches a hole in the jet it is about to kill.

### Audio

R15's level written straight to the piezo reproduces the waveform rather than
approximating it, and leaves Timer3 free. **The piezo is a differential pair**: driving
one pin is half the volume, driving both in phase is silence behind a speaker trace that
is perfect in every other respect.

Measured from the ROM's own R15 edges: the march note is **71.1 ms long at 663 Hz, period
1.51 ms**. `docs/evidence/audio-reference.md:155` records the 600-650 Hz band as
**withdrawn** as a march; cite the measurement, not the band.

**The SPI push must be chunked.** A blocking 1024-byte transfer at 8 MHz is **1,024 µs**.
A tenth of the note's fundamental period is **151 µs**. The blanking render fires one
`REFRESH_TIMEOUT_CYCLES` (15.24 ms) into a stall lasting the note's 71 ms, so a blocking
push lands inside every note by construction and is audible. Arduboy2's `display()` is a
blocking full-buffer loop. Emit in chunks with interpreter steps between them; 128-byte
chunks keep the stall near 130 µs and the total is still only 6.7% of a sweep.

### Input

Lever and dial are **position switches**: exactly one contact of each closed at all times
(`src/machine/board/tms1370-input.ts`). The lever rests at **centre, lane 1** - a closed
contact the ROM is told, not an absence it infers. `KInputMatrix.reset()` is explicitly
**not** what the power switch does, so the controls do not move on a power cycle; on the
Arduboy the power slider cuts VCC and this cannot hold, which is a departure to record.

With both lane buttons held, **most recently pressed wins**, as an ordered stack. Fire is a
**held contact, not an edge**. There is no input latch and no edge detector on the K side:
a contact closed and released between two K reads is never seen, and debounce is the ROM's
problem (`src/machine/cpu/tms1370/ports.ts:161-174`).

**Aim a sweep before you fire.** `tick_fire` is edge-triggered and acts on whatever lane
the sweep that read the press had already sampled, so moving the lever and firing in one
step fires down the previous lane. The symptom is a low score, not an error
(`tools/probe/tms1370-probe.ts:367-391`). A drive that does not space them spans every
scenario while reaching nothing.

### Structural CPU behaviours the ROM never exercises

The assembler rejects the source patterns, so no drive and no mutation test can reach
these. Read them off the source:

- `SETR`/`RSTR` index the latch as `BIT(X,2) << 4 | Y`; a write with X >= 4 addresses
  R16-R31, which does not exist, and is **discarded** (`tools/tmsasm/analysis/r-outputs.ts:5-19`).
- `COMX` complements **only the MSB** of X (`r-outputs.ts:22-26`).
- A taken branch transfers PB into PA **only while the call latch is clear**; `CA = CB` is
  not latch-guarded (`tools/tmsasm/analysis/subroutine.ts:10-29`).
- The return-address save is guarded by the call latch, so a `CALL` inside a subroutine
  saves nothing. `CALL` swaps PA and PB; `RETN` copies PB back into PA.
- Operands are stored **bit-reversed** (`LDP` 4, `LDX` 3, `SBIT`/`RBIT` 2, `TCY` 4), but
  the `BR`/`CALL` target is **not** - it is the raw low six bits, a physical LFSR state
  (`tools/tmsasm/isa.ts:30-39`).
- Status is re-armed to 1 at the **start of every instruction**; there is no unconditional
  branch, and `TCY j / YNEC k` with j != k is this ROM's unconditional-jump idiom.
- Reset enters at **chapter 0, page 15, PC 0**, reserved before any source is read.

Pin the LFSR against the literal sequence in `docs/research/tms1370-architecture.md` §2,
as `tools/tmsasm/memory.test.ts` does - not against a re-derivation of the step rule. A
plausible variant closes after 62 states and leaves two words of every page unreachable,
which only the external table sees.

### Mutation testing is vacuous on a family-dispatched core

The ROM's static opcode histogram has 171 distinct byte values and **19 tied at a count of
one**. Ten of the twelve rarest are served by a handler whose siblings execute thousands
of times per drive, because the ISA dispatches by family and `tools/tmsasm/isa.ts` is
itself family-structured. Corrupting the rarest byte's handler kills a hot constant in the
first hundred instructions and fails every drive loudly - showing the sharing, not the
coverage. Draw mutants from an **executed**-opcode histogram, require each to leave at
least one drive passing, and mutate the operand path for the byte value in question.

### Coverage floors

The march ladder: `STEP_HI = STEP_HI_MAX - kills - STEP_SKILL * (skill - 1)`, floored at
`STEP_HI_MIN`. Today `STEP_HI_MAX=8`, `STEP_SKILL=2`, `STEP_HI_MIN=1`
(`asm/jetfighter.asm:785-788`), so the highest kills count before the march floors at
skill 3 is **3**. **`jet-fighters-v4.md` R3/R4 move these**; its worked candidate
(`STEP_SKILL` 4, `STEP_HI_MIN` 0) makes the figure **0**. Any coverage floor expressed
through that formula needs an absolute minimum beside it.

The win jingle needs **199 points**, minutes of emulated play, which is why
`tools/probe/tms1370-probe.ts:344-365` has a RAM poke at all. Its rule: move the machine
*next to* the behaviour - score to 198, let a kill carry it to 199 through the ROM's own
`add_score` - never write the outcome.

## What the repo does not have yet

Three things the port's verification will want, none of which exist:

- **No K-line stream.** `machine-probe.ts` emits six keys and none is a K history;
  `Board.readK()` is private (`board.ts:408`). Comparing input translation against the
  reference needs an `--emit-k` flag adding.
- **No ghost toggle.** `TubeRendererOptions` (`src/machine/tube/renderer.ts:52-80`) has
  `phosphor`, `glow`, `mesh` and `silkscreen`. `ghostFill()` is drawn unconditionally at
  `renderer.ts:239`. The ghost layer is what makes the tube read as a VFD rather than as
  sprites on black; losing it on the Arduboy is a real change nobody has recorded as a
  decision.
- **No rasterizing canvas.** `fake-canvas.ts` records calls, it does not draw. Producing a
  reference rendering from `src/machine/tube/` needs a dev dependency added.
