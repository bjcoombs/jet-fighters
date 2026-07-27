"""Iso-contours of a mask field, and the simplification applied to them.

Two things here, and the second is the one that decides how much of the glass's
detail reaches the atlas.

**Contouring** is marching squares on the signed field from `masks.py` rather
than a walk around the boolean mask's pixel boundary. The photograph resolves
one atlas unit into about 17 px, so a pixel-boundary walk emits a staircase
whose steps are 0.06 units - below anything that matters - but a staircase is
exactly the kind of structure a simplifier has to be coarsened to swallow. The
zero crossing of a lightly smoothed mask is smooth to begin with, so the
tolerance can be set by what the photograph resolves instead of by what the
staircase forces.

**Simplification** is Douglas-Peucker, and the tolerance is a measurement rather
than a preference - see `pick_tolerance` below.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import numpy as np

# Marching-squares case table: for each of the 16 corner configurations, the
# edge pairs the contour crosses. Edges are indexed 0 = top, 1 = right,
# 2 = bottom, 3 = left. Corners are (r, c), (r, c+1), (r+1, c+1), (r+1, c).
_CASES: dict[int, tuple[tuple[int, int], ...]] = {
    1: ((3, 2),),
    2: ((2, 1),),
    3: ((3, 1),),
    4: ((1, 0),),
    5: ((3, 0), (1, 2)),
    6: ((2, 0),),
    7: ((3, 0),),
    8: ((0, 3),),
    9: ((0, 2),),
    10: ((0, 1), (2, 3)),
    11: ((0, 1),),
    12: ((1, 3),),
    13: ((1, 2),),
    14: ((2, 3),),
}


def _edge_point(field: np.ndarray, r: int, c: int, edge: int) -> tuple[float, float]:
    """Linearly interpolated zero crossing on one cell edge, as (x, y)."""
    if edge == 0:
        a, b = field[r, c], field[r, c + 1]
        t = a / (a - b)
        return c + t, float(r)
    if edge == 1:
        a, b = field[r, c + 1], field[r + 1, c + 1]
        t = a / (a - b)
        return float(c + 1), r + t
    if edge == 2:
        a, b = field[r + 1, c], field[r + 1, c + 1]
        t = a / (a - b)
        return c + t, float(r + 1)
    a, b = field[r, c], field[r + 1, c]
    t = a / (a - b)
    return float(c), r + t


def iso_contours(field: np.ndarray, min_area: float) -> list[np.ndarray]:
    """Closed contours of `field == 0`, positive area outside-first.

    Returned as (N, 2) float arrays of (x, y) in the field's own pixel
    coordinates. Winding is consistent - outer boundaries one way, holes the
    other - so the result fills correctly under the canvas's default nonzero
    rule without the caller having to classify them.
    """
    inside = field > 0
    rows, cols = inside.shape
    codes = (
        inside[:-1, :-1].astype(np.uint8) * 8
        + inside[:-1, 1:].astype(np.uint8) * 4
        + inside[1:, 1:].astype(np.uint8) * 2
        + inside[1:, :-1].astype(np.uint8) * 1
    )
    links: dict[tuple[int, int, int], tuple[float, float, tuple[int, int, int]]] = {}
    starts: dict[tuple[int, int, int], None] = {}
    for r, c in zip(*np.nonzero((codes != 0) & (codes != 15))):
        case = int(codes[r, c])
        for entry, exit_ in _CASES[case]:
            key_in = _half_edge(r, c, entry)
            key_out = _half_edge(r, c, exit_)
            point = _edge_point(field, r, c, exit_)
            links[key_in] = (point[0], point[1], key_out)
            starts[key_in] = None

    contours: list[np.ndarray] = []
    seen: set[tuple[int, int, int]] = set()
    for start in starts:
        if start in seen:
            continue
        chain: list[tuple[float, float]] = []
        key = start
        while key in links and key not in seen:
            seen.add(key)
            x, y, key = links[key]
            chain.append((x, y))
        if len(chain) < 4:
            continue
        polygon = np.array(chain, dtype=np.float64)
        if abs(_signed_area(polygon)) < min_area:
            continue
        contours.append(polygon)
    # Down the lane, topmost first. A segment's sub-paths are read in order by
    # anything that wants to name them - the jet-kill burst's upper and lower
    # blob, the colon's two dots - and area order would let a retrace silently
    # swap them when one mark grew past the other.
    contours.sort(key=lambda p: (round(float(p[:, 1].min()), 3), round(float(p[:, 0].min()), 3)))
    return contours


def _half_edge(r: int, c: int, edge: int) -> tuple[int, int, int]:
    """A cell edge named identically from both cells that share it."""
    if edge == 0:
        return (r, c, 0)
    if edge == 1:
        return (r, c + 1, 1)
    if edge == 2:
        return (r + 1, c, 0)
    return (r, c, 1)


def _signed_area(polygon: np.ndarray) -> float:
    x, y = polygon[:, 0], polygon[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def douglas_peucker(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Simplify a closed ring, keeping the two extreme points as anchors."""
    if len(points) < 4:
        return points
    # A closed ring has no natural endpoints. Splitting it at its two most
    # distant vertices gives two open chains whose simplification is
    # independent of where the tracer happened to start.
    distances = np.hypot(*(points - points[0]).T)
    far = int(np.argmax(distances))
    first = _simplify_open(points[: far + 1], tolerance)
    second = _simplify_open(np.vstack([points[far:], points[:1]]), tolerance)
    ring = np.vstack([first[:-1], second[:-1]])
    return ring


def _simplify_open(points: np.ndarray, tolerance: float) -> np.ndarray:
    if len(points) < 3:
        return points
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        start, end = points[lo], points[hi]
        span = end - start
        length = float(np.hypot(*span))
        segment = points[lo + 1 : hi]
        if length < 1e-9:
            deviation = np.hypot(*(segment - start).T)
        else:
            deviation = np.abs(np.cross(span, segment - start)) / length
        index = int(np.argmax(deviation))
        if deviation[index] > tolerance:
            split = lo + 1 + index
            keep[split] = True
            stack.append((lo, split))
            stack.append((split, hi))
    return points[keep]


def max_deviation(original: np.ndarray, simplified: np.ndarray) -> float:
    """Largest distance from any traced vertex to the simplified ring."""
    if len(simplified) < 2:
        return float("inf")
    ring = np.vstack([simplified, simplified[:1]])
    starts, ends = ring[:-1], ring[1:]
    spans = ends - starts
    lengths = np.maximum((spans**2).sum(axis=1), 1e-12)
    worst = 0.0
    for point in original:
        t = np.clip(((point - starts) * spans).sum(axis=1) / lengths, 0.0, 1.0)
        closest = starts + t[:, None] * spans
        worst = max(worst, float(np.hypot(*(point - closest).T).min()))
    return worst
