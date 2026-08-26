# The owner's account of what the machine tracks

Paths in this file are relative to the repository root.

**Owner testimony, given 2026-07-30 while playing the deployed build**, across
several messages as he watched both the emulation and the physical unit. It is
recorded here because it arrived faster than it could be implemented, and
because it describes a data model rather than a symptom - which makes it the
most reusable thing he has said about this machine.

**Both halves are now built, and one of the four defects below is not.** This
file began as a specification and is now largely a record. The status column is
the only part that should ever move - the owner's account is testimony and does
not change because the code caught up.

| Defect | Status |
| --- | --- |
| The missile rank - three shots, one per row | **CLOSED** |
| 1. Two planes can share a column | **CLOSED** |
| 2. Two planes can share a row | **CLOSED** |
| 3. A plane can appear anywhere on the board | **PARTLY CLOSED** - six entry cells, not fifteen |
| 4. A plane can change row mid-march | **NOT IMPLEMENTED. Nothing has been built for it.** |

One further defect was **found** by this work rather than closed by it: a plane
that spawns onto a live missile's cell is not hit by it - 6 of 30 spawn arrivals
in 88 coincidences, and 0 before grid 2 became an entry column. A settled plane
and a plane that marched on are hit every time (0 of 18 and 0 of 40). It is
`open-questions.md` section 14, and the owner has been asked.

## What can be on the glass at once

| Entity | This ROM today | The owner's account |
| --- | --- | --- |
| Player missile | **up to 3 in flight, one per row** - BUILT | **up to 3 in flight, one per row** |
| Planes | **2, at (row, column) positions** - BUILT | **2, anywhere** |
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

## The four things that broke the model, and where each stands

The headings are kept in the owner's own numbering. What follows each is what it
turned out to cost and whether it is closed.

**1. Two planes can share a column.** Different rows, same distance from the
launcher.

**CLOSED.** Two planes on one column are independently drawable and
independently hittable. `tools/probe/positioned-planes.test.ts` reaches the
arrangement by playing rather than by poking RAM, and floors the run against
producing it too rarely to mean anything.

**2. Two planes can share a row.** *"A plane can share a row also, I've seen it
in the physical game."* This is the one that matters structurally: `FILE_JETS`
held one nibble per lane and the nibble *was* the column, so two planes in one
row was not merely absent from the emulation, it was unrepresentable. Two planes
need a row and a column each - four nibbles.

**CLOSED, and the count was the owner's clue.** The squadron is two `(row,
column)` pairs at `FILE_JETS` 10-13; the lane rank is deleted and its nibbles are
free. The switch was atomic - no shadow write ever existed, because the two
models differ in *cardinality* and a shadow would have diverged silently the
moment a third jet existed. Every probe reads the pairs through one accessor,
`squadronMap` in `tools/probe/tms1370-probe.ts`.

**3. A plane can appear anywhere on the board.** Not only at the far column.
`jet_enter` wrote `GRID_COL_FIRST` and marched inward, so every plane entered at
the same place.

**PARTLY CLOSED, and the remaining part is deliberate.** `jet_enter` now draws
both the row and the column from the entropy nibble and the release count. Where
305 of 305 entries once landed on a single cell, all six reachable cells are now
drawn at 13.4% to 18.8% each, and the column gap between the two airborne planes
went from 66.0/34.0/0 to **47.4% / 44.2% / 8.4%** for gaps of 0, 1 and 2 - so
`assets/reference/device-front-gameplay.jpg`, two jets airborne at different
distances, is a picture this ROM produces. Re-derive with
`npx vite-node tools/probe/drives/entry-spread.ts`.

Six cells and not fifteen: entry is three rows by columns 1 and 2, the far half
of the field. The whole 1-5 range is not a fair draw, because an entry column is
a life expectancy - a plane entering on the capture line would be captured almost
immediately. The owner's words are testimony about **variety**, and nothing in
`assets/reference/` shows a jet appearing at the near end. Whether the unit's own
range is wider than two columns is unresolved.

**4. A plane can change lane mid-flight.** Owner testimony, added 2026-08-25 from
`assets/reference/jetfighters-video.mov`, watching the physical unit: **at most two
jets approach at once**, and as they march toward the launcher they change row -
not only their entry row, which point 3 already covers, but their row *during* the
march. This is additional to, not instead of, the (row, column) position model: it
means a plane's row is not fixed for the plane's lifetime, so whatever design
answers task 10's question (b) - what happens to every lane-indexed reader of
`FILE_JETS` - also has to answer "what moves a plane's row, and how often" once
positions replace the lane rank.

**NOT IMPLEMENTED, and nothing in the tag that built the position model went near
it.** A plane's row is written once, by `jet_enter`, and never changes again for
that plane's lifetime; `jm_move` steps the column alone. The position model is
what *makes* the change expressible - a row is a nibble a march step could now
write - but expressible is not implemented, and no probe in `tools/probe/` looks
for a mid-march row change or would fail if one never happened. What moves a
plane's row, and how often, is still undesigned. The missile rank is unaffected,
since it does not read a plane's row at all.

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

## "Randomly" - settled, and how

*"A plane can randomly appear anywhere on the board."*

**SETTLED. `NIB_ENT` is the entropy nibble and `jet_enter` is its only reader.**
The design below was followed: a nibble accumulating `NIB_TICK` on each fire
rising edge feeds the entry position and nothing else, and the rocket's rotor
stays a plain round robin, so PRD R5 holds. The one consumer is recorded in the
assembly in the terms this section asked for, and the paragraphs that follow are
the reasoning that produced it, kept as the record of how the choice was made.

**When this was written, the ROM had no randomness at all.** `NIB_RAND` does not exist in v3 - the only
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

**Historical. Both were done in this order and both are built** - the record of
the decision, not a plan.

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
