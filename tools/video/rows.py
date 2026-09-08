"""Do the jets change row while they march, and how?

    python3 tools/video/clip.py ~/Downloads/'jetfighers video.mov' /tmp/jf
    python3 tools/video/rows.py /tmp/jf

`measure.py` answers the questions about *columns* on the same registered clip -
how fast the squadron steps, how fast a missile crosses. This one answers the
question `docs/evidence/owner-entity-model.md` point 4 raises and no instrument
in this repository could reach: "they change row" while approaching.

## Why the two instruments already here cannot answer it

`assets/reference/skill3-video-cells.csv` is the committed reduction, and it is
**cyan** - `cells.py` isolates the tube's blue-green phosphor. The jets are red.
So the CSV, and every drive that reads it, is blind to the squadron by
construction.

`sprites.py`'s linker does read red, and `measure.py` drives it, but it links
with `max_lane_drift=8.0` px against a lane pitch of 21 px. A track that changed
row would be broken in two at the change, and each half reported as a plane that
held one row. That bound is right for what it was written for - a track is a
track because it goes one way - and it makes a row change unreportable.

## What this does instead, and the control it carries

The registered clip's red excess is integrated over a box at each (row, grid) of
the lattice `sprites.py` fits, giving a 3 x 5 brightness grid per frame. A cell
is lit above {@link LIT}; a frame with nothing lit is the tube blanking during a
note and carries no measurement, so it is skipped rather than read as darkness.

An event is a lit cell going dark between two measured frames while a neighbour
lights in the same transition: same grid and a row either side is a ROW CHANGE,
same row and one grid nearer the launcher is a COLUMN STEP.

**No linking, and that is the point.** Nothing here decides which plane is which,
so nothing here can invent a track. What it can still do is find adjacency by
chance, which is what the negative control measures: the same detector is re-run
on a grid whose per-cell series are rolled by independent random offsets, which
keeps every cell's lit fraction and run lengths and destroys only the alignment
between cells. A count that does not stand clear of that has not been measured.

Needs NumPy, SciPy and Pillow, and `clip.py` to have run first. Not part of the
build and never run by `npm test`. Paths in this file are relative to the
repository root.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

import sprites as S  # noqa: E402

FPS = S.FPS

# Brightness above which a cell holds a plane. Sprites read 27-76 in the owner's
# clip and row 2's lit background reads 5-11, so the figure sits in a gap rather
# than on a slope; the counts below are unchanged at 15 and at 25.
LIT = 20.0

# Half-width and half-height of the box summed at each cell centre, in pixels of
# the registered clip. A cell is 39 px wide and 21 px tall on that lattice.
HALF_W, HALF_H = 14, 8

# Playfield grids. Lattice column 0 is grid 1, beside the horizon; lattice column
# 4 is grid 5, the capture line. The launcher sits half a cell further out again
# and is not a grid.
COLUMNS = 5

# Frames a gap may span and still be one transition. The tube blanks for a frame
# or two while a note plays, and a plane either side of such a gap is the same
# plane; a longer gap is two separate stretches of play.
MAX_GAP_FRAMES = 3

# Rolls behind the negative control.
CONTROL_TRIALS = 200
CONTROL_SEED = 20260908


def cell_grid(red: np.ndarray, lattice: S.Lattice) -> np.ndarray:
    """Red excess integrated at every (row, grid) centre, per frame."""
    grid = np.zeros((red.shape[0], 3, COLUMNS))
    for row, y in enumerate(lattice.lanes):
        for column in range(COLUMNS):
            x = lattice.origin + lattice.pitch * column
            box = red[:, int(y - HALF_H):int(y + HALF_H), int(x - HALF_W):int(x + HALF_W)]
            grid[:, row, column] = np.clip(box, 0, None).mean(axis=(1, 2))
    return grid


def events(occupied: np.ndarray) -> list[tuple[str, int, int, int, int, int]]:
    """(kind, frame, row before, grid before, row after, grid after)."""
    measured = [i for i in range(occupied.shape[0]) if occupied[i].any()]
    found = []
    for before, after in zip(measured, measured[1:]):
        if after - before > MAX_GAP_FRAMES:
            continue
        went = [(r, c) for r in range(3) for c in range(COLUMNS)
                if occupied[before, r, c] and not occupied[after, r, c]]
        came = [(r, c) for r in range(3) for c in range(COLUMNS)
                if occupied[after, r, c] and not occupied[before, r, c]]
        for r0, c0 in went:
            for r1, c1 in came:
                if c0 == c1 and abs(r0 - r1) == 1:
                    found.append(("row", after, r0, c0, r1, c1))
                elif r0 == r1 and c1 - c0 == 1:
                    found.append(("column", after, r0, c0, r1, c1))
    return found


def control(occupied: np.ndarray) -> tuple[float, float]:
    """Row changes the same detector finds once the cells are decorrelated."""
    rng = np.random.default_rng(CONTROL_SEED)
    counts = []
    for _ in range(CONTROL_TRIALS):
        rolled = np.empty_like(occupied)
        for row in range(3):
            for column in range(COLUMNS):
                rolled[:, row, column] = np.roll(
                    occupied[:, row, column], int(rng.integers(occupied.shape[0])))
        counts.append(sum(1 for event in events(rolled) if event[0] == "row"))
    trials = np.array(counts, float)
    return float(trials.mean()), float(trials.std(ddof=1))


def gaps_ms(frames: list[int]) -> list[int]:
    return [round((b - a) / FPS * 1000) for a, b in zip(frames, frames[1:])]


def report(work: Path) -> None:
    clip = np.load(work / "frames.npy")
    red, _cyan = S.excess(clip)
    lattice = S.fit_lattice(red)
    print("## Lattice")
    print(f"  {lattice}")

    grid = cell_grid(red, lattice)
    occupied = grid > LIT
    lit_frames = int(occupied.any(axis=(1, 2)).sum())
    found = events(occupied)
    rows = [event for event in found if event[0] == "row"]
    columns = [event for event in found if event[0] == "column"]

    print("\n## What the clip holds")
    print(f"  {grid.shape[0]} frames, {lit_frames} with the tube lit, "
          f"{grid.shape[0] - lit_frames} blanked")
    print(f"  {len(rows)} row changes, {len(columns)} column steps")

    print("\n## Every row change")
    for _kind, frame, row0, column0, row1, _c in rows:
        print(f"  f{frame:4d} {frame / FPS:6.2f}s  grid {column0 + 1}  "
              f"row {row0} -> {row1}  ({'+1' if row1 > row0 else '-1'})")

    print("\n## Every column step")
    for _kind, frame, row0, column0, _r, column1 in columns:
        print(f"  f{frame:4d} {frame / FPS:6.2f}s  row {row0}  "
              f"grid {column0 + 1} -> {column1 + 1}")

    print("\n## The pattern")
    by_grid = {c + 1: sum(1 for e in rows if e[3] == c) for c in range(COLUMNS)}
    up = sum(1 for e in rows if e[4] > e[2])
    print(f"  by grid: {by_grid}")
    print(f"  by direction: +1 {up}, -1 {len(rows) - up}, wrapped 0<->2 0")
    pairs = {"0<->1": sum(1 for e in rows if {e[2], e[4]} == {0, 1}),
             "1<->2": sum(1 for e in rows if {e[2], e[4]} == {1, 2})}
    print(f"  by pair: {pairs}")
    change_frames = sorted({e[1] for e in rows})
    both = sum(1 for f in change_frames if sum(1 for e in rows if e[1] == f) > 1)
    print(f"  {both} of {len(change_frames)} change frames moved both planes")
    print(f"  gaps between row changes  (ms): {gaps_ms(change_frames)}")
    print(f"  gaps between column steps (ms): {gaps_ms(sorted({e[1] for e in columns}))}")

    mean, sd = control(occupied)
    z = (len(rows) - mean) / sd if sd else float("inf")
    print("\n## Negative control")
    print(f"  {CONTROL_TRIALS} rolls: {mean:.1f} +- {sd:.1f} row changes by chance, "
          f"{len(rows)} measured, z = {z:+.1f}")


if __name__ == "__main__":
    report(Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/jf"))
