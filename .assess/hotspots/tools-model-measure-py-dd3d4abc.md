<!-- assess:run_id=20260920145155-6530f2a0 artifact_schema_version=1.1.0 -->
# Hotspot: `tools/model/measure.py`

_First flagged: 2026-09-20. Last seen: 2026-09-20. Status: new._

## Current metrics

| Metric | Value |
|--------|-------|
| LOC | 461 |
| Cyclomatic complexity (file max) | 76.0 |
| Commits in churn window | 9 |
| Has test file | no |

## History across runs

| Run date | LOC | CCN | Commits | Status |
|----------|-----|-----|---------|--------|
| 2026-09-20 | 461 | 76.0 | 9 | new |

## Briefing for editing this file

Use this briefing when about to modify `tools/model/measure.py`:

Hotspot (new). 461 LOC, max cyclomatic complexity 76.0, 9 commits in churn window. (Briefing refined by LLM via assess_finalize - see Suggested actions below.) Growth profile: monotonic (+601 LOC, 0 net reductions over 9 commits in 0 months).

## Suggested actions

- Same accretion profile as build_console.py: write_overlays (ccn 28) is the worst function - extract it before the file grows further

