# Jet Fighters - Claude Code Instructions

Emulation of the 1979 Gakken "Jet Fighter" / CGL "Jet Fighters" tabletop VFD game: a
4-bit microcontroller running a game program we author, scanning a vacuum fluorescent
tube.

**The unit's chip is a Texas Instruments TMS1370 (mask MP2110)** - see
`docs/evidence/open-questions.md` section 7 for the evidence and how the earlier
misidentification entered. The instruction rate is provisional: MAME's fitted oscillator
approximation over the architectural divide-by-six, not a measurement of this part. See
`docs/research/mp2110-timing-measurement.md` before treating any cadence figure as
settled.

PRD: `docs/prd/jet-fighters-v3.md` (paths in this file are relative to the repo root).
`docs/prd/jet-fighters-v2.md` and `docs/prd/jet-fighters-v1.md` are historical - v2 for the
machine this one replaced, v1 for the behavioural replica before it - and are kept as the
record of what the rules are and how they were arrived at.

## This is a black-box reconstruction. Do not read the original program.

The chip is identified: `MP2110`, a TI TMS1370, week 40 of 1980 - read off the
teardown photograph, TI logo and all. That mask is the **Gakken Invader** program,
and **a dump of it exists in MAME**. It is deliberately not consulted.

The game program here is being reconstructed from the outside, and the dump is
held back as the *check* on that reconstruction rather than used as its source. A
reconstruction that was peeked at proves nothing about the method that produced
it, so the comparison is only worth making if it has not happened yet. That is
the owner's explicit decision.

**Never consult, as a source of game behaviour:**

- the dumped MP2110 ROM image, in MAME or anywhere else
- MAME's driver internals for Gakken Invader / Tandy Fire Away / Galaxy Invader
- disassemblies, reverse-engineering write-ups, or let's-plays of that program

**These remain fair game**, and the line is *hardware fact* against *program
behaviour*:

- chip identification and its provenance - which part, how many pins, what year
- TMS1000-family instruction set, timing and architecture documentation
- everything in `assets/reference/` - photographs, audio, video of the real unit
- the owner's own testimony

If a gameplay question cannot be settled from measurement, testimony or the
reference assets, **the honest answer is that it is unresolved**, and this project
records unresolved questions well - `docs/evidence/open-questions.md` is what that
looks like. Reaching for the original program to close a gap destroys the thing
being built. An agent that does it will believe it is being helpful.

## Architecture rules

TypeScript, and one runtime dependency: `three`, confined to `src/viewer3d/` (the 3D
page) and kept out of everything else by `src/viewer3d/dependency-boundary.test.ts`, which
reads the import graph. The machine, the input layer, the flat case and the driver take
nothing from npm at runtime. Vite build, Vitest tests. Five layers, mirroring the physical
machine, and a second page beside them:

| Path                 | Layer                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `asm/jetfighter.asm` | The game program - every rule, cadence, sound and score, in TMS1000-family assembly |
| `tools/tmsasm/`      | The assembler, its CLI, five static analyses, and the Vite plugin that makes `.asm` importable |
| `src/machine/cpu/tms1370/` | TMS1370 core: 256 opcodes, 4-bit ALU, LFSR PC, one-level stack, R/O/K ports, output PLA |
| `src/machine/board/` | PWM display state, K input matrix, R15 edge capture, power switch           |
| `src/machine/tube/`  | Segment atlas and the renderer's phosphor rise/decay curves                 |
| `src/machine/audio/` | Cycle-stamped edges band-limited into a waveform                            |
| `src/app/`           | The frame driver - the one clock - plus canvas sizing and the mute toggle, shared by both pages |
| `src/ui/`, `src/input/`, `src/main.ts` | Case shell, keyboard/touch, and the flat page's wiring   |
| `src/viewer3d/`, `3d.html` | The unit as a model: the glTF from `tools/model/` orbited, taken apart and played, the tube's canvas as its texture |

Beside them, and not part of the build: `tools/trace/` is where
`src/machine/tube/atlas.json` comes from. It traces the teardown photograph into segment
outlines, in Python, needing NumPy, SciPy and Pillow. Nothing in `src/` imports it and
`npm test` never runs it, but **a playfield outline is changed there and regenerated, not
edited by hand** - `src/machine/tube/ATLAS-COORDINATES.md`, "Tracing workflow".

`tools/video/` is the same kind of thing for the owner's *gameplay* recordings: it
registers a handheld clip against the printed silkscreen, times what the squadron and the
missile do on the glass, and asks what the audio is doing when the tube goes dark. Same
dependencies, plus `ffmpeg`. Every figure it produces is quoted in
`docs/evidence/timing-analysis.md` or `open-questions.md` with the run that produced it,
and **a cadence figure taken from a video is changed there and re-run, not typed into a
comment**.

`tools/model/` is where `public/models/console.glb` comes from: the physical unit's
dimensions read off the photographs against the chip's pin pitch (`pixels.json` ->
`measure.py` -> `dimensions.json`, every figure measured with its source or estimated with
its basis), and a Blender script that builds every part from them headless and exports the
model with a label, its evidence and an explode vector on each node. The shells wear the
owner's front and back photographs, rectified by `photos.py` into `textures/`. The `.glb` is
committed and deterministic; `npm run model` rebuilds it, `npm run model:render` also
re-renders the comparisons against the photographs in `docs/evidence/`. **A dimension is
changed in `pixels.json` or in `measure.py`'s estimates and regenerated, never typed into
the Blender script or the model** - `docs/evidence/console-dimensions.md`, whose tables
`measure.py --doc` writes. Needs Blender 4.2+ locally; CI never runs it.

**Two ways a recording reaches this repo, and the difference is deliberate.** The full
clips are hundreds of megabytes and are *not* committed - `IMG_6113.mov` and the owner's
skill-3 clip are referenced by path, so a tool that reads one runs only where the file
is. Where a figure needs to be re-derivable in a clean checkout, the *reduction* is
committed instead: `assets/reference/skill3-video-tube.mp4` is a 1 MB crop of the tube
face, `skill3-video-cells.csv` is that crop reduced to per-cell brightness and
`skill3-video-score.csv` is the same crop reduced to the score readout's lit-pixel count
per frame, which is what lets `tools/probe/drives/missile-transit.ts` and
`score-windows.ts` run in CI with no video decode at all.
Prefer the second shape for anything a drive asserts on.

The rules that keep it honest:

- **Nothing owns a clock except `src/app/driver.ts`.** The board advances only when
  stepped. No other module under `src/` may call `requestAnimationFrame`, `setTimeout`,
  `setInterval`, `Date.now()` or `performance.now()`; `src/app/clock-owner.test.ts` reads
  the tree and fails on one. A page (`src/main.ts`, `src/viewer3d/`) builds its canvas
  and controls and hands the driver a renderer; it never steps the board itself.
- **`src/machine/` never touches the DOM** (the tube renderer takes a 2D context handed
  to it; it does not look one up). This is what lets `tools/probe/machine-probe.ts` and
  the spectral tests drive the real machine headlessly, and the Vitest `node` environment
  enforces it.
- **No game state outside the emulated RAM.** Score, jets, lives and skill are nibbles the
  program put there. A control movement reaches the game only by closing a contact on the K
  matrix, which the program reads on its next sample - never by writing state.
- **Game behaviour is changed in `asm/jetfighter.asm`**, not in TypeScript. A gameplay bug
  is a ROM bug. Reassemble with a listing:
  `npx vite-node tools/tmsasm/cli.ts asm/jetfighter.asm --listing /tmp/jetfighter.lst`
- **The power switch is the only reset.** On = core reset with RAM undefined, which the ROM
  then clears; off = stop and invalidate RAM. Do not add a restart path, and do not clear
  RAM on the board's behalf - the clear routine costs real instruction time before the
  first sweep and that cost is a power-on behaviour the machine has.
- **The program counter is an LFSR.** The n-th instruction of a page is not at offset n.
  `tools/tmsasm/memory.ts` owns that map; nothing else may assume address order.
- Geometry and palette values shared with other layers are **copied with a citation
  comment, not imported** - `src/machine/` depends on nothing above it.
- Every gameplay rule lives in the PRD. If a rule is ambiguous, check
  `assets/reference/` (video frames, audio, back-label photo) before inventing behaviour.
  Measured audio bands are in `docs/evidence/audio-reference.md`.

## Commands

- `npm run dev` - Vite dev server
- `npm run build` - production build
- `npm test` - Vitest
- `npm run lint` - lint
- `npm run model` - rebuild `public/models/console.glb` in Blender; `npm run model:render` also the comparison renders

## Marathon Configuration

- Base branch: `main`
- Required approvals: 0 (solo-maintainer repo - merge with `--admin` once required checks are green)
- Markdown-only approvals: 0
- CI patterns: `ci` workflow (lint + test + build) required; `pages` deploy runs on main only
- Bot reviewer rules: none

### Two things that have cost this project a red `main`

**A green local run says nothing about a branch whose base has moved.** GitHub builds the
*merge* commit for a `pull_request` event, so a branch tests against `main` as it was when
the run started. Three PRs each green against a different base landed red together, and a
fourth went red on a commit that changed only comments - the assembled ROM was
byte-identical, and what had moved was `main` underneath it. Before merging a run of PRs
that touch related behaviour, rebase each onto the current `main` and let CI run again;
merging them in the order their CI happened to pass is not the same thing.

**A literal timeout in a test about a machine that stops is a bet on when it stops.** That
figure has moved three times in one day here - 5.66 s while a single capture ended the
game, then 10.92 s once three captures were survivable, then 20.6 s once the cadence
ladder doubled. Express such horizons as multiples of a named, *measured* constant
(`UNATTENDED_SILENCE_S` in `tools/probe/game-lifetime.test.ts` is the worked example), so a
rule or cadence change moves one number instead of turning `main` red. Estimating that
constant rather than measuring it is what caused the third occurrence.

## Acceptance contract gates

Marathon runs are gated on a frozen acceptance contract at both entry and exit.
The gate implementations ship with the ai-native-toolkit plugin; `scripts/contract/`
holds thin shims that exec them, so the documented relative invocations work from
this repo without vendoring (and forking) the enforcement logic. A shim that cannot
resolve the toolkit fails closed and blocks the run.

Run identifier = the Task Master tag. Contract artifacts:

- `docs/contract/<run-id>.contract.md` - the contract, committed and reviewed here.
- `.taskmaster/contract/<run-id>.completion.json` - freeze evidence and the
  completion record. Run state, alongside `tasks.json` at the Task Master root,
  not committed to this repo.

`.taskmaster/` does not live inside this git repository. This checkout is
`jet-fighters/jet-fighters-main/` (worktrees are siblings under
`jet-fighters/worktree/`), and `.taskmaster/` sits one level up in the parent
`jet-fighters/` directory alongside them. That parent is the Task Master root.

The default `--contract-dir` is `.taskmaster/contract` relative to the current
directory, so run the gates from the Task Master root - not from this checkout,
where the default would resolve to a path that does not exist:

```bash
cd ~/dev/github.com/bjcoombs/jet-fighters       # parent dir; holds .taskmaster/
python3 scripts/contract/start_gate.py <run-id>
```

From inside this checkout or a worktree, pass the directory explicitly. Relative
depth differs between the two (a worktree is three levels down, this checkout
one), so use the absolute path rather than counting `../`:

```bash
python3 scripts/contract/start_gate.py <run-id> \
  --contract-dir ~/dev/github.com/bjcoombs/jet-fighters/.taskmaster/contract
```

The contract's sha256 is recorded at freeze and re-hashed by the exit verifier, so
editing a contract mid-run aborts the run rather than certifying against a moved
target. Author and freeze the contract *before* decomposing the tag.
