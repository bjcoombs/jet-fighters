# tools/model - the console in three dimensions

The physical unit as a glTF, built in Blender from measured dimensions, for the 3D page
(`docs/prd/jet-fighters-3d.md`). Paths are relative to the repo root.

| File | Role |
| --- | --- |
| `pixels.json` | Pixel coordinates read off the reference photographs, with the method of each read. **The hand-edited input.** |
| `measure.py` | Converts the reads to millimetres against the chip's pin pitch. `--overlay DIR` draws every read on its photograph. |
| `dimensions.json` | **Generated.** Every figure the model uses, measured or estimated, with its source. |
| `build_console.py` | Runs inside Blender. Builds every part from `dimensions.json`, names it, tags it with `extras`, exports `public/models/console.glb`. |
| `blender.sh` | Finds Blender and runs the build headless. |
| `compare.py` | A render from a camera matched to a photograph, side by side with it, and the positions of the features both can be read for. |
| `label.txt` | The back label's text, transcribed from `assets/reference/case/back.jpg`; the script sets it as flat text meshes on the label. |

```
python3 tools/model/measure.py --overlay docs/evidence --doc docs/evidence/console-dimensions.md   # reads -> mm, and the doc's tables
npm run model                                            # mm -> public/models/console.glb
npm run model:render                                     # plus the two comparison renders
npm run model:blend                                      # also tools/model/console.blend, to open in the app
```

The `.glb` is committed so a clean checkout builds the site without Blender. Nothing on the
model is a photograph: the shells are bevelled geometry in plastics whose colours
`measure.py` samples from the front photograph (white-balanced on the sticker's print), the
stipple is a seeded normal map the script generates, and every printed or moulded word is a
text mesh in Blender's bundled font. The `.blend` is not committed - the
script is the source - and `npm run model:blend` writes one for review in the Blender app. It is
deterministic: two runs of `npm run model` produce the same bytes, so a PR that changes
geometry shows a real diff. Blender 4.2 or later; the macOS app bundle is found
automatically, otherwise set `BLENDER`.

How each figure was arrived at, and how far each estimate might be out, is
`docs/evidence/console-dimensions.md`. A dimension is changed by changing a read in
`pixels.json` or an estimate in `measure.py` and re-running, never by editing
`dimensions.json` or typing a number into the Blender script.

## What the glTF contains

One root node, `console`, scaled to metres. Under it, one node per part, named:
`front_shell` (with children `window`, `scope_mask`, `sticker`, `fire_cap`, `power_thumb`,
`lever_pin`, `skill_flag`), `back_shell` (with `battery_door`), and `pcb` with everything
on it as children: `tube_shroud`, `tube_glass`, `tube_face`, `tube_grid_pins`,
`tube_plate_leads`, `tms1370`, `resistor_row`, `electrolytics`, `discretes`, `lamp`,
`toothed_disc`, `dc_jack`, `fire_switch`, `power_switch`, `lever_disc`, `skill_hub`,
`battery_box`, `board_screws`. Each carries `extras`:

| Key | Meaning |
| --- | --- |
| `label` | What the part is, one line. Sourced from the teardown README and the I/O research where they say; "unidentified" where they do not. |
| `evidence` | The photograph or clip that shows it. |
| `explode` | `[x, y, z]` metres in the glTF frame: where the part goes, relative to its assembled place, when the viewer takes the unit apart. Children inherit their parent's move and add their own. |

Frame: the unit lies face up. glTF +Y is out of the face toward the player, +X is
across the case to the right, and the scope's top (the tab end) is toward -Z. The
`window` and `tube_face` meshes carry UVs spanning their bounding boxes so the page
can draw the silkscreen and the tube's canvas onto them.
