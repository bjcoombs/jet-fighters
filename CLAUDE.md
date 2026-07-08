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
