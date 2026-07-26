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

### Shapes

The score digits and the battleship are still the v1 shape tables from
`src/render/sprites.ts` (`BATTLESHIP_SHAPE` and the seven-segment rectangle map
in `drawSevenSegment`), scaled and translated into atlas units. Digit height is
v1's `cellH * 0.6`.

**The jets, the player's ship, the missile bursts, the explosion and the rocket
dots were traced from the photographs**, replacing v1's `JET_SHAPE`,
`LAUNCHER_SHAPE` and `LIFE_DART_SHAPE`. The v1 tables rendered the jets as
eight-point chevrons and the launcher as a filled right triangle; neither is what
the unit shows, and the owner rejected the v2.11 build on exactly that. The
v2.12 atlas then drew the jets too small, the launcher as a rack of rails at the
field's right-hand edge, the missile as two dots side by side, and the printed
white marks as lit phosphor; the two lit close-ups corrected all four. See
"Sprite silhouettes" below for the method and the numbers.

### Sprite silhouettes

Sizes were measured off `tube-closeup-score0.webp` and `tube-closeup-score10.webp`,
the two lit close-ups; the earlier `device-front-*.jpg` frames set the outlines.
All are handheld frames, so no absolute pixel measurement is trustworthy;
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

| Sprite | Photo, cell fractions | v2.12 atlas | Now |
| --- | --- | --- | --- |
| Jet | 0.54 w x 0.61 h | 0.42 x 0.38 (18 x 12) | 0.60 x 0.54 (26.1 x 17.4) |
| Player's ship | 0.44 x 0.54 | 0.33 x 0.34 (14.5 x 11) | 0.46 x 0.41 (20 x 13) |
| Missile upper burst | 0.48 x 0.44 | 0.14 x 0.20 (6.3 dia) | 0.38 x 0.27 (16.5 x 8.5) |
| Missile lower burst | 0.38 x 0.44 | 0.10 x 0.14 (4.4 dia) | 0.30 x 0.27 (13.2 x 8.5) |
| Explosion | 0.54 x 0.57 | absent | 0.53 x 0.41 (23 x 13) |

Widths are fractions of a printed cell; the "photo" heights are fractions of the
lane pitch and the "now" heights are fractions of the atlas cell height, which
are not the same denominator. The atlas lane cell is 1.35:1 while the
photographed cell is closer to 2:1 - the atlas spreads the three lanes further
apart than the unit does - so every sprite is drawn at its **photographed aspect
ratio** rather than at its photographed cell-fraction on both axes. Honouring
the vertical cell-fraction would flatten the aircraft into something that no
longer reads as one. Lane centres are layout, not sprite geometry, and were not
touched.

What the photographs show, and what the paths now draw:

- **Jets** are plan-view fighter silhouettes with the nose at +x (flying toward
  the missile station). A needle nose and slim forward fuselage, main wings whose
  leading edge sweeps back to maximum span about a third of the length from the
  tail, a waisted rear fuselage, and stepped tailplanes at roughly 0.7 of the
  wing span. The outline is unchanged from the trace off
  `device-front-gameplay.jpg`; what changed is its **size**. A lit jet in
  `tube-closeup-score0.webp` measures ~0.54 of a printed cell wide and the unlit
  ghost in every cell reads wider still, against the 0.42 the v2.12 atlas drew,
  which left the field reading as mostly bare glass rather than the woven
  tapestry of nearly-touching shapes the real tube shows. The outline is scaled
  1.45x and stays centred on the printed column centre, because `layout.ts`
  `columnCenterX` drives the silkscreen and the phosphor has to line up with it.
- **The jet silhouette varies by column.** Owner-confirmed: the jet is not one
  shape repeated across the field. It **changes from column to column** so that a
  jet stepping toward the missile station appears to beat its wings, and the
  animation is a property of the physical phosphor, not of the program. Adjacent
  ghost cells carry perceptibly different outlines - some flatter and wider in
  the wing, others more swept. **The two action photographs prove the variation
  exists without being sharp enough to recover the six shapes**, so the atlas
  still holds one outline translated across the lattice. That is a known gap, not
  a claim: `atlas.test.ts` permits up to one distinct outline per column and only
  requires the three lanes of a column to agree, which is the part that stays
  true once the variants are traced. The test that asserted all 18 jets share one
  outline has been removed - it encoded the misunderstanding this paragraph
  corrects. Recovering the variants needs the angled-light photograph of the dark
  tube listed under "Reference material still wanted" in
  `assets/reference/sprites/README.md`.
- **The player's ship** is the cyan shape inside the playfield near the G line,
  at one of three lane positions, and it is what fires the missile. Owner-
  confirmed. It is a ship-like silhouette - a long hull with a raked bow
  projecting left, a raised superstructure above it and a keel band below,
  three bands separated by dark glass - not the rack of pointed rails plus a
  vertical spine the v2.12 atlas drew, which read as a gun battery. The ids keep
  the `launcher_` prefix so the ROM's plate map does not move.
- **The missile is two bursts stacked vertically**, not two dots side by side.
  Owner-reported and confirmed in `tube-closeup-score10.webp`: two cyan
  starbursts, one directly above the other in the same column, spiky rather than
  round, and **not identical** - the upper is broader than the lower. `dot0` is
  now the upper burst and `dot1` the lower; the "head / trail" reading the ids
  were named for is what the horizontal layout implied and is wrong.
- **The explosion** is a red-orange starburst thrown up where the player's ship
  is hit (`sprites/explosion-red-lit.png`). It is centred on the ship's own lane
  position and drawn wider than the ship, on the assumption that the ship segment
  goes out as the burst comes on - which is what the photograph catches, the
  ship being lit at a different lane from the burst.
- **The three marks at the right-hand edge are white paint, not phosphor.**
  Owner-confirmed. They are bullet shapes, **nose up**, sitting between the right
  rail and the glass edge at each lane. They were modelled as lit cyan segments
  lying horizontal (`life_0..2`); they have left the atlas entirely and are
  `silkscreen.ts`'s to draw. Their measured place is x 346.4-359.4 in atlas
  units, one at each lane centre, about 13 wide by 8 tall.
- **There is no lives display.** Owner-confirmed and important: the unit has no
  way to show remaining lives. Damage is signalled **only by sound**, the two-
  and three-beep warnings between hits, which is why that sequence carries so
  much weight in `docs/evidence/audio-reference.md`. `life_0..2` were phantom
  segments - the tube has no such phosphor - the same class of fault as the
  phantom ground line fixed in #32.

### Still unresolved: the battleship's width

The atlas draws the battleship 43.3 units wide against a jet's 26.1, but the
seven printed cells read as roughly equal width and every one of them carries
three ghost jets. Neither close-up catches a battleship crossing, so its sprite
is still untraced and its size unevidenced; it was left alone rather than
changed on a guess. It is the second item on the reference wish-list in
`assets/reference/sprites/README.md`.

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
| `red` | jets (18), jet rockets (18), battleship (1), explosions (3) - everything the machine attacks with, plus the burst it makes of the player |
| `cyan` | player missile bursts (6), the player's ship (3), score digits (21), SCORE label (1) |

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
| D4 | Distance column 4 | 0-2 jets, 3-5 rockets, 6-11 missile bursts (lane 0 upper/lower, lane 1, lane 2) |
| D5 | Distance column 5 (the G / capture line) | 0-2 jets, 3-5 rockets, 6-8 the player's ship at lanes 0-2, 9-11 the explosion at lanes 0-2 |
| D6 | SCORE digit 0 (hundreds) | 0-6 = seven-segment a-g |
| D7 | SCORE digit 1 (tens) | 0-6 = seven-segment a-g |
| D8 | SCORE digit 2 (units) | 0-6 = seven-segment a-g |
| D9 | Status | 0 SCORE label |

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
7. **The explosion's address.** The three `explosion_lane{0-2}` segments are
   placed on grid 5 - the grid that already carries the player's ship, which is
   what they mark the destruction of - at plates 9-11, the first free plates
   there. The photographs show the burst; nothing shows where the MCU drives it
   from, and the ROM does not drive it at all yet.

   The `life_0..2` segments this assumption used to hedge about are **gone**:
   the marks they modelled are printed paint, and the unit has no lives display
   to drive. **The ROM has not caught up** - it still writes a launcher tally
   into grid 9's R0 nibble (`LIFEP_BASE` in `asm/jetfighter.asm`), so it drives
   addresses 9-1, 9-2 and 9-3 into thin air. `tools/probe/jetfighter-rom.test.ts`
   pins exactly those three as a named allowance that fails once the ROM stops
   writing them; removing the write is ROM work in its own change.
8. **`score_label` is an extra segment beyond this task's brief.**
   `device-front-lit.jpg` clearly shows the word SCORE lit in cyan, so it is a
   phosphor segment and it is in the atlas as a single block on D9 plate 0. Its
   `path` is the word's bounding rectangle, not letterforms - task 6 should draw
   the word, not fill the box.

### Known segment overlaps

Seventeen pairs of segments have overlapping bounding boxes. Each is a case
where the game can never light both meaningfully, so they are accepted rather
than nudged apart:

| Pair | Why |
| --- | --- |
| `battleship` <-> `jet_lane1_col0`, `rocket_lane1_col0` | Both occupy the far zone's centre lane |
| `launcher_lane{0,1,2}` <-> `jet_lane{0,1,2}_col5` | A jet reaching the G line has taken the player's ship - game over |
| `explosion_lane{0,1,2}` <-> `jet_lane{0,1,2}_col5` | Same glass, same reason |
| `explosion_lane{0,1,2}` <-> `launcher_lane{0,1,2}` | The burst marks where the ship was: the ship goes out as the burst comes on |
| `missile_lane{0,1,2}_dot{0,1}` <-> `jet_lane{0,1,2}_col4` | A missile crossing a column a jet is flying in is the hit that removes the jet |

Bounding boxes overlap; the drawn paths overlap less. No other pair touches.
`atlas.test.ts` pins the list, so a geometry change that creates an eighteenth
fails rather than passing silently.

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
