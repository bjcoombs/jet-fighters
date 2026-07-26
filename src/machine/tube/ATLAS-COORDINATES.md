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

Reference material lives in `assets/reference/`. All four photos are 1422 x 800
(the two device-front shots are video frames of the same unit).

| Photo | What it established |
| --- | --- |
| `device-front-lit.jpg` | Lit SCORE label and digit shapes; lit segment colours; the three reserve-launcher marks outside the right border; faint ghost-phosphor matrix confirming a cell grid |
| `device-front-gameplay.jpg` | The printed border geometry: outer rectangle, inner vertical rule, ruler and lane dashes starting at that rule; the SCORE box occupying the region left of it. Also the clearest lit jet on any frame, and the reserve-launcher marks against the right border |
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

### Shapes

The score digits and the battleship are still the v1 shape tables from
`src/render/sprites.ts` (`BATTLESHIP_SHAPE` and the seven-segment rectangle map
in `drawSevenSegment`), scaled and translated into atlas units. Digit height is
v1's `cellH * 0.6`.

**The jets, the launcher, the rocket dots and the reserve-launcher marks were
re-traced directly from the photographs**, replacing v1's `JET_SHAPE`,
`LAUNCHER_SHAPE` and `LIFE_DART_SHAPE`. The v1 tables rendered the jets as
eight-point chevrons and the launcher as a filled right triangle; neither is what
the unit shows, and the owner rejected the v2.11 build on exactly that. See
"Sprite silhouettes" below for the method and the numbers.

### Sprite silhouettes

Sizes were measured off `device-front-gameplay.jpg` and `device-front-lit.jpg`.
Both are handheld frames, so no absolute pixel measurement is trustworthy;
instead **each axis is expressed as a ratio against a printed feature on that
same axis**, which cancels the foreshortening:

| Axis | Sprite measurement | Divided by |
| --- | --- | --- |
| Horizontal | Sprite bounding width | Printed distance-column width (`(right border - inner rule) / 6`) |
| Vertical | Sprite bounding height | Lane pitch (spacing of the three border ticks / two lit jets two lanes apart) |

Sprites were isolated before measuring rather than eyeballed: the red phosphor
separates cleanly on an `R - B` channel difference, and the bounding box was read
off a threshold sweep (25%-45%) so the bloom halo could be bracketed rather than
guessed.

| Sprite | Photo, cell fractions | v2.11 atlas | Now |
| --- | --- | --- | --- |
| Jet | 0.37-0.42 w x 0.52-0.63 h | 0.52 x 0.63 | 0.42 x 0.38 (18 x 12 units) |
| Launcher | 0.34 x 0.54 | 0.55 x 0.80 | 0.33 x 0.34 (14.5 x 11 units) |

The jet is drawn at its photographed **aspect ratio** (~1.5:1) rather than at its
photographed cell-fractions on both axes, deliberately. The atlas lane cell is
1.35:1 while the photographed cell is closer to 2:1 - the atlas spreads the three
lanes further apart than the unit does - so honouring the vertical cell-fraction
would flatten the aircraft into something that no longer reads as one. Lane
centres are layout, not sprite geometry, and were not touched here.

What the photographs show, and what the paths now draw:

- **Jets** are plan-view fighter silhouettes with the nose at +x (flying toward
  the missile station). A needle nose and slim forward fuselage, main wings whose
  leading edge sweeps back to maximum span about a third of the length from the
  tail, a waisted rear fuselage, and stepped tailplanes at roughly 0.7 of the
  wing span. Traced from the lit jets in `device-front-gameplay.jpg`; the
  clearest is the lane-2 aircraft at approximately (765, 443).
- **The launcher** is a rail launcher, not a solid body: a short vertical spine
  standing on the G line at the right-hand edge of the field with three thin
  rails projecting left into the field, each tapering to a point. Drawn as four
  subpaths in one `path` string. The lit launcher in `device-front-lit.jpg` is
  bloomed, but level-stretching the core (`-level 45%,88%`) resolves the stacked
  bright bars separated by dark gaps.
- **The reserve-launcher marks point left**, not right. `LIFE_DART_SHAPE` in v1
  has its tip at +x; `device-front-lit.jpg` and `screen-closeup-gameplay.jpg`
  both show blunt-right, tapered-left marks - reserve missiles aimed into the
  field, consistent with missiles travelling leftward. They are solid bars with a
  flat right end tapering to a blunt left tip, not the notched arrowheads v1
  drew. Their bounds are unchanged; only the outline was re-cut.

`atlas.test.ts` pins the proportions that went wrong (`describe('sprite
proportions')`): jets bounded to 0.45 x 0.40 of a cell, launchers to 0.40 x 0.40
and to less area than a jet, all 18 jets sharing one translated outline, the
launcher having more than one subpath, and a rocket dot staying under 0.6 of the
jet's height. All three of the shape assertions fail against the v2.11 atlas.

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
| `red` | jets (18), jet rockets (18), battleship (1) - everything the machine attacks with |
| `cyan` | player missile dots (6), launchers (3), score digits (21), SCORE label (1), reserve-launcher marks (3) |

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
| D0 | Distance column 0 (BATTLE SHIP ZONE, ruler "10") | 0-2 jets lanes 0-2, 3-5 rockets lanes 0-2, 6 battleship |
| D1 | Distance column 1 | 0-2 jets, 3-5 rockets |
| D2 | Distance column 2 | 0-2 jets, 3-5 rockets |
| D3 | Distance column 3 | 0-2 jets, 3-5 rockets |
| D4 | Distance column 4 | 0-2 jets, 3-5 rockets, 6-11 missile dots (lane 0 head/trail, lane 1, lane 2) |
| D5 | Distance column 5 (the G / capture line) | 0-2 jets, 3-5 rockets, 6-8 launcher lanes 0-2 |
| D6 | SCORE digit 0 (hundreds) | 0-6 = seven-segment a-g |
| D7 | SCORE digit 1 (tens) | 0-6 = seven-segment a-g |
| D8 | SCORE digit 2 (units) | 0-6 = seven-segment a-g |
| D9 | Status | 0 SCORE label, 1-3 reserve-launcher marks |

The plate assignment is deliberately regular: **on every playfield grid, plate
`n` is the jet in lane `n` and plate `n + 3` is that lane's rocket dot**. A ROM
routine that steps the squadron therefore writes the same bit pattern shifted
between grids, which is how the real program almost certainly worked given 2 KB
of ROM.

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
4. **A single battleship segment.** The brief for this task specifies one. It is
   placed in column 0, lane 1 (centre). A crossing therefore has to be modelled
   as the segment lighting and extinguishing rather than as motion. If the real
   tube has a battleship segment per lane or per sub-position, that is a gap.
5. **The missile trail is modelled at one position per lane.** Ids are
   `missile_lane{L}_dot0` (head, leading) and `dot1` (trail, toward the
   launcher), staged in column 4. **A missile that visibly travels the length of
   the field needs a dot pair per column** (or per inter-column gutter), which
   this six-segment inventory cannot express. This is the atlas's most likely
   omission, and task 6 or the ROM work will hit it first.
6. **Rocket dots sit at `cellW * 0.38` right of their jet.** Photos cannot
   resolve dot positions, and no reference frame shows a rocket in flight at
   all. The offset was chosen to clear the jet nose while staying inside the
   cell. The radius (2.8 units) is likewise unevidenced: it preserves v1's
   `rocketR = jetSize * 0.18` proportion against the re-traced aircraft, so that
   shrinking the jets did not leave the dots looking like the larger object.
7. **The reserve-launcher marks may be silkscreen, not phosphor.** They read
   white in every photo, including frames where the tube is showing little else,
   which is what printed silkscreen looks like. They are modelled as cyan
   segments (`life_0..2`) because the game has to decrement them; if the teardown
   shows them printed, they leave the atlas and the count drops to 68.
8. **`score_label` is an extra segment beyond this task's brief.**
   `device-front-lit.jpg` clearly shows the word SCORE lit in cyan, so it is a
   phosphor segment and it is in the atlas as a single block on D9 plate 0. Its
   `path` is the word's bounding rectangle, not letterforms - task 6 should draw
   the word, not fill the box.

### Known segment overlaps

Five pairs of segments have overlapping bounding boxes. Each is a case where the
game can never light both meaningfully, so they are accepted rather than nudged
apart:

| Pair | Why |
| --- | --- |
| `battleship` <-> `jet_lane1_col0`, `rocket_lane1_col0` | Both occupy the far zone's centre lane |
| `launcher_lane{0,1,2}` <-> `jet_lane{0,1,2}_col5` | A jet reaching the G line has captured the launcher - game over |

Bounding boxes overlap; the drawn paths overlap less. No other pair touches.

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

4. Convert to atlas units: `units = fraction * 363` horizontally,
   `fraction * 300` vertically. Where a sprite's photographed cell-fractions and
   its photographed aspect ratio disagree - they do, because the atlas lane cell
   is taller than the unit's - keep the aspect ratio and say so.
5. Edit `atlas.json` directly. Keep `bounds` consistent with `path` - it is the
   axis-aligned bounding box of the path, and consumers trust it rather than
   parsing the path.
6. Run `npm test` (`src/machine/tube/atlas.test.ts` checks the schema, the
   counts, address uniqueness, and that every segment stays inside the viewBox)
   and re-render a preview to eyeball it against the photo:

   ```bash
   node -e "const a=require('./src/machine/tube/atlas.json');
   const p=a.segments.map(s=>'<path d=\"'+s.path+'\" fill=\"'+(s.colorRegion==='cyan'?'#5fe0ec':'#ff5a3c')+'\"/>').join('');
   require('fs').writeFileSync('/tmp/atlas.svg','<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 363 300\"><rect width=\"363\" height=\"300\" fill=\"#050505\"/>'+p+'</svg>')"
   ```

7. If the segment inventory changes, update `EXPECTED_SEGMENT_COUNTS` and the id
   unions in `atlas-schema.ts`. The id unions are template-literal types, so a
   mistyped id is a compile error and `validateAtlas` rejects any id that matches
   no documented family.
