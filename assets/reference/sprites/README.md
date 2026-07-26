# Sprite reference set

Traced-from-photograph reference for every lit segment on the tube. These crops are
the authority for sprite shape, colour and layout - `src/machine/tube/atlas.json`
should match them, not the other way round.

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

### 1. The playfield is 7 columns x 3 rows, not 6

Counted independently on both photographs from the printed cell dividers: **seven**
cell rectangles span the field between the left rail and the G line, each holding
three lane positions. That is **21 jet cells**.

`atlas.json` currently defines `jet_lane{0-2}_col{0-5}` - six columns, 18 cells. This
is a structural error and everything downstream inherits it: the ROM's column
numbering, the distance-zone mapping and the scoring ruler all count in columns.

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
