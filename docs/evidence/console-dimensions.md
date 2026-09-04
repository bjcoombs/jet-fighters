# Console dimensions

The physical unit in millimetres, derived from two photographs, for the 3D model
(`docs/prd/jet-fighters-3d.md` R1). Nothing here was measured with a ruler: the owner
has no further access to the unit for that, so every figure is read off a photograph
against one object of known size, and every depth is an estimate with its basis.

The reads live in `tools/model/pixels.json`, the conversion in `tools/model/measure.py`,
the result in `tools/model/dimensions.json`. **A figure is changed by changing a read and
re-running the converter**, never by editing `dimensions.json`; the converter is
deterministic and CI-free (Python, stdlib only; Pillow for the `--overlay` check images).

```
python3 tools/model/measure.py --overlay docs/evidence
```

Paths are relative to the repo root.

## The scale bar

The only object of known size in any photograph is the microcontroller: a Texas
Instruments TMS1370 in a dual-in-line package. Its pin pitch is 2.54 mm by the package
standard, and its pins can be counted.

| Photograph | What it gives | Value |
| --- | --- | --- |
| `tube-teardown/board-L1001567.jpg` | Pin count, by dark-peak detection across the top pin row | **20 a side, 40-pin DIP** |
| same | Pin pitch, by autocorrelation of the pin-row brightness profile | 41.6 px |
| `tube-teardown/board-L1001568.jpg` | Pin pitch, same method | **22.6 px = 2.54 mm** |
| same | Chip body length, as a check on the pitch | 456 px = 51.2 mm (a 40-pin 0.6 in body is 51.5-52.6 mm) |

So `board-L1001568.jpg`, the frame that holds the whole opened unit, is **0.1124 mm/px at
the board plane**. Autocorrelation rather than endpoint reads because the first attempt
read the pin span between the wrong endpoints (the silkscreen box round the chip) and
came out 8% long; the body-length check is what caught it.

### Perspective

The photograph is of the back shell lying open, board component side up, tube face up:
the `JET FIGHTER` silkscreen, the chip marking and the tube's `SCORE` legend all read
un-mirrored, so the camera is looking at the front of the board and the shell under it is
the back one. The shell's rim (its mating face with the front shell) is nearer the camera
than the board, so a read on the rim is larger than it should be at the board scale.

The correction uses the camera: a Leica Q2's fixed 28 mm lens on a 36 mm sensor, the
committed file being the full frame downscaled. That fixes the horizontal field at 65.5
degrees, so the shell's 3065 px across a 4000 px frame subtends 52.4 degrees, which for a
shell of width *W* puts the rim at *W*/2 / tan(26.2 degrees) from the camera. With the
board estimated **15 mm** below the rim (see Depth), two iterations converge on a rim
scale of **0.1076 mm/px**, a factor of 0.957 on the board scale. The 15 mm is an
estimate; its stated bound of +/-10 mm moves the case width by about +/-9 mm.

The front photograph, `device-front-lit.jpg`, has nothing of known size in it and is
scaled from the case width: **0.2778 mm/px**. Everything read on it is in the face plane.

## What was measured

Origin: the case's top-left corner at the module's top edge, x to the right, y down.
Face reads are on the front face; internal reads are in plan at the board plane. The
full list with sources is `dimensions.json`; this is the shape of the answer.

### The case

| | mm | From |
| --- | --- | --- |
| Width | **329.7** | board photo, rim scale |
| Module height | 142.4 | mean of board (142.5) and front (142.3) reads |
| Wing height | 137.7 | mean of board (138.8) and front (136.6) |
| Wing top below module top | 8.3 | front photo |
| Wing bottom below module bottom | 2.8 | front photo: the wings hang lower than the module's lower lip |

Across the face, left to right: the left wing's raised stippled block **1.9-44.4**, its
smooth inboard strip carrying the power switch **44.4-81.4**, the module **91.7-237.5**,
the right wing's smooth strip **237.5-269.4**, its raised block **269.4-325.8**. The gap
between the left strip and the module, 81-92, is the ribbed channel visible in the
owner's `clip.mov`; on the right the channel reads as part of the strip. The two wings
are not mirror images: the right block is 12 mm wider than the left, in every photograph.

### The scope window

| | mm |
| --- | --- |
| Circle centre | (168.0, 66.7), radius 57.5 |
| Rectangle | left 94.7, top 41.1, bottom 117.5, running into the circle |
| Tab at 12 o'clock | x 166-172, y 0-12, overlapping the glass |

### Controls, on the face

| | mm |
| --- | --- |
| Fire button | centre (20.8, 31.4); cap radius 13.1, ring 16.1; switch body under it radius 18.0 |
| Power switch thumb | centre (48.6, 31.4), 7 x 10, travelling y 26.7-37.8 |
| Launcher lever well | centre (299.1, 31.9), radius 19.4; slot x 295.8-302.8, y 14.7-49.4; pin at y 20.3 / 31.9 / 43.9 for the three lanes |
| Skill flag | hub (304.7, 124.4), radius 6.1; flag 23.2 long; the 1/2/3 marks on a 11.1 radius arc |
| Sticker | x 10.0-34.7, y 106.1-133.0 |

### Inside

| | mm |
| --- | --- |
| Board | x 56.4-343.7, y 16.9-155.1; outline in `pcb.outline` - flat top edge, bottom edge stepping down for a central tongue (x 144-219) and the right end (x 268 on) |
| Tube shroud | x 99.2-233.9, y 47.0-102.4 |
| Tube glass | x 106.2-224.2, y 50.6-94.4 |
| Tube face (printed segments) | x 110.7-216.3, y 56.2-85.4 |
| TMS1370 | pins x 240.3-288.6, body y 61.8-79.8 |
| Battery box | x 0.6-45.5, y 49.5-141.6, against the left wall |
| Resistor row | 17 resistors, x 116-223, y 21-36 |
| Lever disc | centre (314.4, 33.7), radius 26.6, the pin protruding to x 335 |
| Skill hub | centre (314.4, 134.6) |
| Buzzer | centre (141.0, 106.8), radius 10.7 |
| DC jack | x 126-139, y 3-18 |
| Standoffs | eight, `standoffs.centres`; screws, four, `screws.centres` |
| Electrolytics | five cans, `electrolytics.cans` |

The tube face's left edge at 110.7 mm sits 16 mm inside the window rectangle's left edge
at 94.7, which is where the `SCORE` box is on the lit photographs; and its right edge at
216.3 is 9 mm inside the circle's right edge at 225.5. That is the registration between
what the flat page draws on its canvas and where the glass is, and it is consistent.

## What is estimated, and on what basis

No photograph is edge-on. Every figure below carries a `bound_mm` in `dimensions.json`,
which is how far a side view would be expected to move it.

| | mm | Basis | Bound |
| --- | --- | --- | --- |
| Rim above board | 15 | The tube envelope must clear the board under the window; the bosses lift the board off the back floor | 10 |
| Back shell depth | 22 | 5 mm board-to-floor, 15 mm rim-to-board, 2 mm wall | 6 |
| Front shell, wing face | 14 | Clears the fire switch body and the lever disc, both about 12 mm tall | 5 |
| Front shell, module face | 20 | Clears the tube (11 mm) on its shroud plus the window; the module visibly stands proud of the wings | 5 |
| Window recess | 2 | The smoked window sits inside a lip | 1 |
| Wall thickness | 2 | Moulded ABS of the period | 0.5 |
| Tube thickness | 11 | Flat VFD envelopes of this size | 2 |
| Tube face above board | 8 | The envelope sits on its shroud; the phosphor is on the back glass | 3 |
| Board thickness | 1.6 | Single-sided phenolic | 0.4 |
| Battery box height | 28 | As tall as its cells plus a wall, under the rim | 6 |
| Fire cap, lever pin, skill flag heights | 6, 4, 5 | Read off the front photograph's shading | 2 |

The assembled unit, then, is about 330 x 142 x 42 mm at the module and 36 mm at the
wings, with the last figure carrying the largest uncertainty of anything here.

## Cross-check against the flat page's SVG

`src/ui/geometry.ts` and `src/ui/case.ts` draw the case in an 896 x 440 box. Scaled so
the SVG body width (880 units) equals the measured case width, one unit is 0.3747 mm,
and the comparison is:

| | SVG | Photograph | |
| --- | --- | --- | --- |
| Module height | 147.6 | 142.4 | agree |
| Wing height | 136.4 | 137.7 | agree |
| Module x | 89.2-240.5 | 91.7-237.5 | agree |
| Circle radius | 56.2 | 57.5 | agree |
| Rectangle left | 97.4 | 94.7 | agree |
| Rectangle top | 44.2 | 41.1 | agree |
| **Circle centre** | (177.2, 79.1) | (168.0, 66.7) | **SVG is 9 mm right and 12 mm low** |
| **Rectangle bottom** | 98.2 | 117.5 | **SVG's rectangle is 19 mm too short** |

The proportions of the case and the size of the scope agree to within 3%. Two things do
not: the SVG's circle sits lower in the module than the photograph's (the real glass
comes to within 9 mm of the module's top edge; the SVG leaves 23), and the SVG's
rectangle stops well above the circle's bottom while the real window's rectangle runs
to within 8 mm of it. Both are visible by holding `device-front-lit.jpg` beside the
deployed page. **The model follows the photographs; the SVG is left alone**, per the
PRD - the tube renderer's own layout (`src/machine/tube/layout.ts`) shares the SVG's
rectangle and moving one means moving both, which is a change to the flat page and not
part of this work.

## Check images

`console-dimensions-board.jpg` and `console-dimensions-front.jpg` beside this file are
the two photographs with every read drawn on them, regenerated by the converter's
`--overlay`. Red is the shell, white the face bands, cyan the scope and controls,
yellow the tube and chip, green components, magenta the board outline, standoffs and
screws, orange the capacitors. A read that has drifted shows there before it shows in
the model.
