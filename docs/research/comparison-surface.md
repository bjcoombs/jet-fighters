# The comparison surface: why the glass and not the O port

Paths in this document are relative to the repository root.

This is the design record for `tools/compare/` - the harness PRD R7 asks for and
acceptance contract criterion V11 is driven on. It answers one question that a
reader gets wrong by default:

> If we want to know whether our ROM behaves like Gakken's, why not compare what
> the two programs write to the O port?

Because that comparison would report a difference on every strobe of a perfectly
faithful build, and would report no difference at all on some builds that are
wrong. The surface the harness compares is **what lights on the glass**, and the
rest of this document is why.

## The short version

| Layer | Ours | Gakken's | Comparable? |
| --- | --- | --- | --- |
| Program image | `asm/jetfighter.asm`, 1460 words | `mp2110`, 2048 words | No - different programs |
| O PLA index a `TDO` writes | ours | theirs | No - private to each table |
| 8-bit mask that index decodes to | `src/machine/board/o-pla.ts` | `tms1100_ginv_output.pla` | No - different tables by design |
| **(grid, plate) cells lit over a sweep** | **the tube** | **the same tube** | **Yes** |
| **R15 speaker edges, in instruction cycles** | **one pin** | **the same pin** | **Yes** |
| **The number the two digit grids read out** | **seven segments on plates 0-6** | **the same seven** | **Yes** |

The bottom three rows are the comparison surface. `tools/compare/harness.ts`
records exactly those and nothing above them.

## Why the O port is not a surface

The TMS1370's eight O pins are not a latch. They are the output of a
five-bit-to-eight-bit code converter indexed by `status_latch:accumulator`, whose
decoding the customer defines at mask time - TI Data Manual Dec 1976 §2.6, quoted
in `docs/research/tms1370-io.md`. A program does not write a plate pattern; it
selects one of 32 the mask holds.

So the meaning of a `TDO` is entirely a property of the table that chip was
fabricated with. Our table is this project's own design, justified from
`src/machine/tube/atlas.json` and from nothing else, and
`docs/research/pla-design.md` records the arithmetic that forces its shape:
three lane families across plates 0-2, 3-5 and 6-7, ten decoded digits, a dark
slot at 0 and one slot spare. Gakken's table is theirs and this project has
never seen it.

Two consequences, and they run in opposite directions.

**A faithful build compares as different.** Suppose our ROM and theirs put the
identical picture on the identical tube. Ours reaches a three-plate lane subset
by writing index 5; theirs might reach the same three plates by writing index
22, or by two writes where we make one, or through a table whose digit run sits
in the low bank. Every one of those is a difference in the O trace and none of
them is a difference a player could see. A comparison at that layer would be
noise from the first strobe onward.

**A wrong build can compare as identical.** Index equality says nothing about
plates unless the two tables agree, and the tables are known not to agree. Two
machines writing the same index sequence through different tables light
different segments. An O-level comparison would call that a match.

The same argument rules out comparing RAM. Where the score lives, where the
battleship's column counter lives, which nibble holds the buzz divider - these
are the ROM author's choices. `asm/jetfighter.asm` puts the score at `NIB_SCORE`
because that is convenient for the program we wrote, not because MP2110 does.

## What is common to both machines

The tube. `docs/research/tms1370-io.md` reads MAME's `set_size(9, 12)` off the
driver for our own ROM mask and corroborates it twice from the teardown
photograph: nine grids on R0-R8, twelve plates on O0-O7 plus R11-R14. The glass
in the case is the glass whatever program is running beside it, and
`src/machine/tube/atlas.json` addresses 94 segments on it as (grid, plate) pairs.

So a comparison in terms of **which (grid, plate) cells were driven, over which
display sweep** is a comparison of the picture. It is invariant to which slot
either table keeps a mask in, to which index a program chose, and to how many
instructions either took getting there.

Three surfaces follow from that, and they are the three the harness records.

### Lit segment sets, per sweep

One display sweep is the frame. `tools/compare/harness.ts` splits the strobe
stream on the boundary `tools/probe/tms1370-probe.ts` measures the sweep period
between - the first strobe of grid 0 after a strobe of grid 8, grid 8 being
reached only in the two high-bank passes that close a sweep. A cell counts as lit
if it was driven at any point during its grid's dwell.

Sweeps are paired by **ordinal, not by cycle**. Two images reach their tenth
sweep at different cycles as soon as either spends instructions the other does
not, and on this machine a sound suspends the sweep outright - `note` does not
strobe the grids. Pairing by cycle would report every sweep after the first sound
as a mismatch while the glass was identical. The cycle each sweep began on is
still reported, so drift in *when* the sweeps happen is visible rather than
absorbed.

Only sweeps bounded at both ends are compared. The ROM clears 128 nibbles of RAM
before its first strobe, and a run simply stops wherever it stops, so a partial
sweep at either end would compare as a difference between two identical
machines.

### Speaker edges, in instruction cycles

R15 is one pin on both machines and there is no D port. An edge is a transition,
stamped with the instruction cycle it happened on.

Edge *n* of one stream is compared with edge *n* of the other, within
`SPEAKER_EDGE_TOLERANCE_CYCLES` - one grid strobe, derived from
`src/machine/board/tms1370-cadence.ts`'s measured sweep length. One strobe is the
floor because `asm/jetfighter.asm`'s `strobe` ticks the buzz between `SETR` and
`RSTR`, so an edge is emitted from inside a dwell and cannot be placed finer than
the dwell it fell in.

The matcher does not resynchronise after a divergence, and that is deliberate. A
stream missing one edge has every subsequent level inverted; a matcher that slid
one stream along to re-pair them would describe an inverted waveform as a small
skew.

### The score the digits read out

`score_tens_sega` is plate 0 through `score_tens_segg` at plate 6 on grid 7, and
the units digit repeats it on grid 8. That assignment is the atlas's - the
glass's - not either table's, and the ten shapes are the conventional
seven-segment ones. So the same decode reads the original's tube as reads ours.

A pattern that is not one of the ten decodes to "unreadable" rather than to a
nearest match. On a machine being validated, a half-drawn numeral is a finding,
and rounding it to a digit would hide exactly what the harness is for. A dark
tens digit is different: that is leading-zero suppression, and it reads as zero.

### Input response timing

Measured, per injected contact change, as the cycles from the event to the start
of the first sweep whose lit set differs from the sweep in progress when the
contact closed. Compared within `INPUT_RESPONSE_TOLERANCE_CYCLES` - one sweep -
because a contact on K1/K2/K4 is only visible while its own column is strobed,
and two images that each read it on their next pass can legitimately differ by up
to a whole sweep in when they act on it.

## Why the harness needs their output PLA, and why that is not the non-goal

`docs/prd/jet-fighters-v3.md` lists as an explicit non-goal:

> **Reproducing Gakken's O PLA in our ROM.** Ours is ours. R7's harness loading
> theirs to interpret their dump is a different act and is in scope.

The distinction is the whole of this section. A comparison at the glass needs to
know which plates the original's `TDO` indices drive. That information is not in
`mp2110`: the dump is 2048 instruction words, and the index-to-plates table was
fabricated into the mask. It is in `tms1100_ginv_output.pla`, which is why PRD
R7's artifact table lists that file as gating "R7's own harness - a program image
alone cannot say what lights".

So:

- **Loading their table to decode their dump** is reading an input. It changes
  nothing in this repository and produces a statement about what their machine
  lights. In scope, and `tools/compare/romset.ts` does it.
- **Reproducing their table in our ROM** would make our machine's output
  vocabulary a copy of theirs. Out of scope, and `src/machine/board/o-pla.ts`
  and `asm/opla.inc.asm` are this project's own design instead.

The first draft of the PRD conflated the two. They are separate acts and the
harness performs only the first.

## What this project actually holds

**None of the four romset artifacts.** Not `mp2110`, not
`tms1100_ginv_output.pla`, not `tms1100_common2_micro.pla`, not `ginv.svg`. No
ROM content from the original is committed to this repository, no decode of one
is recorded in it, and `tools/compare/romset.ts` has never been run against a
real file.

That is why the no-romset path is the harness's **primary** path rather than a
degraded fallback. Contract V11:

> A harness that cannot run without the romset fails, because that makes it
> unusable for the work it exists to support - this criterion is driveable today
> and is not recorded undriven.

`npm run compare` with no arguments records our machine image, reports the
surface above, and compares a second recording of the same image against the
first. That second recording is not ceremony: it drives the whole comparator -
sweep splitting, cell differencing, edge pairing, score progression - so a
"matched" verdict is a verdict from a comparator that ran. `harness.test.ts`
carries the mutation case that proves the same thing at the assertion level: one
altered output PLA slot, program untouched, and the comparison fails.

**The absence of a romset sets no exit code.** Exit 1 is reserved for a genuine
mismatch and exit 2 for a bad command line or an unreadable named file. An absent
romset, a partial one, and a directory that does not exist all exit 0 with a
report saying which artifacts were looked for.

### Two things assumed about a file nobody here has read

`tms1100_ginv_output.pla` ships as Berkeley/espresso text.
`tools/compare/romset.ts` parses that form, and two things about reading one
cannot be settled from this side:

| Assumption | Default | How to change it |
| --- | --- | --- |
| Which end of the input plane carries the status latch | MSB first | `--pla-input-order lsb-first` |
| Which end of the output plane carries O7 | MSB first | `--pla-output-order lsb-first` |

Both defaults are the conventional reading of the format and nothing stronger.
The harness prints them on every run that loads a PLA, worded so they cannot be
read as verified. If the original's display comes out garbled, reversing one of
them is the first thing to try - which is why they are flags and a report line
rather than a comment in a source file.

The parser also refuses a file whose `.p` term count disagrees with the terms it
holds. A table truncated in transit parses cleanly and is wrong, and a wrong
table would be reported as a difference in *the original's* display. That false
finding is worse than a refusal.

## Reading the report

```
npm run compare                              our machine image, no romset
npm run compare -- --original path/to/romset against an original dump
npm run compare -- --json                    the same report as data
```

`--sweeps N` sets the run length, in display sweeps rather than in cycles or
seconds, because a sweep is the unit the surface is sampled in and it is
rate-free. `--input name=value@cycle` injects a control by closing a contact on
the K matrix, in the spelling `tools/probe/machine-probe.ts` already takes.

Durations are quoted as ranges throughout. `src/machine/cpu/tms1370/timing.ts`
records that MAME's 350 kHz is a fitted RC-oscillator approximation carrying a
stated +/-50 kHz, so the instruction rate is 50000-66667 cycles a second rather
than a point. Every comparison the harness makes is in instruction cycles, which
is rate-free; the spread enters only where a cycle count is quoted as a duration,
and `cyclesToMillisecondRange` is the one place that happens.

## What a mismatch would and would not tell us

If a dump does arrive and the report comes back with differing sweeps, the honest
reading is that **two machines differ** - not that ours is the wrong one. The PRD
says as much about the rocket-lane defect it forbids inheriting: "If the
original's behaviour turns out to be the defective one, R7 will show it and that
is a finding, not a licence to have shipped it unexamined." A difference is
evidence to be read, in either direction.

Three things could be behind any given difference, and the harness cannot tell
them apart on its own:

1. Our game program implements a rule differently.
2. Our reading of the tube's segment addressing is wrong - `ginv.svg` is absent,
   so `atlas.json`'s (grid, plate) pairs are this project's own reading of the
   teardown photograph. Contract V6 is `undriven` for that reason.
3. The PLA plane orderings assumed above are the wrong way round, which would
   garble the original's picture wholesale rather than in one region.

A wholesale mismatch that clears up when a plane ordering is reversed is case 3.
A mismatch confined to one segment family is more likely case 2. A mismatch that
tracks a game event is case 1. Saying which is a reading of the report, not an
output of it.
