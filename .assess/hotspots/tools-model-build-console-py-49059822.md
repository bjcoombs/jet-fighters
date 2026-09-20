<!-- assess:run_id=20260920145155-6530f2a0 artifact_schema_version=1.1.0 -->
# Hotspot: `tools/model/build_console.py`

_First flagged: 2026-09-20. Last seen: 2026-09-20. Status: new._

## Current metrics

| Metric | Value |
|--------|-------|
| LOC | 975 |
| Cyclomatic complexity (file max) | 141.0 |
| Commits in churn window | 9 |
| Has test file | no |

## History across runs

| Run date | LOC | CCN | Commits | Status |
|----------|-----|-----|---------|--------|
| 2026-09-20 | 975 | 141.0 | 9 | new |

## Briefing for editing this file

Use this briefing when about to modify `tools/model/build_console.py`:

Hotspot (new). 975 LOC, max cyclomatic complexity 141.0, 9 commits in churn window. (Briefing refined by LLM via assess_finalize - see Suggested actions below.) Growth profile: monotonic (+1379 LOC, 0 net reductions over 9 commits in 0 months).

## Suggested actions

- Write a characterization test at tools/model/test_build_console.py pinning the current output of build_passives byte-for-byte
- Extract build_passives into tools/model/passives.py behind that test
- The file has ratcheted upward across 9 commits with deletions under 15% of churn - look for appended-but-superseded blocks to delete

