# Jet Fighters - Claude Code Instructions

Browser replica of the 1979 Gakken "Jet Fighter" / CGL "Jet Fighters" tabletop VFD game.
PRD: `docs/prd/jet-fighters-v1.md` (paths in this file are relative to the repo root).

## Architecture rules

- TypeScript + canvas + Web Audio, zero runtime dependencies. Vite build, Vitest tests.
- Game logic (`src/game/`) is pure and deterministic (seedable RNG): no DOM, no timers,
  no Web APIs. Rendering (`src/render/`), audio (`src/audio/`), and input (`src/input/`)
  consume it through explicit interfaces.
- Every gameplay rule lives in the PRD. If a rule is ambiguous, check
  `assets/reference/` (video frames, audio, back-label photo) before inventing behaviour.

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
