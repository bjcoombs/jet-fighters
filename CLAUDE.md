# Jet Fighters - Claude Code Instructions

Emulation of the 1979 Gakken "Jet Fighter" / CGL "Jet Fighters" tabletop VFD game: an
HMCS44 microcontroller running a game program we author, scanning a vacuum fluorescent
tube. PRD: `docs/prd/jet-fighters-v2.md` (paths in this file are relative to the repo
root). `docs/prd/jet-fighters-v1.md` describes the superseded behavioural replica and is
kept only as the record of what the rules are.

## Architecture rules

TypeScript, zero runtime dependencies. Vite build, Vitest tests. Five layers, mirroring
the physical machine:

| Path                 | Layer                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `asm/jetfighter.asm` | The game program - every rule, cadence, sound and score, in HMCS44 assembly |
| `tools/hmasm/`       | The assembler, its CLI, and the Vite plugin that makes `.asm` importable    |
| `src/machine/cpu/`   | HMCS44 core: 91 instructions, 4-bit ALU, 4-level stack, timer, R/D ports    |
| `src/machine/board/` | PWM display state, input strobe matrix, D14 edge capture, power switch      |
| `src/machine/tube/`  | Segment atlas and the renderer's phosphor rise/decay curves                 |
| `src/machine/audio/` | Cycle-stamped edges band-limited into a waveform                            |
| `src/ui/`, `src/input/`, `src/main.ts` | Case shell, keyboard/touch, and the frame driver          |

The rules that keep it honest:

- **Nothing owns a clock except `src/main.ts`.** The board advances only when stepped.
  No module below `src/main.ts` may call `requestAnimationFrame`, `setTimeout`,
  `Date.now()` or `performance.now()`.
- **`src/machine/` never touches the DOM** (the tube renderer takes a 2D context handed
  to it; it does not look one up). This is what lets `tools/probe/machine-probe.ts` and
  the spectral tests drive the real machine headlessly, and the Vitest `node` environment
  enforces it.
- **No game state outside the emulated RAM.** Score, jets, lives and skill are nibbles the
  program put there. A control movement reaches the game only by closing a contact on the
  input matrix, which the program reads on its next sweep - never by writing state.
- **Game behaviour is changed in `asm/jetfighter.asm`**, not in TypeScript. A gameplay bug
  is a ROM bug. Reassemble with a listing:
  `npx vite-node tools/hmasm/cli.ts asm/jetfighter.asm --listing /tmp/jetfighter.lst`
- **The power switch is the only reset.** On = core reset with RAM undefined then cleared
  by the ROM; off = halt and invalidate RAM. Do not add a restart path.
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

## Marathon Configuration

- Base branch: `main`
- Required approvals: 0 (solo-maintainer repo - merge with `--admin` once required checks are green)
- Markdown-only approvals: 0
- CI patterns: `ci` workflow (lint + test + build) required; `pages` deploy runs on main only
- Bot reviewer rules: none

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
