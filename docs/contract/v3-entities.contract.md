# Acceptance contract: Jet Fighters v3-entities (missile rank and jet model)

Authored from `docs/evidence/owner-entity-model.md` before decomposition. That
document is the survey: owner testimony given 2026-07-30 and 2026-08-25 while
playing the deployed build beside the physical unit, recording a data model
rather than a symptom. This contract is what the sixteen tasks derived from it
are graded against. Its sha256 is recorded at freeze; a mid-run edit aborts the
run rather than certifying against a moved target.

The class is `interactive`, for the same reason v2's and v3's were: three of
the four defects below are "does it feel right when you play it", and a cold
agent cannot judge that. What differs from v3.contract.md is scope - this
contract does not re-litigate the TMS1370 core, the assembler or the tube
renderer, all already covered there and unchanged by this work. It covers
exactly what `owner-entity-model.md` names: the missile rank, and the jet
model that replaces `FILE_JETS`' lane rank.

## What this contract is guarding against

Four defects, each named directly in the survey, plus one wrong fix the
survey itself warns against.

### The missile rank, and the fix that would look right and be wrong

**"82% of fire presses are refused while a shot is in flight, measured on the
deployed build."** One shared missile, gated on "is anything in flight
anywhere" (`tk_fired`, `asm/jetfighter.asm`, currently `MNEZ ; one missile at
a time`), is why tapping fire feels unresponsive - not the per-column travel
speed. The survey is explicit that the tempting fix is the wrong one:

> Speeding the missile instead does not work, and this is measured rather
> than argued - at 125 ms a column or faster a defending player wins in
> 60-107 seconds at every skill... Three shots in flight give responsiveness
> without that, because each shot still takes 2.5 s to cross.

`MISSILE_LO`/`MISSILE_HI` (500 ms/column, n=744 measured) are load-bearing and
this contract requires them unchanged. E1 fails a build that "solves"
responsiveness by re-speeding the shared shot instead of building the rank,
because the acceptance-summary duration bound alone cannot distinguish a
three-lane rank at 500 ms/column from one fast shared shot - both keep a
player's own lane occupied for less time. The unchanged-speed conjunct is
what closes that gap.

### The jet model is unrepresentable, not merely unbuilt

`FILE_JETS` holds one nibble per lane and the nibble *is* the column - two
planes sharing a row is not absent from the emulation, it is unrepresentable
in the current RAM layout. E2 is a structural criterion for exactly this
reason, in the shape v3.contract.md's V4 used for the O output PLA: a build
that happens not to exercise the capability in its test drive still fails if
the RAM layout cannot express it, because a jet model that cannot hold two
planes in one row is not the jet model the owner described, however the
tests it ships with behave.

### A plane's row is not fixed for its lifetime

Added 2026-08-25, from a video of the physical unit: *"at most two jets
approach at once... they change row"* while marching, not only on entry. This
is additional to the row/column model E2 requires and is checked separately
(E3) because a build could satisfy E2 - two planes, independent rows and
columns - while still marching each one straight down its entry lane forever,
which is a real but incomplete reading of the survey.

### Entry position, and the nibble-sharing defect this project has already paid for once

*"A plane can randomly appear anywhere on the board."* `jet_enter` currently
writes `GRID_COL_FIRST` unconditionally - every plane enters at the same
place. The fix needs an entropy source, and v2's specific defect here is
already on record: one nibble read by four things, sampled off the free-
running timer at a keypress, let parking the lever make two lanes
permanently safe (PRD R5, `open-questions.md` section 3d). E4 requires both
the varied entry *and* that the entropy nibble's only reader is `jet_enter` -
specifically not `NIB_ROTOR`, the rocket's own round robin, which PRD R5
requires stay independent of the player's press pattern. A build that wires
the same convenient timer sample into both reintroduces the v2 defect under a
different name.

## Drive surface

Tier-1 criteria are driven against `tools/probe/tms1370-probe.ts`'s
`Tms1370Machine` (Node, headless - `src/machine/` never touches the DOM), the
same harness `launcher-lives.test.ts` and `scoring-ruler.test.ts` already
drive. `--input` schedules close contacts on the K matrix exactly as the case
wiring does; nothing here pokes game state to reach a scenario, except where
`pokeRam` is the documented exception (advancing score to reach a rare state
without playing minutes to it) and the criterion says so.

**Every duration and rate bound is read from `docs/evidence/` at verification
time**, per v3.contract.md's own rule - never a figure copied out of this
document once and generalised. Where the survey gives a measured figure (500
ms/column, n=744; the 82% refusal rate; the 205 ms squadron-step cadence)
this contract names which document holds it current.

## Floors

- **The assembled program stays inside 2048 words and every page inside 64.**
  Not a headroom target - the task list's own repeated warning: "the budget
  is the risk, not the logic" (mr-missile-column), and "Pages used: 31 of 32"
  and "RAM high-water mark: 128 of 128" are spans this work has already been
  misread from once (mr-ram-map). A run that overflows either fails at
  assembly, which V1's drive already catches; this floor states it here so a
  criterion never has to.
- **V7 and V8 of `docs/contract/v3.contract.md` still hold.** V7 - all three
  lanes reachable by a rocket - and V8 - the fire blip's 1480-1632 Hz band and
  sub-150 ms duration, measured over its own isolated burst - are the existing
  contract's criteria this work touches most directly. This contract does not
  restate them; a run that breaks either has broken something E1-E4 did not
  license, and re-driving them is task 8's own closing step.

```yaml
class: interactive
criteria:
  - id: E1
    tier: 1
    action: "Run the probe with a closed-loop policy that presses fire in lane 0, moves the lever to lane 1 and presses fire, then moves to lane 2 and presses fire, all inside one 500 ms travel window (one sweep between each lever move and its press, per tms1370-probe.ts's own aiming note); read snapshots and speaker edges throughout. Read asm/jetfighter.asm's MISSILE_LO/MISSILE_HI. Read tools/probe/missile-rank.test.ts (task 7) and the rebased render-fidelity/scoring-ruler drives (tasks 1, 15, 16)."
    observation: "All hold together. A shot is present in all three lanes simultaneously at some point in the drive - three distinct non-zero missile columns read at once, not three shots seen only in sequence. Firing in a lane succeeds whenever that lane's own shot slot is empty, regardless of whether another lane has a shot in flight - the fire press in lane 1 above is not refused merely because lane 0's shot from a moment earlier is still crossing. MISSILE_LO and MISSILE_HI are unchanged from 15 and 1 (500 ms/column) - a build that shortens per-column travel to buy responsiveness fails this conjunct even if three lanes are reachable, because the survey measures that route as making the game unwinnable rather than more responsive. tools/probe/missile-rank.test.ts (or equivalently named) asserts, per lane, zero pass-throughs - a shot's column coinciding with a jet's column with no kill credited - covering both a LEAVE case and an ARRIVE case per lane, six assertions never fewer. A build with one shared missile, a per-lane rank that only one lane can ever populate, or a rank whose per-column speed differs from 500 ms fails this criterion."
  - id: E2
    tier: 1
    action: "Read asm/jetfighter.asm's jet-entity RAM layout and jet_march/jm_capture/the spawn path. Drive the probe with a closed-loop policy that lets two jets enter and steers them, via the lever/skill inputs available to a player - never pokeRam - into the same march column at different times so both stand at the same distance from the launcher, and separately into the same row. Read the render walk (rd_jets) and the collision test (mw_live/mw_arrive on P_HIT, post task 12)."
    observation: "Two planes' positions are each independently held as a (row, column) pair - not a nibble-per-lane rank in which the nibble is the column, which is what FILE_JETS is today. Structurally: a passing test asserts the RAM layout can express two planes with equal row and two planes with equal column at once (mirroring v3.contract.md's V4 - a capability check, not merely a drive that happens not to collide). Behaviourally: in the drive, two planes are observed sharing a column (both at the same distance from the launcher, different rows) and, separately, two planes are observed sharing a row (same row, different columns) - both are drawable simultaneously (rd_jets lights both) and both remain independently hittable (a shot at one does not affect the other's presence). A build in which FILE_JETS' lane rank survives unchanged, or in which two planes sharing a row is representable in RAM but never actually reachable through the spawn/march path, fails this criterion."
  - id: E3
    tier: 1
    action: "Drive the probe across at least four squadron steps at the 205 ms cadence asm/jetfighter.asm's FILE_JETS header records (n=21, sd 22 ms - read the current figure from the source at verification time), tracking each plane's row every step from entry to departure."
    observation: "At least one plane's row differs between two of its own march steps - a plane that entered in row 0 is later observed standing in row 1 or row 2 while still marching (not yet captured or destroyed). The squadron step remains one countdown, not one per plane - the 205 ms march-beep onset rate is a squadron rate and a build with per-plane countdowns produces a beep rate no recording supports, per the design task's own constraint; a passing test asserts a single shared step timer drives every plane's advance. A build in which every plane's row is fixed from entry to departure - satisfying E2's (row, column) model without ever changing the row half of it - fails this criterion."
  - id: E4
    tier: 1
    action: "Drive the probe across at least twelve plane entries (multiple waves) with a fixed input schedule, recording each entry's (row, column). Read jet_enter and every read site of the entropy nibble the design task (task 9) introduces."
    observation: "Both hold. Entries are not identical: across twelve entries, at least two distinct entry positions are observed - a build in which every plane still enters at the same (row, column), such as GRID_COL_FIRST in a fixed lane, fails outright. The entropy nibble has exactly one read site in the assembled program, jet_enter, confirmed by reading every TCY of its nibble index in asm/jetfighter.asm; NIB_ROTOR - the rocket's own round robin - is not among them, and a passing test drives the rocket's lane sequence and asserts it is unchanged by varying only the fire-press timing (PRD R5, independent of press pattern). A build that samples the same free-running counter into both the entry position and the rocket rotor reintroduces the v2 defect open-questions.md section 3d records and fails this criterion even if entries look varied, because the two symptoms - safe lanes and fixed entries - share one root and this criterion is checking the root."
  - id: E5
    tier: 3
    action: "Operator plays the deployed build, taps fire rapidly while moving the lever across lanes, and watches a squadron cross, beside the physical CGL unit and (for the lane-change claim) assets/reference/jetfighters-video.mov. Pastes the observed output into the completion record."
    observation: "Tapping fire while moving the lever lands shots in more than one lane inside a few seconds and does not feel like waiting on one shot at a time - the specific complaint the survey opened with. Two planes are seen sharing a row or a column at some point in ordinary play, not only in a contrived drive. A plane is seen changing row while marching, matching the video. Planes are seen entering from more than one position across a few games, not always the same spot. Human-mandatory: a cold agent structurally cannot judge 'feels responsive' or confirm the video match. Until observed, this criterion is recorded result: escalated with a tier3_escalations entry and no operator_signoff key, exactly as v3.contract.md's V12 describes; the same two forbidden shapes apply here - result: fail without a retained escalation entry, and an operator_signoff written to record a rejection - both of which would certify PASS on a rejected build."
```
