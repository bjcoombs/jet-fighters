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

Two composites corroborate points 1 and 2 directly, in the sprite shapes themselves:
`video/jet-grid.png` is fifteen red jets, every one nose to the right;
`video/player-missile-grid.png` is fifteen cyan darts, every one point to the left.

**This supersedes section 4 below.** That section attributes the two vertically
stacked bursts to the player's missile. The colon-shaped pair the owner describes is
**red and belongs to the attackers**. The stacked bursts in `missile-lit.png` and
`video/jet-kill-burst-col3-lane0.png` are unmistakably **cyan**, so they are a different
object from the attackers' colon.

**Both open points are now answered by the video.** The cyan stacked pair is the **burst
a jet leaves when the missile kills it**. The attackers' colon is **traced** - two red
dots, one directly above the other, at `video/attacker-colon.png` - so point 3 is
confirmed as a shape, though not as a trajectory. See "The gameplay video" below.

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

**The recording is 30 fps real time.** One container frame is 1/30 s = 33.33 ms, and the
clip is 6 min 48 s of real play. Every spatial figure below is unaffected by this; the
timing figures are stated in file time, which is now also real time.

The brief for this work asserted 240 fps slow-motion. It is not that either.

**How it was settled.** `audio-reference.md` records the win jingle as measured from the
owner's real-time recordings: F#5/A#5/D#6 at 750/940/1240 Hz, durations 200/150/150 ms,
that arpeggio three times over, 1830 ms total. The jingle occurs in this video at file
t = 403 s. Measured there:

| Arpeggio | Measured | Reference |
| --- | --- | --- |
| 1st | 750, 936, 1248 Hz / 190, 180, 160 ms | 750, 940, 1240 Hz / 200, 150, 150 ms |
| 2nd | 749, 936, 1248 Hz / 260, 180, 160 ms | as above |
| 3rd | 749, 937, 1249 Hz / 260, 180, 180 ms | as above |

Pitch exact, **duration 1:1**. This is the decisive test because a tone burst has both a
pitch and a length: real time preserves both, a naive slow-motion export drops the pitch,
and a pitch-preserving time-stretch keeps the pitch but stretches the length. Only real
time fits. Under the 4x reading each of these notes would run 600-800 ms.

### The wrong reading this replaces, and why it looked right

An earlier revision of this section concluded **120 fps**, i.e. that the file ran 4x slow
with audio time-stretched but not pitched down. It is recorded here rather than deleted
because it was very nearly acted on, and because the reasoning was sound given what was
known.

The argument was: the measured march-beep interval is 23.3 container frames (median
0.776 s, n = 89 over a 90 s window), against 205.1 ms in `timing-analysis.md`. A ratio
near 4 pointed straight at a 4x time base, and the audio being at true pitch was
explained by a pitch-preserving stretch.

**The flaw was in the comparison, not the measurement.** 205.1 ms is the *floor* of the
cadence ladder, not a typical rate. `PAT_STEP` in `asm/jetfighter.asm` runs 48 sweeps
(743 ms) for a fresh squadron at skill 1, 36 (558 ms) at skill 2, 27 (372 ms) at skill 3,
descending to 13 sweeps (201 ms) as jets are killed and waves cleared. A file-time
interval of 600-776 ms is a fresh-to-mid squadron sitting near the *top* of that ladder.
There was never a 4x discrepancy to explain - two figures from opposite ends of one ramp
were being compared as though they measured the same thing.

That reframing is worth more than the correction. The video is the **first direct evidence
of where real play sits on the cadence ladder**, which `docs/evidence/timing-analysis.md`
carries as an open evidence gap. Whether our ramp descends at the right *rate* is a
separate question and is under measurement.

**Consequence for the reader:** 33.33 ms per frame is longer than one sweep of the tube,
so no single frame shows a whole sprite (see Method, below) - but that was already true
under either reading and the accumulation method below handles it.

### Method

Two things had to be got right before anything was measurable.

**Isolate phosphor by colour excess, not luminance.** The case is red plastic and the
glass is scratched and glary; a luminance threshold selects the case. Red phosphor is
`R - max(G,B) >= 45`, cyan is `min(G,B) - R >= 45`. Both hold across the whole clip.

**Accumulate across frames, because one frame is not one sprite.** The tube is
multiplexed and a single frame's exposure catches only the scan slots that happened to
be live. Masks taken from single frames of the *same* sprite disagree with each other
badly - one frame of the column-4 jet reads as a symmetric delta, another as a raked
wedge. Every outline below is the **per-pixel maximum of the colour excess over a window
in which the sprite is stationary** (typically 0.3-1.2 s of file time, 9-36 frames),
which recovers the union of all scan slots. This matters for whoever specifies the
flicker as much as it did here: **no single frame of this video shows a whole sprite.**

### Cell numbering

**Cells are numbered left to right as the overlay prints them: cell 0 is the far zone at
the left, cell 6 is the missile station at the `G` line where the player is.** Lanes are
0 (top) to 2 (bottom).

That is the deciding convention for this repository because it is what the atlas already
does: `jet_lane0_col0` is grid 0 at x = 124.9 and `col5` is grid 5 at x = 306.4, so the
atlas's x increases with the index and grid 0 is the far end. Crop `colN` maps to atlas
grid `N`.

`asm/jetfighter.asm` uses the opposite internal order, counting from the launcher
outward, and `PAT_COLUMN` translates between them. **An earlier revision of this section
used the ROM's order and every "column N" in it meant cell 6-N.** Both are tabulated so
nothing that cites the old text is stranded:

| This section (and the atlas) | ROM internal (`COL_*`) | Printed zone |
| --- | --- | --- |
| cell 0 | `COL_BSHIP` 6 | `BATTLE SHIP ZONE` |
| cell 1 | `COL_JET_FAR` 5 | `JET FIGHTER FLYING ZONE` |
| cell 2 | 4 | `JET FIGHTER FLYING ZONE` |
| cell 3 | 3 | `JET FIGHTER FLYING ZONE` |
| cell 4 | 2 | `JET FIGHTER FLYING ZONE` |
| cell 5 | 1 | `JET FIGHTER FLYING ZONE` |
| cell 6 | `COL_LAUNCH` 0 | `MISSILE STATION ZONE` |

### The field: seven cells, three lanes, and which cell holds what

Two passes were made at this. The first sampled about 106 s of footage and worked from a
lattice anchored on the launcher. The second processed **all 12,237 frames**, recovered
the printed ruler's own lattice in each frame independently - the wide `+` node at the
left end of the ruler anchors it absolutely, so nothing depends on the camera holding
still - and clustered the 23,247 detected objects on that lattice. Where the two
disagree, the whole-file pass is quoted and the difference is called out.

Positions cluster tightly. `u` is horizontal position in printed-cell widths from the
left node; `v` is vertical position as a fraction of the ruler-to-dash field height.

| Cluster `u` | Sightings | Identity |
| --- | --- | --- |
| 0.278 | 896 | battleship, cell 0 |
| 1.028 | 1,279 | jet, cell 1 |
| 1.975 | 1,388 | jet, cell 2 |
| 2.918 | 2,259 | jet, cell 3 |
| 3.891 | 236 | jet, cell 4 |
| 4.846 | 98 | jet, cell 5 |
| 1.466 / 2.364 / 3.317 / 4.279 / 5.217 | 1,915 / 2,028 / 2,233 / 2,310 / 1,403 | missile, cells 1-5 |
| 6.190 | 6,582 | player's launcher, cell 6 |
| 6.213 | 68 | red mark at the launcher, cell 6 |

Three lanes at `v` = 0.251, 0.404, 0.560 (standard deviation 0.008 to 0.013 on the red
sprites), a pitch of 0.155 of the field height, about 41 px.

| Cell | Jet | Battleship | Missile | Launcher | Cyan burst | Attacker's colon |
| --- | --- | --- | --- | --- | --- | --- |
| 0 (far) | - | yes, 3 lanes | - | - | yes, wide horizontal pair | 2 frames only |
| 1 | yes | - | yes | - | yes | yes |
| 2 | yes | - | yes | - | yes | yes |
| 3 | yes | - | yes | - | yes | yes |
| 4 | yes | - | yes | - | yes | - |
| 5 | yes | - | yes | - | yes | yes |
| 6 (`G`) | - | - | - | yes, 3 lanes | - | - |

**The zone brackets printed under the field independently confirm every row of that
table.** Their legs were measured from the silkscreen in four frames spread across the
recording (crop `video/playfield-zone-brackets.png`):

| Zone label | left leg `u` | right leg `u` | reproduced |
| --- | --- | --- | --- |
| `BATTLE SHIP ZONE` | -0.04 | 0.75 | 3 frames, spread 0.07 |
| `JET FIGHTER FLYING ZONE` | 0.88 | 5.52 | 3 frames, spread 0.07 |
| `MISSILE STATION ZONE` | 5.66 | 6.9 | 3 frames, spread 0.07 |

Every sprite position falls inside the zone its identity implies, with no exceptions.
This is the strongest single check in the section, because the brackets and the sprite
positions were measured from different things - paint against phosphor - and were never
fitted to each other.

**Two corrections to the first pass.**

- **Jets do occupy cell 5, the jet cell nearest the launcher.** The first pass reported
  no red sprite in its columns 0 or 1 (cells 6 and 5 here) and concluded the two cells
  nearest the launcher were missile-flight cells only. Cell 6 holds: no jet-shaped red
  object was found there in 12,237 frames. **Cell 5 does not hold.** 72 sightings in lane
  0 carry a jet-shaped red object at `u` 4.846, inside the printed jet zone, and its
  outline classifies as the same pose family as cells 1, 2 and 3 (best-alignment IoU 0.79
  to 0.87 against c1l0, c2l1 and c3l0). Crop `video/jet-col5-lane0.png`, frame 3777. The
  likely cause of the difference is coverage: 72 sightings out of 6,241 red detections
  over 407.9 s is easy to miss in a 106 s sample.
- **Cell 0 carries the battleship only, not a battleship and a jet.** See "The far-left
  cell", below.

The printed overlay runs on a slightly different lattice from the phosphor. The ruler's
cell-divider bars are **78.6 px** apart; sprite positions step by **71.8 px** (red, cells
0 to 5) to **73.7 px** (cyan, cells 1 to 5), 5 to 9% narrower. That is parallax, and it is
in the right direction - the phosphor plane sits behind the front glass, so it subtends a
smaller angle. Do not expect a printed cell edge and a phosphor cell edge to coincide;
they are on different planes and the offset grows across the field.

The **missile lattice is offset about +0.39 of a cell to the right of the jet lattice**
in the same cell (measured offsets +0.44, +0.39, +0.40, +0.39, +0.37 for cells 1 to 5).
The launcher and the red mark at the launcher share one position to within 0.02 of a cell.

### Sprite catalogue

Sizes are the lit extent including phosphor bloom, which inflates each edge by a pixel or
two. The "of a cell" column divides by the **phosphor** pitch (74.5 px horizontal, 41.3 px
vertical), not the printed pitch. Sighting counts are over all 12,237 frames.

| Sprite | Colour | Cells | Lanes | Size px | Of a cell | Sightings | Crops |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jet, level pose | red-orange | 1-5 | 0-2 | 36 x 28 | 0.48 x 0.68 | 2,738 | `video/jet-col*-lane*.png`, `video/jet-grid.png` |
| Jet, raked pose | red-orange | 1-5 | 0-2 | 36 x 20 | 0.48 x 0.48 | 2,146 | as above |
| Battleship | red-orange | 0 | 0-2 | 48 x 20 | 0.64 x 0.48 | 896, 17 episodes | `video/battleship-col0-lane{0,1,2}.png` |
| Attacker's colon | red-orange | 1,2,3,5 | 0-2 | two dots ~6 x 6, 21 px apart | 0.11 x 0.19 each | 87, 48 episodes | `video/attacker-colon.png`, `video/attacker-colon-2.png` |
| Missile in flight | cyan | 1-5 | 0-2 | 26 x 12 | 0.35 x 0.29 | 8,961 | `video/player-missile-col*-lane*.png`, `video/player-missile-grid.png` |
| Player's launcher | cyan | 6 | 0-2 | 36 x 24 | 0.48 x 0.58 | 6,548 | `video/player-ship-lane{0,1,2}.png` |
| Jet-kill burst, stacked pair | cyan | 1-5 | 0-2 | 36 x 44 | 0.48 x 1.07 | 802, 76 episodes | `video/jet-kill-burst-col*-lane*.png` |
| Battleship-kill burst, side-by-side pair | cyan | 0 | 0, 2 | 58 x 26 | 0.78 x 0.63 | 102, 16 episodes | `video/battleship-kill-burst-lane{0,2}.png` |
| Red mark at the launcher | red-orange | 6 | 0, 2 | 32 x 14 | 0.43 x 0.34 | 68, 4 episodes | `video/player-hit-lane{0,2}.png` |
| `SCORE` label | cyan | left of the field | - | 70 x 24 | - | throughout | `video/score-field.png` |
| Score digit | cyan | left of the field | - | 24 x 32 | - | throughout | `video/score-field.png` |

Recovered core masks for every cell, side by side at one scale:
`video/segment-core-masks-red.png` (cells 0-6 left to right, lanes 0-2 top to bottom),
`video/segment-core-masks-cyan-missile.png`, `video/segment-core-masks-cyan-burst.png`.

**Jet.** A top-down fighter, nose to the right, in every one of the thirteen cells with
enough sightings to recover - which corroborates the owner's point 2, since jets advance
left to right. Detailed airframe: pointed nose, swept wings, and in one of its two poses a
distinct forked twin tail. Confirms the existing description. Shape by cell is the subject
of its own section below.

**Battleship.** `video/battleship-col0-lane{0,1,2}.png`. A **warship in side profile**: a
long low hull with a raised superstructure and funnel amidships, drawn red-orange,
48 x 20 px - half again as wide as a jet and slightly shorter. It appears **only in cell
0**, the cell the overlay itself labels `BATTLE SHIP ZONE`, in all three lanes: 17
episodes over the recording, 896 sightings, median episode 2.5 s, longest 5.9 s, lane
split 8 / 2 / 7. The superstructure sits right of centre in lanes 0 and 1 and left of
centre in lane 2, so the three lanes are three separate segments and not one shape at
three heights.

It is a different shape from a jet by measurement, not only by eye: best-alignment IoU
between the two battleship lanes that share a superstructure position is 0.87, while the
highest IoU between any battleship mask and any jet mask is 0.69.

**Whether it traverses is NOT settled, and an earlier revision of this section said it
was.** That revision concluded "it does not move", and that reading was checked
independently by tracking red blobs through the file t=259-266 s episode at 500 ms
intervals:

```
wide blob   (w~48 px, the battleship): x66-116, x70-116, x72-114, x68-116, x68-116
narrow blob (w~34 px, a jet):          x212-248, x212-246, x216-242, x212-246
```

The battleship holds position, which looks like confirmation - **but the control failed.**
The narrow blob is a jet, and jets certainly do advance; it should have moved in seven
seconds and it did not. A window in which a known-moving object does not move cannot be
used to prove another object is stationary. Whether that stretch falls between waves, in
an ended state, or is defeated by the sound blanking is unresolved.

The whole-file pass does not rescue the claim either, and this is worth stating exactly
because it is easy to over-read: across 17 episodes **the battleship was never once found
outside cell 0**. That is consistent with a stationary sprite and equally consistent with
there being no second cell for a battleship-shaped segment to exist in, which is a fact
about the tube rather than about the game. The succession lane 0 (frames 524-561) to lane
1 (565-626) to lane 2 (628-802) looks like a descent through the lanes, but the video
cannot separate one battleship moving from three in succession.

So: the battleship's **shape, colour, size, cell and three lanes are well attested**; its
**motion is not**. Do not build a stationary battleship into the ROM on the strength of
this section. It is recorded this way rather than deleted because the stationary reading
contradicts the PRD's "battleship crossing", and acting on it would have changed a game
rule on a measurement that could not carry the claim.

The general lesson is worth more than the instance: **motion analysis in this video needs
a control** - something whose behaviour is known, measured in the same window. If the
control does not do what it must do, the window is unusable.

**Missile in flight.** `video/player-missile-grid.png` shows all fifteen placements at one
scale. A cyan dart, **point to the left**, with a short tapering tail to the right - the
direction it travels, corroborating the owner's point 1.

It is **the same outline in all fifteen placements**, cells 1 to 5 in all three lanes.
Best-alignment IoU across the fifteen: median 0.81, minimum 0.53, maximum 0.91, unimodal.
The identical test applied to the jets splits into two clean families, so it has the power
to detect a difference and finds none here. Recorded as a negative result because it
constrains the atlas: **one missile outline, fifteen placements.** It is never drawn in
cell 0 or cell 6.

**It travels right to left, one cell per 500 ms.** 744 adjacent leftward steps measured
across the whole file; median interval 15 frames, 10th to 90th percentile 3 to 22 frames.
The spread is the tube's blanking, not variation in the machine: a step whose first frames
fall inside a blank reads short. **Zero rightward steps were observed.**

**The attackers' red colon - traced.** `video/attacker-colon.png` (frame 2719) and
`video/attacker-colon-2.png` (frame 183). Each crop is two panels: the raw pixels on the
left, the red-excess channel multiplied by 4 on the right, because the mark is faint.

**Two small red dots, one directly above the other at the same horizontal position.** Each
dot is about 8 px of lit area, roughly 6 x 6 px, and the centres are **21 px apart** (10th
to 90th percentile 16 to 26), which is half a lane pitch. This is the `:` the owner
describes, and it is the shape an atlas segment should be cut to.

An earlier revision of this section listed it as untraceable. The reason it was missed is
worth recording: **its peak colour excess is 30 to 50, against 60 to 120 for a jet**, so it
sits at or below the threshold that finds every other sprite. It was found by a dedicated
pass at excess > 30 and area >= 4 px. **87 detections in 48 episodes**, longest episode 8
frames.

| Cell | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| detections | 2 | 7 | 13 | 43 | 0 | 22 |

Lane split 29 / 15 / 43. Its horizontal position is the **jet lattice**, not the missile
lattice: median offset from the nearest jet-cell centre is +0.045 of a cell, about 3 px.
Vertically the pair straddles the lane centre, one dot above and one below. The two at
cell 0 are single frames and are not enough to say whether the battleship has one.

**Which way it travels cannot be established from this video.** Within an episode it stays
put. 60 of the 87 detections occur in frames where no red jet is lit anywhere in that lane,
which is consistent with the colon being a segment lit while the jet's own segment is dark
in that scan slot, and equally consistent with it being an independent projectile. The
episodes are too short and too sparse to trace a path. The owner's account that the
attackers fire it is neither corroborated nor contradicted here; the shape, colour and
placement are.

**The two cyan stacked bursts are a jet dying, not a missile.** Two spiky bursts, one
above the other in the same cell, the upper broader than the lower, their jagged edges
facing away from each other, with a narrow waist between them. 36 x 44 px, taller than one
lane pitch, so it reaches into the lanes above and below. 76 episodes, 802 sightings,
median duration 19 frames (0.63 s). One shape across cells: IoU 0.71 to 0.93 between the
nine cells with enough sightings.

Four independent lines say it is the jet's destruction and not the missile:

- **It appears where a jet was, and the jet then stops appearing.** Of the 76 episodes,
  **71 had a red jet lit in the same cell and lane in the preceding 45 frames (1.5 s), and
  only 6 had one in the following 45 frames.** Nothing about a missile's own appearance in
  a cell would be preceded by a jet in 93% of cases and followed by one in 8%.
- **It does not move, and the missile does.** The missile steps a cell every 15 frames; the
  burst holds one cell for a median of 19 frames and then vanishes without stepping
  anywhere.
- **Both are visible at once.** In frames 6323-6345 a burst holds cell 3 lane 1 for 23
  frames while a *newly fired* missile is separately visible in lane 2, stepping cell 5 to
  cell 4. Two objects, not one.
- **The score increments across it.** At frame 6290 the score reads **41**; a burst occupies
  cell 3 lane 1 from frame 6323 to 6345; at frame 6400 the score reads **42**. The jet that
  had been at cell 3 lane 1 continuously from before frame 6270 is absent from 6317 on.

The whole sequence for that one kill, from the frame log:

```
6287-6298   missile at cell 5, lane 1      jet at cell 3, lane 1
6300-6316   missile at cell 4, lane 1      jet at cell 3, lane 1
6317-6322   tube blank (sound)
6323-6345   burst at cell 3, lane 1        no jet at cell 3
```

So `missile-lit.png` in the stills set is **mislabelled**: it is the jet-kill burst, not a
missile. Section 4 below is wrong on this point and is corrected here.

**A jet is worth 1 point, and an earlier revision read 2.** That revision read the digits
across file seconds 205-208 as "38 before, 40 after a cell-4 kill, 41 after a cell-3 kill"
and concluded that farther kills score more. The burst episodes detected in that window are
**three**, not two - cell 2 lane 1 at frames 6178-6194, cell 3 lane 0 at 6201-6223, and cell
2 lane 1 at 6201-6204 - and 38 to 41 across three kills is +1 each. Both readings fit the
digits that were read; they differ in how many kills happened. Settling it needs the score
decoded on every frame, which the slanted digits defeated. **Until then, no
distance-dependent jet score should be built into the ROM.**

**The cell-0 burst is the battleship's, and it is worth 10 points.**
`video/battleship-kill-burst-lane0.png` and `video/battleship-kill-burst-lane2.png`.
Also cyan, also a pair of spiky bursts, but arranged **side by side
horizontally** and 58 px wide against the jet burst's 36, matched to the wider sprite it
replaces. It occurs only at `u` 0.27, the battleship's own position. 16 episodes, 102
sightings, lane split 6 / 0 / 10.

An earlier revision called this inference because no frame caught the transition. The score
settles it. Reading the digits either side of one burst, on frames chosen because the tube
happened to be lit:

| Frame | File time | Score |
| --- | --- | --- |
| 6106 | 203.5 s | **28** |
| 6162 | 205.4 s | **38** |
| 6234 | 207.8 s | **41** |

The cell-0 burst occupies frames 6134-6159. **28 to 38 is exactly +10 across it.** The three
jet-kill bursts that follow - cell 2 lane 1 at 6178-6194, cell 3 lane 0 at 6201-6223, cell 2
lane 1 at 6201-6204 - account for the further +3 by frame 6234. A jet at 1 point and a
battleship at 10, both in the same seven seconds of one recording, matching the rules on the
back label.

Its vertical centre sits about 0.05 of the field height **above** the lane centre (`v` 0.200
against lane 0's 0.251; `v` 0.501 against lane 2's 0.560), so the burst is drawn above the
hull rather than centred on it. It was never seen in lane 1, on 2 battleship episodes there
against 15 elsewhere, which is a sample-size gap rather than a finding.

**Player's launcher.** `video/player-ship-lane{0,1,2}.png`. The blocky cyan shape by the `G`
line, 36 x 24 px, at one of three lane positions. 6,548 sightings, more than any other
object, and every one of them measured:

- **It never leaves its cell.** `u` = 6.190, standard deviation 0.059, full range 5.875 to
  6.436. That spread is a fifth of a cell and is the noise on the lattice fit; the launcher
  was never once found at another cell's position.
- **It occupies exactly three vertical positions**, `v` = 0.279, 0.438, 0.595, each with
  standard deviation 0.013. Occupancy 1,609 / 1,944 / 2,987 frames.
- **It changes lane by being redrawn, not by sliding.** 349 lane changes between frames less
  than 0.5 s apart, no intermediate position ever detected, and in only 1 frame of 6,491 was
  it seen in two lanes at once. The three lanes are three segments.
- **The three lanes are one shape**: IoU 0.87 to 0.90 between them.

Its three `v` positions sit 0.030 to 0.035 **lower** than the jets' lane centres in the same
lanes. The offset is larger than either measurement's spread, so it is real: the launcher is
drawn slightly below the flight lane it defends.

**The red mark at the launcher.** `video/player-hit-lane{0,2}.png`. A plain red-orange
rounded bar, 32 x 14 px, at cell 6 - the same position as the launcher. An earlier revision
had one sighting of this and deliberately left it unnamed; the whole-file pass has **4
episodes and 68 sightings**, 12 to 33 frames each, in lanes 0 and 2.

All four sit inside long whole-display blanks. Frames 3214-3246 are typical: nothing at all
is lit from 3195 to 3213, then for 33 frames the display holds a static tableau - jets at
cells 2 and 3 in lane 0, a missile at cell 4, and this red mark at cell 6 - and then
everything goes dark again past 3259. Since the tube blanks while the speaker sounds, that is
the signature of a long sound with a brief lit window inside it.

Reading it as **the player being hit** is consistent with the still photographs (the
red-orange starburst above the launcher in `tube-closeup-score10.webp`) and with the owner's
account that damage is signalled by sound. It is not directly proven here: no frame catches
the transition from a lit cyan launcher to this mark, because the transition is inside the
blank. The shape and placement are established; the name is inference.

**The lead's t=210 question, settled.** The two cyan objects visible then are the
**launcher** (blocky, at cell 6) and the **missile in flight** (a dart, at cell 4, same
lane). The lead's reading was right. It did not contradict "two bursts stacked vertically"
because those bursts are a third object entirely.

**Score.** `video/score-field.png`. Cyan seven-segment digits with a `SCORE` legend above,
**outside the printed field rectangle to its left** - the digits span roughly `u` -1.25 to
-0.32. Three digit positions with leading blanking; the hundreds digit was only ever seen
blank, because the scores in this recording stayed below 100. The digits are slanted, which
defeated an automatic seven-segment decoder; every score quoted here was read by eye from an
enlarged crop of a named frame.
### The jet changes shape between cells - what the video shows

This was the headline the lead asked for, and the video answers it directly. Two
independent readings agree, and the second is the stronger.

**One jet, stepping.** In file seconds 15 to 19 a single aircraft in lane 1 steps cell 2 to
cell 3 (frame 457) and cell 3 to cell 4 (frame 502) while the camera does not move. **The
outline is grossly different between adjacent cells** and it alternates:

- One pose is a **symmetric level-winged** delta, vertically symmetric about the fuselage,
  with a detached twin tail at the rear.
- The other is a **raked** outline, asymmetric, wings swept down and back toward a long thin
  nose, a single fin at the upper left.

Stepping between them is what produces the wing-beat the owner described. This is direct
observation of a single aircraft, not an inference from the ghost field.

**It varies by lane too, in a checkerboard of `(cell + lane)` parity.** The whole-file pass
tests this without being told the answer. For each of the thirteen jet cells with enough
sightings, take the core mask - the pixels lit in at least 55% of that cell's well-lit
sightings - and compare every pair by best-alignment IoU over translations of +/- 8 px, so
pure position and pure scale differences are removed. Then split the thirteen in two by an
**unsupervised spectral partition of the similarity matrix**, with no knowledge of which cell
is which.

**The unsupervised split agrees with `(cell + lane)` parity in 13 of 13 cells.**

| Pose | Cells |
| --- | --- |
| Level (odd parity) | c1l0, c1l2, c2l1, c3l0, c3l2, c4l1, c5l0 |
| Raked (even parity) | c1l1, c2l0, c2l2, c3l1, c4l0, c4l2 |

Within-group IoU median 0.80; between-group median 0.58, maximum 0.71. The two distributions
overlap at the tails, so no single pair is decisive - the 13-of-13 agreement of an
unsupervised partition with an arithmetic rule that was never supplied to it is. The first
pass reached the same conclusion from ten accumulated masks with mean IoU 0.83 within class
against 0.65 across, which is the same result at lower resolution.

The two poses, from the aligned average of each group's masks: `video/jet-two-poses.png`
(left = level, right = raked). Median lit extent is **36 x 28 px** for the level pose over
2,738 sightings and **36 x 20 px** for the raked pose over 2,146. **Same width, 40% different
height** - which is the signature of a wing position changing, not of a scale or exposure
artifact. Width is what a scale artifact would move most, and it does not move at all.

Two further checks rule out camera distance: cells in the same column but different lanes are
at the same distance and still fall in opposite groups (c1l0 against c1l1, c2l0 against c2l1,
c3l0 against c3l1, c4l0 against c4l1); and the missile, the launcher and the bursts, measured
with the identical method over the identical cells, show no such split at all.

**What that does and does not license.** It confirms the owner's claim that the silhouette
changes cell to cell, and it sharpens it: the shape varies by cell **and lane together, by
their parity**, so a jet advancing one cell in a fixed lane flips pose on every step and
adjacent lanes in the same cell are always in opposite poses. That is why the effect reads as
a beating formation rather than as noise. The `sprite proportions` test that asserts *"all 18
jets sharing one translated outline"* is refuted - between the two poses the best-alignment
IoU is 0.42 to 0.71, where a single translated outline would give something near 1 - and it
must be replaced, not re-tuned.

It does **not** establish that there are exactly two outlines. Within-class IoU of 0.80
leaves real residual differences, and this video cannot say whether those are subtly distinct
per-cell segment groups or measurement noise: accumulation windows differ in length, the
camera views cells at the far left and far right at different angles, and phosphor bloom
varies with how long a segment was lit. **Two poses is the floor, not the count.** The
angled-light photograph of the dark tube is still the thing that would settle it, and it is
still worth asking for.

### The far-left cell: battleship only

`open-questions.md` asks whether the far-left cell is a battleship-only zone or a seventh jet
column. **An earlier revision of this section answered "both". That answer was wrong and is
withdrawn.**

The reasoning was that cell 0 carries jet-sized red sprites of 32 to 44 px alongside the
46 to 56 px battleship. The whole-file pass finds those narrow sightings - 174 of the 896 red
detections at cell 0 have a bounding box of 30 to 44 px - and shows what they are:

| Comparison | Best-alignment IoU |
| --- | --- |
| cell-0 narrow core against cell-0 wide core | **0.75** |
| cell-0 narrow core against a jet core (c3l0) | 0.55 |
| cell-0 wide core against the same jet core | 0.59 |

The narrow sightings are the **same shape** as the wide ones - hull, superstructure and
funnel, just with fewer scan slots caught - and they are no more jet-like than the full
battleship is. They are partially-lit battleships, which is the single most common artifact in
this video and the reason the accumulation method exists.

So cell 0 is a **battleship-only zone**, the jet field is cells **1 to 5**, and the printed
`BATTLE SHIP ZONE` bracket agrees with both. That resolves the open question in the direction
opposite to the earlier reading, and it means no `COLUMN_COUNT` change and no change to the
ROM's distance-zone mapping.

### Cadence, measured over the whole file

The recording is 30 fps real time, so these are real-time figures.

| Event | Interval | Frames | Basis |
| --- | --- | --- | --- |
| Missile step, one cell | **500 ms** | 15 | 744 adjacent leftward steps, whole file; p10-p90 3-22 frames, the spread being sound blanking |
| One aircraft advancing one cell | **1.2-1.9 s**, median 1.4 s | 36-56, median 42 | 12 consecutive same-aircraft steps, whole file; 3 further readings of 10-22 frames are probably two jets being confused |
| March beep interval | **0.71 s** median | 21 | 111 intervals, 590-740 Hz band, file t=180-270 s, measured independently of the picture |
| Battleship episode, in one lane and cell | 2.5 s median, 5.9 s longest | 74-178 | 17 episodes |
| Jet-kill burst duration | 0.63 s median | 19 | 76 episodes |

**One aircraft steps about twice as slowly as the march beep sounds** (1.4 s against 0.71 s).
That ratio is stable and it is the one cadence fact here that the ROM does not currently
model. Either the beep pulses twice per squadron step, or the beep is a per-aircraft rate and
two aircraft alternate. The video cannot separate those, and `asm/jetfighter.asm` currently
assumes one beep per `PAT_STEP`. This is carried into `docs/evidence/timing-analysis.md` as
measured evidence against its T1 gap.

Note this is also a disagreement with `docs/evidence/vfd-appearance.md`, which records "the
squadron advances one column per 18 frames = 600 ms" from two windows at t=210 s and t=340 s.
The whole-file measurement of a single aircraft gives 42 frames, not 18. The 18-frame figure
was a time-base cross-check in that document rather than a cadence measurement, and it is
flagged there as inference; it should not be cited as the jet step rate.

### What this video does not settle

- **Which way the attackers' colon travels, or whether it travels at all.** Its shape,
  colour, size, cell and lane are now traced (above). Its motion is not: 48 episodes, none
  longer than 8 frames, none showing a change of cell.
- **Whether the battleship traverses.** See the battleship entry. Shape, colour, size, cell
  and lanes attested; motion not.
- **Whether the red mark at the launcher is the player being hit.** The transition happens
  inside a display blank, so the name rests on position, the still photographs and the
  owner's account, not on this video.
- **The count of jet outlines.** Two poses confirmed on a parity checkerboard; whether there
  are subtler per-cell differences on top of that is neither confirmed nor refuted.
- **Whether a jet's score depends on the cell it dies in.** One kill was read as +1 and one
  battleship as +10. A distance-zone jet score is not established by that and must not be
  built in until the score is decoded frame by frame.
- **The jet outline in cell 5 lanes 1 and 2**, at 2 and 0 usable sightings. Thirteen of the
  fifteen jet cells are recovered; whether the parity rule extends to those two is
  extrapolation.
- **The battleship-kill burst in lane 1.** Never seen, on only 2 battleship episodes in that
  lane. Almost certainly a sample-size gap rather than a real absence, but not observed.
- **Whether the score field is three digits.** Only two digit positions were ever lit - the
  scores observed run 8 to 41 - so the hundreds position was never exercised.
- **Sub-pixel segment outlines.** A jet is about 36 x 24 px in a hand-held 1080p frame through
  a scratched smoked filter in bright sun, with bloom inflating every edge. These shapes place
  the segments and tell the two poses apart; they are not good enough to trace an SVG path
  from directly.

### Crops in `video/`

Every crop is cut at the frame's own measured lattice position, point-sampled up with no
interpolation, and chosen as the frame whose mask best matches that cell's core with no other
lit object within one cell. `playfield-overview.png` is at 2.5x and `score-field.png` at 7x.

**The crop set was replaced after the prose above was first written**, so that every crop
carries a frame citation and a systematic name. Old names resolve as follows:

| Old name | Now |
| --- | --- |
| `jet-column-{2..5}.png`, `jet-lane-*-column-3.png` | `jet-col{1..5}-lane{0,1,2}.png`, and the composite `jet-grid.png` |
| `missile-column-{1..5}.png` | `player-missile-col{1..5}-lane{0,1,2}.png`, and `player-missile-grid.png` |
| `battleship-lane-{top,middle,bottom}.png` | `battleship-col0-lane{0,1,2}.png` |
| `player-ship-lane-{top,middle,bottom}.png` | `player-ship-lane{0,1,2}.png` |
| `explosion-jet-column-4.png` | `jet-kill-burst-legacy-crop.png`, superseded by `jet-kill-burst-col*-lane*.png` |
| `explosion-column-6.png` | `battleship-kill-burst-legacy-crop.png`, superseded by `battleship-kill-burst-lane{0,2}.png` |
| `unidentified-red-mark-column-0.png` | `player-hit-legacy-crop.png`, superseded by `player-hit-lane{0,2}.png` |

Remember that the old names used the ROM's column order. `column N` in an old crop name is
`cell 6-N` in this section.

Frame provenance for the current set:

| Crop | Frame | File time (s) | Sightings of that cell |
| --- | --- | --- | --- |
| `battleship-col0-lane0.png` | 9200 | 306.7 | 347 |
| `battleship-col0-lane1.png` | 9365 | 312.2 | 158 |
| `battleship-col0-lane2.png` | 5079 | 169.3 | 391 |
| `jet-col1-lane0.png` | 11078 | 369.3 | 306 |
| `jet-col1-lane1.png` | 8335 | 277.8 | 746 |
| `jet-col1-lane2.png` | 8640 | 288.0 | 227 |
| `jet-col2-lane0.png` | 5603 | 186.8 | 541 |
| `jet-col2-lane1.png` | 8282 | 276.1 | 774 |
| `jet-col2-lane2.png` | 4105 | 136.8 | 73 |
| `jet-col3-lane0.png` | 10199 | 340.0 | 936 |
| `jet-col3-lane1.png` | 4960 | 165.3 | 691 |
| `jet-col3-lane2.png` | 6666 | 222.2 | 632 |
| `jet-col4-lane0.png` | 951 | 31.7 | 132 |
| `jet-col4-lane1.png` | 515 | 17.2 | 48 |
| `jet-col4-lane2.png` | 1006 | 33.5 | 56 |
| `jet-col5-lane0.png` | 3777 | 125.9 | 72 |
| `jet-kill-burst-col1-lane1.png` | 7161 | 238.7 | 94 |
| `jet-kill-burst-col2-lane1.png` | 6682 | 222.7 | 200 |
| `jet-kill-burst-col3-lane0.png` | 6219 | 207.3 | 145 |
| `jet-kill-burst-col3-lane2.png` | 9043 | 301.4 | 98 |
| `jet-kill-burst-col4-lane0.png` | 1359 | 45.3 | 18 |
| `battleship-kill-burst-lane0.png` | 6143 | 204.8 | 6 episodes in lane 0 |
| `battleship-kill-burst-lane2.png` | 9530 | 317.7 | 10 episodes in lane 2 |
| `attacker-colon.png` | 2719 | 90.6 | 87 detections overall |
| `attacker-colon-2.png` | 183 | 6.1 | 87 detections overall |
| `player-hit-lane0.png` | 3238 | 107.9 | 45 |
| `player-hit-lane2.png` | 3682 | 122.7 | 24 |
| `player-missile-col1-lane0.png` | 5391 | 179.7 | 416 |
| `player-missile-col1-lane1.png` | 9165 | 305.5 | 613 |
| `player-missile-col1-lane2.png` | 6559 | 218.6 | 632 |
| `player-missile-col2-lane0.png` | 8348 | 278.3 | 518 |
| `player-missile-col2-lane1.png` | 10414 | 347.1 | 624 |
| `player-missile-col2-lane2.png` | 6811 | 227.0 | 636 |
| `player-missile-col3-lane0.png` | 8335 | 277.8 | 544 |
| `player-missile-col3-lane1.png` | 10048 | 334.9 | 692 |
| `player-missile-col3-lane2.png` | 11533 | 384.4 | 648 |
| `player-missile-col4-lane0.png` | 7266 | 242.2 | 657 |
| `player-missile-col4-lane1.png` | 5318 | 177.3 | 783 |
| `player-missile-col4-lane2.png` | 9893 | 329.8 | 812 |
| `player-missile-col5-lane0.png` | 11693 | 389.8 | 408 |
| `player-missile-col5-lane1.png` | 8406 | 280.2 | 449 |
| `player-missile-col5-lane2.png` | 7455 | 248.5 | 535 |
| `player-ship-lane0.png` | 4732 | 157.7 | 1609 |
| `player-ship-lane1.png` | 8556 | 285.2 | 1944 |
| `player-ship-lane2.png` | 4372 | 145.7 | 2987 |

Composites and derived images, which are not single frames:

| File | What it is |
| --- | --- |
| `jet-grid.png` | The fifteen jet crops at one scale, cell 1-5 left to right, lane 0-2 top to bottom |
| `player-missile-grid.png` | The fifteen missile crops, same layout |
| `jet-two-poses.png` | Aligned average of each pose group's core masks. Left = level, right = raked |
| `segment-core-masks-red.png` | Recovered core masks, red, cell 0-6 left to right, lane 0-2 top to bottom |
| `segment-core-masks-cyan-missile.png` | The same for the missile and the launcher |
| `segment-core-masks-cyan-burst.png` | The same for the two kill bursts |
| `playfield-zone-brackets.png` | The silkscreen zone brackets that fix which cell holds what |

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
manufacturing convenience rather than a statement about what occupies them.

> **Settled by the video, against that lean.** The far-left cell is a **battleship-only
> zone**. Every red object found there in 12,237 frames is the battleship - the narrower
> sightings that looked jet-sized are partially-lit battleships, matching the full hull at
> IoU 0.75 and a real jet at only 0.55 - and the printed `BATTLE SHIP ZONE` bracket spans
> exactly that one cell. So the ghost jets in the far-left cell are printed decoration
> rather than a statement of what is drawn there. See "The far-left cell: battleship only"
> above. No `COLUMN_COUNT` or distance-zone change follows.

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

> **Video, partly.** One aircraft stepping between cells is now traced directly, and every
> recoverable cell has been compared against every other - see "The jet changes shape
> between cells" above. It confirms the variation and shows **two** distinct poses
> alternating on the parity of (cell + lane), with an unsupervised split of the shape
> similarity matrix agreeing with that parity in 13 of 13 cells. Consequence 1 above
> overstates the count: the atlas needs **two** outlines placed on a checkerboard, not up
> to 21 distinct paths. Two poses is the floor the video establishes, not proof there is
> nothing subtler on top; but 21 is not what the video shows.

### 4. The missile is two vertically-stacked bursts

> **Wrong, corrected by the video.** The stacked cyan pair is the **burst a jet leaves
> when the missile kills it**, not the missile. The missile in flight is a single cyan
> dart pointing left - `video/player-missile-grid.png`. Evidence in "The two cyan stacked
> bursts are a jet dying, not a missile" above. `missile-lit.png` is misnamed; the name is
> kept so the commit history lines up.

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

> **Confirmed and measured by the video.** The launcher holds one cell (`u` 6.190,
> sd 0.059 over 6,548 sightings, never once elsewhere) and exactly three lane positions,
> changing between them in a single frame. The red mark above it is traced too, in four
> episodes: `video/player-hit-lane{0,2}.png`. All four sit inside a long display blank, so
> the video shows the mark and its position but never catches the ship-to-mark transition;
> "the player being hit" remains the owner's reading rather than a video observation.

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
| Battleship | red-orange |
| Attackers' colon | red-orange |
| Player's ship (launcher) | cyan |
| Missile in flight | cyan |
| Jet-kill burst, battleship-kill burst | cyan |
| Score label and digits | cyan |
| Red mark at the launcher (player hit) | red-orange |

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
2. ~~**A photograph of a battleship crossing**~~ - **the sprite is obtained**, traced at
   `video/battleship-col0-lane{0,1,2}.png`. A *crossing* is not: 17 episodes and the
   sprite never left cell 0. Whether it traverses at all is still open, so a photograph or
   clip that shows one mid-crossing would still be worth having.
3. ~~Anything showing the field with **many jets lit at once**~~ - **obtained**, and it
   confirms the per-cell variation directly. Item 1 is still wanted, and is now the
   only way to settle whether there is anything finer than the two poses.

## What these photographs do not settle

- Anything about **timing** - these are stills. The gameplay video supplies cadence, in
  real time, and is carried into `docs/evidence/timing-analysis.md`; the per-skill video
  is still wanted for the thin-out and per-wave curves.
- ~~The battleship.~~ Traced from the video - see the sprite catalogue above. Its motion
  is not traced.

The two questions the first draft left open - the identity of the cyan shape, and
whether the white marks were a third phosphor - were both answered by the owner and are
now recorded above as fact, not inference.
