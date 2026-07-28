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
| Unit | 1 atlas unit = 1 case-SVG viewBox unit (`CASE_VIEWBOX` is 896 x 440) |
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

### What is traced from the bare tube, and what is not

The teardown photographs supersede the video for shape. **This table is the
record of where each outline currently comes from; do not read a carried-over
outline as a retraced one.**

| Family | Source |
| --- | --- |
| Jets, cells 1-5 | `tube-teardown/tube-unlit-full.jpg`, 15 distinct outlines |
| Attacker colons, cells 1-5 | the same, two dots straddling the fuselage at the nose |
| Missile darts, cells 1-5 | `tube-teardown/tube-unlit-full.jpg` |
| Jet-kill bursts, cells 1-5 | the same, two blobs in one segment |
| Battleship, cell 0 | `tube-teardown/tube-unlit-full.jpg` |
| Printed sea, cell 0 | the same - new, nothing had accounted for it |
| Battleship-kill burst, cell 0 | the same - new to the atlas |
| Launcher, cell 6 | `tube-teardown/tube-unlit-full.jpg` |
| Capture burst, cell 6 | the same - new to the atlas |
| Rocket burst (`explosion_*`), cell 6 | the same |
| Cell 6's smoke | `tube-teardown/tube-unlit-full.jpg` - **now traced**, see below |
| Score digits, SCORE label | `tube-teardown/score-block.jpg`, traced by `tools/trace/score.py` |

Every row above that names the teardown photograph is now produced by
`tools/trace/`, which is the retrace described in the next section. **The score
readout is now covered too**, by `tools/trace/score.py` against
`tube-teardown/score-block.jpg` - it was the last thing in the atlas still
carrying v1's invented shapes, and the owner spotted it by eye before any
measurement did: the digits were drawn as hollow rectangles rather than as
seven-segment glyphs, at 8.11 x 9.59 units against a measured 10.16 x 17.50.

### The retrace, and the thing it turned out not to be

The outlines were coarser than the glass, and the obvious suspect was the
Douglas-Peucker simplification at the end of the pipeline. **It was not, and the
measurement is worth keeping** because it is exactly the sort of thing that gets
assumed:

Median over the 78 traced segments, against an unsimplified contour of the same
print (`report.py --baseline` re-measures it):

| | Deviation from the traced contour |
| --- | --- |
| The atlas as it stood, against the contour it should follow | **0.88 atlas units** |
| The same, with the best rigid translation removed | 0.89 units |
| Douglas-Peucker at the tolerance this retrace uses | 0.08 units |
| Douglas-Peucker at 6 px, four times coarser than anything considered | 0.36 units |

Simplification accounts for at most a tenth of that, and removing the
translation does not shrink it - so the loss was neither the tolerance nor a
uniform registration shift. It was the mask: sprites merged with the silkscreen
rules and with each other, and marks below the largest few in a cell were
dropped. The tail runs much further than the median says - the capture burst was
out by 8 units because most of it was not there.

`tools/trace/` is that pipeline, committed rather than run once and described:
`lattice.py` registers, `masks.py` separates the pigments, `contour.py` traces
and simplifies, `trace_atlas.py` names each mark and writes `atlas.json`, and
`report.py` re-measures every number the other four depend on. It needs NumPy,
SciPy and Pillow, and nothing in `src/` or in CI imports it.

Four things changed, and each is a measurement rather than a preference.

**The lattice was re-measured, and it had a 2% scale error.** The printed cell
boundaries sit on a 523.85 px pitch (least squares over six gutters, worst
residual 2.1 px = 0.13 atlas units) and the lane dividers on 308.83 px. The
committed atlas implied 515.4 px and 302.4 px - about 2% short on each axis,
which is 0.08 of a cell by the far end of the field. Two of the eight vertical
boundaries and two of the four horizontal ones are excluded from the fit and
`lattice.py` says which and why; they are the field's outer borders, where the
dark run is a frame against tube structure rather than a gutter between two
equal neighbours.

**The print on this glass is three things, not two.** Over cell 2's top lane:

| | luma | blue-minus-red |
| --- | --- | --- |
| White phosphor | 189 | +3 |
| Yellow phosphor | 157 | -53 |
| Silkscreen cell rules | 155 | -3 |
| Dark glass | 123 | +5 |

The silkscreen box rules are as bright as the yellow phosphor and as neutral as
the white, so neither channel separates them alone - and a rule is not a
segment. Left in, cell 0's burst took the box's right-hand rule into its own
component and traced as a shape running the full height of the cell, which is
where its 22-unit bounding box came from. Two thresholds separate all three:
pigment on blue-minus-red, then phosphor from silkscreen on brightness among
the neutral print only.

**A mark is named by where it is, not by what it touches.** Several families are
two or more separate marks - the colon's two dots, the burst's two blobs, the
sea's row of eight wave glyphs, the smoke's eleven curls - and several *touch*
their neighbour, the dart running into the upper burst blob in about half the
cells. So each family's committed outline is rasterised as a seed and grown
through the mask; a merged pair is cut where the print thins rather than where
the previous atlas guessed. Seeding from the committed *bounding box* instead
was tried first and is the wrong thing: a colon's box is mostly the fuselage it
straddles and a burst's box is mostly the dart between its blobs.

**The tolerance is measured, and it is measured at run time.** Nudge the print
threshold by ±5% of a cell's own print-to-field contrast and the traced boundary
moves 1.41 px. Below that a simplifier is encoding which threshold the run
happened to pick, so the tolerance is set *at* that floor - it discards nothing
the trace can tell from its own repeatability. For the check in the other
direction: 1.41 px is **0.084 atlas units**, against the control grid's 0.63-unit
row spacing as the finest real feature the glass has
(`docs/evidence/tube-mesh.md`) and the photograph's own 0.59-unit edge width. It
is eight times finer than either, so nothing that could be a feature is at risk.
`trace_atlas.py` computes it from the photograph on every run rather than
carrying a number someone could nudge.

**That tolerance is measured on the playfield, and the score block is not the
playfield** - it is a dimmer part of the plate against a different background,
so whether the figure covers it there is a question rather than an assumption.
It does: each of the three score boxes traces to **1.00 px** of its own
repeatability against the 1.41 px the playfield probes give, so the simplifier
is discarding less than the score's trace can distinguish. `trace_atlas.py`
prints all three on every run beside the tolerance. Two cautions on reading
that number. It nudges *both* mask levels rather than the print level alone -
for a cyan segment the traced boundary is the rim grown out of the bright core,
which the phosphor level sets and the print level only caps, so nudging the
print level by itself would move a boundary the trace does not use and report a
repeatability far better than it has. And it is a nearest-*vertex* distance on
a contour carrying a vertex per pixel, so it cannot resolve much below 1 px and
never reads zero; it is the same estimator behind the 1.41 px, which is what
makes the two comparable, and it should be read as "no worse than the
playfield" rather than as an absolute.

Coordinates are written to two decimal places, not four. 0.01 atlas units is
0.17 px on the tracing photograph - eight times finer than the trace's own
repeatability - so the two extra places were recording noise, and they cost
20 kB of the shipped bundle.

### What it costs

| | Before | After |
| --- | --- | --- |
| Path vertices across the atlas | 3,287 | 4,787 |
| `atlas.json` | 89.7 kB | 99.9 kB |
| Bundle | 173.6 kB (54.0 kB gzip) | 183.8 kB (60.7 kB gzip) |
| Per-frame path traversal, 30 segments lit | 0.193 ms | 0.296 ms |

The frame figure is the renderer's own geometry work against a no-op context -
the part that scales with the vertex count - and it is 1.8% of a 16.7 ms budget
against 1.2% before. The ghost layer dominates it, because it traces all 94
segments every frame and never changes; caching it to a bitmap the way the mesh
layer already is would remove the growth entirely, and is the lever to pull if
this ever matters. It does not yet.

### Tracing from the bare tube

The plate is **not evenly lit**, so a single global threshold does not segment
all 21 cells: it takes some cleanly and loses others entirely. Masking is
therefore per cell - Otsu on brightness inside the cell separates print from the
dark hatched fill, and blue-minus-red then splits the two pigments at the
midpoint of that cell's own two clusters. Unlit, the yellow phosphor is the one
that emits red-orange and the white is the one that emits cyan; the two measure
around -66 and -28 against -4 and +2, so the split is nowhere near either class.

Two window sizes, and the reason is worth keeping. Otsu is a property of the
pixels it sees, so widening the window takes in more dark border, drops the
threshold, and merges neighbouring sprites into one component; narrowing it
clips the sprites that sit hard against the cell's right-hand edge. **The
threshold is computed over a tight window and applied to a wide one**, and a
component belongs to whichever cell its centroid falls in.

**When a threshold cannot find a thing, check whether its position is already
known.** This is the method, and it has unblocked every family that resisted the
first attempt - three times, in three different ways:

- The **jets** came out right because the cell lattice was measured first and
  each aircraft traced inside its own cell.
- The **white families** separate because all three sit in the cell's right-hand
  half and ordering them down the lane names each one. Ranking them by a
  property instead - the flattest of the three is the dart - picks wrongly the
  moment two of them merge, which they do at any single threshold.
- The **sea** is found because the hull's extent is known, so the wave rows
  below it can be thresholded on their own.

The general form: a threshold is being asked to *discover* a boundary that is
usually already known from the geometry. Give it the smaller question and it
stops having to be clever. Where this fails - cell 6, below - it fails because
the position genuinely is not known, not because the threshold needs tuning.

**Where a threshold cannot find a family, locate it and threshold inside it.**
The printed sea is two rows of small wave glyphs under the battleship's hull,
and a cell-wide adaptive threshold drops them as noise - they are faint and the
hull beside them is not. Profiling the cell down the lane finds them without
help: the hull runs to about +21 of the lane centre, then a gap, then wave rows
at +25..+38 and +40..+52, the same in all three lanes. Splitting on that gap
names the hull and the sea without asking a threshold to tell them apart.

**Locate families by position, do not rank them by size.** A jet cell holds
three white shapes - two burst blobs and the dart between them - and they are
identified by where they sit: all three are in the cell's right-hand half, and
ordering them down the lane names each one. Ranking by a property instead (the
flattest of the three is the dart) picks wrongly the moment two of them merge,
which they do in about half the cells at any single threshold. The size is then
an independent check on the assignment rather than the thing that made it: each
traced dart converts back to 23.9 x 9.6 of the video's own pixels against the
catalogue's 26 x 12 for the missile in flight.

Scale: the printed lattice measures 259 px across and 152 px down at the working
resolution against the atlas cell's 31.114 x 17.68 units, so 0.1201 and 0.1163
units per pixel. Those are within 3% of each other - the bare tube's aspect is
very nearly the atlas's, which the video's was not.

### Shapes, and where each one comes from

The score digits and the SCORE label are still the v1 shape tables from
`src/render/sprites.ts`, scaled and translated into atlas units.

**Every playfield outline in the shipped atlas is traced from the bare tube**,
by `tools/trace/` - including the player's ship and the two bursts in its cell,
which had been the last shapes still coming from the lit close-ups. The two
sections that follow describe the video-crop trace those outlines replaced;
they are kept for the questions they leave open rather than for the geometry.

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
and simplified (Douglas-Peucker, 1.2 px).

**None of the shipped outlines come from this now** - "The retrace, and the
thing it turned out not to be" above replaced them all with the bare tube. The
section is kept because the video is still the only source for how the sprites
*behave*, and because the two readings of which cell a crop is in, below, are
still unresolved.

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

### The lattice comes from the print, not from the sprites

**The print is where the cells are; the phosphor is content placed inside them.**
Deriving cell positions from sprite centroids inverts that: it makes the artwork
define the cells it sits in, so any systematic offset in how the artwork was laid
out becomes invisible by construction. The first version of this trace did
exactly that, and the offset was real.

Each printed boundary is a **triple** of dark runs - one cell's right rule, the
gutter between the boxes, the next cell's left rule. Their centres:

| Boundary | Dark runs, as cell index | Centre |
| --- | --- | --- |
| 3 \| 4 | 3.58 · 3.64-3.67 · 3.73-3.74 | 3.66 |
| 4 \| 5 | 4.57-4.61 · 4.65-4.69 · 4.73-4.76 | 4.665 |
| 5 \| 6 | 5.58-5.64 · 5.66-5.71 · 5.75-5.78 | 5.68 |

Spacing 1.005 and 1.015, so the pitch taken from the sprites was right. **The
phase was not**: every boundary sits at `n + 0.66` rather than `n + 0.5`, so the
printed cell centres are at `n + 0.16` and the artwork sits about 0.16 of a cell
- five atlas units - to their left. `atlas.test.ts` now pins that offset, because
the tests that existed were all satisfied by a uniform shift and could not see it.

**The last cell is not wider, and the measurement that says it is, is the wrong
one.** Cell 6's printed *box* runs 0.95 of a pitch against 0.82-0.83 for its
neighbours, which reads as a 15% wider cell. But the boxes are inset within
their slots by half a gutter on each side, and cell 6 has no neighbour on its
outer side - so there is no gutter to leave and its box simply runs on to the
field border. Its **slot**, boundary centre to boundary centre and the thing
`layout.ts` models, is 1.005 like every other. The field is seven equal cells.

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

### The two ways this atlas goes wrong

Both have happened more than once, and only the first was written down.

**A segment the glass does not have.** The invented ground line, the lives
display, the five seven-segment strokes for a hundreds digit that is really two
strokes. The ROM drives an address, the write reaches no phosphor, and the
sprite simply never appears. `tools/probe/rom-atlas-conformance.test.ts` is the
guard: every address driven must resolve, with no exceptions, ever. It caught
the hundreds digit before the photograph explained it.

**A belief promoted to a constraint.** Subtler, and the guard above cannot see
it, because the addresses are all real. Someone reasons about what the machine
*ought* to do, builds the atlas that way, and then writes a test that freezes
the reasoning as though it were a measurement.

The worked example is the attackers' colon. A shot should read as having left
the aircraft that fired it, so it was drawn offset toward the player, clear of
the jet - and `atlas.test.ts` then asserted that it overlapped nothing, which
was true of the atlas and had never been true of the tube. The bare tube puts
its two dots straddling the fuselage at the nose. The assertion was pinning a
choice, and it would have gone on passing forever.

The tell is an assertion that describes an intention rather than an observation:
*the colon should be clear of the jet*, *the burst should be centred on the
cell*, *the launcher must not out-mass a jet*. Each is a reason someone had.
When a test has no reference behind it - no photograph, no measurement, no
statement from the owner - it is pinning the last person's judgement, and the
right form is to say so in the test rather than to let it read as fact.

### Cell 6's smoke, and why five attempts missed it

The player's cell holds four printed things per lane: two solid yellow
starbursts, a yellow **stipple** - a knot of loose curls - and the cyan
launcher. All four are now traced, and the stipple is in `capture_lane*`'s path.
Five earlier approaches had failed, and what they were all doing wrong is the
useful part:

| Attempt | Result |
| --- | --- |
| One global threshold | Takes some cells cleanly, loses others entirely |
| Per-cell adaptive (Otsu) | Two solid components; the stipple is mostly dropped |
| Erosion, to break necks | Destroys the stipple rather than separating it |
| Hue split | **Hue is the same**: 49 deg against 46-47 deg. No separation |
| Saturation / value split | Separates pixel-wise, but the solid bursts' soft edges are low-saturation too and bridge into the stipple, so it comes back as one blob spanning the cell |

Every one of them was looking for a *pixel property* that would tell a stipple
from a solid area. **There is no such property, and none was needed.** At the
per-lane Otsu threshold the stipple comes out as about **eleven separate marks
of 200 to 1,500 px each**, none of them touching either starburst. They were
never merged with anything. What dropped them was a pipeline that took the
largest components in the cell and treated the rest as noise, and the fix is
that the smoke has a *name* and a place to be: unclaimed red print in the left
half of cell 6, which is the same left/right discriminator that told the capture
burst from the rocket burst.

**The mesh was not the obstacle, and this is worth recording because it looked
like the promising lead.** `docs/evidence/tube-mesh.md` had established that the
control grid modulates the stipple, both phosphors and the dark field alike, and
the reasonable hypothesis was that removing that known periodic modulation would
let the stipple separate where thresholds had failed. It would not have: over
the smoke, the grid's ripple measures **3.5 grey levels of standard deviation
against 74 levels of curl-to-glass contrast** - twenty times too small to be
what was defeating a threshold. Low-passing below the grid's period is in
`masks.py` anyway, because it keeps grid ripple out of the traced contour, but
it changes the smoke's mask by about 7% and it is not what unblocked it.

So the stipple is a coarse print of loose curls, as `tube-mesh.md` suspected
when it said "whatever makes the stipple a stipple is a coarser feature drawn on
top". It is drawn, not screened.

The stipple **is a lit segment**, which a lit photograph from the owner settles:
`lit-capture-burst.jpg` shows the curls glowing red-orange beside a lit
starburst in the same event, **co-lit and contiguous**. So it is one segment with
the stipple in its path - the same structure as the colon's two dots, the
burst's two blobs and the sea's wave glyphs. Strongly evidenced rather than
proved: bloom in a lit photograph can join two separately addressed segments.
**What would falsify it is a frame in which the stipple lights without the
starburst, or the starburst without the stipple** - and if that frame turns up,
what changes is one segment splitting into two addresses, not the outline, which
is now measured either way.

**That photograph is not in this repository.** It is cited here and in
`docs/evidence/open-questions.md` as `assets/reference/tube-teardown/lit-capture-burst.jpg`
and no commit has ever added it. It was in the hands of whoever wrote those
sections; the co-lighting reading rests on it and cannot be re-checked here
until the owner supplies it.

### The two bursts in the player's cell are two different losses

Settled by the owner, in his words: one is *"when the plane reaches right hand
side"* and the other *"when the `:`"*. So `capture_lane*` is a jet reaching the
capture line and `explosion_lane*` is being hit by the attackers' colon.

**The discriminator is horizontal, which is what makes it safe.** In
`lit-capture-burst.jpg` the lit burst sits about 106 px (in the bare tube's
scale) to the *left* of the cyan launcher. Of the two candidates one is 116 px
left of it and the other 11 px left, so only one fits - and the vertical offset,
which is the axis a photograph spanning three lanes could be misread on, never
has to be reconciled.

| | Capture | Rocket |
| --- | --- | --- |
| Size | 113 x 71 | 118 x 58 |
| Area | ~5,100 px | ~4,560 px |
| Shape against each other | IoU 0.63-0.67 | |
| Same one across the three lanes | IoU 0.95 | IoU 0.87 |

They are within about 10% in area and clearly different in shape - the capture
burst deeper, the rocket burst flatter. An earlier measurement put them 1.6x
apart in area; that was an artefact of the old lattice phase, which placed the
extraction window far enough left to clip the right-hand burst.

### Known gaps, so they are not lost

Three things this revision leaves undone, recorded rather than dropped:

1. ~~**The battleship's destruction burst is not in the atlas.**~~ It is -
   `battleship_burst_lane{0,1,2}` on D0 plates 6-8, traced from the bare tube
   when cell 0 was done. What is still missing is the *rule*: the ROM scores a
   battleship kill (`bship_kill`, ten points) and has never drawn one, so the
   segment is on `tools/probe/rom-atlas-conformance.test.ts`'s enumerated
   exception list. That is a line someone deletes when they drive it, not a
   shape anyone has to trace.
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
5. ~~**The teardown photographs supersede everything used here for shape.**~~
   **Done.** Every playfield segment the atlas carries is now traced from
   `tube-teardown/tube-unlit-full.jpg` by `tools/trace/`, and the jet is fifteen
   distinct outlines rather than two poses on a parity. Two things that is not a
   claim about: any segment the tube prints that the atlas does not yet carry -
   the retrace draws what is in the inventory and does not extend it. The score
   readout **was** the other exception and no longer is; it is traced by
   `tools/trace/score.py`.

## Tracing workflow

**For any outline the tracer covers - the whole playfield, and now the score
readout - do not do any of this by hand.** Change `tools/trace/` and re-run it:

```bash
python3 tools/trace/report.py                     # re-measure the free numbers
python3 tools/trace/trace_atlas.py                # dry run: counts and notes
python3 tools/trace/trace_atlas.py --write        # rewrite atlas.json
python3 tools/trace/preview.py /tmp/cmp.png --cells 6,2,0 --before <old atlas.json>
python3 tools/trace/preview.py /tmp/score.png --score --scale 30 --before <old atlas.json>
npm test
```

Read the notes the dry run prints. Each one is a mark the pipeline could not
place from a segment's known position and assigned to its nearest neighbour
instead; two is the current count and both are named in the PR that introduced
them. A run that starts printing more of them has found something, and the thing
to do is look at the photograph rather than at the threshold.

`preview.py` is the check that matters, and it is the one that catches an
outline that is self-consistently wrong: three panels at one scale, the atlas as
committed, the atlas as your tree has it, and the glass.
`docs/evidence/tube-sprite-detail.jpg` is the current one.

**Re-measure the print rather than adjusting the frame assertion.** If the
lattice moves, `lattice.py` is where it is measured and `atlas.test.ts`'s
left-of-centre assertion is the only test that can see out of a self-consistent
wrong frame. Section 5d of `docs/evidence/open-questions.md` explains why.

### By hand, for anything the tracer does not cover

For any new reference the tracing pipeline does not cover. **The score readout
is no longer an example of this** - it was the standing one, and it is now
`tools/trace/score.py` against `score-block.jpg`, so a score shape is changed
there and regenerated like any playfield outline, never edited into
`atlas.json`. What is left here is a photograph nothing in `tools/trace/` reads
yet:

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
