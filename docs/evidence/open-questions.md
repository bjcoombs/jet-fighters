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

T1 (the march step) is the exception and **has** now been measured, from the march
beep onsets in `gameplay-audio.m4a`: 205.1 ms mean, sd 22.1, n=21 across five
uninterrupted runs. That is the only cadence figure in the ROM derived rather than
chosen. Everything else remains marked `PROVISIONAL`.

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

### 3d. The machine's only randomness is the player's own rhythm

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
## 6. The capture rule is unsettled, and #74 may need reverting

**This is the largest open gameplay question and it is the owner's to settle.**

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
