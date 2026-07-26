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

### 4. The missile is two vertically-stacked bursts

`missile-lit.png`.

**Owner-reported and confirmed here:** the fired missile shows as **two cyan
starbursts, one directly above the other in the same column** - not two dots side by
side horizontally, which is what the current atlas models.

They are spiky burst shapes rather than round dots.

### 5. Explosions exist in both phosphor colours

`explosion-red-lit.png`, `battleship-cyan-lit.png`.

Photo 2 shows a red-orange starburst near the G line and a cyan shape just below it.
The tube is two-phosphor (cyan/red) and both are in use for event sprites. The current
atlas has no explosion segments at all.

The cyan shape's identity is **not settled** from these photographs - it may be the
battleship, a jet rendered in the other phosphor, or a capture indicator. Do not guess
it into the atlas; it needs either a clearer photograph or the owner's word.

### 6. Launcher and reserve marks

`launcher-lit.png`.

At the right-hand edge: three cream/white wedge shapes at the three lane positions,
each with a short bar to its left. Rounded, bullet-like, blunt end outward.

### 7. Score and lives

`score-lives.png`.

`SCORE` label and the digits are **cyan** seven-segment. Photo 2 reads `10` with a
ghost digit position visible to the left, so the field is three digits wide with
leading blanking (consistent with the 199 cap).

Three short white bars sit stacked vertically immediately right of the `SCORE` block -
the reserve/lives indicators.

## Colour assignment

| Sprite | Lit colour |
| --- | --- |
| Jets | red-orange |
| Missile bursts | cyan |
| Score label and digits | cyan |
| Explosion (jet hit) | red-orange |
| Unidentified shape near G | cyan |
| Launcher wedges, reserve bars, lives | cream/white |

Note the atlas models `colorRegion` as `cyan | red`. The launcher wedges and lives read
as near-white in both photographs; whether that is a third phosphor region or cyan
washed out by exposure is **unresolved** and should not be guessed.

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

## What these photographs do not settle

- The cyan shape near the G line (section 5)
- Whether the launcher/lives white is a distinct phosphor region (colour table)
- Anything about **timing** - these are stills. Cadence remains blocked on the
  per-skill gameplay video, per `docs/evidence/timing-analysis.md`
