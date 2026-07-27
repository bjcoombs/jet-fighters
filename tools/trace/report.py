"""Measurements behind the tracer's two free numbers, and where the old atlas lost detail.

    python3 tools/trace/report.py [--baseline <some atlas.json>]

Prints, in order:

* the photograph's resolution limit, re-measured;
* the trace's own repeatability under a threshold nudge - the floor under any
  simplification tolerance;
* a tolerance sweep, vertices against worst-case deviation;
* how far a baseline atlas sits from the unsimplified contour of the same print.

The last one is the interesting measurement, and it is what said that
Douglas-Peucker was *not* where this atlas was losing its detail. Point
`--baseline` at the pre-retrace `atlas.json` (the parent of the commit that
added this directory) and it reads a **median 0.88 units**, against 0.36 for the
coarsest tolerance in the sweep and 0.08 for the tolerance in use - so
simplification could account for at most a tenth of it.

Left at its default it reads the working tree's own atlas, where a residual tail
is expected: rings pared below the minimum area are dropped after
simplification, and the contour vertices of a dropped ring have nothing to
measure against.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d

sys.path.insert(0, str(Path(__file__).parent))

from trace_atlas import (  # noqa: E402
    TOLERANCE_PROBES,
    Tracer,
    _rings_of,
    build,
    geodesic_partition,
    trace_uncertainty,
)


def resolution_limit(rgb: np.ndarray) -> tuple[float, int]:
    """Median 10-90% rise across a printed edge, in pixels."""
    luma = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    widths: list[int] = []
    for y in range(1000, 1880, 3):
        row = gaussian_filter1d(luma[y, 1700:5400], 1.0)
        slope = np.gradient(row)
        for i in range(9, len(row) - 10):
            if slope[i] <= slope[i - 1] or slope[i] <= slope[i + 1] or slope[i] < 8:
                continue
            low, high = row[i - 9 : i - 2].min(), row[i + 2 : i + 10].max()
            step = high - low
            if step < 55:
                continue
            window = row[i - 9 : i + 10]
            below = np.nonzero(window <= low + 0.1 * step)[0]
            above = np.nonzero(window >= low + 0.9 * step)[0]
            if not below.size or not above.size:
                continue
            width = int(above.min() - below.max())
            if 0 < width <= 14:
                widths.append(width)
    return float(np.median(widths)), len(widths)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default=None, help="an atlas.json to measure instead")
    args = parser.parse_args()

    tracer = Tracer()
    px_per_unit = tracer.lattice["px_per_unit_x"]

    limit, count = resolution_limit(tracer.rgb)
    print(f"resolution limit: {limit:.1f} px 10-90% rise over {count} printed edges")
    print(f"                  = {limit / px_per_unit:.3f} atlas units")

    print("\ntrace repeatability under a +-5% threshold nudge:")
    samples = []
    for column, lane, region, name in TOLERANCE_PROBES:
        cell = tracer.masks(column, lane)
        mask = tracer.pigment(column, lane, region)
        claimed = geodesic_partition(mask, tracer.seeds_for([name], mask))[name]
        shift = trace_uncertainty(cell, region, claimed)
        samples.append(shift)
        print(f"  {name:22s} {shift:5.2f} px = {shift / px_per_unit:.3f} atlas units")
    floor = float(np.median(samples))
    print(f"  median {floor:.2f} px = {floor / px_per_unit:.3f} atlas units")

    print("\ntolerance sweep (vertices / worst deviation over all traced segments):")
    for tolerance in (0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0):
        built, _ = build(tracer, tolerance)
        vertices = sum(sum(len(r) for r in rings) for rings, _ in built.values())
        worst = max(deviation for _, deviation in built.values())
        print(
            f"  {tolerance:4.1f} px ({tolerance / px_per_unit:.3f} u):"
            f" {vertices:6d} vertices, worst {worst / px_per_unit:.3f} u"
        )

    baseline = (
        json.loads(Path(args.baseline).read_text()) if args.baseline else tracer.atlas
    )
    print(f"\nwhere {args.baseline or 'the working tree atlas'} sits against the contour:")
    reference, _ = build(tracer, 0.0)
    rows = []
    for segment in baseline["segments"]:
        name = segment["id"]
        if name not in reference:
            continue
        traced = np.vstack(reference[name][0])
        rings = _rings_of(segment["path"])
        if not rings:
            continue
        rows.append((name, _hausdorff(traced, rings), sum(len(r) for r in rings)))
    rows.sort(key=lambda r: -r[1])
    print(f"  median {np.median([r[1] for r in rows]):.3f} u over {len(rows)} segments")
    for name, deviation, vertices in rows[:8]:
        print(f"    {name:24s} {deviation:.3f} u, {vertices} vertices")


def _hausdorff(traced: np.ndarray, rings: list[np.ndarray]) -> float:
    """Worst distance from a traced contour vertex to the baseline outline.

    The baseline's sub-paths are kept apart. Flattening them into one point
    list closes each ring onto the next one's first point, and those bridging
    edges do not exist - a traced vertex measured against one of them reads as
    closer to the baseline than it is, which understates the deviation exactly
    on the multi-mark segments this atlas has most of: the bursts, the colons,
    the sea's glyphs and the smoke.
    """
    ring = np.vstack([np.vstack([r, r[:1]]) for r in rings])
    keep = np.ones(len(ring) - 1, bool)
    cut = -1
    for r in rings[:-1]:
        cut += len(r) + 1
        keep[cut] = False  # the edge from one closed ring to the next
    starts, ends = ring[:-1][keep], ring[1:][keep]
    spans = ends - starts
    lengths = np.maximum((spans**2).sum(axis=1), 1e-12)
    worst = 0.0
    for point in traced:
        t = np.clip(((point - starts) * spans).sum(axis=1) / lengths, 0.0, 1.0)
        closest = starts + t[:, None] * spans
        worst = max(worst, float(np.hypot(*(point - closest).T).min()))
    return worst


if __name__ == "__main__":
    main()
