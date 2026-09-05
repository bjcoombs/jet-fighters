# Jet Fighters

**[Play it here](https://bjcoombs.github.io/jet-fighters/).** A 1979 CGL Jet Fighters, taken
apart, measured against the pitch of its chip's pins, and rebuilt in a browser - not the
game, the machine. It opens as the unit sits on a table. Turn it over, lift the red shell
off, pull the board out with the tube still lit, and keep playing.

| The original 1979 CGL unit | This emulator |
| :---: | :---: |
| <img src="assets/reference/readme-real-tube.jpg" alt="The scope of an original CGL Jet Fighters unit, powered on"> | <img src="assets/reference/readme-emulated-tube.jpg" alt="The same view of this emulator running in a browser"> |

## What the machine is

Gakken built it (model 81582); Computer Games Limited sold it in Britain. Inside is a
4-bit Texas Instruments **TMS1370**, custom mask **MP2110**, driving a two-phosphor vacuum
fluorescent tube one grid at a time and making sound by toggling a single pin. It has one
core and no sound hardware, so when it plays a note it stops scanning the tube: on the
real unit, and on this one, **every beep is also a visible blink of the whole display.**

This repository does not re-implement the game's rules. It emulates that machine - the
chip is legible in [the teardown photograph](assets/reference/tube-teardown/) - and the
game it runs is `asm/jetfighter.asm`, assembly source in this repository, written under
the chip's 2048-word program and 128-nibble RAM ceilings. The timing, the display shimmer
and the sound are not approximated; they fall out of running it.

The instruction rate is **not measured**: it is MAME's fitted oscillator approximation
over the architectural divide-by-six, every cadence constant derived from it is marked
provisional, and
[`docs/research/mp2110-timing-measurement.md`](docs/research/mp2110-timing-measurement.md)
records what a measurement would take.

## Writing a game in nibbles

The program's own header states the five properties of the chip that shape every page of
it, and not one of them is a preference.

1. **The O port is a 32-entry PLA, not a latch.** A jet column's visible states come to
   96 masks against 32 slots, so a grid cannot be drawn in one strobe: the sweep draws one
   lane family per pass, four passes a frame. The arithmetic is in
   [`docs/research/pla-design.md`](docs/research/pla-design.md); the table is the
   project's own, and MAME's copy of Gakken's has not been looked at.
2. **The status latch is loaded by exactly one instruction.** A bank crossing costs three,
   so the sweep crosses twice a frame and never once per grid.
3. **One level of subroutine return.** A call inside a subroutine silently loses the outer
   return address, so the game is a flat loop of page branches and four leaf routines
   that call nothing. The assembler rejects the mistake.
4. **A branch is conditional only when the test is the instruction before it.** Anything
   between makes it unconditional, and it assembles cleanly on real silicon.
5. **The program counter is a shift register.** A label is a state, not a position; the
   n-th instruction of a page is not at offset n.

The score, the jets, the lives and the skill are nibbles the program put in its 128 of
RAM; there is no game state anywhere else, and a control reaches the game only by closing
a contact the program reads on its next sweep. The power switch is the only reset:
switching on brings RAM up undefined, which the program then clears, and switching off
lets it die with the supply. The real unit has no restart button, and neither does this.

## Held to evidence

Every line of this repository was written by Claude, in Claude Code - Opus 5 and Fable 5,
across the days in the commit log. I supplied the machine, the photographs, the recordings
and the judgement about what the real unit does. I had held off on this project because
agentic coding did not feel ready for something with this shape: no reference
implementation to copy, a correctness standard that lives in a physical object on a desk,
and thousands of small decisions that are each individually plausible and collectively
wrong if nobody checks them against the thing itself.

Most of what the emulator knows about the tube it learned late, and by being wrong first.
Until late on, every sprite came from photographs and video of the unit *playing*: through
a smoked filter, in sunlight, sampled slower than the tube refreshes. Then I took the unit
apart and photographed the bare glass, unpowered, at 46.7 megapixels, and almost
everything downstream turned out to be an assumption we had promoted to a test. Five
score segments were phosphor the glass does not have: the hundreds digit is two printed
strokes, because the score caps at 199. The jets are fifteen distinct shapes, one per lane
per column, printed on the glass; the program only chooses which to light. The sprite
lattice had been derived from the sprites themselves, which assumed they sit centred in
their cells; they sit 16% left of centre, and every test passed, because "each jet is
inside its own cell" is true of any self-consistent frame. The "march beep" the game's
speed was tuned against was the player's own gun, so the game ran twice as fast as the
real one. And the battleship's buzz was never missing, only a tenth of its measured
length. Magnify the display and the dot screen in the phosphor and the honeycomb in the
dark field turn out to be **the same structure**, the control grid, an etched mesh at a
10.83 px period on a 31 degree axis; one mesh, composited as a shadow, produces both.

What made the work trustworthy is not that the model got things right - that list is what
it got confidently, thoroughly wrong. It is that it could be **held to evidence**: made to
measure rather than assert, to record how it knows each thing, and to say plainly what it
could not determine. Findings carry their provenance and sample counts. Assertions are
checked by mutation. Where two sources disagree, the disagreement is written down in
[`docs/evidence/`](docs/evidence/) rather than averaged away. The two ways the project has
repeatedly gone wrong are named so they can be recognised on sight: **phantom segments**,
phosphor the glass does not have, found three times; and **beliefs promoted to
constraints**, an assertion describing what we decided rather than what the machine does,
found four.

Some of it came from the model refusing instructions. Told to remap the sprite grid one
way, it measured and held its ground; obeying would have mirrored the playfield and
deleted three real segments. Told the battleship's pitch encoding was capped, it measured,
found the pitch correct, and declined to redesign it. Told a path-simplification step was
throwing away sprite detail, it measured that step at a tenth of the error and looked
elsewhere. Each instruction was simply wrong, and each would have shipped.

## What the model found along the way

Each of these is recorded in the document it came from.

- **The chip.** The project spent its first weeks emulating a Hitachi HMCS44, on two
  stacked inferences never checked against the part. The teardown photograph shows
  `MP2110` beside the TI logo, and MAME's device list names that mask as the Gakken
  Invader program - which is why the game reads as Space Invaders. The largest error in
  the project, visible in a committed photograph for a day before anyone read it:
  [`docs/evidence/open-questions.md`](docs/evidence/open-questions.md), section 7. A dump
  of that ROM exists in MAME and is deliberately not consulted: the game here is
  reconstructed from the outside, and the dump is held back as the check on it.
- **A photograph bounding a depth it was never taken to show.** In the board photograph
  the board's edge reads 7 px inside the shell's rim; 15 mm below the rim it would have
  read 70 px further in, so the board sits within about 3 mm of it - a depth read out of
  parallax, in [`docs/evidence/console-dimensions.md`](docs/evidence/console-dimensions.md).
- **The PLA arithmetic** above, which turned "draw the display" into a four-pass sweep
  with a stated instruction bound.
- **The tube face on the renderer's field.** The model's glass and the renderer's drawing
  share one feature, the radar circle; registered through it, the renderer's drawing lands
  where the photographs show the tube's edges. The flat drawing's window rectangle, which
  the tube layout inherited, stops 20 mm short of the real one's; the document says so
  and leaves the layout alone.

## An AI reviewer and 1979 assembly

CodeRabbit reviews every pull request here, and it left 18 comments on
`asm/jetfighter.asm` alone across seven of them - a reviewer with no training on this ROM,
reading 1976 silicon's register map.

On the pull request that gave the game two positioned planes, it found that `sr_retreat`
still walked the three retired lane-rank nibbles, so a surviving squadron no longer fell
back after a capture; the write landed in unused RAM and nothing reported it. A Major
finding, correct, in a routine the change had not touched. On the one that drew all three
lanes of the missile rank, it warned that a second missile in another lane would never
advance. I showed it the fire gate - one missile at a time, tested against the stored
lane, so the second shot is never created - and it re-read the code, withdrew the finding,
and recorded the exchange as a learning it has applied since. The rest were of the same
shape: a probe that counted discarded frames toward its sample, a hunt that could finish
before it had tried every offset it had just been given. Two reviewers who have never
seen the machine, checking each other against the code, is much of why the ROM's later
changes landed clean.

## The unit in three dimensions

No dimension was measured with a ruler; I no longer have access to the unit. Every figure
is read off the photographs against the one object of known size in them, the TMS1370's
2.54 mm pin pitch, and recorded with its source in
[`tools/model/dimensions.json`](tools/model/dimensions.json). A Blender script builds every
part from that file, headless and deterministically, with a label, its evidence and an
explode vector on each node. Renders from matched cameras sit beside the photographs in [`docs/evidence/console-model-front.jpg`](docs/evidence/console-model-front.jpg)
and [`console-model-board.jpg`](docs/evidence/console-model-board.jpg);
[`tools/model/compare.py`](tools/model/compare.py) reads both with the same masks, and the
front agrees to within 1.5% of the case width.

No photograph is edge-on, so every depth is an estimate with a stated basis and bound.
The first pass put the case at 36 mm deep from what the parts inside had to clear; then
I photographed its ends, which showed 58, and the parting line moved to where the
parallax between the window's print and the segments says the glass must be. The
launcher's mechanism and one toothed disc on the board are labelled unidentified, because
the photographs do not say.

The shells wore the photographs for a while, rectified and baked on, and up close that is
what it looked like: shadows frozen into the surface, moulded marks as pictures
of marks. They came off again. Nothing on the model is a photograph now - bevelled
geometry in plastics whose colours are sampled from the front photograph, a seeded
stipple, and a text mesh for every printed or moulded word, so zooming in finds edges
rather than pixels. The flat drawing of the case that preceded the model was a rendering
of the same unit, and it is in git history.

One panel runs the page: **View** (front, back, inside; `F`, `B`, `I`), **Take apart** (a
slider with detents at assembled, lid off and exploded; `E` steps through them, "Bare
board" plays the board alone) and **Parts** (every labelled part, its visibility, and its
evidence when clicked; `H` hides, `Esc` lets go). On a phone the four controls are also a
bar along the bottom; `#touch` on the address shows it on a desktop.

## Running it, changing it, watching it without a browser

```bash
npm install && npm run dev
```

The site has one runtime dependency, `three`, confined to the page's own directory by a
test that reads the import graph.

| Action        | Keyboard                | On the model                  |
| ------------- | ----------------------- | ----------------------------- |
| Move launcher | Arrow Up / Down, W / S  | Launcher lever (3 lanes)      |
| Fire missile  | Space / Enter           | Blue fire button              |
| Skill level   | 1 / 2 / 3               | Skill flag (1 / 2 / 3)        |
| Power         | P                       | ON/OFF slide switch           |
| Mute          | M                       | Speaker button, top left      |

The lever and the fire button are held contacts, read off the input matrix each sweep.
Mute silences the browser, not the machine: the program keeps toggling the pin, like a
unit with its piezo disconnected.

**Changing the game** means editing `asm/jetfighter.asm`, never TypeScript. The Vite plugin
in `tools/tmsasm/vite-plugin.ts` assembles it on import, so there is no generated ROM to
go stale. Assemble it with a listing:

```bash
npx vite-node tools/tmsasm/cli.ts asm/jetfighter.asm --listing /tmp/jetfighter.lst
```

The assembler enforces the real ceilings - 2048 words, 128 nibbles - and rejects five
silent-failure classes this architecture invites: a page-crossing branch inside a
subroutine, a call reachable from inside one, `SETR`/`RSTR` with X out of range, an
instruction between a test and its branch, and code laid down in address order rather
than the program counter's.

**Watching the machine** needs no browser:

```bash
# 250k cycles, about four emulated seconds: grids strobed, segments lit, at what duty
npx vite-node tools/probe/machine-probe.ts --cycles 250000
# move the lever mid-run; capture the R15 edge stream for spectral analysis
npx vite-node tools/probe/machine-probe.ts --cycles 250000 --input lever=up@120000
npx vite-node tools/probe/machine-probe.ts --cycles 250000 --input fire@120000 --emit-edges
```

The probe reads everything off the board's own observation surface, so what it reports is
what the hardware did. In a dev build the running machine is also at `window.jetFighters`
(`board`, `renderer`, the assembler's symbol table, and the scene).

**The layout** mirrors the machine, and data flows the way electricity did: the assembled
image into `src/machine/cpu/tms1370/`; the controls and keyboard onto its K pins; the
grids and plates into `src/machine/board/`'s PWM state and on to `src/machine/tube/`'s
atlas and phosphor; R15's edges into `src/machine/audio/`. `src/app/driver.ts` steps the
core, draws the tube and drains the speaker, and **nothing else owns a clock**, so the
same machine runs in a browser at 60 Hz and in Node as fast as it can. `src/machine/`
**never touches the DOM**, which lets `tools/probe/` and the spectral tests drive it
headlessly. `src/input/` is the keyboard, `src/viewer3d/` the page, `tools/model/` the
dimensions, the Blender script and the comparison.

Nothing in the machine layer is tuned by eye. Each of these records what was measured and
what it does *not* establish:

| Document | What it pins down |
| --- | --- |
| [`docs/evidence/audio-reference.md`](docs/evidence/audio-reference.md) | Every sound's frequency band, from recordings; one figure that turned out to be a note name, substituted for a reading |
| [`docs/evidence/vfd-appearance.md`](docs/evidence/vfd-appearance.md) | Refresh rate, phosphor persistence per colour, brightness under load, the blanking with every sound |
| [`docs/evidence/tube-mesh.md`](docs/evidence/tube-mesh.md) | The control grid's period and angle |
| [`docs/evidence/timing-analysis.md`](docs/evidence/timing-analysis.md) | Squadron cadence and battleship crossings, frame by frame |
| [`assets/reference/sprites/README.md`](assets/reference/sprites/README.md) | Every sprite on the glass, its size, its cell and its lanes |
| [`src/machine/tube/ATLAS-COORDINATES.md`](src/machine/tube/ATLAS-COORDINATES.md) | The tracing method, the five approaches that failed, the two ways the atlas has gone wrong |
| [`docs/evidence/console-dimensions.md`](docs/evidence/console-dimensions.md) | The unit's dimensions against the pin pitch: measured, estimated, and how far the flat drawing disagreed |
| [`docs/evidence/open-questions.md`](docs/evidence/open-questions.md) | What is still unsettled, and what would settle it |

## Credits

Original game by Gakken (model 81582, 1979), released in the UK by Computer Games Limited
(CGL). This project is an unaffiliated fan recreation and is not endorsed by or associated
with Gakken or CGL.

Licensed under the [MIT License](LICENSE).
