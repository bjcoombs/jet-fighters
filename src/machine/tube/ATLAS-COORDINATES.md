# VFD Segment Atlas - Coordinate System and Provenance

`atlas.json` is the geometry of the real Futaba DM-series tube: every phosphor
anode segment, its outline, and the `(grid, plate)` address the HD38800 drives it
from. It is pure data. Nothing in this directory renders, and nothing imports the
DOM, so the atlas loads in plain Node (headless machine probe, Vitest) as well as
in the browser. `atlas.json` is imported statically - there is no `fetch()` path.

Paths in this document are relative to the repository root.

## Coordinate system

| Property | Value |
| --- | --- |
| Space | The scope bounding box of `src/ui/geometry.ts`, origin translated to (0, 0) |
| viewBox | `0 0 363 300` (`atlas.viewBox`) |
| Unit | 1 atlas unit = 1 case-SVG viewBox unit (`CASE_VIEWBOX` is 1000 x 460) |
| Origin | Top-left of the scope bounding box |
| Axes | +x right (toward the missile station), +y down - SVG convention |
| Normalisation | Absolute units, not 0-1. Divide by `viewBox.width` / `viewBox.height` for fractions |

Absolute units in a fixed viewBox were chosen over normalised 0-1 coordinates so
that SVG `path` data stays legible and so that x and y share one scale: the
scope bounding box is projected uniformly, so `1 atlas unit` is the same number
of pixels horizontally and vertically. A consumer maps the atlas to the canvas
with a single uniform scale:

```ts
const scale = geometry.bounds.width / atlas.viewBox.width; // === bounds.height / 300
const px = { x: seg.bounds.x * scale, y: seg.bounds.y * scale };
```

### Where 363 x 300 comes from

`src/ui/geometry.ts` is the single source of truth for the scope window: a circle
(`SCOPE_CIRCLE`, centre 533,222 radius 150) fused with a rectangle to its left
(`SCOPE_RECT`, 320,150 213x144), all in case viewBox units. Their union bounding
box is `x 320..683, y 72..372` - 363 x 300 units. Translating the origin to
(0, 0) gives the atlas space, in which the scope circle is centre (213, 150)
radius 150 and the left tab is `0,78 213x144`.

Every segment is checked to fall inside that circle-plus-rectangle window, not
merely inside the bounding rectangle.

### Relationship to `src/render/layout.ts`

The printed playfield is taken unchanged from v1's `PLAYFIELD_FRACTION`
(`left 0.055, right 0.95, top 0.34, bottom 0.66` of the scope bounding box):

```text
playfield = { x: 19.965, y: 102, width: 324.885, height: 96 }
```

v1's `columnToX` spreads all six distance columns across that whole rectangle.
The atlas does not, because the reference photos show the printed border
enclosing **two** regions (see "Provenance" below):

```text
playfield.x                  field.x                       playfield right
19.965        SCORE box      84.942      6 distance columns        344.85
  |------------------------------|-----------------------------------|
         20% of the width                    80% of the width
```

| Derived value | Atlas units | Source |
| --- | --- | --- |
| SCORE box | `x 19.965, width 64.977` | 20% of the playfield width, photo-measured |
| Distance-column field | `x 84.942, width 259.908` | The remainder |
| Cell | `43.318 x 32` | field width / 6 columns, field height / 3 lanes |
| Column centres | `106.6, 149.9, 193.2, 236.5, 279.9, 323.2` | `field.x + (c + 0.5) * cellW` |
| Lane centres | `118, 150, 182` | `field.y + (l + 0.5) * cellH` |

This is the one place the atlas deviates from v1's layout maths, and it is
deliberate: v1 draws the SCORE readout on top of the column-0 jet cells. Two
phosphor segments cannot occupy the same area of glass, so the atlas separates
them. Task 11 deletes `src/render/`; until then, the two disagree by design.

**Nothing in `src/machine/` imports `src/render/` or `src/game/`.** Geometry
values were copied here with a comment citing where each came from, exactly so
that deleting the v1 modules cannot break the machine.

## Provenance

Reference material lives in `assets/reference/`. The four earlier photos are
1422 x 800 (the two device-front shots are video frames of the same unit). The
two `tube-closeup-*.webp` frames are 1600 x 1200 close-ups of a real CGL unit
powered on, supplied by the owner; they are the first material showing the tube
**lit during play** at a readable scale and they supersede earlier guesses.
`assets/reference/sprites/README.md` is the written record of what they
establish, including the identifications the owner confirmed.

| Photo | What it established |
| --- | --- |
| `tube-closeup-score0.webp` | Three lit jets against the whole unlit ghost field: lit jet size against the printed cell, and that every cell carries a ghost |
| `tube-closeup-score10.webp` | The player's ship, a missile in flight, an explosion, and the three white marks at the right edge |
| `device-front-lit.jpg` | Lit SCORE label and digit shapes; lit segment colours; the three white marks outside the right border (printed paint, not phosphor); faint ghost-phosphor matrix confirming a cell grid |
| `device-front-gameplay.jpg` | The printed border geometry: outer rectangle, inner vertical rule, ruler and lane dashes starting at that rule; the SCORE box occupying the region left of it. Also the clearest lit jet on any frame, and the white marks against the right border |
| `screen-closeup-gameplay.jpg` | Jet silhouettes in flight; lane spacing; the 10/3/2/1/G ruler against the playfield |
| `screen-overlay-closeup.jpg` | Silkscreen detail of the ruler and the top-left corner; unlit tube showing the segment matrix |

### The score box measurement

Measured independently in the two device-front frames, using the printed border's
outer left edge, the inner vertical rule, and the right border on the horizontal
centre line:

| Frame | Outer left | Inner rule | Right border | Score box fraction |
| --- | --- | --- | --- | --- |
| `device-front-gameplay.jpg` | x = 575.7 | x = 650.6 | x = 953.0 | 0.1985 |
| `device-front-lit.jpg` | x = 527 | x = 600 | x = 894 | 0.1989 |

Both agree on **0.199**; the atlas uses 0.20.

### Perspective correction

None was applied, and none of the numbers above depend on any. Both device-front
frames are handheld shots at an angle, so vertical proportions are unreliable -
measuring the playfield height off the photos gives height/width ratios between
0.30 and 0.43 depending on the frame. Only ratios along the horizontal centre
line, where the foreshortening is close to uniform, were taken from the photos.
Every vertical proportion comes from v1's already-tuned layout instead.

### Shapes, and where each one comes from

The score digits and the SCORE label are still the v1 shape tables from
`src/render/sprites.ts`, scaled and translated into atlas units. The player's
ship and the burst that marks its destruction are the outlines traced off the
two lit close-ups.

**Every other playfield sprite is traced from the gameplay video**, from the
per-cell crops in `assets/reference/sprites/video/`. That set supersedes the
outlines taken from the two handheld stills, which could prove that the sprites
were not what v1 drew but could not recover what they are.

### Tracing from the video crops

The crops are point-sampled magnifications of the video's own pixels, at a
factor that differs per crop (8x, 9x and 10x among the ones used here); the
factor is recovered from the run lengths of a few scanlines rather than assumed,
so the mask is at the video's resolution and no resampler is in the path.

Phosphor is isolated the way `assets/reference/sprites/README.md` isolates it:
red as `R - max(G, B) >= 45`. **Cyan needed a different rule.** The accumulated
cyan cores saturate toward white, where `min(G, B) - R` collapses to nearly
zero and selects the fringe instead of the sprite, so cyan is taken as
`min(G, B) >= 150` against a dark background. That threshold is what separates
the jet-kill burst's two blobs, which a colour-excess mask joins through a
four-pixel neck.

Each family's outline is the **per-pixel majority of every crop of that
sprite**, normalised to a common box - the catalogue's accumulation method one
level up, applied across the cells that carry the same shape rather than across
the frames of one cell. A shape is then what the samples agree on rather than
what one sample happened to catch. The boundary of the majority mask is walked
and simplified (Douglas-Peucker, 1.2 px), which is where the vertex counts in
`atlas.json` come from.

**Which cell each crop is in - and this is now contested.** The crop filenames
run `col0` to `col5`. When these sprites were traced the catalogue's prose had
not caught up with its own crop set, so the mapping was inferred from the counts:
darts at `col1`-`col5` and five dart columns in the atlas, bursts at
`col1`-`col4` and four, the battleship alone at `col0`. That gives **crop `colN`
= atlas grid `N - 1`**, which is what the geometry below is built on.

The catalogue has since stated the opposite convention outright: cells are
numbered as the overlay prints them, cell 0 the far zone and cell 6 the `G` line,
and **crop `colN` = atlas grid `N`**. On that reading the field is seven cells -
battleship alone in cell 0, jets in cells 1-5, the launcher alone in cell 6 - and
the `assets/reference/tube-teardown/` photographs of the bare tube agree with it:
seven printed cell boxes, no jet in the launcher's cell, no jet in the
battleship's.

**The two readings cannot both be right, and the atlas cannot express the second
one at all**, because it has six playfield grids and the seven-cell field needs
seven. Under the atlas's own map the launcher sits on grid 5 and a jet reaching
grid 5 captures it, which is the ROM's `COL_LAUNCH` and its whole distance model;
under the printed reading the launcher has a cell of its own that no jet ever
enters. Everything here is placed on the first reading because that is the one
the ROM is wired to, and the shapes are unaffected either way - a dart is the
same dart wherever the lattice says it stands.

Resolving it means going to seven playfield grids, which moves every sprite in
the atlas and every column in the ROM. `assets/reference/tube-teardown/README.md`
says the same thing and declines to do it, because the grid split it implies -
7 playfield, 2 score digit cells, 1 label against the atlas's 6, 3, 1 - is read
off printed cell boxes and not off the tube's leads. That correlation is the
work that settles it. Until it is done, a sprite may be one cell out; the
conformance test will not catch that, because both readings are internally
consistent.

### Converting to atlas units

The catalogue measures in **reference-pose pixels** on a lattice of 74.5 px
column pitch and 44 px lane pitch. The atlas cell is 36.3 x 17.68 units
(`layout.ts` `CELL`), so:

```text
units_x = px * 36.3 / 74.5   = px * 0.487248
units_y = px * 17.68 / 44    = px * 0.401818
```

The two factors differ because the atlas spreads its three lanes further apart,
relative to the column pitch, than the unit does: the reference cell is 1.69:1
and the atlas cell 2.05:1. Earlier revisions kept each sprite's photographed
aspect ratio and let its cell-fraction go; this revision **honours the cell
fraction on both axes** and lets the aspect ratio flatten by that same 1.21.
The reason the trade went the other way is that the measurements are no longer
eyeballed off a handheld frame - they are accumulated masks on a lattice
anchored to the launcher - and a sprite that occupies the wrong share of its
cell reads wrong next to the printed ghost it sits on. The flattening is stated
per sprite below rather than hidden.

### Sprite silhouettes

| Sprite | Video px | Of a cell (w x h) | Atlas units | Crops |
| --- | --- | --- | --- | --- |
| Jet, level pose | 36 x 28 | 0.48 x 0.64 | 17.54 x 11.25 | `video/jet-col*-lane*.png`, 7 of them |
| Jet, raked pose | 39 x 20 | 0.52 x 0.45 | 19.00 x 8.04 | the other 6 |
| Attacker colon | 8 x 17 | 0.11 x 0.39 | 3.90 x 6.83 | `video/attacker-colon-2.png` |
| Missile dart | 25 x 10 | 0.34 x 0.23 | 12.18 x 4.02 | `video/player-missile-col*-lane*.png`, 15 |
| Jet-kill burst | 33 x 37 | 0.44 x 0.84 | 16.08 x 14.87 | `video/jet-kill-burst-col*-lane*.png`, 5 |
| Battleship | 50 x 18 | 0.67 x 0.41 | 24.36 x 7.23 | `video/battleship-col0-lane*.png`, 3 |

- **The jet has two poses, and which cell gets which is not free.** Thirteen
  per-cell crops, clustered by intersection-over-union of their normalised
  masks, fall into two groups with no ambiguous member: within a group they
  agree at ~0.85 and across groups at ~0.6-0.7. The groups are exactly the two
  parities of (column + lane) - the level-winged delta where that sum is even,
  the raked wedge where it is odd. Stepping between them is the wing-beat the
  owner described, and it is in the phosphor rather than in the program. The two
  poses do not share proportions: the level one is deeper and shorter, the raked
  one longer and flatter, which is most of what makes them read as attitudes
  rather than as one shape jittering.

  **Two poses is the floor, not the count.** Within-group IoU of 0.85 leaves
  real residual differences, and this video cannot say whether they are 18
  subtly distinct outlines or measurement noise. The angled-light photograph of
  the dark tube is still the thing that would settle it.

- **The attackers' shot is a colon**, exactly as the owner has always described
  it: two red blobs one directly above the other with clear dark glass between,
  8 x 17 px. It is **one segment with two sub-paths**, not two segments. A
  machine has no reason to light half a colon, and at two segments the family
  would need 36 addresses instead of 18 and would not fit the tube.

- **The missile dart** points left, the direction the player fires, with a
  flared tail at its right. Fifteen crops measure 23-28 x 9-12 px - a pixel or
  two of bloom around one shape - so it is one outline in fifteen placements,
  which is the negative result the catalogue records: unlike the jet it does not
  change with position.

- **The jet-kill burst** is two spiky cyan blobs stacked vertically, the upper
  broader than the lower, their jagged edges facing away from each other. At
  0.84 of the lane pitch it is the largest thing in its cell but it stays inside
  its own lane.

  **One segment with two sub-paths, and this was tested rather than assumed.**
  The alternative was real: the owner's account is that animation on this tube
  comes from lighting different areas within a cell, so two blobs could have
  been two frames of an explosion lit in sequence, which would be two segments.
  The two hypotheses differ in something the video can answer - whether any
  frame shows one blob lit without the other. Across a burst episode sampled at
  30 fps and tracked as cyan connected components, the pair reads as one merged
  component in eleven frames and separates in exactly one, **with both parts
  present in that frame**. No frame anywhere shows a lone blob. The animation
  reading predicts frames with exactly one lit; there are none.

  What that does not amount to: it is **one episode**, the blobs usually merge
  so the check leans on the frames where they happen not to, and a 30 fps frame
  integrates a ~71 Hz multiplex rather than sampling an instant. Good evidence,
  not proof. A lone blob in any future episode reverses this and the family
  doubles from 15 addresses to 30.

- **The battleship** is a warship in side profile: a long low hull with the
  superstructure and funnel rising amidships toward the stern. It is drawn in
  the far cell on the same column centre as that cell's jet, in each of the
  three lanes, because the video finds it in all three and stationary in
  whichever one it is lit in.

### Settled: the battleship's cell is its own, and carries no jet

Three independent sources agree, so this is no longer hedged anywhere in this
document:

1. **The teardown photographs.** Seven printed cell boxes. The far one carries a
   battleship over printed sea with a burst behind it, and **no aircraft**.
2. **The catalogue's whole-file video measurement.** The jet-sized red sightings
   in that cell are partially-lit battleships - IoU 0.75 against the full hull
   against 0.55 against a real jet. It withdraws the earlier "it is both"
   reading, which `assets/reference/sprites/README.md` had raised as an open
   question.
3. **The owner, directly**: "The ship has its own left-hand side; jet fighters do
   not start on that column."

So the jet field is five cells, not six or seven, and `jet_lane*_col0` is not a
segment the tube has. The atlas used to draw one because the playfield had six
grids and the battleship shared the far jet column's; the seventh grid separated
them.

The ship has a segment per lane because the video finds it in all three and
stationary in whichever one it is lit in - and the ROM already stepped
`NIB_BSLANE` through all three with nowhere to show it.


## Colour regions

`colorRegion` is `'cyan' | 'red'`.

The v2 PRD (`docs/prd/jet-fighters-v2.md`, R5 and Technical Context) is
authoritative: the tube is a **cyan/red two-phosphor Futaba DM-series** unit,
colour coming from patterned phosphor plus a filter overlay. Colour is therefore
a fixed property of each segment - a segment can never change colour at runtime,
and there is no colour field in the board's PWM state.

Two other sources disagree in naming, and neither is authoritative here:

- `src/render/sprites.ts` `PALETTE` calls the attacker colour **`amber`**
  (`#ff9a2e`) and the v1 PRD says "orange/amber". That is v1's rendition of the
  photographed colour, not a claim about the phosphor.
- The Task Master description for this task also says `'cyan' | 'amber'`.

The atlas uses the PRD's `red`. Rendering the exact hue is task 6's problem
(phosphor physics plus the filter overlay tint); the atlas only says which of the
two phosphor regions a segment sits in.

| Region | Segments |
| --- | --- |
| `red` | jets (18), attacker colons (18), battleship (3), the player's destruction (3) - everything the machine attacks with, plus the burst it makes of the player |
| `cyan` | missile darts (15), jet-kill bursts (12), the player's ship (3), score digits (21), SCORE label (1) |

94 segments in all. The two burst families are the same three plates under
different grids and are opposite colours, which is only possible because colour
is a property of the glass rather than of the address: `red` under D5, `cyan`
under D0-D3.

## Grid and plate mapping

The MCU scans 10 display grids on D0-D9 and drives roughly 20 plate (anode) lines
from the R ports plus D10-D13 - the topology of the closest emulated sibling,
MAME's `ghalien` (Gakken Heiankyo Alien, HD38800 at 400 kHz). `GRID_COUNT = 10`
and `PLATE_COUNT = 20` in `atlas-schema.ts` come from there. The atlas uses 71 of
the 200 available addresses; the highest plate index used is 11.

Grids are assigned as vertical strips of the tube, left to right, which is how a
scanned VFD is normally laid out and what the sweep loop in the game ROM will
expect:

| Grid | Region | Plates |
| --- | --- | --- |
| D0 | Distance column 0 (BATTLE SHIP ZONE, ruler "10") | 0-2 jets, 3-5 colons, 6-8 missile darts, 9-11 jet-kill bursts, 12-14 battleship lanes 0-2 |
| D1 | Distance column 1 | 0-2 jets, 3-5 colons, 6-8 darts, 9-11 bursts |
| D2 | Distance column 2 | as D1 |
| D3 | Distance column 3 | as D1 |
| D4 | Distance column 4 | 0-2 jets, 3-5 colons, 6-8 darts |
| D5 | Distance column 5 (the G / capture line) | 0-2 jets, 3-5 colons, 6-8 the player's ship at lanes 0-2, 9-11 the burst where it is destroyed |
| D6 | SCORE digit 0 (hundreds) | 0-6 = seven-segment a-g |
| D7 | SCORE digit 1 (tens) | 0-6 = seven-segment a-g |
| D8 | SCORE digit 2 (units) | 0-6 = seven-segment a-g |
| D9 | Status | 0 SCORE label |

The plate assignment is deliberately regular, and the regularity is now four
roles rather than two. **On every playfield grid, plate `n` is lane `n`'s jet,
`n + 3` its attacker colon, `n + 6` the player's own object in that cell, and
`n + 9` the burst that happens there.** The last two each mean different things
under different grids - `n + 6` is the missile dart under D0-D4 and the launcher
itself under D5, `n + 9` the cyan jet-kill burst under D0-D3 and the player's
red destruction under D5 - which is what a multiplexed tube is, not an overload.
A ROM routine that steps the squadron writes the same bit pattern shifted
between grids, and `PAT_LANE` needs one group per role rather than one per
actor, which is how the whole playfield fits four table entries wide.

Two holes in that lattice are deliberate: D4 has no plates 9-11 and D5 no dart.
The video finds no jet, and therefore no kill, in the two cells nearest the
launcher, and no dart in the launcher's own cell.

### Twelve plates a grid was the ROM's habit, not the tube's

`PLATE_COUNT` is 20 here and in `src/machine/board/display.ts`, where the board
wires the whole twenty-line plate bus to R0-R4. The game ROM declared only
`R_PLATE0..2` - R0, R1, R2, twelve plates - for as long as every grid fitted in
twelve, and that made the twelve look like a hardware ceiling. It is not one.

The far column does not fit: it carries a jet, a colon, a dart, a burst and the
battleship, which is fifteen segments. **No consolidation recovers those three
plates** - each of the five families is placed there by direct observation - so
the battleship sits at plates 12-14 and the ROM drives a fourth plate file onto
R3. It is the only actor on the tube above plate 11.

### Assumptions - read this before depending on an address

The exact HD38800Axx and Futaba serials are unknown without a teardown, Jet
Fighter's mask ROM was never dumped, and the owner's angled-light photo of the
dark tube (the shot that would show the complete segment atlas at once) is listed
as **pending** in the v2 PRD's evidence pipeline. Everything below is a reasoned
assumption, not an observation, and is expected to be revised when that photo
arrives.

1. **Every address in the table above.** No photo shows which grid drives which
   segment. The assignment is derived from the sibling hardware's topology and
   from what a 2 KB scan loop makes cheap, not from the unit.
2. **Grid count applied to this layout.** Ten grids for six distance columns,
   three score digits and one status strip is a clean fit, but a real tube might
   for example give the battleship its own grid and share the score digits.
3. **Six distance columns.** From `src/game/constants.ts` `GRID_COLUMNS = 6`
   (v1 PRD R2 expected 5-7). The dotted ruler in `screen-overlay-closeup.jpg`
   appears to have more than six dot groups, so the real column count may be
   higher. If it changes, the atlas and this table change with it.
4. **The battleship shares the far column's grid.** The video puts it in a
   seventh cell that this atlas does not model, so its three segments hang under
   D0 alongside that column's own five. If the real tube gives the far cell its
   own grid - which is what a seventh printed cell suggests - these three
   addresses move.
5. **Plates 12-14, and R3 with them.** The board wires twenty plate lines, so
   nothing here is out of range, but no observation says the far column's grid
   is the one with more plates on it. It is the column that needs them.
6. **The colon's placement, though no longer its shape.** The shape is now
   traced (`video/attacker-colon-2.png`). Where it sits inside its cell is not:
   no frame locates a colon against the jet that fired it, so it keeps the
   offset the old round dot had, `cellW * 0.358` toward the player, chosen to
   clear the jet nose while staying inside the cell. It is the only playfield
   segment that overlaps nothing else in its own cell, and the only one whose
   position is a choice rather than a measurement.

   **Which columns carry a colon is also unevidenced.** All six do here, by
   symmetry with the jets, because a shot travelling from a jet to the player
   crosses every cell between them. The video never caught a colon in flight at
   a known column, so this is the ROM's model rather than the tube's.
7. **The player's destruction keeps its address and its outline.** The three
   `explosion_lane{0-2}` segments are still on D5 plates 9-11, and the video
   corroborates them: `video/player-hit-lane0.png` and `-lane2.png` catch the
   burst at two of the three lanes. The outline is still the one traced off
   `sprites/explosion-red-lit.png` - retracing it was not in this change's scope.
   **The ROM now drives it**, which it did not before.
8. **`score_label` is an extra segment beyond this task's brief.**
   `device-front-lit.jpg` clearly shows the word SCORE lit in cyan, so it is a
   phosphor segment and it is in the atlas as a single block on D9 plate 0. Its
   `path` is the word's bounding rectangle, not letterforms - task 6 should draw
   the word, not fill the box.

### Known segment overlaps

Sixty pairs of segments have overlapping bounding boxes, and every one of them
is two things drawn in the same cell: a jet and the dart that kills it, the
burst it leaves, the launcher and the burst that marks its destruction, the
battleship and the far cell's own occupants. Bounding boxes overlap; the drawn
paths overlap less.

`atlas.test.ts` no longer keeps a list of tolerated pairs. It asserts that **the
segments whose bounding boxes intersect are exactly the segments whose ids name
the same (lane, column)** - an equality between the geometry and the naming, so
a shape that grows into its neighbour's cell fails and so does one that shrinks
out of its own. The one exception is stated separately and is a placement
decision rather than a consequence: the colon is offset clear of its own
cell-mates and touches nothing but the battleship, which is drawn half again as
wide as a jet and reaches it.

### Known gaps, so they are not lost

Three things this revision leaves undone, recorded rather than dropped:

1. **The battleship's destruction burst is not in the atlas.** The crop set
   carries `video/battleship-kill-burst-lane0.png` and `-lane2.png` - the pair
   of cyan blobs arranged side by side that the catalogue's prose still calls
   the "column-6 burst" and still calls inference rather than observation. It
   would fit at D0 plates 15-17, but that drags in a fifth plate file and a
   battleship-destroyed display the ROM does not have. It was not commissioned
   and is not built.
2. **The colon in the launcher's own cell can never light.** `NIB_RCOL` in the
   ROM spends zero on "no rocket in flight", so column 0 is not a value the
   nibble can hold, and a shot arriving at the player is resolved on the sweep
   it lands rather than drawn there first. The tube has the segment;
   `tools/probe/rom-atlas-conformance.test.ts` subtracts it by name so the gap
   is visible rather than silent.
3. **Five hundreds-digit segments can never light either**, because the score
   caps at 199 and the hundreds column therefore only ever shows a `1`. That is
   a game rule meeting a three-digit readout, not a fault, and the readout is
   three digits on the evidence of `tube-closeup-score10.webp`.

4. **The whole cell assignment may be one out**, per "Which cell each crop is in"
   above. This is the largest open question in the atlas and it is bigger than
   any sprite in it.
5. **The teardown photographs supersede everything used here for shape.**
   `assets/reference/tube-teardown/` arrived after these outlines were traced:
   the bare tube at 46.7 MP, every segment visible at once, no filter and no
   multiplexing to defeat. The outlines below are accumulated video masks, which
   is the best that could be had from lit references and is not as good as that.
   Retracing from the teardown crops is the obvious next pass, and it would also
   settle the jet: the teardown shows the three lanes of a single cell carrying
   three different outlines, so the two-pose parity model here is a floor and
   may be as many as fifteen distinct shapes.

## Tracing workflow

To revise the atlas - and this is the expected path once the angled-light photo
arrives:

1. Read the photo at full resolution. For faint ghost phosphor, level-stretch the
   dark end rather than raising brightness, which blows out the lit segments:
   `magick <photo> -crop WxH+X+Y +repage -colorspace gray -level 8%,28% -resize 350% out.png`
2. Express every measurement as a fraction of a printed feature that also exists
   in `src/ui/geometry.ts` or `src/render/layout.ts`, never in raw pixels. For
   *positions* on the printed layout, measure only along the horizontal centre
   line unless the photo is square on. For *sprite sizes*, compare each axis
   against a printed feature on that same axis (column width horizontally, lane
   pitch vertically) - the foreshortening then cancels and both frames agree.
3. Isolate a lit sprite before measuring it rather than eyeballing the glow. Red
   phosphor separates on an `R - B` channel difference, and sweeping the
   threshold brackets the bloom instead of guessing it:

   ```bash
   magick <photo> -crop WxH+X+Y +repage -separate -channel R,B +channel null: \
     -compose MinusSrc -composite -threshold 35% -format "%@\n" info:
   ```

4. Convert to atlas units with the factors in "Converting to atlas units"
   above. Where a sprite's measured cell-fractions and its measured aspect ratio
   disagree - they do, because the atlas spreads its lanes further apart than
   the unit does - keep the cell fractions and state the flattening. That is the
   opposite of what earlier revisions did, and "Converting to atlas units" says
   why the trade went the other way.
5. Edit `atlas.json` directly. Keep `bounds` consistent with `path` - it is the
   axis-aligned bounding box of the path, and consumers trust it rather than
   parsing the path.
6. Run `npm test`. `src/machine/tube/atlas.test.ts` checks the schema, the
   counts, address uniqueness, the two jet poses against the parity that places
   them, and that every segment stays inside the viewBox;
   `tools/probe/rom-atlas-conformance.test.ts` plays the machine and checks that
   the ROM drives every address the atlas defines and no address it does not,
   which is what catches a new segment nothing lights. Then re-render a preview
   to eyeball it against the reference:

   ```bash
   node -e "const a=require('./src/machine/tube/atlas.json');
   const p=a.segments.map(s=>'<path d=\"'+s.path+'\" fill=\"'+(s.colorRegion==='cyan'?'#5fe0ec':'#ff5a3c')+'\"/>').join('');
   require('fs').writeFileSync('/tmp/atlas.svg','<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 363 300\"><rect width=\"363\" height=\"300\" fill=\"#050505\"/>'+p+'</svg>')"
   ```

7. If the segment inventory changes, update `EXPECTED_SEGMENT_COUNTS` and the id
   unions in `atlas-schema.ts`. The id unions are template-literal types, so a
   mistyped id is a compile error and `validateAtlas` rejects any id that matches
   no documented family.
