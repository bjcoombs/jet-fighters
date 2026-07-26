# Playfield geometry: before and after

Screenshots of the running emulator taken either side of the playfield-geometry
fix, at the same framing and in the same machine state - powered on, one red jet
lit in lane 0 and the player's ship in lane 1. Both are the live `#vfd` canvas
exported at its native 799 x 660 device pixels and flattened onto black, so every
pixel here is one the renderer actually produced.

| File | Geometry |
| --- | --- |
| `before.png` | `main` at b3180b6 |
| `after.png` | this branch |

Read them against `../../../assets/reference/tube-closeup-score0.webp` and
`tube-closeup-score10.webp`, which are photographs of the real lit unit.

## What changed

**The frame rides high in the scope circle.** In `before.png` the printed
rectangle is centred on the circle, its bottom rail 48 atlas units below the
centre line. The photographs put it 37 units below - the frame sits high and the
missing 11 units are the room the zone-label plumbing hangs in. Rails measured at
y 85.2 and 187.2 against v1's 102 and 198.

**The cell band no longer fills the frame.** This is the most visible difference.
In `before.png` the dotted ruler sits directly on the first row of cells and the
bottom rail directly under the last, with no black between them. In `after.png`
the three lanes occupy the middle 52% of the frame's height with printed air above
and below, which is what both photographs show. Measured twice and independently:
from the cell rectangles' own printed borders (band at y 113.4-166.7 and
111.7-165.0 in the two photographs) and from the lit sprites' lane pitch (lane 1
at y 141.5 and 141.6, pitch 17.3).

**The plumbing hangs at its photographed depth.** The middle bracket line is 0.33
of the frame height below the rail and the lower line 0.57, where `before.png`
drew them at 0.235 and 0.45 - fitted figures, because at the real depths the
inherited rectangle pushed them outside the glass. Same story for all four bracket
arm columns, both lower bracket columns and the station missiles' gap.

**The station missiles are back to scale.** They are the clearest single read on
the width fix. #51 had to squeeze them to 12.1 x 6 against the bezel, at an aspect
of 2.0 where the photographs show 2.6, and said in as many words that if the
playfield geometry were corrected upstream these constants should go back to
scale. There are now 49 atlas units of glass outboard of the right rail instead of
15, so they are the photographed 15.4 x 6 with their noses at x 331.6 - which is
where the bullets' noses register in the photographs, x 331.4 and 331.7.

**The playfield is narrower.** Left and right rails at x 41.4 and 313.6 against
v1's 20.0 and 344.9. This was not a cosmetic extra: at v1's width the measured
lower bracket columns land 151 and 153 units from the circle's centre against a
radius of 150, so the two constants the task set out to un-fit could not have been
restored without it.

## What this does not fix

**The cells are still too wide and the jets read flat.** The face is drawn with
`COLUMN_COUNT` 6 cells across the field; the photographs show the same span
carrying seven or eight printed cells, so each of ours is about 20% too wide. A
cell here is 36.3 x 17.7 where the photographs give roughly 29 x 17.7. The jets
were sized against v1's cell and carried across by the same transform, so they are
21.9 x 9.6 - the right *area* (a lit jet measures 14.0 x 11.2 and 13.9 x 10.4 in
the two photographs, and 26.1 x 17.4 before this change was far too big) but the
wrong *shape*: aspect 2.3 against the photographs' 1.3.

Neither is this change's business. The column count was investigated and formally
withdrawn (`assets/reference/sprites/README.md`), and the sprite proportions are
what #45 measured. They are recorded here because the flatter frame makes them
easier to see, not because it caused them.
