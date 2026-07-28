# mp2110 instruction-rate measurement: provenance

**Status: Provisional. The instruction rate is not measured.** This document
records why, names the artifact that blocks a measurement, and sets out the
route that would produce one without being circular. Nothing below should be
read as a rate - see [What this document is not](#what-this-document-is-not)
before using any number in it.

This is the provenance document contract criterion V10
(`docs/contract/v3.contract.md`) and PRD R6 (`docs/prd/jet-fighters-v3.md`,
"Measure the instruction rate; do not assume it") require. It is one of two
machine-checkable states V10 accepts - **Measured** or **Provisional** - and
this run is in the second. `src/machine/cpu/tms1370/timing.ts` exports the two
named constants this document is the provenance for:
`OSCILLATOR_HZ` and `CLOCK_DIVIDER`, kept separate so a later refinement of
either moves the derived instruction rate (`CYCLE_HZ`) without silently
touching the other.

## 1. The blocking artifact: `mp2110`

The instruction rate this project needs is the real unit's - not a model's,
not an estimate's. Every route to it that does not assume the answer runs
through the MP2110 ROM dump, and that dump has not been obtained on this run.

`docs/prd/jet-fighters-v3.md`'s romset table lists four artifacts this rebuild
depends on and what each gates. `mp2110` gates R7 (comparison against the
original ROM) directly, and it is also the artifact this document is blocked
on, because the sweep-loop instruction count in
[step 3](#the-four-steps) below is a property of *Gakken's* program, not
ours. `tms1100_common2_micro.pla` - the other artifact R0's opcode
verification needs - is likewise absent; task 1 (R0) is deferred for the same
reason and is recorded separately. Neither is fabricated here. An absent
artifact is a blocked run; an invented hash or romset name would be a failed
one, and `CLAUDE.md`'s instruction on this point is not to let the two read
alike.

## 2. Why the naive measurement is circular

A tempting shortcut: time some on-screen event in the reference recordings -
the battleship buzz, a squadron step - convert the interval to a cycle count
using *our own* ROM's cadence constants, and call the result the instruction
rate.

That is circular. The recordings are of Gakken's program running on Gakken's
silicon. A timed interval from them gives seconds, and converting seconds to
an instruction count needs to know how many instructions Gakken's ROM executed
in that interval - a property of *their* disassembly. Substituting our own
ROM's instruction count instead answers a different question: it says how fast
our program runs at whatever rate we already assumed, which is exactly the
number this measurement exists to stop us assuming. `docs/prd/jet-fighters-v3.md`
R6 states this plainly: *"Using our own program's count is circular, because
our cadences are the thing being set."*

The dependency runs one way only: the real unit's instruction rate can inform
this ROM's cadence constants, but this ROM's cadence constants can never be
used to derive the real unit's instruction rate. Any route that closes that
loop - however indirect - is not a measurement.

## 3. The non-circular route

<a id="the-four-steps"></a>

Four steps, none of which this run can perform because the first is blocked:

1. **Obtain `mp2110`.** The ROM dump of the real MP2110 mask, from the MAME
   romset. Not present in this repository and not present on the machine this
   run executed on.
2. **Apply R0's verified opcode set to disassemble it.** R0
   (`docs/prd/jet-fighters-v3.md`) decodes `tms1100_common2_micro.pla` and
   records, per microinstruction-defined opcode, whether MP2110 implements the
   standard TMS1100 behaviour. That document is what makes a disassembly of
   `mp2110` trustworthy rather than a guess: `tms1370-architecture.md`'s "What
   this does not settle" §1 is explicit that MAME's disassembler ignores the
   microinstruction PLA and always prints standard mnemonics, so *"a
   disassembly of `mp2110` therefore cannot be trusted for any
   microinstruction-defined opcode until the PLA is checked."* R0 is itself
   deferred on this run, blocked on the same missing romset
   (`tms1100_common2_micro.pla`, shared by ~30 MAME sets, not `mp2110`
   specifically) - so this step is two artifacts deep, not one.
3. **Statically count instructions in the sweep loop.** With a trustworthy
   disassembly in hand, find Gakken's display-sweep master loop - the
   TMS1370 equivalent of this project's `dwell`/sweep structure
   (`asm/jetfighter.asm`, "The whole program is one master loop") - and count
   its instructions along the executed path. This is arithmetic on a static
   disassembly, not a timed observation, and it is the step that makes the
   rest of the route non-circular: the count comes from Gakken's program, read
   directly, never inferred from a duration.
4. **Divide the measured ~71 Hz refresh by that count, then derive the
   oscillator frequency as instruction rate x 6.** The refresh figure is
   already measured and already in this repository, independent of any
   instruction-rate assumption: `docs/evidence/vfd-appearance.md` §2 derives
   it from the aliasing beat between the reference video's 30 fps sampling and
   the real tube's refresh, and states the admissible interval as
   **70.6-72.5 Hz** (mean 71.5 Hz across the sound-free sweeps of a played
   game) with 64.5 Hz - the figure this project's own ROM used to target -
   excluded outright by the same analysis. Instructions per sweep, divided
   into sweeps per second, gives instructions per second - the instruction
   rate. Multiplying that by `CLOCK_DIVIDER` (6, architectural and already
   settled - see `src/machine/cpu/tms1370/timing.ts`) gives the oscillator
   frequency this project can then compare against MAME's estimate.

Every step above depends only on things measured independently of one
another - the refresh rate off the video, the instruction count off a verified
disassembly - which is what keeps the final division from smuggling in an
assumed rate. None of the four has been performed on this run; step 1 blocks
the rest.

## 4. What this project has instead

MAME fits the TMS1370's oscillator at 350 kHz and calls it an approximation.
`docs/research/tms1370-architecture.md` §6 quotes the driver comment verbatim -
`TMS1370(config, m_maincpu, 350000); // approximation - RC osc. R=47K, C=47pF`
(S2 `hh_tms1k.cpp:7093`) - and the driver's own header states the spread this
carries: *"the frequency range can differ up to 50kHz"* unit to unit, part of
it attributed to component ageing (S2 `hh_tms1k.cpp:19-24`). That is **+/-14%
on 350 kHz**, and it is a property of the model, not a measurement of the
owner's own chip. Sibling drivers in the same file use 375 kHz and 425 kHz with
the identical "approximation" wording, which is the tell that none of these
figures rests on anything measured per-unit.

`src/machine/cpu/tms1370/timing.ts` carries this estimate forward as
`OSCILLATOR_HZ = 350_000`, with the spread as its own named constant
(`OSCILLATOR_SPREAD_HZ = 50_000`) rather than folded into a single derived
number. Dividing by the architectural `CLOCK_DIVIDER = 6` gives an
instruction rate whose midpoint is 58,333.33 Hz - **and that midpoint must
never be read as a threshold or a fact.** The honest statement is a range:
`OSCILLATOR_HZ` spans 300,000-400,000 Hz, so the instruction rate spans
50,000-66,666.67 Hz. Nothing in this codebase should compare a timing figure
against "58 kHz" as if it were a settled boundary; `timing.ts` exports
`CYCLE_HZ_MIN`/`CYCLE_HZ_MAX` so a comparison can be made against the range
instead, and its test suite asserts the range is reached by division rather
than typed in.

The route in [§3](#the-four-steps) would replace this estimate for the model
with a measurement for the specific unit this project is emulating - which is
the entire reason R6 ranks obtaining `mp2110` ahead of choosing any cadence.

## 5. Where this leaves cadence constants

Until the route above runs, every cadence constant downstream of the
instruction rate is provisional twice over, for two independent reasons:

- **`asm/jetfighter.asm`'s existing cadence figures** (the "Provisional
  cadence constants" block, `DWELL_OUTER`/`DWELL_INNER`, the battleship and
  rocket timers, `PAT_STEP`/`PAT_ROCKET`) were derived against the current
  HMCS44 core's ~400 kHz oscillator with no divide-by-six, which is a
  different machine entirely from the TMS1370 this project is rebuilding onto.
  They were already marked provisional for a first reason -
  `docs/evidence/timing-analysis.md` records the per-skill gameplay video
  this project needs and does not have.
- They are now also provisional for this document's reason: once the ROM is
  rebuilt onto the TMS1370 core, every sweep-count-to-wall-clock conversion in
  that file has to be redone against `CYCLE_HZ` from
  `src/machine/cpu/tms1370/timing.ts`, and `CYCLE_HZ` is itself provisional
  per this document.

Every cadence constant in `asm/jetfighter.asm` and every timing constant in
`tools/probe/` now carries a comment marking it provisional for this second
reason, pointing back here. Re-deriving their values against the TMS1370 core
is out of scope for this document - it is downstream work (contract V10's
"Measured" state, and the tag's re-derivation task) that this document's route
is a precondition for, not a substitute for.

## What this document is not

Not a measurement, not an estimate for the owner's specific unit, and not a
recommendation to treat 350 kHz, 58,333 Hz, or any other figure here as a
target to tune toward. It is the record of what is blocked, why the obvious
shortcut is wrong, and the four steps that would unblock it. When `mp2110` is
obtained, this document is what should change first - and `OSCILLATOR_HZ` and
`CLOCK_DIVIDER` in `timing.ts`, cited from it rather than copied, are what
should change second.
