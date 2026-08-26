# Drives

Instruments, not architecture. Each file here answers one question about how the
machine plays, by driving `Tms1370Machine` and printing numbers.

They are committed because **every gameplay figure quoted in a review, a commit
message or `docs/evidence/` should be re-derivable from this repository by
somebody other than whoever measured it.**

## What enforces that

For a year that sentence was an intention with nothing behind it: no drive was
imported by a suite and `npm test` never reached one. It failed five times.

| Drive | How it failed |
| --- | --- |
| `trace8.ts` | Produced the "0 kills in 12 aimed shots at grid 5" figure that justified the `missile_step` reorder, lived only in one agent's scratch directory, and later reported 0 kills at *every* column because it waited 125 ms for a flight that had become 2.5 s long. True when taken, unreproducible afterwards. Never committed here. |
| `battleship-lead.ts` | Drifted from the kill figure in its own header, unnoticed. |
| `column-hit-profile.ts` | Fired **0 shots at every column** and printed "no kills" five times as a finding. Dead for a whole tag. |
| `playability-audit.ts` | Reported **0 march steps and 0 releases on all three skills**; its crossing test, the drive's whole subject, compared zeroes. Dead for a whole tag. |
| `loss-warning-partials.ts` | Shells out to `ffmpeg`, so a clean checkout could not run it at all. |

**The shape of the failure was always the same: a drive that had stopped being
offered opportunities printed a zero, and a zero reads as an answer.** Nothing
distinguished "the machine does not do this" from "the instrument is broken".

So each drive now has a `<drive>.test.ts` beside it, run by `npm test` and by
CI, asserting a **non-zero opportunity count** - shots offered, crossings seen,
march steps taken, entries observed, coincidences classified, endings heard. Not
that the drive exits cleanly: a dead drive exits cleanly. Each floor is stated
with the figure it was measured against and the margin between them, so a
failure says which of the two it is.

`drives-covered.test.ts` is what stops the next drive slipping through. It reads
this directory and requires every non-test file to name a test that exists, or
to be excluded with a reason on the record. A new drive fails it until somebody
decides which.

Two things the guard does **not** cover, said plainly:

- **It does not check that a figure is still the right one.** A floor catches an
  instrument that measures nothing; it cannot catch one that measures the wrong
  thing accurately. `parked-endings.test.ts` is the exception - it asserts the
  three `game-horizons.ts` constants are still ceilings, which is a figure and
  not a floor - and it is the exception because eight suites derive their
  horizons from those constants.
- **It does not re-aim a drive.** Three instruments here are pinned to emergent
  phase and re-break when a cadence moves. When one fails, the drive is the
  thing to re-read, and re-pointing it at a new phase or strategy is a change to
  announce, not to slip in under a green tick.

## Reading a drive

Each file states what it measures and the ROM state it was written against.
**Re-derive rather than trust**: a drive is a fixed strategy against a machine
whose cadences move, and `open-questions.md` §11a is a list of the ways that
silently stops being the strategy you meant. If a number here disagrees with one
in a comment, the drive is the thing to re-read first.

Run one with `npx vite-node tools/probe/drives/<file>.ts`. Each prints exactly
what it always printed; the figures are now also returned from an exported
function, which is what the tests read.

`loss-warning-partials.ts` needs `ffmpeg` on PATH (`brew install ffmpeg`,
`apt-get install ffmpeg`). Its test skips, saying so, on a machine without one.
CI installs it, and there the test fails rather than skips.
