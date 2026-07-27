# Sprite reference set

Traced-from-photograph reference for every lit segment on the tube. These crops are
the authority for sprite shape, colour and layout - `src/machine/tube/atlas.json`
should match them, not the other way round.

## The owner's account of the mechanics

Stated by the owner, who has the physical unit. **This is the authority.** Where a
section below disagrees with it, the section is wrong and is marked so.

1. **We are the defenders, and we are on the right.** We fire **green (cyan) bullets
   that travel right to left**.
2. **The attackers are red.** They **travel left to right**, advancing toward us.
3. **The attackers shoot back**, firing **red dots that look exactly like a colon
   `:`** - two dots, one directly above the other.
4. **Each cell has its own set of lightable areas.** The illusion of animation comes
   from lighting different areas within a cell, not from moving one shape across the
   glass. Every distinct appearance a sprite has is a separate physical segment.

Point 4 is the structural one. It means the atlas is a set of **per-cell segment
groups**, and any test asserting that one outline is translated across a row encodes a
misunderstanding of how the tube works.

Two crops corroborate points 1 and 2 directly, in the sprite shapes themselves:
`video/jet-column-4.png` is a red jet with its **nose to the right**;
`video/missile-column-4.png` is a cyan dart with its **point to the left**.

**This supersedes section 4 below.** That section attributes the two vertically
stacked bursts to the player's missile. The colon-shaped pair the owner describes is
**red and belongs to the attackers**. The stacked bursts in `missile-lit.png` and
`video/explosion-jet-column-4.png` are unmistakably **cyan**, so they are a different
object from the attackers' colon - which one they are is unresolved and is the first
question for the sprite catalogue.

**Answered by the video**: the cyan stacked pair is the **burst a jet leaves when the
missile kills it**. See "The gameplay video" below.

## The gameplay video

`IMG_6113.mov` (not committed - 580 MB, held by the owner). 1920x1080 HEVC, 12,237
frames, 407.9 s at a 30 fps container, of the real unit being played in daylight. It is
the first material showing the tube **lit and in motion**, and for anything about shape,
arrangement or animation it supersedes the stills.

Every figure below is measured in the frame of a **reference camera pose**, the one held
over file seconds 205-215, identified by the `SCORE` label's left edge at x=1026. The
camera drifts through the clip (that label runs from x=962 early to x=1030 late) so
positions are always quoted relative to it: the player's launcher sits a constant
574 px to its right, +/- 2 px across every sample, which is what makes the drift a pure
translation and the lattice below comparable between runs.

### What the recording actually is, and what that costs

The lead's brief assumed 240 fps capture, which would make one container frame 1/240 s
and the whole clip ~51 s of real play, and predicted a **49-frame** march step. The
measured march-beep interval is **23.3 container frames** (median 0.776 s of file time,
n=89 intervals over a 90 s window) - almost exactly half.

The audio is at true pitch: the march note reads 640 Hz and 700 Hz and the missile blip
1594.8 Hz, all inside the bands `audio-reference.md` records as measured from the
owner's real-time recordings (`jetMarch` 600-650 Hz, `missileFire` 1480-1632 Hz). So the
export **time-stretched the audio without pitching it down**, which keeps audio events
aligned with video events but means file-time intervals carry the same slow factor as
the picture.

That leaves two readings:

| Capture rate | Squadron step in real time | Verdict |
| --- | --- | --- |
| 240 fps | 97 ms | Faster than anything ever observed. The owner's audio gives 205.1 ms mean over 21 intervals, min 151 ms (`timing-analysis.md`). |
| 120 fps | 194 ms | Sits inside the observed distribution (five runs, means 197-217 ms). |

**The evidence favours 120 fps**, making each container frame 1/120 s and the clip about
102 s of real play, not 51. This is inference from cadence, not from metadata: the file
was flattened to 30 fps and carries no capture-rate tag, the room was daylit so there is
no mains flicker to alias against, and the argument would collapse if this session were
being played at a harder skill than the one the owner recorded. **Treat the real-time
column of any table derived from this video as provisional until a clip is captured with
a known frame rate.** Nothing in the sprite catalogue below depends on it.

### Method

Two things had to be got right before anything was measurable.

**Isolate phosphor by colour excess, not luminance.** The case is red plastic and the
glass is scratched and glary; a luminance threshold selects the case. Red phosphor is
`R - max(G,B) >= 45`, cyan is `min(G,B) - R >= 45`. Both hold across the whole clip.

**Accumulate across frames, because one frame is not one sprite.** The tube is
multiplexed and a single 1/120 s exposure catches only the scan slots that happened to
be live. Masks taken from single frames of the *same* sprite disagree with each other
badly - one frame of the column-4 jet reads as a symmetric delta, another as a raked
wedge. Every outline below is the **per-pixel maximum of the colour excess over a window
in which the sprite is stationary** (typically 0.3-1.2 s of file time, 9-36 frames),
which recovers the union of all scan slots. This matters for whoever specifies the
flicker as much as it did here: **no single frame of this video shows a whole sprite.**

### The field: seven columns, three lanes, and which cells hold what

Sprite positions fall on one lattice, pitch **74.5 px**, anchored on the player's
launcher. Numbering columns 0 (the launcher, at the `G` end) to 6 (farthest), the
occupancy observed across ~106 s of sampled footage is:

| Column | Jet | Battleship | Missile in flight | Player's launcher | Cyan burst |
| --- | --- | --- | --- | --- | --- |
| 0 (G) | - | - | - | yes, 3 lanes | - |
| 1 | - | - | yes | - | - |
| 2 | yes | - | yes | - | yes |
| 3 | yes | - | yes | - | yes |
| 4 | yes | - | yes | - | yes |
| 5 | yes | - | yes | - | yes |
| 6 | yes | yes, 3 lanes | - | - | yes (different shape) |

Three lanes, pitch **44 px**, measured on the launcher's three rest positions.

Two facts in that table are worth stating plainly because they are new:

- **Jets never enter columns 0 or 1.** Not one red sprite was found there in any sampled
  frame. The two cells nearest the launcher are missile-flight cells only.
- **The missile is never seen in column 6.** It launches into column 1 and steps left as
  far as column 5, then expires. A missile that reaches column 5 without hitting
  anything simply stops being drawn.

The printed overlay runs on a slightly different lattice: the ruler's cell-divider bars
are **78.3 px** apart, 5% wider than the phosphor's 74.5 px. That is parallax, and it is
in the right direction - the phosphor plane sits behind the front glass, so it subtends a
smaller angle. Do not expect a printed cell edge and a phosphor cell edge to coincide;
they are on different planes and the offset grows across the field.

### Sprite catalogue

Sizes are the lit extent in reference-pose pixels, including phosphor bloom, which
inflates each edge by a pixel or two. The "of a cell" columns divide by the phosphor
column pitch (74.5) and lane pitch (44).

| Sprite | Colour | Size (px) | Of a cell (w x h) | Crops |
| --- | --- | --- | --- | --- |
| Jet | red-orange | 40 x 26 | 0.54 x 0.59 | `video/jet-column-2..5.png` |
| Battleship | red-orange | 54 x 24 | 0.72 x 0.55 | `video/battleship-lane-*.png` |
| Missile in flight | cyan | 28 x 12 | 0.38 x 0.27 | `video/missile-column-1..5.png` |
| Player's launcher | cyan | 36 x 26 | 0.48 x 0.59 | `video/player-ship-lane-*.png` |
| Jet-kill burst pair | cyan | 42 x 46 | 0.56 x 1.05 | `video/explosion-jet-column-4.png` |
| Column-6 burst pair | cyan | 56 x 24 | 0.75 x 0.55 | `video/explosion-column-6.png` |
| `SCORE` label | cyan | 70 x 24 | - | `video/score-field.png` |
| Score digit | cyan | 24 x 32 | - | `video/score-field.png` |

**Jet.** A top-down fighter, nose to the right, in every sighting - which corroborates
the owner's point 2, since jets advance left to right. Detailed airframe: pointed nose,
swept wings, and in one of its two poses a distinct forked twin tail. Confirms the
existing description.

**Battleship - first sighting.** `battleship-lane-{top,middle,bottom}.png`. Previously
untraced; there is now a clean one. It is a **warship in side profile**: a long low hull
with a raised superstructure and funnel amidships, drawn red-orange, 54 x 24 px - half
again as wide as a jet and slightly shorter. It appears **only in column 6**, in any of
the three lanes, and **it does not move**: four separate episodes (file t=168-170,
199-203, 259-265, 311-316) each hold it stationary in one lane for 4.4 to 6 s of file
time and then it vanishes. Whatever "a battleship crossing" means on this machine, it is
not the sprite traversing columns.

**Missile in flight.** `missile-column-1..5.png`. A cyan dart, **point to the left**,
with a short tapering tail to the right - the direction it travels, corroborating the
owner's point 1. It is **the same shape in all five columns**; unlike the jet it does not
change with position. Recorded as a negative result because it constrains the atlas: one
missile outline, five placements.

**The two cyan stacked bursts are a jet dying, not a missile.** This is the correction
the lead asked for and the question the owner's note left open. Two spiky bursts, one
above the other in the same column, the upper broader than the lower and their jagged
edges facing away from each other. It is not the missile:

- It appears at a column **immediately after a red jet at that column disappears**, and
  it persists there while a *newly fired* missile is separately visible flying in another
  lane. Two objects, not one.
- The score increments across it. Reading the digits frame by frame through file seconds
  205-208: 38 before, 40 after a column-4 kill, 41 after a column-3 kill. Farther kills
  score more, which is what a distance-zone scoring rule predicts.
- The missile itself is elsewhere in those same frames, and is the dart above.

So `missile-lit.png` in the stills set is **mislabelled**: it is an explosion, not a
missile. Section 4 below is wrong on this point and is corrected here.

**The column-6 burst is a different shape.** `explosion-column-6.png`. Also cyan, also a
pair of spiky bursts, but arranged **side by side horizontally** and 56 px wide rather
than stacked and 42 wide. It occurs only in column 6, the battleship's column. The
natural reading is that it is the battleship's destruction burst, matched to the wider
sprite - but no frame in the sample catches the transition from battleship to burst
directly, so that is inference, not observation.

**Player's launcher.** `player-ship-lane-{top,middle,bottom}.png`. The blocky cyan shape
by the `G` line, at one of three lane positions, 36 x 26 px. It changes lane in a single
frame - it does not slide, it is redrawn - so the three lanes are three segments. This
confirms the existing identification.

**The lead's t=210 question, settled.** The two cyan objects visible then are the
**launcher** (blocky, at column 0) and the **missile in flight** (a dart, at column 2,
same lane). The lead's reading was right. It did not contradict "two bursts stacked
vertically" because those bursts are a third object entirely.

### The jet changes shape between columns - what the video shows

This was the headline the lead asked for, and the video answers it directly.

**One jet, stepping.** Over file seconds 15-19 a single jet in the bottom lane steps
column 5 -> 4 -> 3 -> 2 while the camera does not move. `jet-column-5.png`,
`jet-column-4.png`, `jet-column-3.png`, `jet-column-2.png` are that one aircraft at its
four successive positions. **The outline is grossly different between adjacent columns**
and it alternates:

- Columns 5 and 3: a **symmetric level-winged** delta - vertically symmetric about the
  fuselage, with a detached twin tail at the rear.
- Columns 4 and 2: a **raked** outline - asymmetric, wings swept down and back toward a
  long thin nose at the lower right, a single fin at the upper left.

Stepping between them is what produces the wing-beat the owner described. This is direct
observation of a single aircraft, not an inference from the ghost field.

**It varies by lane too, in a checkerboard.** `jet-lane-{top,middle,bottom}-column-3.png`
are three jets in the same column at the same moment, and they are not the same shape
either: top level, middle raked, bottom level. Across ten accumulated masks covering
columns 2-5 and all three lanes, **every sample fits the parity of (lane + column)** with
lanes numbered 0 top to 2 bottom: odd gives the level pose, even gives the raked pose.

Quantitatively, after normalising each mask to a common box, mean IoU is **0.83 within a
parity class and 0.65 across** (n=21 and 24 pairs). The two-pose model explains most of
the variance and every sample's gross shape.

**What that does and does not license.** It confirms the owner's claim that the
silhouette changes cell to cell, and it confirms the structural point that the atlas
needs per-cell segment groups rather than one outline translated across a row. The
`sprite proportions` test that asserts *"all 18 jets sharing one translated outline"* is
refuted by the four crops above and must be replaced.

It does **not** establish that there are exactly two outlines. Within-class IoU of 0.83
leaves real residual differences, and this video cannot say whether those are 21 subtly
distinct segment groups or measurement noise: the accumulation windows differ in length,
the camera views cells at the far left and far right of the field at different angles,
and phosphor bloom varies with how long a segment was lit. **Two poses is the floor, not
the count.** The angled-light photograph of the dark tube is still the thing that would
settle it, and it is still worth asking for.

### The far-left cell: it is both

`open-questions.md` asks whether the far-left cell is a battleship-only zone or a
seventh jet column. The video says **both**. Column 6 carries jet-sized red sprites
(32-44 px wide, in frames where no battleship is lit anywhere) *and* the 46-56 px
battleship, in the same three lanes. Recorded here as evidence only - no code or
`COLUMN_COUNT` change is made on the strength of it, and the ROM's distance-zone mapping
is untouched.

Note this narrows the jet field rather than widening it: jets occupy columns **2 to 6**,
five columns, and never columns 0 or 1.

### Cadence, in file time

Recorded because the video is the only source for these, but see the frame-rate caveat
above before converting any of them to milliseconds. All figures are container frames at
30 fps.

| Event | File time | Container frames | Basis |
| --- | --- | --- | --- |
| March beep interval (squadron step) | 0.776 s median | 23.3 | 89 intervals, 600-730 Hz band, file t=180-270 |
| Missile step, one column | 0.50 s | 15 | Four consecutive steps, file t=207-209, exact |
| Jet step, one aircraft | ~1.4 s | ~42 | Two steps of one jet, file t=15-17 |
| Battleship episode, stationary | 4.4-6 s | 130-180 | Four episodes |

The jet step being about twice the march beep interval is consistent with
`timing-analysis.md`'s reading that the beep is the *squadron* rate and that two jets
were in the air - which is what the frames show, two or three jets stepping in lockstep
one lane apart.

### What this video does not settle

- **The attackers' red colon shot.** The owner describes red dots like a `:` fired back
  at the player. No stacked pair of small red components was found anywhere in ~106 s of
  sampled frames. Either it is rarer than the sampling, or it happens at a scale the
  colour-excess threshold rejects. Its shape, size and colour remain untraced.
- **A red explosion.** One unidentified red mark was found at column 0, top lane, at file
  t=107 - a plain bar 30 x 12 px, no burst structure, one sighting only. Saved as
  `video/unidentified-red-mark-column-0.png` and deliberately not named. Whether the
  player's launcher shows a red burst when hit is not established by this video.
- **The battleship's destruction burst.** The column-6 side-by-side burst is the obvious
  candidate but no frame catches the transition.
- **The count of jet outlines.** Two poses confirmed; 21 neither confirmed nor refuted.
- **Whether the score field is three digits.** Only two digit positions were ever lit -
  the scores observed run 8 to 41 - so the hundreds position was never exercised.
- **The real-time scale**, per the frame-rate section. Everything above is in file time.

### Crops in `video/`

Produced by the accumulation method above and magnified 12x point-sampled (no
interpolation) except `score-field.png` at 7x and `playfield-overview.png` at 2.5x, so
the pixels are the video's.

## Source photographs

Both are close-ups of a real CGL Jet Fighters unit, powered on, supplied by the owner.
They are the first reference material showing the tube **lit during play** at a
readable scale, and they supersede earlier guesses.

| File | State captured |
| --- | --- |
| `../tube-closeup-score0.webp` | Score `0`. Three jets lit in the right-hand columns. Whole ghost field visible. |
| `../tube-closeup-score10.webp` | Score `10`. A missile in flight, a red burst and a cyan shape near the G line. |

Crops here were cut with ImageMagick from the originals at native resolution and
point-sampled up (no interpolation), so pixel edges are the photograph's, not a
resampler's.

## What the photographs establish

### 1. The playfield is 7 cells wide - which the code already models

Counted independently on both photographs from the printed cell dividers: **seven**
cell rectangles span the field between the left rail and the G line.

**An earlier revision of this document claimed that contradicted the code. It does
not.** The ROM already works in seven columns - `COL_LAUNCH 0` (the G line) through
`COL_JET_FAR 5`, plus `COL_BSHIP 6` - and the atlas already carries six jet columns
plus a separate `battleship` segment, which is seven cells. `PAT_COLUMN` inverts ROM
column numbering onto atlas grids, so ROM column 0 (the G line, at the right of the
glass) resolves to the atlas's rightmost jet column. That indirection is what made the
two look inconsistent on a first reading.

The claim was wrong and no column-count rework is needed. It is recorded here rather
than deleted because it was acted on: it nearly commissioned a large change to the
ROM's distance-zone mapping on a false premise.

What the photographs do **not** settle is the shape of that far-left cell. The atlas
models the battleship as a single segment 43 units wide against a jet's 18, whereas
the seven printed cells read as roughly equal width. Whether the far-left cell is a
battleship-only zone drawn wide, or a seventh jet column with the battleship overlaid,
is unresolved - and the ROM's own comment concedes the point:

> the split below (5=3, 4,3=2, 2,1=1) is this ROM's reading of the ruler and is
> recorded in PAT_COLUMN rather than spread through the code

The overlay photograph has never been column-counted against the ruler bands. That is
worth doing before trusting either reading.

**One piece of evidence leans toward the seventh-jet-column reading.** Every one of the
seven printed cells carries three jet ghosts - including the far-left one. A cell that
existed only to hold a battleship would not be printed with a jet in each of its three
lanes. That is suggestive rather than conclusive: the ghost field is legible in these
photographs but not crisp, and a shared print pattern across all seven cells could be a
manufacturing convenience rather than a statement about what occupies them. It is the
thread to pull first when an angled-light photograph of the dark tube arrives.

### 2. Every cell carries a ghost jet

Unlit phosphor is visible in all 21 cells as a pale grey jet silhouette. The ghost is
not a rendering flourish - it is a real physical property of the tube and it is what
makes the field read as a printed radar screen rather than empty black.

### 3. The jet silhouette

`jet-lit.png`, `jet-unlit.png`.

A top-down fighter, **nose pointing right** (the direction of travel, toward the
missile station at G): pointed nose, swept delta wings mid-body, and **twin vertical
tails** at the rear giving a distinctive forked tail. Wider at the tail than the nose.
It is a detailed aircraft silhouette, not a chevron or arrow.

Lit colour is a saturated red-orange. The unlit ghost is the same outline in pale grey.

### 3b. The jet sprite CHANGES between columns to imply flight

`ghost-row-variation.png`.

**Owner-confirmed:** the jet is not one shape repeated across the field. The silhouette
**changes from column to column** so that a jet stepping toward the missile station
appears to beat its wings - the animation is built into the physical phosphor segments,
not produced by the program. The ROM lights a different *shape* at each column; the
motion is a property of the tube.

This is visible in the ghost field: adjacent cells carry perceptibly different
outlines, some with flatter, wider wings and others more swept.

Two consequences:

1. The atlas needs **per-column jet outlines** - up to 21 distinct paths - not one
   outline translated across a row.
2. The `sprite proportions` test added in #31 asserts *"all 18 jets sharing one
   translated outline"*. That assertion is now known to be wrong and must be replaced,
   not merely re-tuned. It encodes exactly the misunderstanding this section corrects.

**These photographs cannot support tracing all 21 variants.** The ghosts are legible
enough to prove the variation exists, not to recover each outline faithfully. See
"Reference material still wanted" below.

### 4. The missile is two vertically-stacked bursts

`missile-lit.png`.

**Owner-reported and confirmed here:** the fired missile shows as **two cyan
starbursts, one directly above the other in the same column** - not two dots side by
side horizontally, which is what the current atlas models.

They are spiky burst shapes rather than round dots, and **the two are not identical** -
the upper burst is broader than the lower one.

### 5. The cyan shape near G is the player's ship

`battleship-cyan-lit.png` (filename is a misnomer - kept so the commit history lines
up; the crop is the player's ship).

**Owner-confirmed.** The cyan shape near the G line is the **player's launcher** - the
thing you control. It occupies one of three vertical positions and it is what fires the
two cyan dots. It is drawn in cyan phosphor, inside the playfield.

The red-orange starburst directly above it in photo 2 is **the player being hit at that
position**, immediately before moving away.

So the two event sprites are:
- `explosion-red-lit.png` - the player's ship taking a hit
- the cyan ship itself, at three lane positions

This corrects the atlas, which places `launcher_lane{0-2}` at the right-hand edge as
white wedges. Those wedges are not the launcher - see below.

### 6. The white marks are printed paint, not segments

`launcher-lit.png` (also a misnomer - these are the painted marks).

**Owner-confirmed:** the cream/white wedges and bars at the right-hand edge are **white
paint on the overlay**. They are fixed silkscreen, not lit phosphor, and the machine
cannot change them. They must not be atlas segments at all.

### 7. There is no lives display

**Owner-confirmed and important:** the unit has **no way to show remaining lives**.
Damage is communicated **only by sound** - the two-beep and three-beep warnings between
hits.

`atlas.json` currently defines `life_0`, `life_1`, `life_2` as lit segments. They should
not exist. Whatever the ROM writes there is writing to segments the tube does not have,
which is the same class of fault as the phantom ground line fixed in #32.

This also explains why the warning-beep sequence carries so much weight in
`docs/evidence/audio-reference.md`: it is the *entire* damage feedback channel.

### 8. Score

`score-lives.png` (misnomer again - there are no lives in it).

`SCORE` label and digits are **cyan** seven-segment. Photo 2 reads `10` with a ghost
digit position visible to the left, so the field is three digits wide with leading
blanking, consistent with the 199 cap.

## Colour assignment

| Sprite | Lit colour |
| --- | --- |
| Jets | red-orange |
| Player's ship (launcher) | cyan |
| Missile bursts | cyan |
| Score label and digits | cyan |
| Explosion (player hit) | red-orange |

The `cyan | red` model in the atlas is correct and complete. The near-white marks at
the right-hand edge are **painted overlay, not phosphor**, so they need no colour
region - they need removing from the segment list entirely.

## Wording and spacing

The silkscreen text matches ours word for word:

- `COAST SIDE MISSILE STATION RADAR SIGHT SCREEN` curved along the top
- `JET FIGHTER FLYING ZONE` on its own line
- `BATTLE SHIP ZONE` and `MISSILE STATION ZONE` below it
- Distance ruler `10  3  2  1 ... G`

What differs is **layout**: on the real unit each zone label is tied to its region by
drawn bracket lines that drop from the field and turn inward, and the three labels sit
on two separate lines with the brackets nesting between them. The ruler numbers each
carry a small right-angle tick. Compare our render against the photographs before
adjusting - the wording is right, the geometry and spacing are not.

## Reference material still wanted

To finish the atlas faithfully, the most valuable additions would be, in order:

1. **A straight-on, well-lit photograph of the dark tube at an angle that catches every
   phosphor segment** - the standard way to recover a complete segment atlas in one
   shot. This would settle all 21 jet variants, the battleship, and every segment the
   two action photographs happen not to light.
2. **A photograph of a battleship crossing** - its sprite is entirely untraced.
3. Anything showing the field with **many jets lit at once**, which would confirm the
   per-column variation directly rather than through the ghosts.

## What these photographs do not settle

- Anything about **timing** - these are stills. Cadence remains blocked on the
  per-skill gameplay video, per `docs/evidence/timing-analysis.md`.
- The battleship. Neither photograph catches one crossing the far zone, so its sprite
  is still untraced. It is worth 10 points per the rules and has a documented buzz in
  `audio-reference.md`, but its shape is unknown.

The two questions the first draft left open - the identity of the cyan shape, and
whether the white marks were a third phosphor - were both answered by the owner and are
now recorded above as fact, not inference.
