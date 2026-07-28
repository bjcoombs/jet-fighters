# Jet Fighters v3 - TMS1370 Rebuild PRD

## Problem Statement

v2 is a careful, measured emulation of the wrong processor.

The unit's microcontroller is a **Texas Instruments TMS1370**, custom mask **MP2110** -
legible in `assets/reference/tube-teardown/board-L1001567.jpg` and named in MAME's device
list as *"1980, Gakken Invader/Tandy Fire Away"*. v2 implements a Hitachi HMCS44, chosen
from a generalisation about Gakken's suppliers stacked on a match between the box's "2K
Bytes L.S.I." and a datasheet, neither checked against the chip.
`docs/evidence/open-questions.md` §7 records the finding and how the error entered.

The identification is safe. It rests on the mask number in MAME's device list, the die
label `1370`, the 40-pin package, a pin budget that comes out exactly full at 16 R plus 8 O,
and a cyan tube. It does **not** rest on the `47K`/`47P` silkscreen matching MAME's
`R=47K, C=47pF` comment: `tms1370-io.md` reads that as corroboration and
`tms1370-architecture.md` reads the same comment as "a guess about a guess". Where our own
research disagrees with itself, the claim is not load-bearing here.

The consequence is not cosmetic. Every hardware constraint that shapes the program differs:

| | v2 built (HMCS44) | The machine (TMS1370) |
| --- | --- | --- |
| Instruction word | 10-bit | **8-bit** |
| ROM | 2048 + 128 pattern words | **2048**, as 2 chapters x 16 pages x 64 words |
| RAM | 160 nibbles | **128 nibbles**, 8 files x 16, not cleared at reset |
| Subroutine stack | 4 levels | **1 level**; nesting silently loses the return address |
| Program counter | a counter | **a 6-bit LFSR** - execution order is not address order |
| Instruction rate | 1 per oscillator cycle, 400 kHz | **1 per six**, ~58 kHz - a **6.86x smaller budget** |
| Display outputs | 10 grids, 20 plates | **9 grids (R0-R8), 12 plates (O0-O7 + R11-R14)** |
| Segment patterns | any plate mask per grid | the low 8 come from a **32-entry mask PLA**, and 32 is all there ever are |
| Speaker | D14 | **R15**, an R latch like the grids |
| Inputs | dedicated strobe port | **K1/K2/K4** strobed from R9/R10, **K8 unstrobed** for fire |

The instruction-rate row is the one that changes the program rather than its constants.
Six oscillator pulses make one instruction cycle - the figure `tms1370-architecture.md` §6
calls "confirmed three independent ways". A ~71 Hz sweep buys roughly **820 instructions,
about 91 per grid dwell**, against v2's ~5,600.

## Technical Context

Two research documents, each marking every claim executable / documented / inferred /
unestablished, and each closing with what it does not settle:

- `docs/research/tms1370-architecture.md` - core, memory, paging, instruction set, timing.
- `docs/research/tms1370-io.md` - pin budget, the O PLA, the K inputs, MAME's `ginv`
  machine definition, and what the ROM dump is.

**Where this PRD asserts something those documents hedge, it says so.** That discipline is
the whole reason for this rebuild.

### There are two PLAs, and only one of them is ours

This distinction is load-bearing and was missing from the first draft of this document.

- The **microinstruction PLA** decides what each opcode *does*. It is mask-programmed per
  customer. MAME loads `tms1100_common2_micro.pla` for MP2110 and its own TODO calls "mpla
  is usually the default" a working assumption. **We do not know that MP2110 implements the
  standard TMS1100 instruction set.**
- The **O output PLA** converts `status_latch:accumulator` into 8 output lines. Also
  mask-programmed. Because we author the program, this one is ours to define.

### What survives untouched

Everything measured from the glass and the speaker: the 94 traced segment outlines, the
printed-cell registration, the phosphor decay constants, the control-grid mesh, the case
geometry, every audio band and duration, and every gameplay rule the owner has corrected.
The renderer, audio reconstruction, case shell, input UI and `docs/evidence/` all stand.

`atlas.json` already uses plates 0-11 only, already expresses seven cells, and already
models two seven-segment digits plus a `1`-only hundreds place. `tools/trace/` round-trips
`grid`/`plate` rather than emitting them, so **re-addressing is a hand edit that survives
regeneration** - which the `CLAUDE.md` regeneration rule would otherwise suggest is
forbidden.

### What is replaced

`src/machine/cpu/`, `tools/hmasm/`, `asm/jetfighter.asm`, and the display's address space.

## Scope

Everything below is a requirement with acceptance criteria. Nothing is optional, phased, or
deferred to a later document.

### R0. Verify the instruction set against MP2110's own microinstruction PLA

**A precondition of R1, R2 and R5, and the first work done.**

`tms1370-architecture.md` ranks this its most consequential gap and states that verifying it
is *"a prerequisite for writing a single line of assembly"*. The instruction semantics in §5
of that document are Documented for behaviour and Executable for encoding, but **Inferred
for "this chip does that"**.

Decode `tms1100_common2_micro.pla` from the `ginv` romset and check all 256 opcodes against
the standard TMS1100 map.

**Acceptance.** A document recording, per opcode, whether MP2110's PLA implements the
standard behaviour, with any divergence named. If it diverges, R1's core and R2's assembler
target the divergent set, not the standard one.

**Dependency.** Needs the romset (see R7's artifact list). This is a hard block on R5, and
it is why R0 is first.

### R1. TMS1370 CPU core (`src/machine/cpu/`)

Replaces the HMCS44 core. It owns no clock, touches no DOM, advances only when stepped.

- TMS1100-class core: 4-bit ALU, accumulator, X (3 bits), Y, status, status latch, call
  latch, page/chapter address and buffer registers, the one-level return register SR, and
  the chapter subroutine latch CS. **PB doubles as the return page.**
- **The program counter is a 6-bit LFSR**, stepped by the shift-register rule.
- 2048 x 8 ROM addressed `(CA << 10) | (PA << 6) | PC`; 128 x 4 RAM as 8 files x 16,
  addressed `X << 4 | Y`.
- **One instruction per six oscillator pulses.**
- Opcodes per R0's finding. Two traps the standard set contains: `COMX` complements **only
  the MSB of X**, and `COMC` replaces `CLO`, so **there is no clear-O instruction** -
  clearing O means `TDO` with A=0 and the status latch clear.
- `BR`/`CALL` conditional on status, with PB moving into PA only on a taken branch **and
  only outside a subroutine**, while CB moves into CA regardless.
- `CALL` inside a subroutine saves no return address; `RETN` outside one does not restore
  the PC. Modelled as the silicon behaves.
- **Reset**: entry at chapter 0, page 15, PC 0 (`0x3C0` per MAME; TI says only "a fixed
  instruction address", so this is MAME-sourced). R outputs cleared, O written with index 0,
  status 0, call latch clear, **RAM not cleared**.

**Acceptance.** Per-opcode semantics tests. The LFSR sequence asserted against the 64-state
table and shown to be a bijection. A test that a branch inside a subroutine does not change
page. `encode(decode(op)) == op` across the opcode space - this guard caught real bugs in v2
and belongs here, in the core, not in the assembler.

### R2. TMS1000-family assembler (`tools/tmsasm/`)

Replaces `tools/hmasm/`. A library, a CLI emitting a listing, and a Vite plugin so an `.asm`
file imports with no generated ROM to go stale.

**Five silent-failure classes it must reject.** Each assembles cleanly on real silicon and
fails later as a wild jump or a wrong output:

1. **LFSR placement.** The *n*-th instruction of a page goes at physical offset `lfsr[n]`; a
   label resolves to an LFSR state, not an ordinal.
2. **A page-crossing branch inside a subroutine.**
3. **A `CALL` reachable from inside a subroutine.** Note this is **interprocedural**, not
   local: a routine can be entered by `BR` (call latch clear) or `CALL` (set), so it needs
   context sensitivity or a conservative over-approximation. The over-approximation may
   reject legitimate programs; if so, it must say which call site forced the rejection.
4. **`SETR`/`RSTR` with X >= 4.** MAME indexes `BIT(X, 2) << 4 | Y`, so X >= 4 silently
   addresses R16-R31, which do not exist. Under R4 the grids, input strobes, high plates and
   speaker are all R lines, so every sweep, strobe and sound edge is exposed to this.
5. **An instruction between a status-setting test and its branch.** It makes the branch
   unconditional. On a chip with no unconditional jump this is how every branch is written.

Ceilings enforced as errors: 2048 program words, 128 RAM nibbles.

**Acceptance.** Each of the five has a test asserting a violating program fails to assemble,
and #3's rejection names the offending call site.

### R3. The O output PLA: 32 patterns, and they are the display's whole vocabulary

**Not a syntax feature. The hardest design problem in the rebuild, and it gates R5.**

The low 8 plates come from a 32-entry PLA indexed by `status_latch:accumulator` - one status
bit, four accumulator bits. **Only 32 distinct O patterns exist for this chip, ever.** They
must simultaneously serve two seven-segment score digits, the hundreds stroke, and every
lane-and-shape combination on the low 8 plates of seven playfield cells.

Because we author the program, we author the PLA: declared in the assembly source, assembled
into the machine image, loaded by the core. The precedent exists - v2's `.PATTERN` + `.DW` +
a `LISTING_KEYS` entry already gives "declared in source, own listing section, assembled into
the image" for the HMCS44's pattern words.

**Acceptance.**

- A design showing the 32 entries covering the display's entire vocabulary, or a named list
  of what cannot be expressed and how R5 works around it.
- **Entry 0 is all plates dark.** Reset writes O with index 0, so any other choice flashes
  garbage at power-on.
- The integration seam is built, not assumed: a new export from the `.asm` module, a changed
  `Board`/`Memory` signature, updated `src/asm.d.ts`, and `tools/probe/machine-probe.ts`
  carrying the PLA through. `Memory` currently asserts `rom.length === ROM_SIZE`.

### R4. Board and display re-addressing (`src/machine/board/`, `src/machine/tube/`)

- `GRID_COUNT` 10 -> **9**; `PLATE_COUNT` 20 -> **12**.
- Grids R0-R8. Plates O0-O7 and R11-R14. There is no D port on this chip.
- Speaker from D14 to **R15**, written by `SETR`/`RSTR`. The cycle-stamped edge model
  carries; the pin and write mechanism do not.
- Inputs: K1/K2/K4 returned from strobes on R9/R10, K8 unstrobed for fire. **Only one of
  R9/R10 may be high at a time**, or the columns superimpose. K8 being unstrobed makes
  fire's latency one K read rather than a full strobe cycle - a behavioural difference from
  v2 that R5's input handling must reflect.

**The 94 outlines do not change. Their addresses do** - and the assignment is **not** ours
to invent. `tms1370-io.md` lists the exact per-segment addressing as an open gap with a
named artifact that settles it: **`ginv.svg`** from the romset, 143 KB of hand-traced
outlines already addressed as `(grid, plate)`. Inventing an assignment would make R7's
comparison meaningless, because Gakken's dump drives *Gakken's* addresses.

Two forced moves: `score_label` is the sole occupant of grid 9 and must be re-homed (grid 8
has plate 7 free); `atlas.test.ts`'s `it('uses all ten grids')` goes red until it is, and
must be updated rather than relaxed.

**Acceptance.** The conformance guard holds both directions. The one-strobe-at-a-time rule
is asserted by a test, not merely stated. `atlas.test.ts`'s measured frame assertion is
untouched - it uses `getSegmentById` and `bounds` only, no grid or plate, so re-addressing
cannot reach it.

### R5. The game program (`asm/jetfighter.asm`)

Rewritten for the TMS1370, under one stack level, LFSR placement, 32 output patterns and
~820 instructions per sweep.

**Blocked, not merely large**, on R0's opcode verification and R3's output vocabulary.

Every gameplay rule and measured cadence in `docs/evidence/` and the v1 PRD is the
specification - including the owner's own recordings: a ~4.0 s battleship appearance
sounding continuously, arrivals ~19.8 s apart, a ~93.4 Hz buzz repetition, the squadron
ladder against a ~2040 ms slowest march, three launchers with two- and three-beep warnings.

**The capture rule.** R5 implements *a jet reaching the G line costs one launcher*, as v2
does. `open-questions.md` §6 records the owner's contrary description and an exact revert
path; that path is the switching criterion if he settles it the other way. This is **his
decision, not a measurement**, so nothing in this PRD can answer it.

**Acceptance.** The v2 probe suites pass: `game-lifetime`, `launcher-lives`,
`battleship-arrival`, `blank-to-glass`, `sweep-timing`, `rom-atlas-conformance`,
`speaker-bands`. They assert behaviour rather than an instruction set, which is why they
survive - but only `rom-atlas-conformance` and `speaker-bands` carry clean. Six of seven
import from `src/machine/cpu/`, five reach through `board.cpu.memory.readRam()`, four
hard-code grid/plate addresses. Six classes of re-derivation, named so none is discovered
late:

1. Raw cycle literals sized at 400 kHz across six files - `BURST_GAP_CYCLES = 8000`,
   `CAPTURE_WINDOW_CYCLES = 600_000`, `WARNING_CLUSTER_CYCLES = 80_000`,
   `PLAYER_SLICE_CYCLES = 3_000`, `STEP_CYCLES = 200`, `REFRESH_TIMEOUT_CYCLES = 2000`.
2. `battleship-arrival.test.ts` hard-codes `13.46` ms as the nominal sweep period.
3. `BUZZ_NOMINAL_HZ = 86` embeds "ten dwells to a sweep" - the 10-grid assumption inside a
   constant. Its divisor must be re-derived from the TMS1370's own sweep and land inside the
   measured **79-111 Hz**.
4. `game-lifetime.test.ts` asserts `getStrobedGrids()` equals a literal `[0..9]` rather than
   `GRID_COUNT`.
5. `game-lifetime.test.ts` asserts `board.cpu.standby` - an HMCS40 `SBY` concept with **no
   TMS1000-family equivalent**.
6. `phosphor.ts`'s `REFERENCE_DUTY = 0.1`, documented as `1/GRID_COUNT`, becomes 1/9, which
   shifts every brightness assertion including `blank-to-glass`'s `LIT_BRIGHTNESS`.

The loss sound must be identified by its decay floor as well as its 80-97 Hz collapse,
because an ~85-93 Hz buzz sits inside that band on any silicon. `FILE * 16` RAM addressing
survives unchanged - the TMS1370 is also 8 files x 16.

### R6. Measure the instruction rate; do not assume it

MAME fits ~350 kHz as an RC-oscillator approximation with a stated +/-50 kHz spread.
`tms1370-architecture.md` §6 says measuring it *"is worth doing before any cadence is
chosen"*, and `CLAUDE.md` records what assuming such a constant has already cost this
project.

**Acceptance.** The instruction rate is derived from a known-period program event measured
against the audio timebase in the owner's recordings, and recorded with that provenance. The
oscillator frequency and the divide-by-six are separate named constants. Cadences are
asserted against measured audio bands and durations, so a later refinement moves one number
and re-derives the rest.

### R7. Comparison against the original ROM

**Acceptance.** A harness that runs our machine and reports the comparison surface - lit
segment set over time, speaker edges, score - and that accepts the original artifacts as an
alternative machine image. It must run against our own ROM with no romset present.

**The romset carries four artifacts and three of them gate other requirements**, which is
why this is not a tail-end nicety:

| Artifact | Gates |
| --- | --- |
| `tms1100_common2_micro.pla` | **R0**, and therefore R1, R2, R5 |
| `ginv.svg` | **R4**'s segment addressing |
| `tms1100_ginv_output.pla` | **R7**'s own harness - a program image alone cannot say what lights |
| `mp2110` | R7 |

The non-goal below excludes *reproducing* Gakken's O PLA in our ROM. It does **not** exclude
the harness loading it to interpret their dump; those are different acts and the first draft
of this document conflated them.

**Dependency:** the owner obtains the romset. R0 is blocked on it, so this is a schedule
dependency for the whole rebuild, not for R7 alone. No ROM content enters this repository.

### R8. Remove the HMCS44 toolchain

Leaving both toolchains in the tree is the deferred decision this project's PRD rules
forbid.

Delete `src/machine/cpu/`'s HMCS44 implementation, `tools/hmasm/` (7 modules, 226 tests),
`asm/example.asm` and its tests, `isa.test.ts`, `decoder.test.ts`, and `ports.ts`'s D-port
constants. Update `src/asm.d.ts`.

**Acceptance.** `rg -i hmcs4` returns matches only in `docs/` history and
`open-questions.md` §7.

### R9. Freeze a v3 acceptance contract

`CLAUDE.md` requires a contract authored and frozen **before the tag is decomposed**.
`docs/contract/` holds only `v2.contract.md`.

**Acceptance.** `docs/contract/v3.contract.md`, frozen before decomposition, and not
repeating two faults recorded in `open-questions.md` §3: criteria narrower than the hardware
(v2's V1 would have failed a correct ROM using the pattern region; its V5 asserted a 150 ms
burst against a correctly-measured 40.9 ms), and the live gate defect where a failed tier-3
criterion plus a sign-off object still certifies `PASS`.

## Non-Goals

Cut, deliberately, not tracked elsewhere:

- Emulating any other TMS1000-family machine, or a general MAME-style frontend.
- Importing MAME's CPU implementation. The research cites it; the code is written here.
- Shipping the original ROM or any part of it.
- **Reproducing Gakken's O PLA in our ROM.** Ours is ours. R7's harness loading theirs to
  interpret their dump is a different act and is in scope.
- 3D rendering of the case.

## Success Criteria

1. R0's opcode verification is complete and R1/R2 target its finding.
2. The core passes per-opcode tests, the LFSR bijection, and the page/subroutine rules.
3. The assembler rejects all five silent-failure classes.
4. The machine drives 9 grids and 12 plates on `ginv.svg`'s addressing, conformance guard
   green both directions.
5. Every behavioural probe suite passes, with the six re-derivations done and each recorded.
6. The instruction rate is a measurement with provenance, not an assumption.
7. `rg -i hmcs4` is clean.
8. README, `CLAUDE.md` and the diagram describe a TMS1370 without qualification.

## Complexity

| Requirement | Points | Note |
| --- | --- | --- |
| R0 opcode verification | 3 | Mechanical, but blocks everything |
| R1 core | 8 | LFSR, bit-reversed operands, call-latch-conditional page transfer |
| R2 assembler | 8 | Five static analyses, one interprocedural |
| R3 O PLA design | 8 | A 32-entry vocabulary problem, not a syntax feature |
| R4 re-addressing | 5 | |
| R5 game program | 13 | **Blocked** on R0 and R3; decompose before starting |
| R6 measure the rate | 3 | |
| R7 comparison harness | 5 | |
| R8 remove HMCS44 | 3 | |
| R9 contract | 2 | |

## Stale references to correct alongside this work

Found during review, all in documents a decomposition would read:

- `tms1370-io.md`'s "What this changes in the repository" claims the repo has six playfield
  columns and models the score as three full digits. Both were true before #69 and #82 and
  are not now.
- `ATLAS-COORDINATES.md` still carries the D0-D5 mapping table, places the battleship at
  plates 12-14 against its own JSON, and cites `src/game/constants.ts`, which no longer
  exists.
