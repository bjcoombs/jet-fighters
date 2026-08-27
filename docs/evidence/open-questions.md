# Open questions for the owner

Everything that needs the owner's eye, judgement, or camera, in one place. Written
after a long autonomous session so the answers are not scattered through chat
history. Each entry says what is blocked, why it cannot be settled without him, and
what would settle it.

Nothing here is a bug report - the bugs are in the issue history. These are the
decisions and the evidence gaps.

## 1. Criterion V7 - the perceptual judgement

**Status: failed once, not yet re-judged.**

The acceptance contract's tier-3 criterion is the owner playing the build beside the
physical CGL unit and deciding whether it is *recognisably the 1979 machine*. It is
the only criterion no agent can evaluate, and it is the one v1 failed while every
process signal read "done".

It failed on 2026-07-26 with six defects. All six have been addressed, but a fix
landing is not the same as the result being right.

Note the criterion's own wording asks for a comparison against "the reference
gameplay video in `docs/evidence/`" **and** the physical unit. There is no video
(see 3 below), so only half the comparison is performable. A sign-off should say
which comparison was actually made.

## 2. Reference material that would unblock work already scoped

### 2a. An angled, raking-light photograph of the **dark** tube

The single most valuable artifact outstanding. A VFD at the right angle under a
low light shows every phosphor segment at once, lit or not. It would settle, in
one shot:

- ~~The **21 per-column jet variants**.~~ **Answered by the gameplay video, and the
  count was wrong.** The silhouette varies by **cell and lane together, by the parity of
  `(cell + lane)`**, taking one of **two** poses - not 21. An unsupervised split of the
  shape-similarity matrix over the thirteen recoverable jet cells agrees with that parity
  13 times out of 13. See `assets/reference/sprites/README.md`, "The jet changes shape
  between cells". The atlas needs two outlines on a checkerboard. Whether anything subtler
  sits on top of the two poses is still open and still wants the angled-light photograph.
- ~~The **battleship sprite**, entirely untraced.~~ **Traced**: a red-orange warship in
  side profile, 48 x 20 px, in the far cell, in all three lanes -
  `assets/reference/sprites/video/battleship-col0-lane{0,1,2}.png`. Its **10-point score
  is confirmed** by reading the digits either side of one destruction (28 to 38).
- ~~Whether the battleship **traverses**, and in which direction.~~ **Settled, and it
  needed the owner rather than the video.** The two halves of the question have different
  answers and were being run together:
  - **Across the columns: it does not.** Never found outside cell 0 in 17 episodes, and
    the tube carries a battleship-shaped segment for that cell only.
  - **Down the lanes: it does.** The video traced the succession lane 0 (frames 524-561)
    to lane 1 (565-626) to lane 2 (628-802) and recorded, correctly, that it "cannot
    separate one battleship moving from three in succession". The owner, playing beside
    his own unit, supplies the half the video could not: the battleship *"moves slowly
    down the the slots which gives you time to shoot at it"*. One boat, descending, top
    to bottom - which is the succession the video saw, in the order it saw it.

  The reference's own numbers become readable once an *episode* is understood as a
  contiguous run of sightings in **one lane** rather than a whole crossing. On that
  reading the 17 episodes are lane dwells: median 2.5 s, longest 5.9 s - and the longest
  is that traced descent's own last lane, 5.83 s, which is the check. The alternative
  reading, an episode as a crossing, is excluded outright: the traced descent runs 9.3 s
  end to end, longer than the longest episode.

  So a crossing is about **7.5 s** and arrivals come about **1.18 a minute** - eight
  lane-0 episodes over 407.9 s, lane 0 being where a descent starts.
  `asm/jetfighter.asm` now answers to both: 172 sweeps a lane, ~8 s a descent, 1.16-1.25
  crossings a minute measured off the machine.

  **Still open: the lane split, 8 / 2 / 7.** A boat that always descends all three lanes
  should give three roughly equal counts. Lane 1 giving two where its neighbours give
  eight and seven is either detection loss in the transit lane - it is the shortest dwell
  of the traced descent, and the tube blanks for every sound - or a boat that does not
  always start at the top. The ROM assumes the first. A recording in which one crossing
  can be watched start to finish settles it.
- ~~Whether the far-left cell is a **battleship-only zone or a seventh jet column**.~~
  **Answered: battleship-only.** Every red object found in that cell across 12,237 frames
  is the battleship; the narrower sightings that looked jet-sized are partially-lit
  battleships (IoU 0.75 against the full hull, 0.55 against a real jet), and the printed
  `BATTLE SHIP ZONE` bracket spans exactly that one cell. The jet field is the five cells
  between it and the missile station. The ghost jets printed in the far-left cell are
  decoration, not a statement of what is drawn there. No `COLUMN_COUNT` change follows.

### 2b. Gameplay video, 15-20 s per skill level

Blocks the measured-timing table in `timing-analysis.md`. Rows T2 to T10 -
battleship crossing interval, rocket travel, thin-out curve, post-hit recovery -
have no measured values and cannot get them from stills or from the audio.

~~T1 (the march step) is the exception and **has** now been measured, from the march
beep onsets in `gameplay-audio.m4a`: 205.1 ms mean, sd 22.1, n=21 across five
uninterrupted runs. That is the only cadence figure in the ROM derived rather than
chosen.~~ Everything else remains marked `PROVISIONAL`.

**Struck through: that row is withdrawn.** The beep is not on the squadron step's
clock - `timing-analysis.md`, "What the audio row does and does not say" - and what
the 205 ms period actually is remains unidentified in two separate recordings, which
is §17 below. **T1 is now measured from the picture instead**, at a skill the owner
states: 267, 300 and 467 ms at skill 3, n = 3. See
`timing-analysis.md`, "The skill-3 clip".

**Partly relieved by `IMG_6113.mov`**, the owner's 407.9 s recording of real play at 30 fps
real time. It supplies, at one unknown skill level: one aircraft advancing one cell every
1.4 s (n=12), the missile stepping one cell every 500 ms (n=744), and a march beep every
0.71 s (n=111). See `timing-analysis.md`, "What the gameplay video supplies". It does not
supply a per-skill ladder, a thin-out curve, or a battleship crossing, so this item stays
open. It also raises a question the ROM currently assumes away: **one aircraft steps about
twice as slowly as the march beep sounds**, which the ROM's one-beep-per-`PAT_STEP` model
does not predict.

The game is now *playable* - the rocket flight was the thing making it impossible,
not the jet cadence - but playable is not the same as accurate.

**A second measurement now points at the same beep cadence, from the tube rather than the
speaker.** `vfd-appearance.md` measures **14-17% of camera frames fully dark** during
active play - the blanking `note_loop` causes, since the sweep stops for the whole of
every sound. This ROM measures **5.9%**. Roughly three times too little blanking against
roughly three times too few beeps (0.71 s measured against this ROM's slowest rung of
1995 ms), which is the same shortfall counted two independent ways.

It was hidden until now, and worth knowing how: the battleship used to cross 51 times a
minute and blank the tube three times a crossing, which carried the figure over 10% on its
own. `sweep-timing.test.ts` and `blank-to-glass.test.ts` were both asserting a floor of
0.1 and both were being held up by that.

The battleship has since stopped blanking the tube **entirely**. Its buzz is now clocked
by the display sweep out of `dwell` rather than played by `note_loop`, because the owner's
isolated recording measures it as 4.0 s of continuous sound and four seconds of `note_loop`
would blank the display for the whole of a crossing the player has to see. Measured, the
worst blank in the 600 ms after an arrival fell from **383.5 ms to 1.5 ms**. So none of
this figure is the boat's any more: `blank-to-glass.test.ts` measures 9.0% and
`sweep-timing.test.ts` 4.4%, against floors of 0.04 and 0.03 with the arithmetic attached
to each. **The fix is the beep cadence, not putting the battleship's note back.**

### 2c. A closer photograph of the JET FIGHTERS sticker

The CGL logotype beneath the wordmark is an approximation. At roughly 24x16 px in
the current reference it does not resolve. Placement, size and colour are right;
the letterforms are invented.

### 2d. The skill lever photographed at two different settings

Both existing photographs show the lever in the same position, so its sweep has
never been observed. The handle sits about 143 degrees from vertical while the
moulded numerals are at roughly -45 / 0 / +45. The only self-consistent reading is
that the handle is a grip and the setting is the direction opposite it - which also
puts both photographs at skill 1. That is inference, not measurement. Moving the
lever and photographing two settings resolves it immediately.

## 2e. Measured differences left unfixed, and why

These were measured during the geometry work and deliberately not acted on. Each
needs either the owner's eye or evidence that does not exist yet.

**The jets are now the right size but the wrong shape.** Aspect 2.3 against the
photographs' 1.3 - they read flatter than the real ones. Two contributing causes,
neither belonging to the task that found it:

- The field is drawn with `COLUMN_COUNT` 6 where the photographs show 7-8 printed
  cells across the same span, making each of our cells about 20% too wide.
- The sprite proportions are those measured in PR #45.

**Note the column-count question is live again here, and it must not be
re-litigated from memory.** An earlier claim that the atlas was short a column was
investigated and formally withdrawn - the ROM works in seven columns and the atlas
carries six jet columns plus a battleship, which is seven cells. What this new
measurement says is different: that the printed cells *across the field span* count
7-8 where we draw 6. Those are compatible statements only if the far-left cell is a
seventh jet column rather than a battleship-only zone - which is exactly the
question section 2a says the angled-light photograph would settle. **Do not change
`COLUMN_COUNT` before that photograph exists.**

**The face's absolute scale is unresolved by about 6%, though its shape is not.**
Two independent measurements agree closely on the printed frame's *aspect* -
2.701, 2.687 and the 2.669 that shipped, all within 1.2%, and all making v1's
3.384 about 25% too flat. They disagree on *size*: 298 x 110 atlas units against
the 272 x 102 that shipped. That is purely the px-per-atlas-unit calibration, not
a reshape.

The tiebreak used was the atlas's own bounding box, which needs no circle fit:

| Calibration | Glass spans | Left edge vs `RECT.x` = 0 | Right vs `VIEWBOX.width` = 363 |
| --- | --- | --- | --- |
| 2.70 px/unit (bezel fit, r = 405) | 389.6 units | -16.9 | 372.8 - overshoots 7.3% |
| 2.867 px/unit (glass-arc fit, r = 430) | 367.0 units | -3.5 | 363.5 - within 1.1% |

The 2.70 figure is inconsistent with the coordinate space it was quoted in, which
is why the smaller size shipped. **If the owner prefers the larger calibration the
fix is a single uniform scale-up of the whole face, roughly 1.09x - not a reshape**,
because the aspect is already agreed. Worth deciding once rather than re-arguing.

**`BOTTOM_RAIL_OVERHANG` is still 9.5 and has nothing honest behind it.** The two
photographs disagree outright - 10.2 and 26.9 units past the right rail - so there
is no value to pin it to. Needs a cleaner photograph or the owner's eye.

**`ZONE_INNER_RISE` is 0.115; the photographs put it at 0.158.** Left alone because
it is not a fitted constant - it belongs to the bracket topology introduced in PR
#49, and the same photographs show the outer drops turning inward at the arms' top
rather than at the middle line as that PR drew them. Changing the value without the
topology would be half a fix.

## 3. Decisions that are the owner's, not ours

### 3a. The printed layer's typeface

The real face is a geometric sans - circular O and C, pointed A, splayed M - in the
Futura / Century Gothic family. We draw the whole silkscreen in `sans-serif`, which
resolves to Helvetica or Arial. The difference is visible on close comparison.

Deliberately not changed, for a reason worth stating: it applies to the curved
header, the ruler numerals and the zone labels equally, so it is a change to the
entire printed layer rather than to any one defect. And a font stack naming faces
present on only some platforms trades one infidelity for another.

### 3b. How much the acceptance contract's wording should bind

Two places where the frozen contract is narrower than the hardware:

- **V1** asserts "the listing's highest assembled address is <= 2047". The HMCS44
  ROM is (2048 + 128) words and the upper 128 are the pattern region, addressed by
  `.PATTERN`. Any ROM defining a pattern table - the game does, for BCD score
  lookup - legitimately writes to 2048-2175. The listing separates the two figures
  so a careful reader takes the program-region number, but a verifier taking the
  maximum of the address column would fail a correct ROM.
- **V5** asserts "the burst is shorter than 150 ms". Against the bootstrap ROM the
  fire tone was the only sound in the window, so first-to-last edge *was* the
  burst. Against the full game the same window holds several sounds; measured
  correctly the fire burst is 40.9 ms, but first-to-last across the whole capture
  reads 445 ms.

The contract cannot be amended mid-run by design - its sha256 is recorded at freeze
and re-hashed at exit. Both are recorded in `worktree/v2/exit-gate-notes.md`. The
question is whether to re-freeze a corrected contract for the next run.

### 3c. A defect in the acceptance-contract tooling itself

`validate_completion.py` checks only **tier-1** failures when deciding a verdict, and
`_is_signed()` treats *any* non-empty `operator_signoff` as assent. So a run with a
**failed tier-3 criterion** plus a sign-off object certifies `PASS`. That is the exact
escape hatch tier-3 exists to close, and tier-3 is the criterion that caught what six
machine checks missed here.

The completion record for run `v2` therefore deliberately carries **no**
`operator_signoff` key, so it reads `AWAITING-TIER3-SIGNOFF` rather than falsely
certifying. V7's failure and its six defects are recorded in `criteria_results`.

This lives in the ai-native-toolkit plugin, affects every project using it, and is a
floor artifact - the marathon retrospective is explicitly forbidden from self-applying
a fix. It needs the maintainer's out-of-band decision.

### 3d. The machine's only randomness is the player's own rhythm - **superseded by the TMS1370 rebuild**

**Everything below describes the v2 HMCS44 ROM and no longer describes the machine.**
It is kept because sections 6 and 7 point at it, and because the defect it names is the
one PRD R5 forbids inheriting - a reader who finds only a corrected ROM cannot tell what
was corrected.

What is true of v3, checked against `asm/jetfighter.asm` rather than remembered:

- **`NIB_RAND` no longer exists**, and `ti_press` - the routine that sampled the timer on
  a fire press - is gone with it. The one surviving mention of the name is a comment in
  `rocket_fire` explaining what it used to do.
- **Both rotors are pure round robins.** `NIB_ROTOR` picks the rocket's lane and advances
  on every launch attempt, finding a jet or not, so an empty lane walks it on rather than
  stalling it. The squadron's start lane is the same shape.
- **The remaining timings are fixed constants.** The jet entry countdown reloads from
  `ENTRY_HI`, and the battleship's gap is the `NIB_BS_HI`/`NIB_BS_LO` countdown pair. No
  path samples the free-running timer into game state.

So **the machine is now fully deterministic**: identical inputs give an identical game,
every time, and the owner's *"shows up randomly"* is still something this ROM does not do.
That is unchanged from the section below. What changed is the reason - not "entropy the
player accidentally controls" but no entropy at all.

Two consequences for anyone writing a drive against it, both learned the hard way here:

- **Determinism is an asset, not a limitation.** A drive that reaches a rare state reaches
  it identically on every run, so a measurement taken once holds, and a flake is a real
  defect rather than luck. Several findings in this document rest on that.
- **"Vary the seed" is not available.** There is no seed. Two runs of the same drive are
  the same run, and repeating one proves nothing about coverage. To reach a different
  state, **vary the play policy** - the lane walk, the firing rhythm, whether the drive
  dodges, which skill it selects. `boatHunt` in `tools/probe/scoring-ruler.test.ts` is the
  worked example: nine games that differ only in skill and starting lane, because that is
  the only axis the machine offers.

---

*The v2 record, from here down:*

Sections 6 and the battleship work both point here, and until now the reference was
dangling.

`NIB_RAND` is written in exactly one place - `ti_press`, which samples the free-running
timer on the sweep the player closes the fire contact. It is read in four: the jet entry
countdown, the lane a fresh squadron's rotor starts on, `rocket_fire`'s lane, and the gap
between battleship crossings. So none of those is chance. All four are the phase of the
player's last button press, and two consequences are measured by driving the machine:

- **A player who never fires leaves it at zero for the whole game.** Every value derived
  from it is then fixed. An unattended machine's battleship gap is identical to the sweep,
  crossing after crossing.
- **A player who does fire produces values that cluster on his own rhythm.** Four, five,
  six and seven dominated a fifteen-crossing run of a steady player.

The two callers feel it differently, and it is worth separating them:

- **`rocket_fire`'s lane is the severe one.** With the lever parked in lane 1 or 2, no
  rocket ever reaches the launcher (section 6). A whole game rule is decided by the
  player's press pattern.
- **The battleship's gap is the mild one.** The sampled nibble is only a sixteenth of the
  interval, so even a uniform sample would move a ~50 s gap by under 9%. Nothing a player
  would read as random. The owner's *"shows up randomly"* is therefore something this ROM
  does not currently do at all, and no change to the battleship's own constants can make
  it - the source has to change.

**The owner's question, and it is one question for all four callers:** does the real unit
vary these, and by how much? A machine whose only entropy is a keypress-sampled counter
is a real HMCS44 constraint and may well be exactly what the unit does. If it is, "shows
up randomly" describes a gap whose *phase* wanders rather than its length, and nothing
needs fixing. If it is not, the fix belongs at the source and lands on all four callers at
once - which is why the battleship's was deliberately left alone.

## 4. Review coverage - worth knowing before trusting the diff

CodeRabbit was rate-limited across most of this session. Its check reports `SUCCESS`
while posting only a "review limit reached" notice, so **a green CodeRabbit check on
these PRs means "did not review", not "reviewed and approved"**.

Each merge was verified by the lead against the contract criteria, the test suite,
and by driving the machine - but that is one party's judgement standing in for
review across a large diff. A pass over the session's changes is worth doing.

## 5. Handover from the teardown retrace

Recorded when the atlas work finished, so these do not evaporate with the agent that
found them. All three are honest gaps rather than loose ends: each is documented where
someone will meet it, and each names what would settle it.

### 5a. The capture burst's smoke - **closed**, with two things left over

The smoke is traced. It is in `capture_lane*`'s path, about eleven curl marks per lane,
and `docs/evidence/tube-sprite-detail.jpg` shows it against the glass at matched
magnification.

It was never merged with anything and never needed separating: at a per-lane threshold it
comes out as eleven marks that touch neither starburst. Five approaches missed it because
they were all hunting a pixel property that would tell a stipple from a solid area, and
then dropping everything that was not one of the cell's largest components. What it needed
was a name and a place to be. `src/machine/tube/ATLAS-COORDINATES.md`, "Cell 6's smoke,
and why five attempts missed it", has the detail - including that removing the control
grid's modulation, which was the promising lead, is not what unblocked it: over the smoke
the grid's ripple is 3.5 grey levels against 74 levels of curl-to-glass contrast.

**A photograph the reading rests on is not in this repository.**
`assets/reference/tube-teardown/lit-capture-burst.jpg` is cited in two documents and no
commit has ever added it. That the curls are lit at all, and lit *with* the starburst
rather than separately, comes entirely from it - so the outline is now measured but its
membership of `capture_lane*` still rests on a file nobody here can open. Please supply
it, or say if it was never meant to be committed.

**The falsifier is unchanged, and acting on it is now cheap.** A lit frame showing the
stipple without the starburst, or the starburst without the stipple, would mean the cell
needs two addresses rather than one path. The outline is measured either way, so what that
frame would cost is splitting one path in two - not another attempt at the trace.

### 5b. `capture_lane*` is undriven

The tube prints two different bursts in the player's cell - one for a jet reaching the G
line, one for the colon hitting the launcher - and the ROM draws the same segment for
both, so the capture burst never lights. It is on the conformance test's enumerated
exception list, which means it is a line someone **deletes** rather than a thing someone
has to notice.

Distinguishing them is a change to the launcher-destroyed path in `asm/jetfighter.asm` -
the same code `launcher_down` touched - and not to the display map.

### 5c. The two-unit border disagreement

`PLAYFIELD` in `src/machine/tube/layout.ts` comes from the lit close-ups; the cell lattice
comes from the bare tube. They differ by about 5% of a cell on the right-hand border, and
that sits **visible in a test** rather than absorbed as slack.

**If anyone resolves it, the teardown wins.** It has won every conflict with the video and
the lit stills today, on the same basis each time: it shows the glass itself rather than
what happened to be lit, through a smoked filter, sampled slower than the tube refreshes.

### 5d. Do not adjust the frame assertion's data to make it pass

`atlas.test.ts` pins the atlas against three **measured** printed-boundary positions - cell
index 3.66, 4.665 and 5.68, each the centre of a triple of dark runs in
`tube-unlit-full.jpg`.

If the atlas is ever re-derived, **re-measure the print**; do not adjust those numbers to
fit the new atlas. The entire registration error found here was a frame that was perfectly
self-consistent - every existing test passed from inside it, because they compared the
atlas against `layout.ts` and both had inherited the same wrong phase. The only assertion
that could see out of it was one anchored on something the atlas does not control.
## 6. The capture rule, settled: a capture costs a launcher, in any lane

**SETTLED by the owner.** He was asked directly, after playing the v3 build, and chose: **a
jet reaching the G line costs one launcher wherever the lever is standing**, and the game
ends on the third. That is `docs/prd/jet-fighters-v1.md` rule 6 and
`docs/prd/jet-fighters-v3.md` line 280, so the rule the ROM implements is the one this
section proposed keeping. What has been **removed** is a lane condition that was never in
either PRD: `jm_capture` used to let a jet crossing any lane but the lever's through for
nothing.

That condition is what made the v3 build unplayable rather than merely inaccurate. The
player's missile sweeps his own lane end to end in about 150 ms with unlimited ammo, so
tapping fire kept that lane permanently empty - and the only jets that could capture him
were exactly the ones he was killing, while `rf_look` will not launch a rocket from an
empty lane either. Both loss paths closed at once. Measured: 0 to 1 launchers lost in 90 s
of tapped-fire play, against game over in 24-43 s for the same machine left alone.

Removing the condition needed one further change, recorded here because it does not follow
from the rule. The loss is claimed at the end of the squadron's lane walk rather than from
inside it: branching to `launcher_down` from the walk skipped the `step_reload` that sits
at the end of it, so the march countdown was never reloaded and the march collapsed to the
ladder's floor. On the ungated rule the three launchers went at sweeps 799, 815 and 831,
sixteen apart, where a skill-1 step is 144. `NIB_J_LOST` is a flag and not a count, so a
step costs one launcher however many jets arrive on it.

**Still open from the same description:** the player's ship flashing when a bullet hits it,
which is unimplemented and is noted at the end of this section.

---

### The question as it stood, and why it was the owner's to settle

`launcher_down` currently makes a jet reaching the G line **cost one launcher**, so a game
survives two captures and ends on the third. That landed in #74 on the strength of the
owner's report that *"you seem to end the game after one loss, there's no three lives
working"*, and `docs/prd/jet-fighters-v1.md` rule 6 was amended to match.

**His later description points the other way.** Describing the two events on his own unit:

> the bullets if it hits me makes the green of me flash briefly and plays sound then i can
> continue. The image of when the plan reaches i loose with no lives left

Read literally, that is **bullets cost lives** (flash, sound, continue) and **a capture
ends the game** - which is the original rule 6, and the reverse of what is implemented.

If so, his original complaint had a different cause than was diagnosed: `rocket_fire`
takes the rocket's lane from `NIB_RAND` as the player's last keypress latched it, and with
the lever parked in lane 1 or 2 **no rocket ever reaches the launcher** (section 3). Every
loss is then a capture, the three lives never come into play, and "no three lives working"
follows without the capture path being wrong at all.

**The question that settles it:** on the real unit, if a jet reaches the G line while
launchers remain, does the game end there, or does play continue with one fewer?

### If it reverses, what to change and what to keep

- **The revert is small and the PRD was written to survive it.** The superseded wording is
  kept inline as a block quote, so restoring it is an edit to one block plus putting
  `JMPL game_lost` back in `jet_swept`. `launcher_down` can stay as a label - it costs
  nothing and documents that the two losses are different events, which the tube confirms
  by printing two different bursts for them.
- **Keep `tools/probe/launcher-lives.test.ts`.** Its method is rule-independent: never
  pressing fire means no missile exists, so a jet leaving the deepest jet cell can only be
  a capture. Under the reversed rule its expectations invert - lane 0's rocket deaths
  become the two-beep/three-beep path and a capture becomes an immediate loss - rather
  than the file being deleted.
- **The `rocket_fire` lane asymmetry gets *more* important, not less.** If bullets are what
  cost lives, then a rocket's lane coming from the player's own keypress pattern decides
  how many lives a player gets. That moves it from an oddity to something the owner would
  feel directly in every game.
- The liveness fix and `tubeSignature` in `game-lifetime.test.ts` are independent of the
  rule and unaffected either way.

### Also unimplemented, from the same description

**The player's ship flashes when a bullet hits it.** Nothing in the ROM or the renderer
does this. It is the visible half of a damage signal that has always been described as
sound-only, and it is unaffected by which way the capture rule goes.

## 7. The microcontroller is a TI TMS1370, not a Hitachi HMCS44

**The single largest error in this project, and it was visible in a photograph in this
repository for a day before anyone read it.**

`assets/reference/tube-teardown/board-L1001567.jpg` shows the chip marked **`MP2110`**,
**`MSHL△8040`**, beside the Texas Instruments logo - the outline of Texas with `TI` inside
it. A 40-pin DIP, date-coded week 40 of 1980.

MAME's own device list, in `src/mame/handheld/hh_tms1k.cpp`, names that exact mask:

```
@MP2110   TMS1370   1980, Gakken Invader/Tandy Fire Away
```

`MP` is TI's prefix for custom mask-programmed TMS1000-family parts, and an MP number is
one program. **So this unit runs the Gakken Invader program, behind Jet Fighters artwork**
- which is why its logic reads as Space Invaders: attackers advancing in columns, a player
moving between three positions and shooting upward, a higher-value target crossing the far
row, a score capped at 199. Gakken licensed the same game to Tandy as *Fire Away* and to
CGL as *Galaxy Invader*.

### How the error entered

`docs/prd/jet-fighters-v2.md` reasons:

> Gakken standardised on the **Hitachi HMCS40 MCU family** across its VFD line; no Gakken
> game uses NEC uCOM-4. The CGL box's "2K Bytes L.S.I." matches the **HD38800 (HMCS44)**

Two inferences stacked: a generalisation about a manufacturer, and a match between a
marketing string on a box and a datasheet. Neither was checked against the chip. The
generalisation is false on its own terms - Gakken's Galaxy Invader 1000 (1981) is a TI
TMS1370, and so is Gakken Poker (MP2105, 1979).

This is the project's own named failure mode - **a belief promoted to a constraint** - at
the deepest level in the stack, and the only instance where the disproving evidence was
already committed.

### What survives a CPU change, and what does not

**Survives.** Everything measured from the glass: the atlas and all its segments, the cell
registration, the phosphor constants, the control-grid mesh, the case geometry. Every audio
measurement. Every gameplay rule the owner has corrected. None of it depends on which chip
drives the tube.

**Does not.** `src/machine/cpu/`, `tools/hmasm/`, `asm/jetfighter.asm`, the 2048-word and
160-nibble ceilings, the 400 kHz clock, and the claim of emulating *this* machine.

### Three things the battleship work established that the rebuild must carry

Recorded because they were learned at cost and are easy to lose in a rewrite.

1. **The test changes survive a CPU change; the assembly does not.** They encode a
   behavioural fact rather than an instruction set: the buzz is the first sound that does
   *not* blank the tube, and the first that overlaps other sounds. The blanking probes
   exclude crossings, and `launcher-lives` separates buzz edges from note edges by
   half-period. The one that will bite again: **the loss sound must be identified by its
   decay floor as well as its 80-97 Hz collapse**, because an ~85-93 Hz buzz sits inside
   that band on any silicon.
2. **The mechanism argument is family-independent; its arithmetic is not.** "Clock the buzz
   off the display sweep so the tube keeps scanning" follows from a 4 s continuous sound on
   a single-core machine whose note player stops the display. What does **not** carry is
   "every fourth grid, ten grids a sweep" - that landed on 89 Hz against a measured 93.4 Hz
   by arithmetic specific to the HMCS44 sweep rate. On the TMS1370 the divisor must be
   re-derived from its own sweep, and the check is that the result lands inside the
   measured 79-111 Hz.
3. **93.4 Hz is the *pin* repetition rate.** The 2.4-9.6 kHz energy belongs to the owner's
   piezo and his phone, not to the program, so the new ROM does not have to produce it.

### The open decision

Whether the rebuild runs **the real dumped MP2110 program** - which MAME has, and which
would settle every open gameplay rule outright, including section 6 above - or **a program
written for the TMS1370**, keeping this project a reconstruction. A third option: build the
core, and use the real ROM as a **test oracle** rather than as the shipped program, so
disagreements between the two say where the reconstruction is wrong.

`asm/jetfighter.asm` on `main` is HMCS44 and is expected to be replaced wholesale rather
than reverted. Only the `.asm` is family-specific - the recordings,
`docs/evidence/audio-reference.md` and the probe tests all carry across.

## 8. Three owner observations, measured. Two faithful, one a real defect.

The owner reported three things while playing the deployed build. All were measured
against the running machine rather than reasoned about. Two were faithful. **The first
was a defect, and this section recorded it as faithful for two revisions.** Recorded so
the next report of any of them can be answered from the tree instead of costing another
diagnosis.

### 8a. "The last note of the game win is a high note, not a low note" - **a defect, now fixed**

**The owner was describing his machine, and this section read it as a question about
ours.** The sentence is a statement of fact about the unit: the last note is a high
note. It was taken as "the last note sounds high to me, is that right?", answered by
measuring the emulator against `audio-reference.md`, and closed as faithful because the
two agreed. They agreed because the document was wrong.

Re-analysed off `assets/reference/gameplay-audio.m4a`, the unit's resolution is
**1868 Hz** - an octave above the arpeggio's middle note and a fifth above its peak.
The jingle climbs and then leaps past its own top note. The ROM was playing the middle
note a fourth time, at 956 Hz, which is exactly the "low note" the owner said it is not.

`audio-reference.md` recorded the resolution as 940 Hz, and that figure was never a
reading of that note: `win.partialsObserved` records 940 / 1880 / 2820, which are the
arpeggio's middle note's partials. The tail's own partials - 1868 / 3735 / 5601, with
no energy at 934 at all - were never taken. See that document's "The resolution was
never measured" for the method that settles it.

**What was measured correctly and still misled.** The measurements in the superseded
version of this section were all accurate: the ROM did end at 956 Hz against a 1190 Hz
peak, the synth did render the last 300 ms at 972 Hz with an RMS of 0.4905 against
0.4926 at the start, and nothing was truncated or attenuated. Every one of those
readings was of the emulator, and the question was whether the emulator matches the
unit. **A measurement of the thing under test cannot answer that** - only the recording
can, and the recording was not consulted because a document said it had been.

**The lesson, which is the same one as 8b's.** The prior conclusion here was that
"changing the resolution's pitch would move the ROM away from the measurement". That
was true and it was the wrong thing to protect: it treated a transcribed figure as
more reliable than the owner's ear, when the owner is the only source with access to
the actual machine. Where a documented measurement and the owner disagree about what
his unit sounds like, **re-derive the measurement from the recording before concluding
the owner is describing something else**.

`tools/probe/win-jingle.test.ts` asserted the shape in the wrong direction - "ends
below its own highest note" - and so locked the defect in. Both the bound and its
reasoning are corrected there, and the file now asserts the leap and its interval.

### 8b and 8c. Both endings freeze the controls

**Faithful, and it is the ROM ignoring input rather than the emulator stopping.** After an
ending, working the lever and the fire button for two emulated seconds leaves `NIB_STATE`
at `ST_WIN` and the score at 199. The machine is running and choosing to do nothing: `tick`
branches to `tk_ended` for anything above `ST_PLAY`, and `Board.running` is `power.isOn` and
nothing else, so no layer above the ROM has halted.

A core reset - what the on-screen power switch does - returns `NIB_STATE` to `ST_PLAY` and
the score to 0, so **the unit is not stuck**. That is `docs/prd/jet-fighters-v1.md:30`'s
back-label rule, power-cycle to start a new game, wired as v1 line 168 describes.

**But the ending is not always silent, and that part is a real defect rather than a faithful
freeze.** An earlier draft of this section said an ending "produces zero speaker edges",
measured with the lever parked in lane 0 at skill 1. That reading was true of the run it
came from and not of the machine: it was one of the cases where no battleship happened to be
crossing. Driving all nine parked-lever combinations of skill and lane:

| ending lands... | runs | speaker edges in the 4 s after the ending |
| --------------- | ---- | ----------------------------------------- |
| with no boat on the glass | 7 of 9 | 0 |
| **during a crossing** | **2 of 9** (skill 2 lane 2, skill 3 lane 0) | **632 and 629** |

The buzz is ticked from `strobe` on every O strobe, and once `tick` takes its `tk_ended` arm
it never reaches `tick_bship` again to run the crossing down - so a game that ends mid
crossing buzzes for as long as the machine is left switched on. The capture-rule work found
this independently and fixes it by clearing `NIB_BUZZ` and `NIB_BPHASE` at the top of
`game_win` and `game_lost`; the numbers above were measured before that change.

**The lesson is a sibling of 8a's.** "Zero edges" was measured from one drive and stated
as a property of the machine. It took two more drives out of nine to contradict it. A
property claimed about an ending has to be measured across the states the machine can be
in when it ends, not the state it happened to be in once. Where 8a measured the right
quantity against the wrong reference, this measured the right quantity over too narrow a
sample; both produced a confident claim that the machine did not support.

### 8d. "The screen flashes" - one blank, not a flicker

Sampling what a viewer sees at 60 Hz across a whole game, the ending produces **40
consecutive dark frames, about 0.67 s, with exactly two dark/lit transitions.** One
blackout. After it the tube is lit and stable: 60 viewer frames, one distinct lit set, 12
segments - the final score standing still. During play only 2% of frames are dark.

The cause is the ROM stopping the sweep while it drives the speaker, which
`tools/probe/blank-to-glass.test.ts` already asserts for every sound on this machine. The
loss envelope is simply the longest sound the ROM plays, so it is the only one long enough
to read as a blackout rather than a blink.

**Stated generally, because it will be reported again about some other sound: every
*note-driven* sound on this machine is a visible blink, and the longer it plays the more it
looks like a fault.** Criterion V12 names that as something an operator should recognise as
authentic, and a build whose tube kept drawing through a note would be the wrong one.

**The battleship buzz is the exception, and saying why makes the rule sharper rather than
weaker.** The blink is not a property of sound; it is a property of `note`, which parks the
sweep for the whole of what it plays. The buzz is not played that way - it is ticked from
`strobe`, at `st_buzz`, one O strobe at a time, precisely so that a four-second crossing
does not blank the display the player has to see it on. Section 7 records the change and
what it bought: the worst blank in the 600 ms after an arrival fell from 383.5 ms to 1.5 ms,
and the battleship stopped blanking the tube entirely.

So the test is *how* a sound is produced, not how long it lasts: **`note` blanks, `strobe`
does not.**

That same distinction is what makes the stranded buzz in 8b possible, which is worth
noticing because the two findings corroborate each other. Once `tick` takes its `tk_ended`
arm it never reaches `tick_bship` again to run a crossing down - but `strobe` is still
running, because the tube is still being drawn, so it goes on ticking the buzz. A sound
that blanked the sweep could not have survived an ending unnoticed; this one could, and did,
**while the tube kept drawing normally**. The mechanism that keeps the boat visible is the
mechanism that let it buzz forever.

## 9. FIXED in #117: a capture in the lever's lane collapsed the squadron's march

**Fixed on `main` by #117, which reached it independently.** Kept because the mechanism
and the measurement are worth having, and because the fix and the guard in this branch
resolve it in different shapes - see the note at the end of this section.

**This is a bug in the shipped ROM, not a question, and it is written here rather than
only in the pull request that found it because it is independent of whether the capture
rule in section 6 ever changes.** It needs no rule change to fire. It needs a jet to reach
the G line in the lane the lever is standing in, which is the one case the current
`jm_capture` charges for.

**Mechanism.** `jm_capture` is reached from inside the squadron's lane walk, by
`jm_move` when a jet steps past grid 5. On the arm that costs a launcher it branches
straight out to `launcher_down`, and **the walk never finishes**. `step_reload` is at the
end of that walk - `jm_lane_done` to `jm_beep` or `jm_reload`, and both to `step_reload` -
so the squadron's step countdown, `NIB_STEP_LO` and `NIB_STEP_HI`, is never reloaded. It
is already expired, having just fired this step. On the next sweep `jet_march` decrements
an expired countdown and marches again, and it goes on marching once every sixteen sweeps
- the ladder's floor, `STEP_HI_MIN` - until some step happens to complete without a
capture.

**Measured**, on a build with the lane condition removed so the path is easy to reach: the
three launchers went at sweeps **799, 815 and 831**, sixteen apart, where a skill-1 step
with a full squadron is **144 sweeps**. A factor of nine, and the game ends in a burst the
player cannot react to.

**Why it has been invisible.** On `main` the costly arm needs the jet to cross in the
lever's own lane, and a player who taps fire keeps that lane empty - which is the
immortality the same pull request diagnoses. So the path is rarely taken, and when it is
taken the game is usually one launcher from over anyway. Nothing in the suite covers it:
the death-path tests drive a machine that never fires (`launcher-lives.test.ts` asserts
`everFired === false`), and no test asserts the march *rate* after a capture.

**Two fixes, and they are not the same shape.** #117 made `step_reload` a `CALL`/`RETN`
subroutine and had `jm_capture` call it on its way out of the walk, so the path that leaves
reloads the countdown before it goes. The branch that found this claims the loss at the
*end* of the walk instead - `jm_capture` sets a flag and rejoins `jm_lane_next`, and
`sr_after` spends the flag after `step_reload` has run - so the capture path never leaves
the walk at all, and the whole squadron finishes marching.

The second is the stronger invariant: the countdown is reloaded on the one exit every
completed walk takes, rather than on every exit somebody remembered to patch, and that
distinction is what the original defect was. It also gives a guard the first does not - one
march step costs one launcher however many jets arrive on it. Both are kept in the
resolution: the subroutine is #117's, the claim point is the branch's, and #117's
`jm_capture` call becomes unnecessary rather than being dropped silently.

**A caution the rebase taught.** `launcher_hit`'s tail is instruction-identical to
`jm_capture`'s, and a rebase spliced #117's continuation onto it - so a *rocket* landing on
the launcher reloaded the squadron's countdown. No conflict marker, no lint error, a clean
assemble. Measured: march intervals of 160, 160, 160, 160, 160, **112**, 160 sweeps, the
112 landing on the sweep the rocket arrived. `tools/probe/march-cadence.test.ts`, written
for the original defect, is what caught it.

## 10. Can the real unit lose two launchers within half a second, and what does it sound like?

**An owner question, raised by a fix rather than by a failure.**

`tools/probe/launcher-lives.test.ts` counts the damage ladder off the speaker - two beeps
after the first launcher, three after the second - because on this machine the beeps *are*
the lives indicator: there is no lives display, and the three marks outside the playfield
border are paint. It used to separate one warning from the next by the silence between
them. That stopped working once the missile ran at its measured speed and games lasted
long enough for a capture and a rocket to land in the same half-second: the two warnings
then arrive as one run of five beeps rather than as a two and a three.

The ROM is right in that case. It sounded 2 and then 3, which are the correct per-loss
signals; the observer was merging them. The test now attributes each beep to the launcher
it announces by reading `NIB_HITS`, which is the one place that file reads RAM and it
reads it to *segment* the evidence rather than to supply it.

**What is not settled is whether the machine's signal survives the collision.** If two
launchers genuinely go within half a second, a human listener cannot separate five beeps
into a two and a three either, so the player is told he has lost two launchers by a sound
that does not say so. That is a question about the unit, not about the emulation:

- Can the physical machine lose two launchers that close together at all?
- If it can, does it sound both warnings back to back, or does one of them get suppressed?

**No minimum-spacing rule has been invented to make the audio tidy**, and none should be
until this is answered. A lockout would be a rule with no evidence behind it, added to
make a test read cleanly.

**The technique that made this tractable generalised on first contact with another
suite.** Stating a precondition as its own named test - so it fails loudly instead of the
real assertion passing quietly - was adopted by the distance-scoring branch, and within
hours it caught a problem in that agent's own drive: a run that took 5.4 s against
Vitest's five-second per-test default, so the win it was waiting for never arrived. Its
guard reported *"the drive never reached the win - the cap is untested"* rather than
passing over an absent event. A technique that works in the suite it was invented for is a
habit; one that works in somebody else's on first contact is a method.

## 11. Two blanking assertions pass because their input became rare, not because they were fixed

`blank-to-glass.test.ts` and `sweep-timing.test.ts` each assert that the renderer paints
nothing for the whole of every sound. Both failed while the player's missile was 28 ms a
column, and the mechanism was understood: `BURST_GAP_CYCLES` is two sweeps, so a 71 ms
march note and a 19 ms fire blip played close together are grouped as **one** sound, the
ROM legitimately runs a sweep between them, and when that gap is shorter than
`REFRESH_TIMEOUT_CYCLES` it is not recorded as a hole either - so the lit frames inside it
counted against an assertion about a dark tube.

**They now pass, and the mechanism has not been addressed.** At the measured 500 ms a
column the player fires about one shot every two and a half seconds, so a fire blip landing
adjacent to a march note has become rare enough that the fused pair does not occur in these
windows. The assertions are green because their input got rarer.

That will not hold. Anything that raises the fire rate, shortens the march step, or adds a
sound to the loop can bring the pairing back - and distance-based scoring, which changes
how fast the ladder walks down, is exactly such a change. When one of these goes red, the
history is here: it is not a regression in the blank, it is the sound splitter calling two
notes one sound.

The march-note assertions in both files no longer have this problem - they select by pitch
as well as by duration and reject a sound carrying anything faster than a march note. It is
the "every sound, march or not" pair that remains exposed.

### 11a. The general form: a timing change can invalidate a drive's premise silently

**If you read one paragraph of this section, read this one. Revert the fix and watch the
test pass.**

That is the only technique on this run with a hit rate against the hazard below, and it
found two of the four instances - including one in an assertion written *specifically* to
catch this class, by someone who had spent the day finding the other three. Take a test you
believe covers a defect, undo the fix in the ROM, and run it. If it still passes, it never
covered the defect, and you have learned that in thirty seconds.

Nothing else has worked. The hazard is invisible to reading, because the assertions are
correct. It is invisible to coverage, because the addresses are all legal. It is invisible
to CI, because nothing goes red. Reverting the fix is the only move that asks the question
directly.

**And one way these survive is worth naming separately, because it is not a property of
the drives at all.** A correct diagnosis closes an investigation as effectively as a wrong
one. Twice on this run a test in these suites was observed taking 80 to 94 seconds; both
times it was diagnosed as another suite starving it, which was true, and the matter was
dropped. The question that went unasked was the adjacent one - *whether the default
timeout was survivable at all* - and the answer was no: 1.4 s idle against a five-second
default and a 67x worst case. Nothing was wrong with the diagnosis. It answered the
question in front of it and stopped, and stopping is what a correct answer licenses.

So when a measurement surprises you and the explanation is satisfying, that is the moment
to ask what *else* follows from it. The other routes below are drives whose premise
stopped being true; this one is an explanation that was true and incomplete.

---

The blanking pair above is one instance of something worth naming, because this run
produced four of them in a day and none announced itself.

**Every drive in these suites rests on a premise about the machine's timing**, and the
premise is almost never written down. Change a cadence anywhere and the premise can stop
holding while the drive goes on running, goes on passing, and quietly measures something
else. It is not a failure - nothing goes red - which is exactly what makes it dangerous.

Four instances, in the order they were found:

- **The input became rare.** The two assertions above pass because a fire blip landing
  beside a march note stopped being common once the missile slowed. The mechanism is
  untouched.
- **The drive stopped reaching the case.** `launcher-lives.test.ts` needed a game that ends
  during a battleship crossing, to prove the buzz stops. When the stranded buzz was found,
  the three parked-lever games did that. After the wave retreat and the missile speed moved
  every game length they end at 27.1, 36.6 and 45.4 s, all *between* crossings. The defect
  had not moved; the drive had stopped arriving at it, and an assertion written over those
  games passed against a ROM with the fix deliberately reverted.
- **The drive started terminating for a different reason.** Every drive in this branch was
  built when 199 points was unreachable - a skilled player topped out at 184 in 400 s - so
  they all end by losing three launchers or by running out of clock. Distance-based scoring
  roughly triples the rate, and the same drives now end by *winning*. A drive that measures
  "how long until the machine falls silent" measures something different once silence
  arrives from a win rather than a loss. Found from the other direction on the scoring
  branch, whose census drive now ends on the third launcher at 198 where it used to reach
  the win.

- **The outcome the drive waits for is not the drive's to guarantee.** The scoring branch
  tried to bound its census by running until the win, and measured 240, 300, 360, 480 and
  600 s all stopping at the same 58 events and the same 198 points. Whether a game *wins*
  is a pacing property, and pacing is exactly what this run has been changing from three
  branches at once. **An outcome-dependent drive is hostage to every other branch's pacing
  changes** - and unlike a drive that runs out of clock, waiting longer does not fix it.

The last three are the same shape seen from different ends: **the drive's premise about why
the run ends, or about what it will encounter before it does, stopped being true.** The
fourth is the sharpest form of it, because it cannot be fixed by widening a window: the
premise is about an outcome rather than about a duration.

**What to do about it is not settled, and this section is not a solution.** Reverting the
fix finds an instance once you suspect one; it does not tell you which drive to suspect.
The one technique that prevents rather than detects is the precondition assertion - if a
test needs a precondition
to be meaningful, assert the precondition out loud as its own named test, so it fails
loudly instead of the real assertion passing quietly. `launcher-lives.test.ts` carries one
now (*"ends the game while the boat is still crossing, or this proves nothing"*), and
`tools/probe/tms1370-rom.test.ts`'s `requireNonVacuous` is the same idea for cardinality.
Neither is automatic and neither finds a premise nobody thought to state.

The honest position is that **every timing-sensitive drive in this tree is exposed**, that
this run alone changed the missile speed eighteen-fold, added a wave retreat, corrected the
march ladder's arithmetic and tripled the scoring rate, and that the next cadence change
will do it again to drives nobody has looked at.

### 11b. Work outside a timeout's reach, and the sweep that closes it

A second general form, and the reason it deserves its own entry is that **its symptom
appears in innocent code**. A slow test does not fail. It starves whatever the runner has
in parallel, so unrelated files time out and look broken while the slow one stays green.

Three instances, all one shape:

| Where the work ran | How it surfaced |
| --- | --- |
| Inside an `it`, with no explicit timeout | A 5.4 s drive against Vitest's 5 s default. Green locally, red on a slower runner |
| In a `describe` body, and at module scope | Drives evaluated during collection, outside every per-test timeout. Found in review |
| At module scope | A coverage search no per-test timeout could reach. A badly-playing lever took it from 49 s to 246 s and timed out `render-fidelity`, `launcher-lives` and `tms1370-rom` - none of which had anything wrong |

The third is the instructive one: **four failures were reported in three files whose code
was correct**, and they were nearly filed as real defects.

**The sweep this defines, and it is a checklist rather than an investigation.** Find every
drive, search or loop that runs outside a bounded context - module scope, a `describe`
body, anything not inside an `it` or a `beforeAll` carrying an explicit budget - and bound
it. Mechanical and greppable.

**It does not need a measured constant, and that is what unblocks it.** The fix is *that a
bound exists*, not that the bound is the right size: a generous ceiling that makes a file
name itself is the whole benefit, and a wrong-but-generous number costs nothing. The 60 s
figure previously attached to this follow-up was correctly flagged as a guess; it did not
need to be anything else.

Bounds in place so far: `SEARCH_BUDGET_MS = 240_000` in
`tools/probe/rom-atlas-conformance.test.ts` and `DRIVE_TIMEOUT_MS = 60_000` in
`tools/probe/scoring-ruler.test.ts`. Moving the conformance search into a hook took that
file's **import time from 48.8 s to 107 ms** - which is the figure to watch for, because a
file costing tens of seconds merely to import is a starvation risk whether or not it ever
fails.

## 12. The gate that could not tell clean from never-ran

Every pull request in this run merged with a green CodeRabbit check. Sixteen of the
twenty-five v3-era merges were never reviewed by CodeRabbit at all; the check reported
`SUCCESS` on all sixteen, verified one at a time on 2026-07-30. The gate was not bypassed
and it did not fail. It answered a question nobody had asked it: *did the job finish*,
not *did anything look at the code*.

That is the shape this section is about, and it is not confined to a bot. The same shape
appeared repeatedly in instruments written by hand, by both parties, over three days.

**A second instance, from the brief that opened this work.** The ROM was described as
sitting at 31 of 32 pages, and every plan made downstream of that treated space as the
binding constraint - fixes were sized to it, a page relocation was justified by it, and
one feature was deferred on it. The assembler does print `Pages used: 31 of 32`. It also
prints `Program words: 1470 of 2048` at the time, and `1538 of 2048` now. Pages counts
pages *touched*, not pages full. The ROM was and is about three-quarters empty. The
figure was accurate, it was read off the right tool, and the conclusion drawn from it was
wrong, because the number answers "how spread out is the code" and it was read as "how
much room is left".

**Three audits of this tree's own instruments, all of which the instruments failed.**
Each was found by deliberately breaking the thing the test claimed to protect and
checking that the test went red. None did:

1. The missile-lane assertion passed against a ROM broken on purpose, because the drive
   feeding it never pressed fire.
2. The "lights no missile lane" assertion passed with one of its two arms deleted,
   because it only ever constrained one direction.
3. The unattended-silence assertion in `launcher-lives.test.ts` passed because no parked
   game reached the state it was written to observe any more.

A fourth was found while writing this section: the battleship hunt in
`scoring-ruler.test.ts` launched a missile on 0 of 24 attempts and reported "no
battleship was shot down in any game". True statement, correct arithmetic, nothing to do
with the scoring ruler it was asserting on.

**The quota comment matters more than it looks.** CodeRabbit posted "review limit
reached" on the PRs it skipped. The information needed to catch this was present, in the
thread, the whole time. What was consulted was the check's colour. An instrument that
reports both a status and a reason will be read for its status.

### The three families

**1. Absence read as success.** The instrument observed nothing and reported pass, having
never produced the input that would make the observation meaningful. The CodeRabbit gate,
the silence assertion, and the battleship hunt are all this. The tell is that the passing
condition and the never-ran condition are the same condition, and nothing distinguishes
them. The fix is a precondition assertion: state and check the thing that must be true
for the measurement to mean anything - that a shot was fired, that a game reached the
state, that a review happened - and fail loudly when it is not.

**2. A true and narrow claim accepted as complete.** The instrument answered an adjacent
question accurately, and the accurate answer was taken for the question asked. `Pages
used: 31 of 32` is this. So is the one-sided lane assertion, which correctly proved shots
do not appear where they should not, and was read as proving they appear where they
should. Nothing here is false, which is exactly why it survives review: checking the
claim confirms it.

The **misread-number chain** is the sharpest instance, and it has two halves that need
separating. A figure of `13423.6` in a drive's output was a millisecond timestamp. It was
read as a frequency in Hz, and a mechanism explaining the "anomalous 13.4 kHz component"
was built on top of that reading and pursued. The first half is an ordinary mistake. The
second half is the one worth recording: the misread was accepted and built upon without
anyone returning to the source to check what the column was. The correction, when it came,
had to disprove the mechanism separately from correcting the number, because by then the
mechanism had acquired its own supporting argument. A wrong number is cheap; a wrong number
that has been reasoned from is not.

**3. Tolerances sized for the artefact rather than the machine.** Last, because it is the
one that looks most like rigour. A band, threshold or window fitted to what the instrument
happened to produce will keep passing as the machine moves underneath it. Two from this
run: a median-pitch discriminator that could not separate a fused march-plus-blip from a
clean march, because a fused signal still medians inside the band; and `warningRunsIn`,
which counted every edge rather than rising edges and so reported every frequency at
double, with a band widened until the doubled figures fitted. Both had numbers in them.
Neither number came from the machine.

### A separate mechanism, and the one with no wrong step in it

The three families all contain a mistake somewhere - a wrong assertion, a misread
column, a fitted tolerance. This one does not, which is why it is recorded apart from
them rather than as a fourth family.

**A correct derivation, from correct measurements, that stops early because the
conclusion is attractive.**

The instance. The battleship was driven, the shots were counted honestly, and the
arithmetic was right: aiming at the lane the boat occupies scored 0 in 18 shots over
11 crossings, because the boat descends a lane per 1.29 s while a shot needs 3.0 s to
arrive. Every step of that holds up. It was about to be reported as **"the battleship
cannot be hit"**, which does not follow from it. Leading the boat by two lanes hits it
3 times in 27. What was missing was not a check on the numbers. It was the next
question - *is there another way to aim* - and the reason it went unasked is that the
finding was better without it. "The two most valuable targets cannot be chosen" is a
more interesting thing to report than "I tried one strategy and it failed."

**This is the second instance from the same source in one day**, and by the standard
used everywhere else in this document, two makes it a pattern. The first is in section
11a: a set of starvation calls that were true, that explained the observation, and that
closed the investigation while a second cause was still live. Same shape - accurate
work, satisfying explanation, premature stop, and a conclusion that was stronger than
the evidence carried.

What catches it is worth stating precisely, because the obvious answer is wrong.
Scepticism about the measurements does not help; the measurements are correct, and
checking them again returns the same numbers and more confidence. **What catches it is
asking what else follows from them.** That prompt is already written into section 11a
in its own words: when a measurement surprises you and the explanation is satisfying,
that is the moment to ask what else follows. It was available and it was not used.

Worth recording honestly: this one was not caught by the person who made it. It was
caught because the finding was challenged and a leading control was demanded before
the conclusion was accepted. A mechanism whose only known counter is someone else
declining to take the answer is not yet a solved problem.

### The same misreading twice, from the same six-line header

Family 2 above records `Pages used: 31 of 32` being read as a space budget when
`Program words` one line above was the real figure. **It has now happened a second
time, in the same listing header, on a different counter**, which by this document's
own standard makes it a pattern rather than a slip.

The second instance: `RAM high-water mark: 128 of 128 nibbles`, read as "RAM is full",
and a feature nearly declared unbuildable on it. The mark is `(file + 1) * 16` -
`tools/tmsasm/assembler.ts:702`, driven by whichever file an `LDX` selects. It is the
**highest address reachable**, not the count of nibbles in use. It moved 112 to 128
because a new file 7 was introduced holding exactly two nibbles. File 7 has fourteen
free, and the feature was never in doubt.

The root is worth naming, because it is a property of the header and not of either
reader. Three of its lines are `X of Y`, and `Y` does not mean the same thing in each:

| Line | What `Y` is |
| --- | --- |
| `Program words: 1538 of 2048` | a real capacity |
| `Pages used: 31 of 32` | pages *touched*, so `Y` is a count of containers, not room |
| `Highest address: 2047 ($7FF) of 2047` | a span, and always equal once anything is placed high |
| `RAM high-water mark: 128 of 128` | a span, from file selection alone |

Only the first is a budget. The other three are spans or tallies wearing a budget's
notation, and two of the three have now been read as budgets by two different readers
on the same day. **A span presented as `X of Y` will be read as an occupancy**, and no
amount of care by the reader fixes a label that invites the error.

Unlike most of this section there is a cheap remediation available here - the two span
lines could say `span` or `highest touched` rather than `of N`, and `Pages used` could
carry the free-word count it already knows. That is a change to `tools/tmsasm/output.ts`
and not to this document, so it is named here rather than made.

### A further mechanism: both halves true, the error entirely in the join

Reported by the agent that built the renderer harness, and verified here against the
source before being written down.

The reasoning was: `src/main.ts` calls `board.getLitSegments()`; `getLitSegments()` is
unprotected, returning the last completed frame with no staleness rule; therefore the
application draws a stale lit tube where the probe would report it dark.

**Both premises are true. The conclusion is false, and nothing in between is a
mistake.** They are two different methods that happen to share a name:

- `src/main.ts:189` really does call `board.getLitSegments()`.
- `Display.getLitSegments()` at `src/machine/board/display.ts:282` really is
  unprotected - it is `return this.getFrame().segments`, and `getFrame()` hands back
  `_lastFrame` however old it is.
- But `Board.getLitSegments()` at `src/machine/board/board.ts:299` is a *different
  method*, and it delegates to `this.display.getObservedFrame(...)`, which is the one
  that applies the staleness rule.

The join is invisible precisely because the name is shared. In a layered tree a
wrapper that shares its delegate's method name is exactly where this hides - and the
wrapper usually exists **because** it changes the behaviour, which is what makes the
shared name so misleading.

**The consequence is what earns this a place here.** Every other instance in this
section cost a wrong belief. This one commissioned a **wrong experiment**: believing
the application used the unprotected path, the agent re-ran a 7202-frame renderer
scan driving `getFrame()`, modelling a path the application never takes, and got a
perfectly plausible number that could have been quoted. Nothing about the output
would have looked wrong. **Experiments outlive the sentences that motivate them** - a
retracted claim is retracted, but a measurement taken under it keeps circulating with
its methodology unexamined, and that is the sharper warning.

The check that generalises, and it is cheap: **when a conclusion rests on "X calls Y"
and "Y does Z", confirm the Y in both clauses is the same Y.** What caught it was
grepping for *who calls what* rather than for the symbol. `rg "getObservedFrame" src/`
shows `board.ts` calling it, which is impossible if `board.getLitSegments()` were the
unprotected one. The contradiction is only visible from the caller side; reading
`display.ts` as carefully as you like will never show it, because nothing in that file
is wrong.

### What this section is

**A record, not a remediation.** Nothing here is fixed by this document. Three of the four
instrument failures above have been repaired in this branch and the fourth is repaired in
the commit that adds this section; the gate has not been changed, the review coverage has
not been made up, and the deferred feature is still deferred on a constraint that turned
out not to bind. The value of writing it down is that the next person to see a green check
or a confident figure has a list of the specific ways this tree has produced both while
measuring nothing.

The one habit that found every instance: **break the thing on purpose and watch the
instrument go red.** An instrument that has never been seen to fail has not been shown to
work.

## 13. Where the probe and the application model the tube differently

One divergence, found while checking the shared-name join above, and recorded because
it lands inside a window that already has an anomaly in it.

**`Board.getLitSegments()` falls back to `sampleFrame()` when `frameCount === 0`; the
probe's equivalent does not.** `src/machine/board/board.ts:299` returns
`this.sampleFrame().segments` before any frame has completed, where
`Tms1370Machine.getLitSegments()` at `tools/probe/tms1370-probe.ts:366` goes straight
to `getObservedFrame` with no such branch. So before the first completed frame the
application shows the tube mid-sweep and the probe shows it dark. Both are defensible;
they are not the same.

It only matters before the first completed frame, and that is not an empty window:

- `NIB_BSLANE` reads 0 for the first **11.5 ms** after power-on, measured. Zero is a
  valid lane, and `BS_NONE` is 15, so until the ROM's clear routine writes 15 the
  state says a battleship is crossing in the top lane. A phantom battleship, at
  power-on, for as long as it takes the ROM to clear RAM.
- The probe reports nothing lit at all until **30 ms**, also measured.

So the phantom sits entirely inside the window where the two paths disagree about what
is on the glass. **Two known anomalies in the same 30 ms, with the probe modelling that
window differently from the application**, is worth a note rather than a rediscovery.

Neither is asserted to be a defect here. What is asserted is that any claim about what
the tube shows in the first 30 ms after power-on has to say which of the two paths it
was measured on, because they answer differently and both are in this tree.

## 14. A plane that appears on top of a live missile is not hit by it

**Unresolved. A plane landing on a live shot was always reachable; what is new is that
the shot can now walk away from one.** `jet_enter` draws an entry column of 1 or 2
(`asm/jetfighter.asm`, "The column: the far half of the field"). The ROM before it
entered every plane at grid 1 and **26 spawn coincidences were measured on that ROM**,
so a plane appearing on a cell a shot already stood in is not the new thing. Grid 1 is
where a missile expires against the horizon rather than stepping to a lower column, so
the escape had nowhere to show. Grid 2 is a cell the shot steps *out of*, and from there
it shows.

It survives. The sweep hit-tests a collision at two moments - when the missile steps a
column, and when the squadron marches - and a spawn is neither. The shot takes its next
step, finds the cell it moved *into* empty, and carries on to expire against the
horizon. The plane flies on.

Measured with `tools/probe/drives/entry-onto-missile.ts` over three firing cadences and
90 emulated seconds each, "before" being `main` at 192fefc:

| | before entry positions varied | after |
| --- | --- | --- |
| coincidences (a shot and a jet on one cell) | 94 | 88 |
| the jet was already settled on the cell | 19 | 18 |
| the jet marched onto it that frame | 49 | 40 |
| the jet spawned onto it that frame | 26 | 30 |
| shot walked away from a settled jet | 0 | 0 |
| shot walked away from a jet that marched on | 0 | 0 |
| **shot walked away from a jet that spawned on** | **0** | **6** |

**The collision test itself is not implicated, and the last three rows are the
evidence**: a jet standing on a shot's cell is hit every time, before and after, and a
jet that *marches* onto one is hit every time as well - the march does test. Only the
spawn escapes, and only since grid 2 became an entry column.

**These figures replace an earlier set, and both reasons matter.** The first ones were
taken before the unstirred-entropy fix flipped which column an untouched machine enters
at, so they described a ROM this branch no longer carries. They were also produced by a
classifier that asked the *row* whether a jet had marched. A row can hold two planes, so
a plane settled at column 1 beside a new one at column 2 answered yes and the spawn was
booked as a march. On this ROM the row reading and the slot reading disagree about 2 of
the 88 coincidences and in opposite directions, so the totals happened to come out the
same - which is luck rather than a defence. Both instruments now follow a plane by its
slot and use the row only to decide that a shot and a jet are on one cell.

**Why this is recorded rather than fixed.** Whether the unit hit-tests a spawn cannot be
settled from `assets/reference/`, from the audio, or from the owner's testimony. The
owner's evidence about entry is that "a plane can randomly appear anywhere on the
board" - about variety, and silent on what happens when the board already has a shot on
that cell. Both readings are defensible: a missile fired before the plane existed
arguably has nothing to hit, and a player watching his shot pass through a plane would
call it a bug. `P_SPAWN` is at 63 of 64 words, so the check would not fit where the
decision is made in any case.

`missile-rank.test.ts` excludes spawn-created coincidences from its pass-through tallies
for this reason, and carries an assertion that the exclusion stays a corner of the file
rather than most of it.

## 15. A real 625 Hz tone nobody can name

`assets/reference/gameplay-audio.m4a` and `assets/reference/skill3-video-audio.m4a` -
two separate sessions on the same unit - both carry a **625 Hz tone with six
consecutive partials** (625 / 1252 / 1877 / 2509 / 3129 / 3755 Hz), running **unbroken
for 405-417 ms**, three times in 130 s and twice in 23 s.

It is the machine and not the room. Its sixth partial sits in the piezo resonance the
`battleshipBuzz` section of `audio-reference.md` measures at 3.7-4.5 kHz; it scores
10.9-17.8 dB on a harmonic comb where room silence in the same file scores 4.7 dB; and
the same detector finds nothing across 24 s of `battleship-interval.m4a`, which contains
two full boat arrivals and no squadron.

It is also not the periodic clicks in those recordings, which the owner has suggested may
be his own thumb on the controls. Two of the video's tone episodes - 14.10-14.51 s and
17.70-18.11 s - fall *inside* the 3.2 s and 4.6 s silences in that recording's click
train.

### What the score does across an episode

A sound that blanks the tube and is followed by a changed score would be a scoring event,
so the video was read frame by frame to test exactly that. The result is **suggestive and
does not close it**, and why it does not is the useful part.

| Time | Score readout | Relation to a tone episode |
| --- | --- | --- |
| 13.30 s | **SCORE 18**, a red plane and cyan sprites on the glass | 0.8 s before episode 2 |
| 13.70 s | not lit | before |
| 14.05 s | not lit | before |
| 14.55 s | not lit | just after |
| **14.70 s** | **SCORE 20** | 0.2 s after |
| 15.00 s | SCORE 20 | - |
| 16.50 s | SCORE 20, a squadron of cyan jets | 1.2 s before episode 3 |
| 17.00 - 22.50 s | not lit at any sample | spans episode 3 |

**The score rises by two across the 14.10 s episode.** Two is `SCORE_JET_MID`, a jet shot
in the ruler's `2` band, so a jet kill is the right size of event.

Three things stop that closing the question:

1. **n = 1.** The readout is unlit at every sample from 17.00 s to the end of the video,
   so the 17.70 s episode cannot be tested at all, and the three episodes in
   `gameplay-audio.m4a` have no picture to read.
2. **The converse is untestable here.** "The score never rises without an episode" needs
   a readout legible most of the time, and this one is dark for more of the video than it
   is lit. The 18 could have become 20 anywhere in the 1.4 s between the two legible
   frames.
3. **It runs against owner-confirmed testimony.** The `missileFire` section of
   `audio-reference.md` records, as Owner-confirmed, that a missile *hitting* a jet makes
   the same ~20 ms beep as firing and that there is **no separate explosion sound**. A
   410 ms tone is not that. Either the tone is not a kill, or a claim the owner confirmed
   is wrong, and one score reading is nowhere near enough to prefer the second.

The same frame-by-frame read killed a different claim, recorded in `audio-reference.md`:
the tube is *not* specifically dark during the tone. It is also dark from 13.70 s, four
tenths of a second before the episode starts, and for the whole 17.00-23.20 s stretch.

### The fundamental, precisely - and what it says about unit identity

Run because the recordings have been proposed to be **two different physical units**
(`timing-analysis.md` records the two clips disagreeing by 3.5x on missile speed and 4.7x
on aircraft speed, measured from pictures with no audio involved). A delay-loop note is
clocked off the chip's own RC oscillator, so its pitch is a property of the hardware and
can test that directly.

**The null first, because agreement without a scale is a number.** MAME fits this part's
oscillator at 350 kHz and its driver header states the spread that carries: the frequency
*"can differ up to 50kHz"* unit to unit, partly from ageing. That is **±14%**, carried in
this repository as `OSCILLATOR_SPREAD_HZ` and discussed in
`docs/research/mp2110-timing-measurement.md` §4. At 626 Hz, ±14% is **±88 Hz**.

Method: the fundamental as **the median spacing between adjacent partials**, which is the
method `audio-reference.md`'s `win` section uses and the reason it gives - *"a fundamental
is the spacing between adjacent partials"*. Resolution is measured rather than asserted:
the same fit over three disjoint thirds of each run.

| Recording | at (s) | f0 | sub-window spread | residual |
| --- | --- | --- | --- | --- |
| `gameplay-audio.m4a` | 12.71 | 625.80 Hz | 0.17 Hz | 0.14 Hz |
| `gameplay-audio.m4a` | 28.90 | 625.60 Hz | 0.47 Hz | 0.28 Hz |
| `gameplay-audio.m4a` | 116.17 | 625.77 Hz | 0.23 Hz | 0.19 Hz |
| `skill3-video-audio.m4a` | 14.20 | 624.88 Hz | 0.35 Hz | 0.09 Hz |
| `skill3-video-audio.m4a` | 17.85 | 624.93 Hz | 0.15 Hz | 0.10 Hz |
| `IMG_6113` t=120 | +0.75 | 623.11 Hz | 0.24 Hz | 6.46 Hz |
| `IMG_6113` t=120 | +6.54 | 623.11 Hz | 0.05 Hz | 6.57 Hz |

**Seven episodes across three recordings span 2.70 Hz - 0.432%, thirty-two times inside
the ±14% two-unit null**, with a worst measurement noise of 0.47 Hz. On the audio, these
are one machine. Two units agreeing to under half a percent on an untrimmed RC oscillator
would be the coincidence; one unit on three occasions agreeing this closely is what the
part does.

**The structure inside that span is real and is not noise**: each recording clusters
tightly on its own value - 625.7, 624.9, 623.1 - separated by more than the within-episode
spread. A third of a percent of drift between sessions is ordinary for an RC oscillator
with temperature and supply. It is nowhere near a different part.

**Two things this does not say.** It cannot explain a 3.5x or 4.7x speed difference - that
is far too large to be a clock effect, and 0.4% of clock drift would move a speed by 0.4%.
And it does not identify the sound. It says the *emitter* is the same across the three
recordings, which is a claim about hardware, not about what the program was doing.

If both hold, **one unit in two states** fits better than two units, and the state to test
is the **skill dial**: every `IMG_6113` row in `timing-analysis.md` records the skill as
"unknown", while the skill-3 clip's is stated by the owner. A tired supply is the other
obvious candidate and this measurement argues against it - a sagging supply moves an RC
oscillator's rate, which would move this note, and it has moved by 0.4%. *Whether the real
unit scales missile speed with the dial is `timing-analysis.md`'s question, not this
one's; the ROM's `MISSILE_LO`/`_HI` are constants and do not.*

**A method note, because the first version of this measurement was wrong.** It fitted the
partials by least squares through the origin and read `IMG_6113` t=120 as **626.9 Hz**. The
residual column is what exposed it: 3.8 Hz there against 0.1-0.2 Hz elsewhere. Five of
that episode's six gaps measure 623.1 Hz and only the third partial is astray, and a fit
through the origin is pulled by one bad partial while still returning a confident-looking
number. The median of the gaps ignores it. **A fit that cannot fail needs a residual
printed beside it**, which is the same lesson as the partial-ratio table earlier in this
section.

**What is unresolved**: what game event fires it. Nothing in the ROM emits a 410 ms tone,
and no rule in the PRD predicts one. The episode times in `gameplay-audio.m4a` are
12.60, 28.80 and 116.10 s; in the skill-3 clip, 1.10, 14.10 and 17.70 s; and in
`IMG_6113` t=120, at +0.60 and +6.30 s, where the runs are longer still at **699 and
649 ms**.

Those last two widen the range from 405-417 ms to **405-699 ms** and are worth their own
line, because they arrive from the window §16 uses as its *no-blanking* control. A sound
this long that darkens nothing is the single most useful fact recorded about it so far:
it is what separates this tone from §16's population, and it is a constraint on any
future guess at the trigger.

**What would settle it**: a video where the tube stays legible - the owner's unit filmed
in a darker room, or anything that stops the readout going dark for seconds at a time -
covering several episodes. The score table above then becomes a census instead of one
row. Failing that, two questions to the owner: what makes a sound about half a second
long, and whether shooting a jet sounds different from firing at one. The second is a
direct re-test of the `missileFire` row that point 3 collides with.

Re-derive every audio figure here with `tools/probe/drives/march-tone-identity.ts`. The
score readings come from the owner's video and are **not** re-derivable from the
committed audio; the timestamps are given so they can be re-read from the source file.

### Added from §17's pass over the same clip: episode 3 *can* be tested, and it says no

Point 1 above rests on "the readout is unlit at every sample from 17.00 s to the end of
the video". **That is a sampling artefact.** Read frame by frame from the registered
stack rather than at half-second samples, the score digits are lit in **nine separate
windows after 17.00 s**: 17.03-17.07, and then 19.93-20.17, 20.33-20.43, 20.60-20.70,
20.87-20.97, 21.13-21.23, 21.40-21.50, 21.67-21.77 and 21.93-21.97. The last seven are a
regular ~270 ms flash, which is the end-of-game display rather than play.

**Eight of the nine read 20.** The ninth is the last flash of the clip, 21.93-21.97 s,
two frames, heavily overexposed - and its tens digit is unmistakably a **3**, not a 2:
the bottom-left segment is dark and the bottom-right lit, the opposite of every reading
before it. What it means is not established. A score cannot climb after the game has
ended, so the candidates are a partial multiplex catch (the following frame lights the
tens digit alone, so the two digits are being strobed separately by then), bloom on a
saturated segment, or something the end-of-game display does that nothing here models.
It is recorded and not explained.

**It does not bear on episode 3**, which is what this addendum is about: the two
readings that bracket the episode are 17.03-17.07 s and 19.93-20.17 s, and both are
plainly 20. So episode 3 (17.70-18.11 s) has a legible score 0.6 s
before it and a legible score 1.8 s after it, and **the score did not change across it**:

| Time | Score readout | Relation to episode 3 |
| --- | --- | --- |
| 16.60 s | SCORE 20 | 1.1 s before |
| 17.03 - 17.07 s | **SCORE 20** | 0.6 s before |
| 19.93 - 20.33 s | **SCORE 20** | 1.8 s after, tube now flashing |

Every row is a frame measured lit before it was read: 536, 564, 409, 640 and 704 lit
pixels in the digit box against a 40-pixel floor. **A fifth row said "21.33 s, SCORE 20"
and has been removed - that frame is dark, 0 lit pixels.** It came from misreading a
contact sheet whose frame list contained a duplicate, so a panel was attributed to the
wrong timestamp. Nothing else in this addendum depended on it, and the three rows that
bracket the episode are unaffected, but it was a row of data that was never observed and
it should not have been written.

**The census is therefore n = 2, one for and one against**, not n = 1 suggestive.
Episode 2 has the score rising by two across it; episode 3 has it flat across it. That
does not settle the question either, but it moves it: a tone that fires on a scoring
event should not fire when no score is scored, so the reading that survives both rows is
that the tone is **not** a kill - which is the reading point 3 already preferred on the
owner's testimony.

**One correction to point 3's own footing, from the other direction.** It leans on
`audio-reference.md`'s `missileFire` row, 1480-1632 Hz, being what a fire and a hit both
sound like. Measured in *this* recording, the unit's fire blip is a **2577 Hz** tone, sd
7.6 Hz over sixteen events, each leading a visible missile launch by a median 50 ms - see
§17 and `timing-analysis.md`, "The skill-3 clip". 2577 is not a harmonic of 1520. So the
band that point 3 reasons from may not describe this unit, and the collision it worries
about is softer than it looks. That is a reason to re-measure `missileFire`, not a reason
to prefer the kill reading.

Method and re-derivation: `tools/video/clip.py` then `tools/video/measure.py` for the
audio figures; the score windows come from thresholding cyan excess in the digit box of
the registered stack, which is the same colour-excess rule the rest of this analysis
uses. The tube-blank question in §16 is untouched by any of this.

## 16. The real machine blinks about once a second - ANSWERED: it is the speaker, and which sounds

`vfd-appearance.md` §5 measures, off video of the owner's unit, **complete whole-display
blanking on 14-17% of all frames during active play**, in runs of **4-5 frames (133-167
ms)**, at roughly one per 1.1 s. It calls that "the loudest thing this document has to
say about the look", and the mechanism is not in doubt: the chip bit-bangs the speaker in
timed delay loops and is not sweeping the tube while it does, so every sound is a blink.

**Nothing we had identified sounded at that rate for that long** - the reasoning that
follows is kept because the resolution below turns on which of its premises was wrong.

- The march note, at 71.8 ms a step, is the emulator's main source of blanking - but it
  is 71.8 ms, and the observed runs are 133-167 ms. It never matched the thing it was
  supposed to explain. And on the evidence in the withdrawn `jetMarch` section of
  `audio-reference.md`, plus the owner's "no marching sound", the real unit does not
  play it at all.
- The 625 Hz tone of §15 is 410 ms and fires a handful of times a game.
- `missileFire` is ~20 ms, under one video frame.
- The two-beep launcher warning measures 141.7 ms of blank on the running machine, which
  *is* in the observed range - but a warning costs a launcher, and there are three of
  those in a game, not one a second.

So the arithmetic does not close, and it is worth stating the size of the gap: removing
`jm_beep` takes the emulator's dark-frame fraction to **1.55%** in `sweep-timing.test.ts`
and **0.73%** in `blank-to-glass.test.ts`, against a machine measured at 14-17%.

### ANSWERED: the blanks are a 600-650 Hz tone of 130-210 ms, and a shot's blip

The analysis this section asked for has now been done - `tools/video/blanking.py`,
which locates every dark run in a window of `IMG_6113.mov` and classifies it by **its
own dominant bin**, the way `timing-analysis.md` classifies an onset rather than
trusting the band it was found in.

**The instrument was validated against this document's own census first.** Run on the
same windows §5 of `vfd-appearance.md` measured, it returns 0.0% at t=120 against their
0/600, 13.2% at t=210 against their 13.8%, and 16.7% at t=340 against their 16.7%. The
t=25 window is excluded: the unit sits differently there and a glare patch falls inside
the fixed tube box, so the frame never reads dark and the tool returns 0.7% against
their 6.5%. That is the tool's limit, stated - the box is fractional and fixed, which
holds within a window and not across windows where the unit was repositioned.

**It is the speaker, confirmed rather than assumed.** 82% of dark runs have an audio
onset within +/-50 ms against a phase-shuffled null of 45% (p95 64%). `P(dark | loud)`
is 0.39-0.51 against `P(dark | quiet)` of 0.05, reproducing this document's 0.37-0.46
against 0.04.

**Which sound: every long blank is one of two, and both are already modelled.** Over
t=210 and t=340 together, the dark runs classify as:

| Dominant at the run's onset | Runs | Blank length |
| --- | --- | --- |
| 603-635 Hz - the `jetMarch` band, tonality 0.57-0.80 | **25** | 133-200 ms |
| 1593 Hz - the `missileFire` band | **6**, of which 4 corroborated - see below | 133-167 ms |
| 151-248 Hz, tonality 0.21-0.48, unclassified | 9 | **33 ms - one frame each** |
| 1820 Hz, tonality 0.26, unclassified | **1** | **167 ms - the one exception** |

**31 of the 32 runs longer than one frame are one of the two bands**, and nine of the
ten unclassified runs are single frames, which is what sensor noise looks like. **And
the blank lasts as long as the sound**: median blank 133 ms against median sound
132-150 ms, r = +0.63 and +0.65 in the two windows. The mechanism §5 states is
confirmed and the sounds are named.

**The exception is left standing rather than absorbed.** One 167 ms run at t=340+19.00 s
has its dominant at 1820 Hz with a tonality of 0.26 - just above `missileFire`'s
1480-1632 Hz and not tonal enough to call a note. It is one run in 41 and it does not
change the reading, but "every" was the word this section originally used and it was
wrong by one, which is the kind of error that survives precisely because the headline
is right.

**The duration gap closes on the note, not on the blank.** The bullet above is right
that 71.8 ms cannot produce a 133-167 ms blank. The resolution is that the real unit's
notes in that band are **130-210 ms**, roughly twice what the ROM emits. Gated on band
share, t=210 holds 13 such notes and t=340 holds 16.

**What separates the blanking windows from the quiet one is the length of what is in
the band, not the band being occupied.** An earlier version of this passage said
"three recordings agree" and leaned on the skill-3 clip's absence of both notes and
blanking as a third supporting window. That was weaker than stated: **t=120 has the
band occupied and blanks 0.0%**, so it is not a third agreeing case, it is the
discriminator. The skill-3 clip's row is kept below for completeness and carries no
weight in the argument - a clip with neither notes nor blanking cannot distinguish
between the two, whatever it is a recording of.

> **A note on the words "long" and "short", because this section and the one below
> nearly used them for opposite things.** "The blanking attaches to the long
> population" and "the sound that darkens the display is the short population" are
> both defensible sentences and they mean the same thing, because each is relative to
> a different comparator: the events that blank are **long** against t=120's 69-75 ms
> notes and **short** against §15's 405-699 ms tone. They are one population reported
> by two instruments that bracket it from opposite sides.
>
> **Three quantities, named, because a first draft of this note spliced two of them.**
> It said "the 126-210 ms events", which is a number appearing nowhere else in the
> section: 126 is the floor of the run length below and 210 the ceiling of the note
> length above, taken from two different instruments and joined. That is the same
> defect this note exists to fix, one level down, and it is deleted rather than
> reconciled. What there actually is:
>
> | Quantity | Instrument | Measured |
> | --- | --- | --- |
> | Note duration, gated on band share | `tools/video/blanking.py` | 130-210 ms at t=210, 103-288 ms at t=340 |
> | Unbroken run length | `march-tone-identity.ts` §3c | 126-155 ms |
> | Dark-run duration | `tools/video/blanking.py` | 133-167 ms, one at 200 ms |
>
> **Length is a correlate here, not the discriminator.** The two populations are told
> apart by harmonic comb - `march-tone-identity.ts` §3c's instrument - and they happen
> to differ in duration as well. A 225 ms note in the t=120 window scores 23.9 dB on
> that comb, is §15's tone, and does not blank; the notes that blank score 1.0-8.2 dB.
> Reading the correlate as the cause is a mistake this section made and the paragraph
> below the table now records.
>
> **The three overlap, and that overlap is the finding rather than an inconvenience.**
> The sound and the blank measure the same length because the blank *is* the sound -
> the tube is not swept while a note plays - and the two instruments disagree at the
> edges because one gates on band share and the other on an unbroken run. Everything
> below states a length in milliseconds with the quantity named, and anything that
> reintroduces "long" or "short" should say against what.

| Window | sustained 600-660 Hz notes | of which 100-300 ms | frames dark |
| --- | --- | --- | --- |
| `IMG_6113` t=210 | 13, 129-209 ms | **13 of 13** | 13.2% |
| `IMG_6113` t=340 | 16, 102-287 ms | **16 of 16** | 16.7% |
| `IMG_6113` t=120 | 14, 68-660 ms | **2 of 14** (110 and 225 ms) | **0.0%** |
| the owner's skill-3 clip | **none** - the band never exceeds 11% share | - | ~0% (5%, all single frames) |

> **The t=120 row said "14, but durations 69-75 ms" and that was wrong.** 69-75 ms is
> that window's *mode*, not its range: eleven of its fourteen notes are 68-99 ms, but
> two are 110 and 225 ms and one is 660 ms - the long tone §15 measures. Quoting the
> mode as the range hid both ends, and it hid them in the direction that made the
> argument tidier, which is the direction to distrust. Re-derive the distribution with
> `python3 tools/video/blanking.py ~/Downloads/IMG_6113.mov 120 20`.

t=120 is the informative row. Its notes are **mostly** the length
`audio-reference.md` synthesises and the ROM emits - eleven of fourteen at 68-99 ms,
with a mode of 70 - and it does not blank at all. So a note of the ROM's length does
not produce a measurable blank at 30 fps, and the emulator's dark-frame fraction was
never going to reach 14-17% by emitting one. That is the claim this section needs and
it survives the corrected figures: the two windows that blank contain **nothing but**
100-300 ms notes, 13 of 13 and 16 of 16.

**A residual was recorded here and has now been closed, and closing it corrected the
rule.** t=120 holds two notes in the 100-300 ms range, at 110 and 225 ms, which a
length rule says should have blanked about 1.5% of frames against a measured 0.0%.
Located in the frames and looked at:

| t=120 note | harmonic comb, partials 2-6 | tube at its quietest |
| --- | --- | --- |
| 660 ms at 0.73 s | **23.7 dB** | 80% of the window median |
| **225 ms at 6.94 s** | **23.9 dB** | **126%** - not dark at all |
| 110 ms at 14.11 s | 3.5 dB | 67% - a dip, not a blank |
| 70 ms at 8.45 s | 12.8 dB | - |

against the notes that *do* blank, at t=210: **1.0, 2.3 and 8.2 dB**.

**So the detector did not miss them, and length was the wrong rule.** The 225 ms note
is §15's tone - 23.9 dB, indistinguishable from the 660 ms one beside it - and §15's
tone does not blank whatever length it runs to. It was never a counterexample, because
it was never in this section's population. **What separates the two populations is the
comb, not the duration**, exactly as `march-tone-identity.ts` §3c has it; the durations
differ as a correlate and this section had been reading the correlate as the cause.

**A residual about the 110 ms note was recorded here as a duration boundary, and
censusing it showed there is no boundary.** Every sustained note in the three windows,
filtered to a comb below 12 dB - §15's tones score 23.7-23.9 - against whether the
tube went dark while it played:

| Window | frames dark | comb-weak notes | durations | blanked |
| --- | --- | --- | --- | --- |
| t=210 | 13.2% | 13 | 129-209 ms | 13 of 13 |
| t=250 | 12.5% | 10 | **61**-197 ms | 10 of 10 |
| t=300 | 16.2% | 8 | 132-193 ms | 8 of 8 |
| t=340 | 16.7% | 13 | 102-209 ms | 13 of 13 |
| **all four** | | **44** | **61-209 ms** | **44 of 44**, tube at 0-8% of median |
| **t=120** | **0.0%** | **7** | 68-110 ms | **0 of 7**, tube at 83-122% of median |

**A 61 ms note blanks at t=250 and a 74 ms note does not at t=120**, which ends any
duration rule outright: the shorter one darkens the tube completely and the longer one
leaves it brighter than its own median. Across the four blanking windows every
comb-weak note blanks whatever its length, over a range spanning more than three to
one.

So the discriminator is **the window, not the note**. Something about t=120 suppresses
blanking for sounds that blank elsewhere, and this analysis does not say what. It is
the window `vfd-appearance.md` §5 calls "a quiet stretch - which is the control", and
its tube carries far more lit phosphor than the others: a median of 1452 lit pixels
against t=210's 614. Whether that is a different game state, a different display mode,
or something else is open.

**Every duration from this tool is long by 6-7 ms, and that is measured rather than
assumed.** `blanking.py --calibrate` runs the estimator against 626 Hz bursts of known
length: start-to-start reports +5.6 to +7.4 ms across 60-300 ms. A review proposed
adding the final FFT window's 23.2 ms span on the reasoning that the note is still
sounding through it - sound reasoning, and empirically wrong, because the windows
overlap sixteen to one so the first qualifying window starts *before* the note and the
last starts before its end. Calibrated, that correction would make the tool long by
about 30 ms instead of 7. The figures above therefore carry a constant +6-7 ms, which
is well inside every distinction drawn with them and is recorded rather than removed.

**What that costs the section:** nothing in its conclusion, which is that the blanking
is the speaker and the sounds are named - that rests on the 44 of 44. What it costs is
a mechanism sentence this section has now had wrong twice. Length is not the rule, and
comb is not the rule either, because t=120's 110 ms note is comb-weak and does not
blank. **What the sound is determines whether it *can* blank; whether the window blanks
at all is decided by something else, and that something is not identified here.**

The two extra windows in that table were decoded to answer exactly this, rather than
being left as a note saying somebody should. That matters because the paragraph this
replaces had already made the mistake once: it recorded a residual, then wrote a rule
in the same breath that the residual falsified. Logging a residual is not the same as
respecting it, and the cheap version of respecting it is to close it before writing the
rule it qualifies.

### The fire blip does blank the display, and two of the six labels do not survive

`isBuzzOutput`'s companion question - whether the *other* blanking source is real -
is now tested rather than asserted, by `tools/video/blanking.py`'s fire-blip pass.

**A dominant bin is not a detection, and that is what the six `missileFire` labels
rest on.** Their tonality runs 0.13-0.40 against 0.59-0.80 for the march notes, so
the loudest bin being 1593 Hz says much less for them than it does for the march.
Corroborating it needs the band to be *loud*, not merely top: a real blip holds
12-18% of total energy for 20-48 ms.

| Window | blips meeting that | dark runs on a blip | chance (p95) | blips that blank |
| --- | --- | --- | --- | --- |
| t=210 | **5** (20-48 ms) | 23% at +/-100 ms | 5% (14%) - **above chance** | **4 of 5** |
| t=340 | **0** | - | - | - |

So at t=210 the label holds twice over: four of the four runs labelled `missileFire`
sit on an independently detected blip, dark runs land on blips above a
phase-shuffled null, and four of the five blips blank the display. **The null is
built for the subset shape** - blips are rarer than dark runs, so the question is
whether a dark run lands on a blip; a one-to-one null would reject on arithmetic
before looking at the data.

**At t=340 there is no blip at all** by the same criteria, and the window's whole
fire band holds 5 frames above 12% of energy against t=210's 68. Its two
`missileFire` labels are therefore **uncorroborated and should be read as
unclassified**, which takes the identified population from 31 of 32 to 29 of 32.
The three threshold crossings that window does contain last 1, 3 and 6 ms - the
same shape as the single-frame dark runs, and noise for the same reason.

That does not weaken the section's conclusion, which rests on the march notes: 25
of the runs are those and they are not in question. It sharpens what the second
source is worth. The fire blip blanks the display **where it occurs**, on one
window's evidence, and it does not occur in the other.

**And one fire sound has never been tested against blanking at all.** The owner's
skill-3 clip fires at **2577 Hz** - sixteen events, sd 7.6 Hz, each leading a visible
missile launch by a median 50 ms, which is as well established as anything here. It
is not the 1593 Hz measured above, and it has no blanking result because **that clip
has almost no blanking to test it against**: 5% of its timeline dark, all of it in
single frames. So the finding above is about the fire sound in `IMG_6113` and says
nothing either way about the one in the skill-3 clip. That holds whatever the two
recordings turn out to be recordings of, which is why it is stated in terms of the
clips rather than in terms of units.

### What this does and does not settle for the removal

**It removes the blocking reason.** This section blocked taking `jm_beep` out on the
grounds that the blanking would then be unexplained. It is now explained, and the
explanation says the emulator's 71.8 ms note is not the thing that produces the measured
blanking in any case - the t=120 row is a note of exactly that length blanking nothing.
Removing it costs the emulator a dark-frame fraction it was never entitled to claim.

**It does not settle whether the sound is the march.** What is measured is a tone in
the `jetMarch` band, at the blanking rate, long enough to blank. Whether it is *tied to
the squadron's step* is a further claim and this does not establish it: the intervals
between long notes run 0.15-3.17 s with medians of 1.15 s and 1.39 s in the two windows,
against a per-aircraft step measured at 1.2-1.9 s median 1.4 s. The medians sit inside
that range and the spread does not, so a clean one-note-per-step reading is not
supported.

**It does sit against the owner's testimony, and that has to be said plainly.** He
reports no marching sound, and the `jetMarch` row of `audio-reference.md` was withdrawn
on that basis. The band is nevertheless occupied in his own recording, by a tone with a
tonality of 0.57-0.77, 25 times across 40 s, and it is what darkens his display. One of
those two things is wrong, and this analysis cannot say which: a player may not describe
a once-a-second blip as "a marching sound", and a band can be occupied by something that
is not the march. **What would settle it** is the question already queued for the owner
in §15 - whether shooting a jet sounds different from firing at one - plus a third:
whether he hears anything at all in step with the jets advancing.

### The blanking sound is not §15's tone, and the two were nearly conflated

This section and §15 both describe something in the 600-650 Hz band, and it would be
easy to read them as one finding measured twice. They are two sounds.
`tools/probe/drives/march-tone-identity.ts` §3c puts both through one instrument, which
is the thing neither analysis had done - §15's came from `gameplay-audio.m4a` and the
skill-3 clip, this one from `IMG_6113.mov`, by two different tools.

| | §15's tone | this section's runs |
| --- | --- | --- |
| unbroken run | 405-699 ms | 126-155 ms |
| harmonic comb, **same 100 ms window for both** | **17.4 dB** | 6.6 dB |
| partials 2-6 over their neighbourhood | **15.2-20.5 dB** | 1.8-7.1 dB |
| fundamental | 626 Hz, spread 9 Hz | 625 Hz, spread 26 Hz |

Room silence scores 4.7 dB on that comb. So §15's tone is strongly harmonic and these
runs are barely tonal by this measure, which is a different statistic from the 0.57-0.80
tonality quoted above and disagrees with it; both are recorded rather than one being
preferred.

**The discriminator is this section's own t=120 control.** It blanks 0.0% and contains
two of the longest tones measured in any recording - 699 and 649 ms - and not one short
event. t=210 and t=340 blank 13.2% and 16.7% and contain sixteen short events between
them and one long tone. **A long tone can be present with no blanking at all.** So the
sound that darkens the display is this section's short population, and §15's tone is
something else that happens to share the band.

That matters for the removal. The question "is there a march" now attaches to *these*
runs - which are at roughly the right rate and the right length - and not to §15's tone,
whose rarity was most of the argument against it. **`jm_beep` stays in the ROM** until
that is settled.

### A note on how these two findings nearly became one

Worth recording because the mechanism is general. §15's drive gated an episode at "comb
>= 10 dB **and** unbroken run >= 200 ms", and every run in this section fails the second
condition by construction. It reported five episodes and concluded from that count that
the band held nothing on a step cadence. The gate had decided the answer.

The fix is not a better threshold, it is **printing the sweep instead of a cell**: that
drive's §3b now reports the count at every combination of both gates. Read as a grid, the
count is flat across every continuity value in `gameplay-audio.m4a` and the skill-3 clip
- so nothing was hidden *there* - and in t=210 it falls 9, 9, 1, 0 as the floor moves 50,
100, 150, 200 ms. The cliff is where this section's population was being erased.

This is the same shape as §11a, and as the `speaker-bands.test.ts` non-monotonicity found
the same evening: **a constant nobody thought of as an input decides the result.** The
countermeasure that works is to sweep it and publish the curve.

## 17. What repeats at 208 ms in both audio recordings of the unit

**Two recordings of the same machine, made months apart, each carry a repetition at
about 205 ms that nothing has identified.** That is the whole of the finding, and its
history is worth more than the number, because the number has now been given two
confident explanations and both were wrong.

`assets/reference/gameplay-audio.m4a` gave **205.1 ms, sd 22.1, n = 21** across five
uninterrupted runs of onsets in the 585-660 Hz `jetMarch` band. It was read as the
squadron's step rate and the ROM's cadence floor was derived from it. That reading is
**withdrawn**, on `IMG_6113.mov`: in the one window where both can be measured against
each other the column steps run 1067-1200 ms while the same band repeats at 763 ms, and
the step onsets land on troughs of that envelope. `timing-analysis.md` carries the
detail.

The owner's skill-3 clip gives the same period again - envelope autocorrelation peaking
unambiguously at **lag 208-213 ms, r = 0.35**. That was read as the squadron's step rate
a second time, and a "the ROM is 2.4x too slow" figure was drawn from it. The owner then
said: *"the sound might also be me hitting buttons, not from the device electronics."*
That reading is withdrawn too.

**This is a different sound from §15's, and the two sections must not be collapsed.**
§15's is a *tone*: 625 Hz with six partials, sustained unbroken for 405-417 ms, a handful
of times a game. This one is a *train of transients* about 208 ms apart, running for most
of the clip, with no tonal peak at all - the same onset times fall out of band envelopes
at 380-470, 590-740, 1620-1760, 2500-2660 and 2780-2960 Hz. They are also separable in
time: two of §15's episodes fall inside stretches where this train goes quiet. Three
unexplained sounds are now on the record in one recording - that tone, this train, and
the 2577 Hz fire blip below, which is the only one of the three that is identified.

**Known.** It is real: an envelope autocorrelation over 23 s is not something a
refractory window manufactures. It is **broadband** - the same onset times fall out of
band envelopes at 380-470, 590-740, 1620-1760, 2500-2660 and 2780-2960 Hz, which is a
transient's signature and not a note's. And it keeps time with nothing visible: tested
against missile launches, missile column steps and jet column steps, each against a null
built by sliding the same event list to a random phase, only the launch row clears its
95th percentile and it does so because the machine's fire tone is inside the train.

**Also known, and it forecloses the easiest answer.** The recording *does* contain
device audio. Sixteen onsets carry a tone at **2577 Hz, sd 7.6 Hz**, and fourteen sit
within 100 ms of a visible missile launch, leading it by a median 50 ms. A thumb does
not do that. So "it is all handling noise" cannot be asserted merely because handling
noise is present.

**Not known.** Whether the 208 ms train is the owner's thumb, the lever's detents, the
case, or a sound the machine makes that has no visible correlate. The two candidates the
picture can offer - firing and moving the launcher between lanes - together reach 52%
against a 47% p95 at +/-100 ms, which is not an identification.

### What would settle it

**A recording of the unit with nobody touching it.** Power on, set it down, let a game
play itself out. If the 208 ms train survives, it is the machine; if it stops, it is the
hand. That is one minute of the owner's time and it closes a question that has produced
two wrong ROM-facing inferences.

Failing that: the same clip re-recorded with the phone on a support and the unit on a
table, so handling is removed while play continues.

### A second thing the skill-3 clip found, recorded here because it is the same shape

The unit's missile-fire blip in that recording is **2577 Hz**. `audio-reference.md`
records `missileFire.dominantHzRange` as 1480-1632 Hz from `gameplay-audio.m4a`. 2577 is
not a harmonic of 1520. Either the two recordings caught different sounds, or one of the
two measurements is of something else. Not resolved here, and flagged rather than
changed: `audio-reference.md` is measured from the owner's isolated recordings and one
video-side reading is not grounds to move it.

## 18. The cadence ladder reaches a rung below the floor its own constants document

`asm/jetfighter.asm` documents `STEP_HI_MIN` as "the floor: 32 sweeps, 488 ms" and
reasons from that figure in the cadence header. `step_reload` computes the rung with
`SAMAN` and takes the floor branch **only when that subtraction borrows**:

```text
        SAMAN                   ; A <- STEP_HI_MAX - A
        BR   sr_ok              ; taken when it did not borrow
        CLA
        A1AAC                   ; the floor: one high nibble
sr_ok:
```

Zero does not borrow. At skill 3 with four kills, `STEP_HI_MAX - kills - STEP_SKILL *
(skill - 1)` is exactly `8 - 4 - 4 = 0`, so `sr_ok` is reached with A = 0, `STEP_HI` is
written as zero, and the squadron steps every **16 sweeps** - half the documented floor.
Measured by `tools/probe/drives/march-wall-clock.ts`: 16 sweeps asked, 16 run, **325 ms**
of wall clock. A fifth kill floors the ladder back up to 32 sweeps, so the descent is not
monotonic either.

**Why it survived.** `tools/probe/march-cadence.test.ts` already asserted "never takes a
step the cadence ladder cannot ask for" - but every run in that file is at skill 1 with
fire never pressed, so `NIB_KILLS` stays 0 and the assertion has never been within four
rungs of the floor. The file's own header called 16 sweeps "a cadence no skill setting
and no score can produce". It can.

**Not fixed here**, because the task that found it was measuring the video and was
forbidden to touch `asm/`. The fix is one instruction. It is recorded in two assertions
of opposite polarity so it cannot be lost: `march-cadence.test.ts` carries the rule as an
`it.fails()`, and `march-wall-clock.test.ts` asserts the sub-floor rung is still
reachable. A fix turns both red at once.

**One consequence to weigh before fixing it.** That accidental rung is the *only* one on
the skill-3 ladder inside the range the owner's skill-3 clip actually shows - 267 to
467 ms, median 300. Raising it to the documented 488 ms makes the ROM slower at exactly
the point the owner says it is already too slow. The right order is to re-derive
`STEP_SKILL` against the video first and repair the floor second, so the repair is not
mistaken for the pace change.
