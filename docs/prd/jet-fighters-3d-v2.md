# Jet Fighters 3D, second pass - Geometry, Interface, and the Story PRD

> **Current for the `3d` tag, tasks 14 onward.** `jet-fighters-3d.md` built the page; this
> PRD takes it from "a model wearing photographs" to a modelled object, gives the page an
> interface that reads as one thing, and rewrites the README as the article the project
> deserves. Paths are relative to the repo root.

## Problem Statement

Three things the owner said after using the page with the photographs baked on.

**It looks like a photo overlay on a model.** It is one. `tools/model/photos.py` rectifies
the front and back photographs and the shells wear them. Up close that is exactly what it
reads as: the photograph's shadows are frozen into the surface, the moulded marks are
pictures of marks, and the sticker and label are pixels with the bed's lighting in them.
The page should be built the way the flat page's case is - every feature defined, like
an SVG, so it holds at any zoom - and then made photo-real by material and light rather
than by pasting the photograph on.

**The display controls are clunky.** The page grew a panel per feature: an explode panel
bottom-left with three presets, a slider and two case buttons; an info panel
bottom-right; a tooltip; a chrome bar top-left; the help and mute buttons; a touch bar.
They compete, the presets do not reflect the state the slider puts the model in, hiding a
part is discoverable only by clicking it, and there is no way back to a good view once
the camera has wandered.

**The README should read as an article.** It already has the bones - what the teardown
changed, how the work was held to evidence - but it is a reference document with a story
inside it. The story is the thing: a 1979 tabletop game emulated as a *machine*, its game
written in nibbles under a 2048-word ceiling with a one-level stack and a shift-register
program counter, held to photographs and recordings rather than to the original ROM, and
reviewed line by line by an AI reviewer that had opinions about 1979 assembly.

## Decisions taken in this PRD

1. **No photographs on the model.** `tools/model/textures/` and `photos.py` are removed.
   Every visible feature is geometry, a text mesh, or a generated image whose source is
   data in the repo (the label's transcribed text, the sticker's wordmark) drawn at build
   time by the same deterministic script. The photographs stay in `assets/reference/case/`
   as evidence and as the comparison targets.
2. **Photo-realism is the lighting's job.** Bevelled edges, physically based plastics
   with measured colour, procedural stipple as a normal map, real shadows and an
   environment in the viewer. The comparison renders remain the check that the geometry
   is the unit; a second, lit render from the oblique photograph's viewpoint is added for
   the look.
3. **One interface.** A single collapsible dock on the left with three sections - View,
   Take apart, Parts - and nothing else on the page but the mute and help buttons, the
   tooltip, and the touch bar on phones. State lives in one place and every control
   reflects it.
4. **The README is rewritten in the owner's voice**, with the project's own records
   quoted where the model's discoveries are described. Which discoveries, and the
   structure, are set out below so the owner can strike anything before it is written.

## Part A - The model as an object (21 points)

### A1 - Edges, plastics and light (8 points)

- A bevel on every shell edge (Blender bevel modifier, about 0.8 mm, applied before
  export), so edges catch light the way moulded ABS does. Bevels on the caps, thumb,
  flag, door and panels.
- Plastic materials from measured colour: the case red sampled from the front photograph
  as now (recorded with its sample region in `dimensions.json`, not in a texture folder),
  with a clearcoat-like gloss; the blue of the controls and sticker; the black of the
  switch; the grey rubber; the brown phenolic with a faint weave; the tube's black
  surround; steel; the smoked window; glass.
- Stipple on the wings' raised blocks as a **generated normal map**: seeded noise drawn
  by the build script into a small tileable image, applied with tiling UVs, so the
  texture is defined by a seed and a formula, not photographed. Roughness follows it.
- In the viewer: a directional key light casting soft shadow maps, a hemisphere fill,
  the room environment kept for reflections, a contact-shadow plane under the unit,
  ACES tone mapping at an exposure that reproduces the front photograph's mid-tones.

Acceptance: the model has no image textures except the generated stipple and the two
generated print images (A2). A lit render from `front-oblique.jpg`'s viewpoint is
committed as `docs/evidence/console-model-oblique.jpg` beside the photograph. The front
and board comparisons are back under 3%: `compare.py` reads the case by silhouette, not
by colour, on both images.

### A2 - Every printed and moulded feature, defined (8 points)

- Moulded text as embossed text meshes on the shells: `ON` / `OFF` beside the switch, the
  `1 2 3` marks (already), `OPEN` and its arrow on the door, `MADE IN JAPAN` on the back
  of the module's top edge, `JET FIGHTER` on the board (already).
- The sticker as a generated image: the sticker's blue, `JET` over `FIGHTERS` in a bold
  italic sans and the `CGL` mark below, drawn by the build script with Blender's own text
  rendering into an image sized to the sticker at 20 px/mm, or as raised text meshes on
  the blue plate. Whichever is chosen, the typeface is recorded as an approximation of
  the original in `docs/evidence/console-dimensions.md`.
- The back label as a generated image: the four numbered instructions, transcribed
  exactly from `assets/reference/case/back.jpg` into `tools/model/label.txt`, set in a
  plain sans on off-white with the `JETFIGHTERS` wordmark and the CGL mark, drawn at 20
  px/mm and applied to the label recess.
- Everything else already geometry stays geometry: ribs, panels, grips, screws, tab,
  channels, shoulders, bosses.

Acceptance: `tools/model/textures/` is gone; `photos.py` is gone; the glTF is under 1 MB.
Zoomed to the sticker or the label in the viewer, text is crisp at any distance. The
label's text matches the photograph word for word.

### A3 - Model hygiene from the second pass (5 points)

- `outline_points` becomes the one source of the plan outline for both shells, the
  cavities, the rib clip and the comparison's silhouette check.
- The estimated figures that the second pass added (`shape.*`, the depths) are in the
  document's estimate table with their bounds; the first-pass figures they replaced are
  noted as replaced.
- `npm run model:blend` is documented as the review path and the `.blend` stays out of
  git.

## Part B - One interface (13 points)

### B1 - The dock (8 points)

A single panel on the left, collapsible to a tab, with three sections:

- **View**: Front, Back, Inside (the board from above with the front shell lifted), and
  Reset. Each eases the camera. The current one is marked.
- **Take apart**: one slider with three detents labelled Assembled, Lid off, Exploded,
  and the two case buttons, Bare board and Show all. The slider is the state: a preset
  moves it, and the slider between detents is a partial explode.
- **Parts**: every labelled part, grouped as Case, Board, Tube, Controls, with a checkbox
  for visibility, hover-to-highlight, and click to focus. The part's label and evidence
  open inline under its row when focused, replacing the bottom-right info panel.

Keyboard: `F`/`B`/`I` for views, `E` cycles the explode detents, `H` hides the focused
part, `Escape` clears focus. These do not collide with the machine's keys (`P`, `1-3`,
arrows, space, `M`).

Acceptance: the page has one panel plus the mute and help buttons, the tooltip, and the
touch bar on phones. Every control reflects the state it controls. `src/viewer3d/dock.ts`
owns it, and `dock.test.ts` covers the pure state (detent from slider value, keyboard
mapping, group membership) headlessly.

### B2 - Small screens and feel (5 points)

- On narrow screens the dock starts collapsed and opens over the scene; the touch bar
  stays clear of it.
- Hover feedback on the modelled controls (cursor and a light tint) and a short press
  animation on the fire cap (already) and the switch.
- A one-line hint on first load, "Drag to orbit · P for power · click the controls",
  that goes away on first interaction.
- Consistent tokens: one font size scale, one radius, one translucency, in a small CSS
  block rather than per-element inline styles.

Acceptance: at 390 px wide the scene and the touch bar are usable with the dock closed,
and the dock opens without covering the bar.

## Part C - The README as an article (8 points)

The rewrite keeps every fact the current README carries and reorders it as a story. The
owner's voice throughout; the model's discoveries are told by quoting the project's own
documents, so the reader can see where each came from. Proposed structure:

1. **The hook.** A 1979 CGL Jet Fighters, taken apart, measured against the pitch of a
   chip's pins, and rebuilt in a browser - not the game, the machine. Play it; see it in
   three dimensions.
2. **What the machine is.** A TMS1370 scanning a two-phosphor tube one grid at a time;
   every beep is a blink. Two photographs, real and emulated.
3. **Writing a game in nibbles.** The five properties of the chip that shape every page
   of `asm/jetfighter.asm`, as its header states them: a 32-entry output PLA and no
   thirty-third pattern, so a grid is drawn one lane family per pass; a status latch
   loaded by exactly one instruction; one level of return, so the game is a flat loop of
   page branches and four leaf routines; a branch that is conditional only when the test
   is the instruction before it; a program counter that is a shift register, so the
   n-th instruction of a page is not at offset n. 128 nibbles of RAM holding the score,
   the jets, the lives and the skill, and nothing else anywhere.
4. **Held to evidence.** The teardown; measuring rather than asserting; the misidentified
   chip and how the error entered; phantom segments found three times; beliefs promoted
   to constraints found four; the model refusing three instructions because it had
   measured.
5. **What the model discovered along the way** - each with the document that records it:
   the chip is a TMS1370 and the dump exists and is deliberately not read; the board's
   edge bounding the case's depth from a photograph that was never meant to; the PLA
   arithmetic; the tube face landing on the renderer's field within 5 mm from an
   independent measurement; the window rectangle the flat page has wrong.
6. **An AI reviewer and 1979 assembly.** CodeRabbit left 18 review comments on
   `asm/jetfighter.asm` alone: a Major finding that `sr_retreat` still read a retired
   lane rank so the wave no longer retreated (PR 149); a finding it withdrew after the
   owner showed the fire gate made it moot (PR 139); the "learnings" it recorded about
   `SBIT` row bits and the two-plane renderer. What it means that a reviewer with no
   training on this ROM could find a regression in a register map.
7. **The unit in three dimensions.** Dimensions from a pin pitch; Blender headless; the
   depth the end views forced; photographs baked on and then taken off again, and why.
8. **Running it, changing it, watching it without a browser.** The existing Development
   and Architecture material, condensed, with the evidence table.
9. **Credits.**

Acceptance: the owner strikes or adds items in this list before the rewrite lands; the
rewrite is one PR; every link the current README has still resolves; the article is
under 2,500 words.

## Out of scope

Photogrammetry; a new typeface for the silkscreen; changes to the machine, the ROM or
the atlas; a mobile-first redesign of the flat page.

## Order

A1 and A2 together (one Blender pass), then A3; B1 then B2; C last, because it describes
the finished thing. 42 points.
