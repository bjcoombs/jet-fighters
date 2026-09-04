# Evidence catalogue

Ground-truth inputs for the v2 rebuild, with provenance and what each one
establishes. Per PRD `docs/prd/jet-fighters-v2.md` R7, **every timing, segment, and
sound constant in the ROM source (`asm/jetfighter.asm`) must cite its evidence item
here in a comment.** A constant with no citation is an unverified guess and fails
review.

## Documents in this directory

| File | Contents | Status |
| --- | --- | --- |
| `audio-reference.md` | Measured frequency bands, envelopes, and note sequences for all six sounds. | Complete - extracted from the v1 codebase before Task 11 deletes `src/audio/`. |
| `timing-analysis.md` | Method spec for deriving cadences in display sweeps, plus the v1 working values, plus what the owner's gameplay recording supplies. | Partly relieved - one recording at one unknown skill; the per-skill clips are still pending. |
| `vfd-appearance.md` | Tube refresh, phosphor persistence, brightness and sound blanking, measured from the gameplay recording. | Complete for what 30 fps can resolve; the sweep rate is bracketed, not pinned. |
| `tube-mesh.md` | The control-grid honeycomb: its pitch, its axes, and where on the face it sits, measured off the teardown photographs. Also the finding that the phosphor's dot screen and the dark field's lattice are one structure. | Complete for period, angle and extent; web width and shadow depth are judgements, and say so. |
| `console-dimensions.md` | The physical unit's dimensions in millimetres, derived from the teardown and front photographs against the TMS1370's pin pitch, with what is measured, what is estimated, and how far the flat page's SVG disagrees. Feeds `tools/model/`. | Complete for plan; every depth is an estimate with a stated bound, because no photograph is edge-on. |
| `console-dimensions-board.jpg`, `console-dimensions-front.jpg` | The two photographs with every pixel read from `tools/model/pixels.json` drawn on them. | Regenerate with `python3 tools/model/measure.py --overlay docs/evidence`. |
| `console-model-front.jpg` | The 3D model rendered from a camera matched to `device-front-lit.jpg`, beside the photograph. `tools/model/compare.py` prints where each control and the window sit in both, as fractions of the case; the PRD bound is 3%. | Regenerate with `npm run model:render`. |
| `tube-sprite-detail.jpg` | Cells 6, 2 and 0 at one scale: the atlas before the teardown retrace, after it, and the glass. The check that a retraced outline is not self-consistently wrong. | Current as of the retrace; regenerate with `tools/trace/preview.py`. |

**The sprite catalogue is not in this directory.** Every lit shape the tube draws - its
cell, lane, measured size, frame count and crop - is in
`assets/reference/sprites/README.md`, next to the crops it cites. That file is the
authority for segment shape and placement; `src/machine/tube/atlas.json` should match it.

## Reference materials in `assets/reference/`

All materials are the repo owner's own recordings and photographs of a physical CGL
"Jet Fighters" unit (Gakken model 81582, 1979). They were committed across three v1
PRs: #1 (initial PRD and assets), #3 (photo rotation), #12 (loss recording). No
material here is sourced from a third party, and no mask-ROM dump exists or is sought
(explicitly out of scope, PRD v2).

### Audio

| File | Duration | Provenance | Establishes |
| --- | --- | --- | --- |
| `gameplay-audio.m4a` | 130.3 s | Owner recording of the real unit during a full play session (PR #1) | Missile fire blip (~7.30 / 38.31 / 41.89 s), battleship low buzz (~54 s), jet march step buzz (~66 s), win jingle (~120.5-122.4 s). The owner confirmed this recording ends in a genuine win at 199 points, which is why the tail is the win jingle and not a loss. |
| `loss-audio.m4a` | 88.6 s | Owner recording of a losing game (PR #12) | Launcher-hit warning beeps - the discrete triple-beep at ~27.4 s - and the full loss sound at ~85.86-86.99 s. Also the source for the owner-confirmed rule that hit 1 warns with two beeps, hit 2 with three, and hit 3 plays the loss sound. |

Both recordings are ground truth to be *measured and imitated*, not audio to bundle.
No sampled clip ships in the build. Measurements are in `audio-reference.md`.

### Photographs

| File | Size | Provenance | Establishes |
| --- | --- | --- | --- |
| `device-front-lit.jpg` | 1422x800 | Owner photo, unit powered with screen active (PR #1, rotated upright in PR #3) | Case geometry, control layout (blue fire button, spring-centred three-position lever, rotary 1/2/3 skill dial, ON/OFF power slide), the round black scope window, and the lit VFD colour split - orange/amber on the far side, blue/cyan on the player side. |
| `device-front-gameplay.jpg` | 1422x800 | Owner photo mid-game (PR #1, rotated in PR #3) | Full unit during play. The v1 PRD names this as the side-by-side visual match target for screen layout and sprite placement. Also the README hero image. |
| `screen-closeup-gameplay.jpg` | 1422x800 | Owner photo, close on the scope window mid-game (PR #1, rotated in PR #3) | Playfield detail: jet and battleship sprite shapes, the two-dot missile trail, launcher silhouette, and the SCORE digit readout. Primary input for the segment atlas. |
| `screen-overlay-closeup.jpg` | 1422x800 | Owner photo, close on the silkscreened overlay (PR #1, rotated in PR #3) | The white silkscreen: "COAST SIDE MISSILE STATION RADAR SIGHT SCREEN", the zone bands (BATTLE SHIP ZONE / JET FIGHTER FLYING ZONE / MISSILE STATION ZONE), and the printed scoring ruler 10 / 3 / 2 / 1 / G that fixes the scoring geometry. |
| `back-instructions-label.jpg` | 1200x900 | Owner photo of the CGL instruction label on the case back (PR #1) | The verbatim rules text transcribed in v1 PRD R2 item 7: skill dial and power-on start, lever aiming and fire, the three end conditions (199 points, all launchers destroyed, launcher captured), and power-cycle to restart. This label is the authority for the rule set - it is the manufacturer's own statement, not testimony. |

## Evidence still outstanding

Named as owner-supplied and pending in PRD R7. These are not present in
`assets/reference/`:

| Missing material | What it would establish | Blocks |
| --- | --- | --- |
| Gameplay video, 15-20 s per skill level (1, 2, 3) | Jet step cadence, battleship crossing interval, rocket travel time, and the thin-out speed-up curve, all as integer display-sweep counts | `timing-analysis.md` measured-timings table; ROM timing constants; contract criterion on frame-comparable playback at skill 1 |
| Angled-light photo of the dark tube | Complete segment atlas in one shot - every segment, including those never lit in the recorded games | Segment atlas completeness; tube renderer fidelity |
| PCB photo with chip markings | Confirms the CPU part is an HD38800Axx | CPU core part-number claim (currently inferred from the MAME `ghalien` sibling, not verified against this unit) |

The absence of the video is the reason `timing-analysis.md` carries a method
specification and an explicit evidence gap rather than a filled timing table. See
that document's "Evidence gap" section.

## Citation format for ROM source

Each constant cites the evidence item and, where applicable, the row or timestamp it
came from:

```text
; Missile-fire beep: docs/evidence/audio-reference.md missileFire.dominantHzRange
; (1480-1632 Hz, gameplay-audio.m4a ~7.30 s). Half-period in sweep units below.
MISSILE_BEEP_HALFPERIOD: .word 0
```

For a constant that is not yet evidence-backed, the citation must say so explicitly
and point at the gap, so a cold reviewer can find every unverified number by grep:

```text
; UNVERIFIED - v1 behavioural approximation, not a measurement of the real unit.
; Blocked on the pending gameplay video; see docs/evidence/timing-analysis.md.
SKILL1_STEP_SWEEPS: .word 0
```
