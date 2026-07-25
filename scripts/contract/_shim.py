#!/usr/bin/env python3
"""Resolve and exec an acceptance-contract gate script from the toolkit plugin.

The marathon skill and the /tm command invoke the contract gates by a path
relative to the run cwd (`python scripts/contract/start_gate.py <run-id>`), but
the gate implementations ship with the ai-native-toolkit plugin rather than
living in this repo. Vendoring copies here would fork the enforcement logic from
the version the toolkit tests, so each entry point in this directory is a thin
shim that execs the plugin's real script instead.

Resolution order for the plugin's contract directory:

1. `$ACCEPTANCE_CONTRACT_SCRIPTS` - explicit override, checked first so CI and
   local runs can pin a specific checkout.
2. The marketplace clone at `~/.claude/plugins/marketplaces/ai-native-toolkit`.
3. The highest-versioned cache entry under `~/.claude/plugins/cache/...`.

Failing to find it is a hard error, not a skipped gate: a gate that cannot run
must block the run exactly as a failing gate does.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import List, Optional

ENV_OVERRIDE = "ACCEPTANCE_CONTRACT_SCRIPTS"
MARKETPLACE = Path.home() / ".claude/plugins/marketplaces/ai-native-toolkit/scripts/contract"
CACHE_ROOT = Path.home() / ".claude/plugins/cache/ai-native-toolkit/ai-native-toolkit"


def _version_key(name: str) -> List[int]:
    """Sort key for a plugin version dir, so 1.56.0 beats 1.9.9 numerically."""
    return [int(part) for part in re.findall(r"\d+", name)] or [0]


def _cache_candidates() -> List[Path]:
    if not CACHE_ROOT.is_dir():
        return []
    versions = sorted(
        (p for p in CACHE_ROOT.iterdir() if p.is_dir()),
        key=lambda p: _version_key(p.name),
        reverse=True,
    )
    return [v / "scripts/contract" for v in versions]


def resolve_scripts_dir() -> Optional[Path]:
    # An explicit override is authoritative, not merely first: pinning an audited
    # checkout must never silently degrade to a different version. If it does not
    # resolve, fail closed rather than falling through to the marketplace.
    override = os.environ.get(ENV_OVERRIDE)
    if override:
        pinned = Path(override)
        return pinned if (pinned / "validate_completion.py").is_file() else None

    for candidate in [MARKETPLACE, *_cache_candidates()]:
        if (candidate / "validate_completion.py").is_file():
            return candidate
    return None


def exec_gate(script_name: str, argv: List[str]) -> int:
    scripts_dir = resolve_scripts_dir()
    if scripts_dir is None:
        print(
            "contract gate %s: CANNOT RUN - the ai-native-toolkit contract scripts\n"
            "were not found. Looked at $%s, %s, and the plugin cache.\n"
            "Install/update the ai-native-toolkit plugin or set $%s.\n"
            "The gate is failing closed: this blocks the run."
            % (script_name, ENV_OVERRIDE, MARKETPLACE, ENV_OVERRIDE),
            file=sys.stderr,
        )
        return 1

    target = scripts_dir / script_name
    if not target.is_file():
        print(
            "contract gate %s: CANNOT RUN - %s does not exist in the resolved\n"
            "toolkit contract dir (%s). Failing closed." % (script_name, script_name, scripts_dir),
            file=sys.stderr,
        )
        return 1

    # exec rather than import: the real script then runs with sys.path[0] set to
    # the toolkit contract dir, so its flat sibling imports (validate_completion,
    # tiers) resolve exactly as they do in the toolkit's own test suite.
    os.execv(sys.executable, [sys.executable, str(target), *argv])
