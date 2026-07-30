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

The lesson is its own finding, recorded in section 7: **once a branch merges,
`git show origin/main:<file>` stops being a pre-fix baseline.** Pin to a commit, not to a
branch name.

## A convention this file follows

`docs/evidence/open-questions.md` requires that a claim recorded as faithful must name the
states it was measured across, not just the numbers it produced, because prose has a
test's failure mode - passing over an empty set - and no way to go red.

Every claim below states its quantification. Where a result comes from a single drive it
says so and is not called faithful.

---

## 1. A competently played game cannot be lost

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
comment describing the v2 defect. Both rotors - `NIB_ROTOR` for rockets, `NIB_J_ROTOR` for
jet entry - are round robins advanced by the routines that own them, with nothing on the
input path touching either.

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
