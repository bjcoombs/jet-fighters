# The owner's account of what the machine tracks

Paths in this file are relative to the repository root.

**Owner testimony, given 2026-07-30 while playing the deployed build**, across
several messages as he watched both the emulation and the physical unit. It is
recorded here because it arrived faster than it could be implemented, and
because it describes a data model rather than a symptom - which makes it the
most reusable thing he has said about this machine.

**The missile rank is now built; the jet model is not.** This file began as a
specification and is becoming a record as each half lands. The table below says
which is which, and the status column is the only part that should ever move -
the owner's account is testimony and does not change because the code caught up.

## What can be on the glass at once

| Entity | This ROM today | The owner's account |
| --- | --- | --- |
| Player missile | **up to 3 in flight, one per row** - BUILT | **up to 3 in flight, one per row** |
| Planes | 3, one per row by construction - NOT YET | **2, anywhere** |
| Battleship | 1 | 1 |
| Jets' rocket | 1 | at least 1 - "the planes might have fired" |
| Launcher | 1 | 1 |

### What "built" means for the missile rank

`FILE_MISS` holds one column nibble per lane, the nibble index *is* the lane, and
one shared countdown steps the whole rank (`missile_walk` on `P_HIT`). Firing is
gated on `FILE_MISS[the lever's lane]` alone, so a shot in another lane is no
longer a refusal - which is the defect this document opened with.

Measured over the same drive both sides, the refusal rate went from a flat
**~82% however patiently the player taps** to one that tracks the physical limit:
39.0% at one press per lane per 1.8 s, and **0% at 3.6 s**, which is what three
lanes and a 2.5 s flight can absorb. The residual at faster cadences is correct -
a lane whose shot has not cleared must still refuse.

`tools/probe/missile-rank.test.ts` holds the collision test to every lane on both
halves of the LEAVE/ARRIVE pair, proved against two ROM mutants.

His summary: *"up to three bullets in flight but only two planes in flight but
you can have two planes and one boat, and the planes might have fired. So one
row might have a fighter bullet, two planes a ship and a bullet from my gun, and
me."*

## The three things that break the current model

**1. Two planes can share a column.** Different rows, same distance from the
launcher.

**2. Two planes can share a row.** *"A plane can share a row also, I've seen it
in the physical game."* This is the one that matters structurally: `FILE_JETS`
holds one nibble per lane and the nibble *is* the column, so two planes in one
row is not merely absent from the emulation, it is unrepresentable. Two planes
need a row and a column each - four nibbles.

**3. A plane can appear anywhere on the board.** Not only at the far column.
`jet_enter` writes `GRID_COL_FIRST` and marches inward, so every plane currently
enters at the same place.

**4. A plane can change lane mid-flight.** Owner testimony, added 2026-08-25 from
`assets/reference/jetfighters-video.mov`, watching the physical unit: **at most two
jets approach at once**, and as they march toward the launcher they change row -
not only their entry row, which point 3 already covers, but their row *during* the
march. This is additional to, not instead of, the (row, column) position model: it
means a plane's row is not fixed for the plane's lifetime, so whatever design
answers task 10's question (b) - what happens to every lane-indexed reader of
`FILE_JETS` - also has to answer "what moves a plane's row, and how often" once
positions replace the lane rank. Not yet designed against; the missile rank
(tasks 1-9) is unaffected, since it does not read a jet's row at all.

## Why the count is the clue

The owner's own inference, and it is a good one: *"the max two planes hints at
how it's managing its nibbles."* Two entities at two nibbles each is four; three
lanes at one nibble each is three. The current model is cheaper *and* cannot
express what he sees. A machine that tracks two planes as positions is paying
for generality it must have had a reason to buy.

The same shape covers the missiles: three shots as three columns, the row implied
by which nibble. **Both are "track N moving things at positions", which is one
mechanism rather than two**, and that is the argument for doing them the same way.

## Three bullets aligned: not a rule, a limit on thumbs

He has seen two bullets share a column, on different rows, and never three:
*"this might also hint at looping speed relationship between repeated firebutton
and change of joystick allowing that."*

**That is input speed, not a rule, and nothing should be written to forbid it.**
Getting three shots into one column needs three presses and two lever moves
inside a single 500 ms step. Allow three in flight, let the player's hands decide
what is reachable, and the observation falls out for free. A minimum-spacing rule
here would be a rule with no evidence behind it, invented to make a pattern match
- the same trap section 10 refuses for the warning beeps.

## The open problem: "randomly"

*"A plane can randomly appear anywhere on the board."*

**This ROM has no randomness at all.** `NIB_RAND` does not exist in v3 - the only
occurrence of the name is a historical comment - and both rotors are plain round
robins. The same drive twice produces an identical lane sequence, which was
verified while checking the rocket lane against PRD R5.

v2 had one, and section 3d of `open-questions.md` records what it was: the free
running timer sampled on the sweep the player closed the fire contact, so *"the
machine's only randomness is the player's own rhythm"*. v3 removed it because PRD
R5 requires the rocket's lane to be **independent of the player's press pattern**
- v2's defect was that parking the lever made two lanes permanently safe.

**Those two requirements are not actually in conflict, and the distinction is the
design work.** The clause forbids the *rocket's lane* depending on press pattern.
It does not forbid the machine having an entropy source. A timer sampled at a
press can feed a plane's entry position without feeding the rocket rotor, which
stays a round robin.

Whoever implements this should read PRD lines 285-291 and section 3d together
before choosing a source, and should record which consumers read it - the v2
defect was one nibble read by four things, and the harm came from the sharing
rather than from the sampling.

## Order of work, and why

The **missile rank is first** and separately, because it is what makes the game
unplayable rather than merely unfaithful: 82% of fire presses are refused while a
shot is in flight, measured on the deployed build.

Speeding the missile instead does not work, and this is measured rather than
argued - at 125 ms a column or faster a defending player wins in 60-107 seconds
at every skill, which is the owner's other complaint from the same morning. Three
shots in flight give responsiveness without that, because each shot still takes
2.5 s to cross. **Responsiveness and difficulty are controlled by different
things, and one missile makes one knob do both jobs badly.**

The **jet model is second**, as one change: two planes, positions, anywhere,
sharing rows or columns, with the entropy question settled first. Capping the
current three-lane model at two would be throwaway work, because the model is
what is wrong.
