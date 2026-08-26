# Playability audit

Paths in this file are relative to the repository root.

Five gameplay defects were fixed and merged in one afternoon, each verified against the
specific defect that motivated it, one at a time, by the agent that wrote it. Nobody had
driven a whole game end to end afterwards. This is that drive: what the machine actually
does from power-on to an ending, rather than whether a suite goes green.

It exists because the report that started the work was **"this rework isn't playable"**,
and that is not a claim any of the five fixes answers on its own.

## The baseline every number here is pinned to

**Every measurement below was taken on `f3e0769`** - the tip of `main` at the time of the
audit, with the scoring fix of #121 and the ruler-census timeout of #123 in it.

Pinning matters more than usual here, because most of these figures are downstream of one
constant. **On `f3e0769`, `MISSILE_SWEEPS` is 2 - 28 ms a column.** A correction to
roughly 500 ms a column was measured on a separate branch and is *not* in this baseline.
When it lands, expect win times, kills by grid, jets steps per release and every survival
figure in section 1 to move. Nothing in this file should be quoted as current without
checking that constant first.

The lesson is its own finding, and section 8 records how it was learned: **once a branch
merges, `git show origin/main:<file>` stops being a pre-fix baseline.** Pin to a commit,
not to a branch name.

## A convention this file follows

`docs/evidence/open-questions.md` requires that a claim recorded as faithful must name the
states it was measured across, not just the numbers it produced, because prose has a
test's failure mode - passing over an empty set - and no way to go red.

Every claim below states its quantification. Where a result comes from a single drive it
says so and is not called faithful.

---

## 1. A competently played game cannot be lost - SUPERSEDED

> **Superseded. The finding was true of the build it was measured on and is no longer true
> of the machine.**
>
> **Why it was true:** `jm_capture` carried an undocumented lane condition - a jet reaching
> the G line cost a launcher only when it arrived in the lever's own lane, and crossings
> elsewhere were free. The player's own lane is the one he keeps clear by firing, and
> `rf_look` will not launch a rocket from an empty lane either, so **both loss paths closed
> together.** `open-questions.md` section 6 records that condition as removed on the owner's
> own ruling; it was still in the ROM, labelled `WITHDRAWN-RULE BUILD`, when this section
> was written. Every policy below was measured through it.
>
> **What the same policies do with the settled rule:**
>
> | Policy | As measured below | With a capture costing a launcher in any lane |
> | --- | --- | --- |
> | greedy | WIN 58-61 s, 0-2 hits | **OVER 25-55 s, three launchers, every skill** |
> | dodge | WIN 58-60 s, 0 hits | **OVER at skills 1 and 3**; WIN at 2 in 245 s |
> | **defensive** | **WIN 325-534 s, 87 rockets and none landing** | **OVER 163-207 s, three launchers, every skill** |
> | dodgeOnly | OVER 32-47 s | OVER 21-36 s |
>
> The defensive row was the load-bearing measurement of this whole audit - built precisely
> because every other policy ended too fast to sample anything - and it now loses every
> launcher at every skill.
>
> **The section is kept rather than rewritten**, because the reasoning below is how the
> extra shield was found: it was the anomaly of a game that could not be lost, chased
> across seven layers, that eventually produced the three instructions. The rocket findings
> in it also still stand - `rm_arrived` compares lanes only at arrival, and that test is
> correct and faithful. What is superseded is the conclusion, not the measurements.

**Measured across three play policies x three skill levels, plus a fourth policy at three
skill levels, all on `f3e0769`. Not a single drive.**

| Policy | Skill | Outcome | Time | Rockets fired | Rockets that hit | Launcher losses |
| --- | --- | --- | --- | --- | --- | --- |
| **greedy** - shoot the nearest target, never move otherwise | 1 | WIN | 58.0 s | 2 | **2** | 2 |
| | 2 | WIN | 60.3 s | 0 | 0 | 0 |
| | 3 | WIN | 60.5 s | 1 | **1** | 1 |
| **dodge** - shoot, and never stand in a live rocket's lane | 1 | WIN | 57.7 s | 2 | **0** | 0 |
| | 2 | WIN | 60.3 s | 0 | 0 | 0 |
| | 3 | WIN | 60.4 s | 1 | **0** | 0 |
| **defensive** - dodge, and shoot only what is about to capture | 1 | WIN | **533.7 s** | **26** | **0** | 0 |
| | 2 | WIN | **428.7 s** | **31** | **0** | 0 |
| | 3 | WIN | **325.3 s** | **30** | **0** | 0 |
| **dodgeOnly** - never fire, only avoid | 1 | OVER | 46.9 s | 2 | 0 | 3, all captures |
| | 2 | OVER | 38.7 s | 2 | 0 | 3, all captures |
| | 3 | OVER | 31.7 s | 2 | 0 | 3, all captures |

Every WIN above is the score reaching 199, which is the win condition; the exact figure a
probe reads back at the break varies by a point with where its last sample landed relative
to `add_score`, so the outcome is quoted rather than the readout.

**87 rockets were fired at a moving player across the three defensive games. None of them
landed.**

### Why this is a finding and not "the drive dodges too well"

The contrast between the first two blocks is the whole of it. **The same rockets that hit
a stationary player 2 times out of 2 at skill 1, and 1 out of 1 at skill 3, hit a moving
player 0 times out of 87.**

- The hit path is **not dead**: a player who does not move is hit by every rocket that is
  aimed at its lane.
- The loss path is **not dead**: `dodgeOnly` loses all three launchers in 32-47 s.
- It is specifically **competent play** that cannot be lost.

The defensive policy is the load-bearing row. The greedy and dodge policies win in about a
minute, which is too short to sample the rocket cadence at all - two rockets in a whole
game. Shooting only what is about to capture keeps the game alive for five to nine minutes
and produces a real sample of 87.

### What "competent" means here, and its limit

These policies are perfect and tireless. A person would sometimes be caught mid-move. The
finding is that **perfect avoidance is cheap and always available**, not that a human
would never die.

### One thing that is working

Skill matters once the game is played rather than speed-run. The defensive games run
**534 / 429 / 325 s at skills 1 / 2 / 3** - a clean monotone spread, because that policy
lets jets march and march speed is what the dial controls. The dial was invisible in the
greedy and dodge rows only because nothing survived long enough to march.

---

## 2. The mechanism, and why it is independent of missile speed

`rocket_move` steps the rocket inward and, at `rm_arrived`, compares the rocket's lane to
the lever's lane **only once, at the launcher line**:

```
rm_arrived:
        TCY  NIB_RLANE
        TMA
        TCY  NIB_LANE
        MNEA                    ; status = the launcher is in some other lane
        BR   tr_done
```

There is no penalty for standing in the lane at any point during the flight, and the
flight is about 0.7 s at `ROCKET_SWEEPS` = 7, 97 ms a column. The rocket is drawn in its
lane for that whole time. So the entire defence is *be somewhere else when it lands*, and
the player is told where it will land for the whole approach.

**This is why the finding survives the missile-speed correction.** It is a property of the
arrival test's timing, not of anything upstream of it, so a branch that changes
`MISSILE_SWEEPS` will not change it. Two agents measured invulnerability independently on
two different ROMs - this baseline with the fast missile, and the corrected branch with
the slow one - and got the same answer.

### This hit test is probably faithful, and should not be "fixed" on the strength of this file

On the physical machine a rocket descends a lane and takes the launcher when it reaches
it; moving out of the lane is how a player survives. `rm_arrived` comparing lanes at the
launcher line is what that looks like in code. **The suspect quantity is how often rockets
come and how avoidable their lanes are, not the arrival test itself.**

Two measured facts make avoidance cheap even before skill enters into it:

- **Rockets are rare.** `ROCK_HI_BASE` gives 768 sweeps at skill 1, about 11.7 s, and only
  about 26 arrived in a nine-minute game.
- **Most need no dodge at all.** At skill 1 the dodging policy made **9 dodges against 26
  rockets**. The other 17 arrived in a lane it already was not in. The player is safe two
  thirds of the time by accident.

And the capture threat never forces a choice: one missile in flight was sufficient to stop
every jet reaching the G line across 534 s, so the player is never made to choose which
threat to answer.

`CLAUDE.md` puts every gameplay rule in the PRD and requires an ambiguous one to be
checked against `assets/reference/` before behaviour is invented. **This section is a
measurement, not a proposal.**

---

## 3. What the reference says, and the discrepancy

`assets/reference/sprites/README.md` records **the red mark at the launcher** -
`video/player-hit-lane{0,2}.png`, a red-orange bar at cell 6, the launcher's own cell -
as **4 episodes and 68 sightings** over the 407.9 s gameplay recording, each sitting
inside a long whole-display blank, which is the signature of a long sound.

| | Launcher hits | Over | Rate |
| --- | --- | --- | --- |
| **Real unit, recorded play** | **4** | 407.9 s | about 1 per 102 s |
| This baseline, defensive policy | **0** | 325-534 s, 87 rockets | never |
| This baseline, dodge policy | **0** | 58-60 s | never |
| This baseline, greedy policy | 2 | 58 s | about 1 per 29 s |

**The recorded player was hit. A competent player on `f3e0769` cannot be.**

Three caveats belong to that number and not to a footnote:

1. **The 4 hits span at least two games.** Three hits ends a game, so 4 is a lower bound
   spread across two or more.
2. **The recorded player's skill setting is unknown.** The recording does not show the
   dial.
3. **The mark's identity is inference, not proof.** No frame catches the transition from a
   lit launcher to the mark, because it happens inside the display blank. The sprites
   README states this itself: "The shape and placement are established; the name is
   inference."

---

## 4. Rocket cadence on the real unit: `undriven`

**This cannot be measured from the evidence in the repository, and an invented figure
would be worse than the gap.** Recorded here so the next person does not spend the time
discovering it again, or worse, fill it in.

**The audio cannot answer it in principle.** The ROM emits four sounds - missile fire,
march, launcher-hit warning, and the win/loss pair. **`rocket_fire` emits none of them**,
and no rocket-launch sound is documented for the physical machine either. There is nothing
in the recording to count.

**The video's only candidate fails its own identity test.** The "attacker's colon" is 87
detections in 48 episodes over 407.9 s, which would be one launch every 8.5 s if it were
the rocket. It should not be read that way:

- 60 of the 87 detections occur in frames with no lit jet in that lane, which the sprites
  README calls "equally consistent with a segment lit while the jet's own segment is dark".
- Direction of travel could not be established.
- Its cell distribution is **2 / 7 / 13 / 43 / 0 / 22**. **Zero detections at cell 4**,
  between 43 at cell 3 and 22 at cell 5. A projectile crossing the field does not skip a
  cell in the middle of its path.

**What would settle it**: re-running the video frame log for the red launcher mark and for
the colon at a lower detection threshold. That needs the gameplay recording, which is not
in the repository - the same gap that already blocks the measured-timings table in
`docs/evidence/timing-analysis.md`.

---

## 5. A calibrated launcher-hit detector, and what it could not do

Reusable, and the calibration is the point.

A band detector over **455-545 Hz** - `launcherHitWarning.dominantHzRange` from
`docs/evidence/audio-reference.md` - probing at 455 / 480 / 500 / 520 / 545 Hz over 30 ms
windows at a 10 ms hop.

**Calibrated before use, against the two events already documented in
`loss-audio.m4a`.** It recovers both as the two strongest moments in the file:

| Detected | Documented | Strength |
| --- | --- | --- |
| **27.94 s** | ~27.4 s, launcher-hit warning | 1.25e-2 |
| **86.16 s** | ~85.86-86.99 s, loss sound | 8.29e-3 |
| 13.77 s | not documented | 3.49e-3, **2.4x weaker than the second real event** |

Two documented events, two clear top detections, and a real gap to everything else.

**It could not discriminate on `gameplay-audio.m4a`, and that is stated rather than
worked around.** The eight strongest moments in that file, between 56 s and 114 s, all sit
at **2.0-2.6e-2** - *above* the genuine warning in the loss recording at 1.2e-2 - with no
structure distinguishing them. That is continuous in-band energy, most plausibly leakage
from the 627 Hz march beep at the 33 Hz bin width of a 30 ms window, not discrete events.

**So it is not known whether the owner was hit during the game he won.** The absence of a
clean detection is not read as an absence of hits. A detector that cannot resolve the
signal and a machine that produced no signal look identical, and only one of them is a
finding.

---

## 6. End-to-end behaviour on `f3e0769`

### It plays, and it is not yet a game

Power-on is clean: RAM cleared, first lit cell at 21.9 ms, nine cells lit, no garbage on
the glass. Jets release and march, missiles fly, targets die, the score accumulates and
carries, and both endings fire.

**Measured across three skill levels with the greedy policy**, the game is won in about a
minute every time - 58.0 / 60.3 / 60.5 s - and across a whole game at skill 1 there were
**55 jet releases and 4 jet steps.** The march, which is what the game is about, is
essentially never seen. At 28 ms a column a missile crosses the field in 0.25 s against a
2438 ms march period.

### The merged fixes, confirmed together in one drive

| Fix | Status on `f3e0769` | Measured |
| --- | --- | --- |
| March cadence, 160 sweeps | Holds | 2.51 s between steps against 2438 ms nominal; the +3% is sounds stopping the sweep, which the ROM comment predicts |
| March direction | Holds | grid 1 (far, battleship side) to grid 5 to capture, consistently |
| Distance scoring 3/2/1, battleship 10 | Holds | every kill paid the ruler value for its column; kills landed on the aimed column |
| Hundreds carry | Holds | observed directly: `99 -> 102 (+3)` |
| Missile speed | **Not in this baseline** | `MISSILE_SWEEPS` = 2 |

Two further constants agree with their own documented measurements: **battleship onset to
onset 19.8 s** against the ROM's measured 19.7 s and the recording's 19.80 s, and **march
intervals 2.47-2.53 s** in steady state.

### Three reported defects, characterised rather than fixed

**Measured across both ending paths, observing 40 s past each ending.**

| Reported | On `f3e0769` | Evidence |
| --- | --- | --- |
| Far-right game-over lockup | **Does not reproduce** | After OVER: 2604 sweeps in 40 s = 65.1/s against 65.6/s nominal. Display refreshing, state stable, loss sound plays |
| 199-win freeze | **Does not reproduce** | After WIN: 2659 sweeps in 40 s = 66.5/s. Score holds at 199, win jingle plays |
| Bullets passing through far-stage jets | **Not at the far stage. Yes at the near one** | Grid 1 is the best column at 89% of aimed shots killing there. **Grid 5 is 0 kills from 35 shots** |

The third appears to be about **grid 5, the cell against the G line**, not the battleship
end: `fire_missile` places the missile on `GRID_COL_LAST` and `missile_step` decrements
before it hit-tests, so the launch cell is drawn and never tested. Independently measured
at 0 of 12 by another agent and 0 of 35 here.

**Both non-reproductions are headless observations of pins and RAM.** If either report is
about the rendered page, nothing in this audit speaks to it.

### A latent hazard the missile correction may expose

Missile and jet close on each other in discrete steps, so they can swap cells without ever
sharing one - the classic crossing miss.

**Measured: 0 crossings in 249 missile flights, across three skill levels.** The detector
was live rather than vacuous: the same code saw 407 samples with missile and jet on the
same column.

It does not happen on this baseline only because a 0.25 s flight almost never spans a
2.4 s march step. **At 500 ms a column the flight becomes comparable to the march period,
and a mid-flight step goes from rare to routine.** That is a prediction to test on the
branch that makes the change, not a defect today.

---

## 7. The rotor, against PRD R5

PRD v3 requires that `rocket_fire`'s lane come from "a source independent of the player's
press pattern", so as not to inherit v2's defect in which the lane came from `NIB_RAND` -
the free-running timer as the player's last press latched it - leaving two of three lanes
permanently safe.

**The clause is satisfied, and more thoroughly than it asks. `NIB_RAND` does not exist in
this ROM.** The only occurrence of the name in `asm/jetfighter.asm` is the historical
comment describing the v2 defect. `NIB_ROTOR`, the rocket's lane, is a round robin
advanced by the routine that owns it, with nothing on the input path touching it - which
is the half of the clause that matters, and contract criterion V7 is the test that
catches it if it stops being true.

**Jet entry is the deliberate exception, and it reads the entropy nibble by design.**
`NIB_J_ROTOR` is retired: from task 14 `jet_enter` takes the entry row from
`(NIB_J_SENT + 1 + NIB_ENT) mod 3` and the entry column from that nibble's top bit, so
where a plane appears does depend on the player's press pattern. That is the point - the
owner reports that a plane can appear anywhere on the board, and the machine has no other
source of variety. What v2 got wrong was **sharing** one such nibble between four
readers, so a parked lever made two lanes permanently safe; `jet_enter` is `NIB_ENT`'s
only consumer and `entropy-nibble.test.ts` counts the sites.

**Measured across four press patterns at skill 1:**

| Press pattern | Rocket lanes observed |
| --- | --- |
| Never fires | 1, 2 |
| Fire every 1.0 s | 1, 0, 2, 1, 2, 0, 2 |
| Fire every 2.7 s | 1, 2, 0, 0, 0, 1, 0 |
| Fire every 5.3 s | 0, 2, 0, 1, 2, 0, 1, 2, 2, 1 |

All three lanes appear in every pattern sampled long enough to show them. **No lane is
ever permanently safe**, which is the property v2 lost. The sequences differ between
patterns only because the rotor walks past lanes with no jet airborne, and which lanes
hold jets depends on what the player has shot - state dependence, not press-pattern
dependence.

**The sequence is nonetheless completely predictable**, because it is a deterministic
round robin and this ROM has no entropy source at all. Running the same drive twice gives
an identical lane sequence. In practice prediction is not needed anyway: section 2's
mechanism means the rocket announces its lane for its whole flight.

### A consequence for `open-questions.md` section 3d

That section says "The machine's only randomness is the player's own rhythm" and lists
`NIB_RAND` as read in four places, one of them the rocket lane and one the squadron
rotor's start. **None of that is true of the v3 ROM**, which has no `NIB_RAND` and
therefore no randomness whatsoever - not even the player's rhythm.

Section 3d is cited elsewhere as live evidence. It is left untouched here to avoid
colliding with work in flight on that file; the cross-reference is expected to be added
from that side.

---

## 8. Four probe bugs, and why they are recorded

Every measurement in this file came from a throwaway probe. **Four of those probes were
wrong before they were right**, and the pattern is worth more than any single number here:

| Bug | What it produced |
| --- | --- |
| Score read while `add_score` was mid-write | A phantom `-9` delta. `NIB_SC_U` is written and `NIB_SC_T` four instructions later; a sample landing between reads 19 as 10 |
| State check skipped by the score branch's `continue` | **The win was never logged.** The probe reported "no ending" while the state nibble read `ST_WIN` |
| Score left stale while not tracking a shot | **"0 kills at grid 1"** - a spectacular false negative on a column that in fact kills reliably |
| Fire deadline recomputed every sample | Zero shots in a 150 s drive; the deadline outran the clock forever |

**Two of the four invented a defect. Two produced silence.** Every one was caught by a
number disagreeing with something already known - not by any check in the repository.

### A fifth, in the verification rather than the probe

A check that a scoring assertion still failed against the pre-fix ROM returned **10 of 10
passing**, which is exactly what a suite gone blind looks like. It had not gone blind. The
check diffed against `origin/main`, and `origin/main` had moved: the fix had merged
mid-check, so the "pre-fix" ROM being tested already contained the fix. Against the commit
before the fix, the same suite failed 3 of 10, as intended.

**Once a branch merges, a branch name stops being a baseline.** Worse, the failure is
silent and its polarity is arbitrary - here it reported a healthy suite as blind, and with
the comparison the other way round it would have reported a blind suite as healthy. Any
fail-on-defect check should name a commit.

Two things follow.

**A one-off exploratory number is not a finding until something independent agrees with
it.** That applies to every number in this file that is not cross-checked, and to numbers
produced by anyone driving this machine ad hoc.

**This is the argument for assertions living in the suites.** The probes that produced
these bugs had no precondition guards; the suites do, and the one place in this work where
a guard existed - a census drive asserting it had scored enough to be worth reading - is
the one place a machine-dependence problem announced itself with its cause attached
instead of as three unexplained downstream counts.

---

## 8b. The ghost layer, and the one constant nobody has measured

The owner confirmed the departure report - *"yes the three boats appear briefly on
departure"* - after sections 1 to 7 had concluded the machine cannot produce it. What
follows is where that left the question.

### The machine really cannot, now traced rather than sampled

Section 6's ruling-out rested partly on a record that turned out to be sampled (see
section 8). Re-done without that hole:

- **Every completed frame**, interval-based so a plate lit for a single cycle still
  registers: **0 frames of 3701 with two or more grid-0 plates in any family.**
- **Instruction by instruction**, three departures, on a *played* game so a missile, a
  rocket and a burst had all used the shared render scratch first: **the most plates ever
  selected on grid 0 in one family is 1.**
- The kill path likewise: exactly one burst segment, throughout every burst.

`rd_bship` skips the draw entirely when the lane reads `BS_NONE`, `lane_bit` returns
exactly one of 1 / 2 / 4, and `rd_bs_draw` stores rather than ORs. On a departure sweep
grid 0's nibbles are never written at all.

### Three visible marks does not need three lit segments - but the arithmetic still says no

The renderer composes a **ghost layer under everything, at a constant alpha, for every
segment in the atlas including all three battleship positions**. So the third position is
never dark, and three marks needs only two phosphor-lit segments rather than three.

Composed exactly - background, ghost at `GHOST_ALPHA`, then the active layer source-over,
which is skipped below `MIN_VISIBLE_BRIGHTNESS` - in Rec.709 luminance:

| Display | Row 1 | Row 2 | Row 3 | 2nd row lift over ghost |
| --- | --- | --- | --- | --- |
| 60 Hz | 13.1 | 13.1 | 13.1 | 0% |
| 120 Hz | 155.3 | 14.3 | **13.1** | 9% |
| 144 Hz | 153.1 | 15.7 | **13.1** | 20% |
| 240 Hz | 139.0 | 24.9 | **13.1** | 90% |

Ghost-only is 13.11 and fully lit is 157.28, a ratio of 12. **The third row is exactly
13.11 at every refresh rate - it is never lifted by anything.** So the composed picture is
one bright mark, one marginally lifted, and one untouched. At 120 Hz the lift is 9%.

**The trail is refresh-rate dependent, and at 60 Hz it is not drawn at all.** The lane
just vacated decays over about 12 ms, so a faster display samples that decay where a
slower one steps over it: the trailing segment's brightness runs 0.0001 at 60 Hz, 0.0114
at 120, 0.0241 at 144, 0.1068 at 240. **At 60 Hz that is below
`MIN_VISIBLE_BRIGHTNESS = 0.004`, so the active layer skips the segment entirely** - not
dim, not drawn. Every measurement in this repository was taken at 60 Hz.

### What is actually worth checking next

**The ghost matrix is faithful in kind.** `assets/reference/readme-real-tube.jpg` plainly
shows unlit segments as a visible grey matrix - faint jets in every cell across all three
rows, alongside the two or three bright sprites. **"All ships on all rows" is this
machine's normal appearance, on the real unit as much as ours.**

So the open question is not whether three boats can be seen. It is:

> Are the three marks *brighter* than the faint ships that are always visible, or are they
> those same ships becoming *noticeable* when the bright one goes out?

**If the answer is "brighter", `GHOST_ALPHA` is the first place to look, and it has never
been measured.** `src/machine/tube/palette.ts` documents it as *"a judgement call tuned by
eye"*, inherited from v1's single neutral `rgba(120, 120, 120, 0.08)`, with the alpha kept
and only the colour made per-region. Nothing in `docs/evidence/` calibrates it, and
`vfd-appearance.md` says nothing about ghost prominence.

**A calibration attempt was made and its output is not recorded here, deliberately.**
Sampling patches from `readme-real-tube.jpg` returned a *lit* orange jet at 1.1x the plain
dark screen, which contradicts what the photograph obviously shows, so the patches were
misregistered and every figure from that pass is unusable. Doing it properly needs the
per-row frame-rail registration that `layout.ts` used for the ruler - the photograph is a
hand-held phone shot through a tinted filter, and absolute luminance in it is dominated by
exposure rather than by the tube.

**One caution for whoever does it.** `docs/evidence/timing-analysis.md`'s method section
records that camera drift across that clip is 28 px in y, two thirds of the lane pitch, so
a lane band fixed in frame coordinates mixes lanes and one jet straddling a boundary reads
as *a pair of sprites in adjacent lanes at the same column* - an artefact that pass came
close to recording as a finding. This project has produced the "one sprite in two lanes"
percept once already, from an instrument rather than from the machine.

---

## 9. What this audit did not cover

Named because a drive that never arrives and a drive that arrives and finds nothing are
indistinguishable in a summary.

- **Nothing above `src/machine/`.** No renderer, no case shell, no input layer. If "not
  playable" is partly visual, this audit does not speak to it at all.
- **Audio was counted as speaker edges, not pitches.** No sound's correctness was checked
  here; that is `docs/evidence/audio-reference.md`'s subject and #122's.
- **No power-off-then-on cycle.** Every machine was powered on once. The off-invalidate-on
  path is untested here.
- **No mid-game skill change**, no lever between detents, and no simultaneous contacts.
- **The thin-out speed-up ladder was not measured.** Nine wave resets were observed, but
  cadence against squadron size could not be read because jets die before the ladder
  becomes visible on this baseline.
- **Rocket flight length was not characterised.** `rf_fire` starts the rocket from the grid
  the firing jet stands on, so how much warning a player gets varies with how far the
  squadron has advanced. That distribution is unmeasured.
- **The rotor was not tested across a wave reset or a capture**, only within continuous
  play.
- **Grid 5's scoring value remains unobservable** while a missile cannot reach that cell.
  `tools/probe/scoring-ruler.test.ts` asserts it and will begin checking it on the first
  run after the missile path changes.
- **The colon and red-mark figures in sections 3 and 4 are quoted** from the sprites
  README's whole-file pass and were not re-derived, because the recording is not in the
  repository.
- **Idle drives were run at skills 1 and 3 only**; the greedy, dodge, defensive and
  dodgeOnly policies were run at all three.

---

## 10. Handover: what is left on the capture-rule branch, and what to try

Written at the point the branch was handed over, so the next person does not have to
reconstruct it from a conversation. **State at handover: 3 failing tests**, `ea3a663`.

### The V7 decision, which settles three of the three

`tools/probe/tms1370-rom.test.ts`'s *"flies a rocket down every one of the three lanes"*
is contract criterion V7. Its drive deliberately **never fires**, and it can no longer
survive: measured, it reaches lane `[1]` only, at every skill.

**The test conflates two claims, and separating them is the fix.**

- **Claim A - rockets reach all three lanes.** Needs a drive that survives, which since
  the settled capture rule means a drive that *shoots*.
- **Claim B - the rocket's lane does not depend on the player's press pattern.** This is
  what V7 exists for, and **a single no-fire run was never a good test of it**: one press
  pattern, even the empty one, cannot falsify dependence on press patterns.

**Claim B is already tested properly elsewhere.** Four press patterns - never fires, every
1.0 s, every 2.7 s, every 5.3 s - all reach all three lanes, and the sequences differ by
*which lanes hold jets* rather than by press phase, because `rf_look` only stops on an
occupied lane. That is a real falsification; see section 7.

**So: let a surviving, firing drive carry Claim A, and assert Claim B from the
multi-pattern evidence** - by moving that check in, or by citing it. Neither claim is
weakened. They stop being asserted by one drive that could only ever support one of them.

**Why the old premise looked sound, which is the instructive part.** The drive's own
comment explains that dodging worked because *"an arrival in the lever's own lane is a
capture while an arrival elsewhere flies past"* - so a never-firing lever survived
precisely because two lanes cost it nothing. **The drive was built on the undocumented
lane guard.** Someone measured the guard's effect in the other direction and tuned to it:
*"charging a launcher for the crossings that used to go uncharged shortened that run by
9 s."* They saw it, quantified it, and took it for the machine.

That is the sixth consequence of those three instructions, after a free capture, a rocket
path that read as untested, an assertion passing by timing luck, an invulnerability
finding that overstated its case, and a measured constant 23% too long.

### The three failing tests

| Test | Diagnosis | What to try |
| --- | --- | --- |
| `tms1370-rom` - flies a rocket down every one of the three lanes | Never-firing drive cannot survive the settled rule; reaches lane `[1]` only | Split Claim A from Claim B as above |
| `tms1370-rom` - sounds the battleship as a continuous buzz | No crossing completes before the game ends | Give the drive the defending policy already in that file |
| `scoring-ruler` - still pays the battleship its ten | Census dies before it can shoot a boat | Same policy; the boat also has to be **led**, which that file's round-robin arm already documents |

**All three want the same thing: a drive that survives long enough to see a battleship
crossing.** They are one problem, and letting a drive fire is what buys the survival - so
the V7 ruling settles the approach for all of them.

### Two things already tried, so nobody repeats them

- **Skill 3 for the rocket rotor does not help, it hurts.** Rockets come three times as
  often at skill 3, but the game ends 40% sooner, so the rotor gets *less* far: measured
  `[1, 1]` at skill 1 in 36.2 s, `[1]` at skill 2 in 28.5 s, `[1]` at skill 3 in 21.8 s.
- **Caching the conformance guard's decision for eight sweeps is worse than reading every
  sweep.** It played badly enough that the search fell through most of the scenario space:
  49 s became 246 s and timed out three unrelated files.

### Already done, despite appearing on earlier lists

`playability-audit.md` section 1 is superseded in place, the tap-to-win margin is
re-derived and recorded at the assertion, and the PR body is written. The explicit
timeouts it quotes are **`SEARCH_BUDGET_MS = 240_000`** in
`tools/probe/rom-atlas-conformance.test.ts` and **`DRIVE_TIMEOUT_MS = 60_000`** in
`tools/probe/scoring-ruler.test.ts`.

### One thing to re-derive when the missile rank lands

`STEP_HI_MAX`'s comment carries a played-to-nominal ratio of **1.18**, measured on this
ROM. It is a function of how much sound a game makes, and a rank of three shots in flight
raises that. **The ratio must be re-derived then**, and the constant's own comment says so.
