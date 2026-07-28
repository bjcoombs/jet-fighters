# Jet Fighters v3 - TMS1370 Rebuild PRD

## Problem Statement

v2 is a careful, measured emulation of the wrong processor.

The unit's microcontroller is a **Texas Instruments TMS1370**, custom mask **MP2110** -
legible in `assets/reference/tube-teardown/board-L1001567.jpg` and named in MAME's device
list as *"1980, Gakken Invader/Tandy Fire Away"*. v2 implements a Hitachi HMCS44, chosen
from a generalisation about Gakken's suppliers stacked on a match between the box's "2K
Bytes L.S.I." and a datasheet, neither checked against the chip.
`docs/evidence/open-questions.md` §7 records the finding and how the error entered.

The consequence is not cosmetic. Every hardware constraint that shapes the program is
different, and three of them change what the toolchain has to be:

| | v2 built (HMCS44) | The machine (TMS1370) |
| --- | --- | --- |
| Instruction word | 10-bit | **8-bit** |
| ROM | 2048 + 128 pattern words | **2048**, as 2 chapters x 16 pages x 64 words |
| RAM | 160 nibbles | **128 nibbles** |
| Subroutine stack | 4 levels | **1 level**, and nesting silently loses the return address |
| Program counter | a counter | **a 6-bit LFSR** - execution order is not address order |
| Display outputs | 10 grids, 20 plates | **9 grids (R0-R8), 12 plates (O0-O7 + R11-R14)** |
| Segment patterns | any plate mask per grid | the low 8 come through a **32-entry mask-programmed PLA** |
| Speaker | D14 | **R15**, an R latch like the grids |
| Inputs | dedicated strobe port | **K1/K2/K4** strobed from R9/R10, **K8 unstrobed** for fire |

## Technical Context

Two research documents, each marking every claim as executable, documented, inferred or
unestablished, and each closing with what it does not settle:

- `docs/research/tms1370-architecture.md` - core, memory, paging, instruction set, timing.
- `docs/research/tms1370-io.md` - pin budget, the O PLA, the K inputs, MAME's `ginv`
  machine definition, and what the ROM dump is.

Both are sourced against MAME's CPU implementation (an executable specification that runs
the real MP2110 dump) and TI's *TMS 1000 Series Data Manual*, December 1976.

**The board corroborates the identification independently of the mask number**: the
silkscreen beside the chip reads `47K` and `47P`, and MAME's source comments its clock as
*"approximation - RC osc. R=47K, C=47pF"*.

### What survives untouched

Everything measured from the glass and the speaker, because none of it depends on which
chip drives the tube: the 94 traced segment outlines, the printed-cell registration, the
phosphor decay constants, the control-grid mesh, the case geometry, every audio band and
duration, and every gameplay rule the owner has corrected. The renderer, the audio
reconstruction, the case shell, the input UI and the whole of `docs/evidence/` stand.

### What is replaced

`src/machine/cpu/`, `tools/hmasm/`, `asm/jetfighter.asm`, and the display's address space.

## Scope

Everything below is a requirement with acceptance criteria. Nothing here is optional,
phased, or deferred to a later document.

### R1. TMS1370 CPU core (`src/machine/cpu/`)

Replaces the HMCS44 core. Same architectural rules as v2: it owns no clock, touches no DOM,
and advances only when stepped.

- TMS1100-class core: 4-bit ALU, accumulator, X (3 bits), Y, status, status latch, call
  latch, page and chapter address and buffer registers, and the one-level subroutine
  return register.
- **The program counter is a 6-bit LFSR.** The core steps it by the shift-register rule,
  not by increment.
- 2048 x 8 ROM addressed as `(CA << 10) | (PA << 6) | PC`; 128 x 4 RAM.
- Full TMS1100 opcode set, with operands decoded bit-reversed.
- `BR` and `CALL` conditional on status, with the page/chapter transfer rules: PB moves
  into PA only on a taken branch **and only outside a subroutine**; CB moves into CA on a
  taken branch regardless.
- `CALL` inside a subroutine does not save a return address; `RETN` outside one does not
  restore the PC. Both are modelled as the silicon behaves, not as errors.

**Acceptance.** Every opcode has a unit test asserting its documented semantics. The LFSR
sequence is asserted against the 64-state table in the architecture research and shown to
be a bijection. A test asserts that a branch inside a subroutine does not change page.
Instruction timing is one cycle per instruction, asserted against the oscillator model in
R6.

### R2. TMS1000-family assembler (`tools/tmsasm/`)

Replaces `tools/hmasm/`. Same shape: a library, a CLI that emits a listing, and a Vite
plugin so an `.asm` file is an importable module with no generated ROM to go stale.

Three things it must do that a conventional assembler does not, each because the failure it
prevents is silent:

- **Place code by LFSR order.** The *n*-th instruction of a page goes at physical offset
  `lfsr[n]`. A label resolves to an LFSR state, not to an ordinal.
- **Reject a page-crossing branch inside a subroutine.** It assembles cleanly on real
  silicon and jumps to the wrong place. This is an error, not a warning.
- **Reject a `CALL` reachable from inside a subroutine.** Nesting does not fault at the
  call site; it loses the outer return address and fails as a wild jump much later.

It must also enforce the real ceilings as errors: 2048 program words, 128 RAM nibbles.

**Acceptance.** Round-trip `encode(decode(op)) == op` across the whole opcode space, as v2
did for the HMCS44 - that guard caught real bugs and is carried over. Each of the three
rules above has a test asserting a violating program fails to assemble.

### R3. The O output PLA is ours to design (`asm/` and the core)

The low 8 plates are not written directly. They come from a 32-entry PLA indexed by
`status_latch:accumulator`, mask-programmed at manufacture - part of the custom silicon,
not of the ROM.

Because we author the program, **we author the PLA**. It is declared in the assembly source
alongside the code, assembled into the machine image, and loaded by the core.

**Acceptance.** The PLA is a first-class part of the source file with its own syntax and
its own listing section. A test asserts the core's O output equals the PLA entry selected
by the current status latch and accumulator.

### R4. Board and display re-addressing (`src/machine/board/`, `src/machine/tube/`)

- `GRID_COUNT` 10 -> **9**; `PLATE_COUNT` 20 -> **12**.
- Grids are R0-R8. Plates are O0-O7 and R11-R14. There is no D port on this chip.
- Speaker moves from D14 to **R15**, written by `SETR`/`RSTR`. The cycle-stamped edge
  capture model carries; the pin and the write mechanism do not.
- Inputs: K1/K2/K4 returned from strobes on R9/R10, plus K8 unstrobed for fire. Only one
  of R9/R10 may be high at a time.

**The 94 segment outlines do not change.** Their addresses do. The research establishes the
shape (9 x 12) and the regions but **not** which line drives which cell - so the assignment
is ours to choose, constrained to be physically plausible and internally consistent.

**Acceptance.** The atlas conformance test from v2 carries over unchanged in intent: every
address the ROM drives exists in the atlas, and every atlas segment is driven or is on a
named exception list. `atlas.test.ts`'s measured frame assertion - the three printed
boundary positions - is untouched, because it answers to the photograph and not to the
chip.

### R5. The game program (`asm/jetfighter.asm`)

Rewritten for the TMS1370, under one level of stack and LFSR placement.

Every gameplay rule and every measured cadence in `docs/evidence/` and the v1 PRD carries
over as the specification. In particular the figures the owner's own recordings established:
a ~4.0 s battleship appearance sounding continuously, arrivals ~19.8 s apart, a ~93.4 Hz
buzz repetition rate, the squadron ladder anchored to a ~2040 ms slowest march, and three
launchers with two-beep and three-beep warnings.

**Acceptance.** The probe suites from v2 carry over and must pass: `game-lifetime`,
`launcher-lives`, `battleship-arrival`, `blank-to-glass`, `sweep-timing`,
`rom-atlas-conformance`, `speaker-bands`. They assert behaviour, not an instruction set,
which is why they survive the chip change. Two of them need re-derivation rather than
re-tuning, and this is stated so it is not discovered late:

- the buzz's divisor, which landed on 89 Hz against a measured 93.4 Hz by arithmetic
  specific to the HMCS44 sweep rate, must be re-derived from the TMS1370's own sweep and
  land inside the measured 79-111 Hz;
- the loss sound must be identified by its decay floor as well as its 80-97 Hz collapse,
  because an ~85-93 Hz buzz sits inside that band on any silicon.

### R6. The clock is a stated assumption, not a measurement

MAME fits ~350 kHz as an RC-oscillator approximation with a +/-50 kHz spread across
specimens. Our board's 47K/47pF matches that comment, which confirms the circuit but not
the frequency.

**Acceptance.** The oscillator frequency is a single named constant with its provenance
recorded as an approximation. No cadence is derived by arithmetic from it; every cadence is
asserted against a measured audio band or a measured duration, so that a later measurement
of the real clock moves one number and re-derives the rest. This is the v2 lesson about
literal horizons, applied to the clock itself.

### R7. Comparison against the original ROM

The point of writing our own program is to be able to compare it with the one Gakken
shipped. MAME's `ginv` romset contains the real MP2110 dump.

**Acceptance.** A harness that runs our machine and reports the behavioural trace the
comparison needs: display state over time, speaker edges, and score. It must run against
our ROM with no dump present, and accept a dump as an alternative program image when one is
supplied. The dump is a **test oracle**, never a shipped artifact: no ROM content enters
this repository.

**Dependency, stated rather than hidden:** the comparison itself needs the owner to obtain
the romset. The harness is in scope and testable without it; the comparison run is gated on
that step.

## Non-Goals

Cut, deliberately, and not tracked elsewhere:

- Emulating any other TMS1000-family machine, or a general MAME-style frontend.
- Importing MAME's CPU implementation. The research cites it; the code is written here.
- Shipping the original ROM, or any part of it.
- Reproducing the O PLA of the original. Ours is ours.
- 3D rendering of the case. That is a separate piece of work with its own prerequisite
  measurements.

## Open questions this rebuild answers

Two long-standing gameplay questions become answerable by R7 rather than by inference, and
must not be guessed at before then:

- **Whether a jet reaching the G line ends the game or costs a launcher**
  (`open-questions.md` §6), with its revert path already recorded.
- **Whether the rocket's lane should derive from the player's own keypress pattern**
  (§3), which currently makes one lane lethal and two safe.

## Success Criteria

1. The core passes a per-opcode suite, the LFSR bijection test, and the page/subroutine
   rule tests.
2. The assembler round-trips the opcode space and rejects all three silent-failure classes.
3. The machine drives 9 grids and 12 plates, with the atlas conformance guard green in both
   directions.
4. Every behavioural probe suite carried from v2 passes.
5. The README, `CLAUDE.md` and the architecture diagram describe a TMS1370 without
   qualification - the "currently HMCS44" notes are gone because they are no longer true.
6. `docs/evidence/` is unchanged except where a measurement was re-derived, and each such
   change says why.

## Complexity

| Requirement | Points |
| --- | --- |
| R1 core | 8 |
| R2 assembler | 8 |
| R3 PLA | 3 |
| R4 board and display re-addressing | 5 |
| R5 game program | 13 |
| R6 clock constant | 1 |
| R7 comparison harness | 5 |

R5 is 13 and must be decomposed before it is started: it is a rewrite of every rule under a
one-level stack, which is a different program rather than a translation of the existing one.
