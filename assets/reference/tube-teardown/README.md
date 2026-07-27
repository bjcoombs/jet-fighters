# Tube teardown reference

The unit disassembled, with the VFD tube out of its case and photographed unpowered on a
Leica Q2 at 8368 x 5584 (46.7 MP). Supplied by the owner.

**This supersedes every other visual reference in the project for questions of segment
shape, position and inventory.** The video and the through-the-glass stills show only
what happened to be lit, through a smoked filter, in sunlight, sampled slower than the
tube refreshes. These show *every segment at once*, sharp, unfiltered, with no
multiplexing to defeat.

| File | What it is |
| --- | --- |
| `tube-unlit-full.jpg` | The whole tube, full resolution from the original. The tracing source. |
| `cell0.jpg` - `cell6.jpg` | The seven playfield cells, left to right, full resolution. |
| `score-block.jpg` | The `SCORE` label and the digit cells. |
| `board-L1001567.jpg`, `board-L1001568.jpg` | The board in context, downscaled to 4000 px. |

Originals (~20 MB each) are held by the owner and are not committed.

## Reading the colours

The tube carries **two phosphors**, and unpowered each shows its pigment colour rather
than its emission colour:

| Unlit appearance | Emits | What is drawn in it |
| --- | --- | --- |
| **Yellow / gold** | red-orange | jets, the battleship, the sea, the attackers' dots, some bursts |
| **White / cream** | cyan | `SCORE` and the digits, most bursts, the object in the last cell |

This is consistent with every lit reference: jets read red-orange in the video, the
jet-kill burst reads cyan, the score reads cyan. Do not read the yellow as a third colour
- the atlas's two-region `cyan | red` model is correct.

## What the photographs establish

### The playfield is seven cells of three lanes

Counted directly off the printed cell boxes in `tube-unlit-full.jpg`, and confirmed by
cropping past the last one (`cell6`) - beyond it is tube structure, getter and support
wire, no further segments.

| Cell | Contents, per lane |
| --- | --- |
| 0 | yellow **battleship** - hull, raised superstructure, funnel - over yellow **sea/wave marks**; white **burst** behind it |
| 1 - 5 | yellow **jet**; **two small yellow dots** off the jet's nose, stacked vertically; white **bursts** |
| 6 | yellow textured **smoke/cloud**, yellow **burst**, a second yellow **burst**, and a white **object** |

So jets occupy **five** cells, the battleship has a cell of its own at one end, and the
cell at the other end - the `G` line, the player's end - carries no jet at all.

### The attackers' dots are printed on the glass

`cell1.jpg` - `cell5.jpg`. Two small yellow ovals sit off each jet's nose, one above the
other, on the side facing the player. Yellow is the red-emitting phosphor.

This is the owner's colon, confirmed physically. It had been described verbally, then
traced from video; it is now visible as printed phosphor at full resolution.

### The jet's pose varies by lane, not only by column

`cell2.jpg` is the clearest. Within a single cell the three lanes carry **three different
outlines**: the top lane raked one way, the middle lane a symmetric level-winged delta
with a detached twin tail, the bottom lane raked the other way. The video established
that the pose alternates between *columns*; this shows it also differs between *lanes*.

Both can be true and probably are - every one of the 15 jet positions may be a distinct
outline. That is what "each cell has its own set of lightable areas" means in practice,
and it is why an atlas built from one translated outline can never look right.

### The score is one label and two digit cells

`score-block.jpg`. The `SCORE` legend sits in its own box. Below it are **two** cells: the
left holds a half-digit `1` **and** a full seven-segment digit; the right holds one full
seven-segment digit. Three digit positions, two cells - consistent with the 199 cap.

## The structural consequence, and it is not small

Ten grids, D0-D9. The photographs account for them as **7 playfield + 2 score digit + 1
label**.

`src/machine/tube/atlas.json` allocates them as **6 playfield + 3 score digit + 1 label**.

Both total ten, but the split differs, and if the photographs are right then the atlas's
grid map is wrong at the structural level rather than in any individual sprite - the
playfield is a grid short and the score has one too many. The ROM's six-column distance
model rests on the same map.

**This is stated as the reading of the printed cell boxes, not as a settled fact.** What
would settle it is correlating the boxes against the tube's own leads: the plate leads are
visible along the bottom edge of `tube-unlit-full.jpg` and the grid connections come off
the top pins. That work has not been done here and should be done before the map is
changed, because changing it moves every sprite in the atlas and every column in the ROM.

## What these photographs still do not settle

- **Which (grid, plate) address each segment is on.** The shapes and their positions are
  now unambiguous; the wiring is not. Only a continuity trace or a lit-segment sweep can
  give the addresses.
- **Whether the two dots of a colon are one segment or two.** They are printed as two
  ovals. The owner's judgement is that they are one segment, on the grounds that the
  machine has no reason to light half a colon, and the atlas is built that way - but the
  photograph cannot distinguish a single segment with two sub-paths from two segments.
- **What the white object in cell 6 is.** It is drawn like a tumbling or wrecked aircraft.
  It is in the cyan phosphor and sits at the player's end, which fits the player's
  launcher, but it does not obviously look like the "blocky cyan shape" the video shows
  there. Identify it before drawing it.
- **What the yellow smoke/cloud in cell 6 is.** Its *shape* is no longer open - it is
  traced, about eleven separate curl marks per lane, and it is drawn as part of
  `capture_lane*` on the reading that the owner's lit photograph shows it glowing in the
  same event as the starburst beside it. What that photograph shows is all that says the
  smoke is lit at all, and it is not in this directory: `lit-capture-burst.jpg` is cited
  by `src/machine/tube/ATLAS-COORDINATES.md` and `docs/evidence/open-questions.md` and has
  never been committed. What the smoke *depicts*, and whether it is one address with the
  starburst or two, are both still open.
