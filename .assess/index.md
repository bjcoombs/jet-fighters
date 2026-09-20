<!-- assess:run_id=20260920145155-6530f2a0 artifact_schema_version=1.1.0 -->
# Assess Wiki Index

_Last updated: 2026-09-20_

Catalog of every hotspot ever flagged by `/assess` in this repo. Status reflects the most recent run.

| File | First Flagged | Last Seen | Status | Latest CCN | Latest LOC |
|------|---------------|-----------|--------|------------|------------|
| `tools/probe/render-fidelity.test.ts` | 2026-09-20 | 2026-09-20 | new | 103.0 | 576 |
| `tools/probe/battleship-arrival.test.ts` | 2026-09-20 | 2026-09-20 | new | 116.0 | 542 |
| `tools/model/build_console.py` | 2026-09-20 | 2026-09-20 | new | 141.0 | 975 |
| `tools/probe/scoring-ruler.test.ts` | 2026-09-20 | 2026-09-20 | new | 96.0 | 413 |
| `tools/probe/launcher-lives.test.ts` | 2026-09-20 | 2026-09-20 | new | 131.0 | 429 |
| `tools/probe/sweep-timing.test.ts` | 2026-09-20 | 2026-09-20 | new | 119.0 | 403 |
| `tools/probe/tms1370-rom.test.ts` | 2026-09-20 | 2026-09-20 | new | 136.0 | 541 |
| `tools/model/measure.py` | 2026-09-20 | 2026-09-20 | new | 76.0 | 461 |
| `src/machine/tube/atlas.test.ts` | 2026-09-20 | 2026-09-20 | new | 166.0 | 606 |
| `tools/probe/speaker-bands.test.ts` | 2026-09-20 | 2026-09-20 | new | 140.0 | 410 |

## Legend

- **active** - in the latest top hotspots list
- **new** - newly entered the hotspot list this run
- **graduated** - was a hotspot, no longer is (good)
- **regressed** - still a hotspot, and getting worse
- **persistent** - still a hotspot, roughly unchanged

## How this gets updated

Each `/assess` run reads this file, the prior `complexity-stats.json`, and the latest run output, then rewrites this index. Per-file detail lives in `hotspots/<slug>.md`. Run history lives in `log.md`.
