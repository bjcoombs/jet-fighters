# Two planes as (row, column) pairs

Paths in this file are relative to the repository root.

This is the design `v3-entities` task 10 requires, and it gates tasks 11-14 and
16: no jet implementation task may start without it. It answers seven concrete
questions against the code as it stands after the missile rank landed (`main` at
PR #146), not against the code as the survey found it.

## What the owner described, and what the ROM does

`docs/evidence/owner-entity-model.md` records the testimony. The three claims
this design has to make representable:

1. **Two planes can share a column** - different rows, same distance from the
   launcher.
2. **Two planes can share a row.** This is the structural one: `FILE_JETS` holds
   one nibble per lane and the nibble *is* the column, so two planes in one row
   is not merely absent from the emulation, **it is unrepresentable**.
3. **A plane can enter anywhere**, not only at the far column.

A fourth arrived later, from a video of the physical unit (2026-08-25):

4. **A plane changes row mid-flight**, not only on entry. So a plane's row is not
   fixed for its lifetime, which point 3 alone does not cover.

The count is the clue, and it is the owner's own inference: *"the max two planes
hints at how it's managing its nibbles."* Two entities at two nibbles each is
four; three lanes at one nibble each is three. The current model is cheaper *and*
cannot express what he sees. A machine that tracks two planes as positions is
paying for generality it must have had a reason to buy.

---

## (a) The RAM layout

**Four nibbles, contiguous, at `FILE_JETS` 10-13.**

```
FILE_JETS  10  plane 0 row     (0..2, the lane)
           11  plane 0 column  (1..5 on the playfield, 0 = slot empty)
           12  plane 1 row
           13  plane 1 column
```

Indexed as `base + 2 * plane`, so a walk over the two slots is one `A2AAC` and
needs no lookup - the same property that made the missile rank cheap, where the
nibble index *is* the lane.

**Why not `FILE_STATE` 5-6, which `owner-entity-model.md` line 38 names.** That
reservation was written when those two nibbles were the only free ones in sight.
They *are* free now - `NIB_MCOL` and `NIB_MLANE` used to live there and the
missile rank deleted both - but taking them would split the four nibbles across
two files, and every walk would then pay an `LDX` per plane instead of an
increment. `FILE_JETS` 10-15 are free and contiguous, which is strictly better.
**Record `FILE_STATE` 5-6 as free rather than reserved**, so a later task does
not treat them as spoken for.

**Why not reuse `FILE_JETS` 0-2**, which collapsing the lane rank frees. It works
and it is tempting, but it makes the shadow in task 11 impossible: the old rank
and the new positions have to coexist for one task, and they cannot if they
occupy the same nibbles. Use 10-13; delete 0-2 in task 12 and leave them free.

Current occupancy for reference - `FILE_JETS` 3-9 are `NIB_J_SENT`, `NIB_J_WORK`,
`NIB_J_LOST`, `NIB_J_MOVED`, `NIB_J_TMP`, `NIB_J_SCR`, and 14-15 stay free.
Nibble 4 was `NIB_J_ROTOR` and is free from task 14: it existed only to step the
entry row one place per entry, which is what `NIB_J_SENT` at nibble 3 already
does, so `jet_enter` takes the rotation from the release count.

---

## (b) Every lane-indexed reader of `FILE_JETS`, and what happens to it

There are **37 `LDX FILE_JETS` sites**. Most address the housekeeping nibbles
(3-9) and are untouched by this change. The ones that read a *jet* by lane, and
therefore assume jet-per-lane, are:

| site | what it does | what it becomes |
| --- | --- | --- |
| `mw_live` (P_HIT) | `TMA / LDX FILE_JETS / MNEA` - the LEAVE test | must compare the shot's (lane, column) against **each plane's (row, column)** |
| `mw_arrive` (P_HIT) | same, after the step - the ARRIVE test | same |
| `mw_kill` (P_SPARE) | clears `FILE_JETS[lane]` | must clear **the plane slot that matched**, not a lane |
| `jm_step` / `jm_lane` / `jm_lane_next` / `jm_lane_done` (P_JETS) | the march, walked by lane | walked by plane slot |
| `jm_capture` | the capture test | reads a plane's column, not a lane's |
| `jet_release` / `jet_enter` / `je_try` / `je_wrap` / `je_look` / `je_busy` / `je_place` (P_SPAWN) | finds a free lane and places a jet | finds a free **slot** and places a plane at a position |
| `rf_empty` (P_ROCKET) | the rocket's lane choice skips empty lanes | must ask "is any plane in this row" rather than "is lane N occupied" |

**The collision test is the load-bearing one and it does not survive a rename.**
Today `mw_live` reads `FILE_JETS[the shot's lane]` and compares it to the shot's
column - one nibble, one comparison, because a lane holds at most one jet. With
two planes at positions, *both* planes can be in the shot's row, so the test
becomes a loop over two slots comparing row **and** column. That is two
comparisons per shot per half of the LEAVE/ARRIVE pair, and the missile walk runs
over three lanes, so the cost is per-lane-per-plane.

`tools/probe/missile-rank.test.ts` already asserts zero pass-throughs per lane on
both halves, proved against two ROM mutants. **It is the guard for this change**
and must stay green through task 12; if it goes red there, the collision test was
rewritten wrongly, not the test.

---

## (c) `jet_march` and `jm_capture`

`jet_march` marches a squadron by lane on one shared countdown. **The countdown
does not change.** The 205 ms squadron-step figure at `FILE_JETS`' header is
measured (n = 21, sd 22 ms) and it is a *squadron* rate: three independent
countdowns would produce a beep rate no recording supports. One countdown, two
slots.

`jm_capture` tests whether a jet crossed the G line. After the settled rule -
*a capture costs a launcher in any lane*, `open-questions.md` §6 - it no longer
reads the lever's lane at all, so it needs only to read a plane's column instead
of a lane's. This is the cheapest of the conversions.

**Point 4, the mid-march row change, lands here.** A plane's row is a nibble the
march can write, so changing row is a write to `FILE_JETS[base + 2*plane]`. The
open question is *what decides it* - a rotor, the entropy nibble, or a fixed
alternation - and that is a task-12 decision, not a layout one. It must not read
the entropy nibble: see (g).

---

## (d) `rd_jets`

`rd_jets` walks `NIB_RBIT`/`NIB_RLNE` per lane and adds into the near group's
eight subsets. Two facts make this the easiest conversion in the list:

- **The near group already holds all eight subsets** specifically because three
  lanes can stand in one column (the comment at the head of the walk), so two
  planes in one column need no new PLA slot. `O PLA slots declared: 31 of 32`
  must not move.
- **The walk already ADDS rather than overwrites**, so two planes in one column
  sum correctly by construction.

Carry the bit-then-lane warning forward **verbatim**: `NIB_RBIT` is 11 and
`NIB_RLNE` is 12, `TCMIY` steps Y up, and writing them the other way round lands
the second store in nibble 13 which nothing reads. That fault made the atlas
conformance suite go **greener** rather than red, which is why it is the nastiest
one in this file.

Note the missile rank's own render walk went the other way - task 4 replaced a
loop with three straight-line arms because a loop cost ~15 instructions per lane
of bookkeeping and would not fit the sweep budget. **Two slots is not three
lanes**, so a two-arm unrolled form is the likely shape here too. Measure before
choosing.

---

## (e) What still assumes three lanes

`LANE_COUNT` = 3 has four uses, and **three of them stay**:

| site | assumes | verdict |
| --- | --- | --- |
| `jet_enter` (`TCMIY LANE_COUNT`) | three lanes to try before giving up | **changes** - it becomes two slots to try |
| `rocket_fire` (`TCMIY LANE_COUNT`) | the rotor wraps at three | **stays** - the rocket still flies down one of three rows |
| the render walk (`YNEC LANE_COUNT`) | three rows to draw | **stays** - the tube has three rows whatever occupies them |
| the battleship's lane test | the boat descends three rows | **stays** |

**The playfield is still three rows.** What changes is that a row is no longer a
*slot*: rows are geometry, planes are entities, and the two stop being the same
thing. That distinction is the whole design.

---

## (f) Which page

Chapter 0 free space, measured on `main` after #146:

```
P_SWEEP  (ch0 p0)  33/64  31 free
P_ROCKET (ch0 p11) 38/64  26 free
P_SPARE  (ch0 p14) 44/64  20 free
P_SPILL  (ch0 p12) 45/64  19 free
P_HIT    (ch0 p7)  50/64  14 free
```

**`P_SPARE` is no longer empty** - tasks 3 and 6 put `bship_kill` and `mw_kill`
there, and the survey's claim that it is "entirely free" is stale. The largest
free page in chapter 0 is now `P_SWEEP` at 31 words, then `P_ROCKET` at 26.

**And the budget is genuinely tight now.** Across all 32 pages the maximum is
`P_STROBE` at **64/64** with chapter 1 pages 1 and 2 at 63/64. Task 15 needed two
spare words and used exactly two. Any task here that needs more than ~20
contiguous words must plan its page before writing code, not after the assembler
refuses.

**The sweep-cycle ceiling binds harder than the word budget.**
`sweep-timing.test.ts` requires the mean silent sweep keep
`CYCLE_HZ_MAX / meanSilentCycles > 72.5`; its own comment says *"920 cycles is
all it takes for `fastest` to fall through 72.5"*. Current mean is ~914, so there
are about six cycles of headroom. The march runs every sweep. **A per-sweep cost
increase in `jet_march` is the most likely way this work breaks the tube**, and it
will not show up as a word-count problem.

---

## (g) The entry position, and the nibble it must not share

`NIB_ENT` (`FILE_MISS` nibble 6) landed in task 9. It accumulates `NIB_TICK` on
each fire rising edge. `jet_enter` is its **single consumer**, from task 14,
deriving both the entry row and the entry column from it - a test asserts
exactly two sites in the whole program, the write in `if_down` and that read,
and names the two routines they must sit in.

The row is `(NIB_J_SENT + 1 + NIB_ENT) mod 3` and the column is
`GRID_COL_FIRST` plus the nibble's top bit. Both halves of the row are
load-bearing: the release count supplies a rotation that never repeats a row on
consecutive entries when the player is quiet, and the nibble supplies the
offset. **A zero nibble has to mean the far end**, because that is the state a
machine nobody has fired at is in, and a draft with that polarity reversed gave
the quietest player the shortest game.

**The rocket's rotor must never read it.** PRD lines 285-291 require the rocket's
lane to be independent of the player's press pattern, and contract criterion V7
is the test that catches it - v2's defect was one nibble read by four things, and
*the harm was in the sharing rather than in the sampling*
(`open-questions.md` §3d). `NIB_ROTOR` stays a plain round robin.

The same applies to point 4's mid-march row change: if it needs variety, it needs
its own source or a deterministic rule, **not** a second read of `NIB_ENT`.

---

## Order, and what each task owes

| task | lands | must stay green |
| --- | --- | --- |
| 11 | the four nibbles + a shadow write, no behaviour change | everything; word count moves, behaviour does not |
| 12 | march, capture, spawn and **collision** against positions; deletes the lane rank and the shadow | `missile-rank.test.ts` - it is the collision guard |
| 13 | `rd_jets` draws two positioned planes | `rom-atlas-conformance`, and `O PLA slots declared: 31 of 32` |
| 14 | entry position from `NIB_ENT`, sole consumer | V7 - the rocket's lane must not have moved |
| 16 | rebase the probe suite; re-drive the criteria | all of it |

**Task 11's shadow is what makes 12 reviewable.** The old rank and the new
positions coexist for exactly one task, which is why the new nibbles are at 10-13
rather than reusing 0-2.
