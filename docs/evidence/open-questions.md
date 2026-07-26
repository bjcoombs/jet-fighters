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

- The **21 per-column jet variants**. The jet sprite changes shape column to column
  so a flying jet appears to beat its wings - the animation is in the phosphor, not
  the program. Confirmed by the owner and visible in the ghost field, but these
  photographs cannot resolve 21 distinct outlines. The atlas currently repeats one
  outline.
- The **battleship sprite**, entirely untraced. Neither photograph catches a
  crossing. It is worth 10 points and has a documented buzz, but nobody knows what
  it looks like.
- Whether the far-left cell is a **battleship-only zone or a seventh jet column**.
  The atlas draws the battleship 43.3 units wide against a jet's 26.1, while the
  seven printed cells read as roughly equal width. The ghost field leans toward the
  seventh-column reading - every one of the seven cells carries three jet ghosts,
  including the far-left - but that is suggestive, not conclusive.

### 2b. Gameplay video, 15-20 s per skill level

Blocks the measured-timing table in `timing-analysis.md`. Rows T2 to T10 -
battleship crossing interval, rocket travel, thin-out curve, post-hit recovery -
have no measured values and cannot get them from stills or from the audio.

T1 (the march step) is the exception and **has** now been measured, from the march
beep onsets in `gameplay-audio.m4a`: 205.1 ms mean, sd 22.1, n=21 across five
uninterrupted runs. That is the only cadence figure in the ROM derived rather than
chosen. Everything else remains marked `PROVISIONAL`.

The game is now *playable* - the rocket flight was the thing making it impossible,
not the jet cadence - but playable is not the same as accurate.

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

## 4. Review coverage - worth knowing before trusting the diff

CodeRabbit was rate-limited across most of this session. Its check reports `SUCCESS`
while posting only a "review limit reached" notice, so **a green CodeRabbit check on
these PRs means "did not review", not "reviewed and approved"**.

Each merge was verified by the lead against the contract criteria, the test suite,
and by driving the machine - but that is one party's judgement standing in for
review across a large diff. A pass over the session's changes is worth doing.
