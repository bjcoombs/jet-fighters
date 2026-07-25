#!/usr/bin/env python3
"""Shim: exec the toolkit's spawn_verifier.py. See _shim.py for resolution rules."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _shim import exec_gate  # noqa: E402

if __name__ == "__main__":
    sys.exit(exec_gate("spawn_verifier.py", sys.argv[1:]))
