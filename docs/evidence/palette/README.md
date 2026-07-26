# Phosphor palette: before and after

Screenshots of the running emulator taken either side of the palette fix, at the
same framing and the same magnification. Both are the live `#vfd` canvas drawn
2x with nearest-neighbour sampling, so every pixel here is a device pixel the
renderer actually produced - no resampling, no exposure, no camera.

| File | Palette |
| --- | --- |
| `before.png` | `main` at 9a9cf65 |
| `after.png` | this branch |

Read them against `assets/reference/tube-closeup-score0.webp`,
`tube-closeup-score10.webp` and the crops in `assets/reference/sprites/`, which
are photographs of the real lit unit.

## What changed

**Cyan hue.** `before.png` renders the SCORE label and digits ice-blue; every v1
cyan value had B > G. `after.png` renders them mint. Every hue-filtered phosphor
band measured in the photographs has G > B - by +5 at the clipped highlights and
+14 to +17 through the mid-tones.

**Saturation at full drive.** The `before.png` digits are close to white and the
jet is pale cream. The photographs hold 0.52 saturation on the lit jet core and
0.57 on the explosion, and show no white centre anywhere.

**Bloom.** The `before.png` digits melt into a halo that fills the gaps between
their segments and renders them as fat continuous rectangles; the jet carries a
halo wider than itself. In `after.png` the inter-segment gaps are open and the
strokes are slim, which is how the seven-segment digits read in the photographs.

## Caveat on the reference photographs

They are hand-held webp snapshots with a warm cast, so their absolute RGB is not
a target and nothing in `src/machine/tube/palette.ts` is tuned to match it.
Channel *ordering* and *relative saturation* are what survive a colour cast, and
those are what the palette and its tests are pinned to.
