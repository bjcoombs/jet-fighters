# Drives

Instruments, not architecture. Each file here answers one question about how the
machine plays, by driving `Tms1370Machine` and printing numbers - no assertions,
nothing imported by the suites, nothing run by `npm test`.

They are committed because **every gameplay figure quoted in a review, a commit
message or `docs/evidence/` should be re-derivable from this repository by
somebody other than whoever measured it.** That failed once: a drive called
`trace8.ts` produced the "0 kills in 12 aimed shots at grid 5" figure that
justified the `missile_step` reorder, lived only in one agent's scratch
directory, and later reported 0 kills at *every* column because it waited 125 ms
for a flight that had become 2.5 s long. The figure it gave was true when taken
and unreproducible afterwards.

So each file states what it measures and the ROM state it was written against.
**Re-derive rather than trust**: a drive is a fixed strategy against a machine
whose cadences move, and `open-questions.md` §11a is a list of the ways that
silently stops being the strategy you meant. If a number here disagrees with one
in a comment, the drive is the thing to re-read first.

Run one with `npx vite-node tools/probe/drives/<file>.ts`.
