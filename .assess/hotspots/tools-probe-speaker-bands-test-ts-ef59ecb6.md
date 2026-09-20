<!-- assess:run_id=20260920145155-6530f2a0 artifact_schema_version=1.1.0 -->
# Hotspot: `tools/probe/speaker-bands.test.ts`

_First flagged: 2026-09-20. Last seen: 2026-09-20. Status: new._

## Current metrics

| Metric | Value |
|--------|-------|
| LOC | 410 |
| Cyclomatic complexity (file max) | 140.0 |
| Commits in churn window | 10 |
| Has test file | yes |

## History across runs

| Run date | LOC | CCN | Commits | Status |
|----------|-----|-----|---------|--------|
| 2026-09-20 | 410 | 140.0 | 10 | new |

## Briefing for editing this file

Use this briefing when about to modify `tools/probe/speaker-bands.test.ts`:

Hotspot (new). 410 LOC, max cyclomatic complexity 140.0, 10 commits in churn window. (Briefing refined by LLM via assess_finalize - see Suggested actions below.) Growth profile: monotonic (+967 LOC, 0 net reductions over 10 commits in 1 months).

## Suggested actions

- Accretion-flagged test file at 410 LOC; extract the shared band-setup helpers rather than appending further cases

