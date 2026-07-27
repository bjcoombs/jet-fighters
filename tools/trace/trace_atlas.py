"""Retrace every playfield segment from the bare tube, and write `atlas.json`.

    python3 tools/trace/trace_atlas.py               # dry run: counts and notes
    python3 tools/trace/trace_atlas.py --write       # rewrite src/machine/tube/atlas.json

Needs NumPy, SciPy and Pillow. It is a developer tool, not part of the build or
of CI: nothing in `src/` or `tools/hmasm/` imports it and `npm test` never runs
it. What it produces is data, and that data is reviewed as data.

Run it from the repository root. Its two inputs - the photograph and the frozen
naming prior in `seeds.json` - are both fixed, and nothing here is random, so a
run against an unmodified tree reproduces the committed `atlas.json` byte for
byte. That is what makes the output reviewable as data.

The pipeline, and where each stage's decisions are justified:

1. **Register** the photograph against the atlas on the printed cell lattice -
   `lattice.py`, and `ATLAS-COORDINATES.md` on why the lattice may not come from
   the sprites.
2. **Mask** each printed cell for its three kinds of print - `masks.py`.
3. **Name** each mark by growing it from where the segment is already known to
   be, so that a threshold is never asked which sprite it is looking at.
4. **Contour** the masks at sub-pixel accuracy and **simplify** at a tolerance
   measured on the run - `contour.py` and `measure_tolerance` below.

`report.py` re-measures every free number the four stages depend on.
`preview.py` puts the result beside the glass at matched magnification, which is
the check that catches an outline that is self-consistently wrong.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).parent))

from contour import _signed_area, douglas_peucker, iso_contours, max_deviation  # noqa: E402
from lattice import Registration, load_photo, measure_lattice  # noqa: E402
from masks import WIDE_MARGIN, CellMasks  # noqa: E402

ATLAS = Path("src/machine/tube/atlas.json")

# Where each segment is *already known* to be, frozen at the teardown retrace.
#
# The tracer needs a prior to attach names to marks with, and the obvious source
# is `atlas.json` itself - which would make the tool read its own output, so a
# second run would seed from the first and the atlas would wander. It only moved
# 0.06 units on the second pass, well under the 0.083-unit tolerance, but a tool
# whose output depends on how many times it has been run is not one whose data
# can be reviewed.
#
# So the prior is a frozen snapshot instead, at one decimal place because all it
# has to say is which mark is the dart. It is not evidence and it is not
# geometry - every outline in it was superseded by the run that created this
# file. Replace it only to *rename* something, never to reshape it.
SEEDS = Path("tools/trace/seeds.json")

# The photograph's own resolution limit: printed edges rise 10-90% over a median
# of 10.0 px (601 edges sampled across the playfield, `--report` re-measures it).
# Nothing finer than this is a resolved printed feature - it is the lens and the
# sensor. Note it lands within 8% of the control grid's 10.83 px period, which is
# why `docs/evidence/tube-mesh.md` finds the grid smeared into a sinusoid rather
# than resolved as webs.
RESOLUTION_LIMIT_PX = 10.0

# Smallest component kept, in px. One resolution cell squared: below this a blob
# cannot be a printed mark, only grain.
MIN_COMPONENT_AREA = RESOLUTION_LIMIT_PX**2

# How far from a segment's prior outline a mask pixel may still be seeded for
# it, in photograph pixels. 30 px is 1.8 atlas units, which covers the prior's
# median 1.2-unit drift from this trace with room to spare and is well inside
# the ~9-unit gaps between the marks in a cell.
SEED_REACH = 30.0

# The segments the simplification tolerance is measured on: one per distinct
# shape class the tube prints - an aircraft, a spiky white burst, a long low
# hull, a solid yellow starburst with loose curls beside it. The tolerance is
# their median trace repeatability and is computed at run time, never typed in;
# see `measure_tolerance` below for what that means and why it is not a knob.
TOLERANCE_PROBES = (
    (2, 1, "red", "jet_lane1_col2"),
    (2, 1, "cyan", "burst_lane1_col2"),
    (0, 1, "red", "battleship_lane1"),
    (6, 1, "red", "capture_lane1"),
)

# Segments whose outlines are not on this photograph and are left alone: the
# score readout is v1's shape tables and the SCORE label is a block, per
# ATLAS-COORDINATES.md, "Shapes, and where each one comes from".
UNTRACED_PREFIXES = ("score_",)


def cell_of(segment_id: str) -> int | None:
    """Which printed cell a segment is drawn in, or None for the score readout."""
    if segment_id.startswith(UNTRACED_PREFIXES):
        return None
    marker = segment_id.split("_col")
    if len(marker) == 2:
        return int(marker[1])
    if segment_id.startswith(("battleship", "sea")):
        return 0
    return 6


def lane_of(segment_id: str) -> int:
    return int(segment_id.split("_lane")[1][0])


def _rings_of(path: str) -> list[np.ndarray]:
    """The sub-paths of an SVG polygon path, as arrays of atlas-unit points."""
    rings = []
    for chunk in path.split("M")[1:]:
        points = [
            (float(m[1]), float(m[2]))
            for m in re.finditer(r"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)", chunk)
        ]
        if len(points) >= 3:
            rings.append(np.array(points))
    return rings


# Decimal places kept on a coordinate. 0.01 atlas units is 0.17 px on the
# tracing photograph - eight times finer than the trace's own 1.4 px
# repeatability and twenty times finer than the simplification tolerance - so it
# is below anything this measurement can distinguish. The four places the atlas
# used to carry cost 20 kB of the shipped bundle to record noise.
COORDINATE_PLACES = 2


def format_number(value: float) -> str:
    return f"{round(value, COORDINATE_PLACES):g}"


def to_path(rings: list[np.ndarray]) -> str:
    parts = []
    for ring in rings:
        points = [f"{format_number(x)},{format_number(y)}" for x, y in ring]
        parts.append("M " + " L ".join(points) + " Z")
    return " ".join(parts)


def bounds_of(rings: list[np.ndarray]) -> dict[str, float]:
    """The axis-aligned box of the rings *as written*, so `bounds` cannot drift.

    Rounded coordinates first, then the box of those - consumers trust `bounds`
    rather than parsing the path, and a box measured before rounding would sit a
    hundredth of a unit inside the shape it claims to contain.
    """
    stacked = np.round(np.vstack(rings), COORDINATE_PLACES)
    x0, y0 = stacked.min(axis=0)
    x1, y1 = stacked.max(axis=0)
    return {
        "x": round(float(x0), COORDINATE_PLACES),
        "y": round(float(y0), COORDINATE_PLACES),
        "width": round(float(x1 - x0), COORDINATE_PLACES),
        "height": round(float(y1 - y0), COORDINATE_PLACES),
    }


def geodesic_partition(mask: np.ndarray, seeds: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Split `mask` between named seeds by distance measured *inside* the mask.

    Two of the six printed families in a jet cell touch at a neck - the missile
    dart runs into the upper burst blob in about half the cells, and a colon dot
    into the jet's nose in others - so connected components do not name them and
    a threshold sweep cannot be made to, which ATLAS-COORDINATES.md records after
    it was tried.

    Growing each family outward from a seed *through the mask* cuts a merged pair
    at its own narrowest point rather than at the seed box's edge, so the split
    is where the print thins rather than where the previous atlas guessed. The
    seed says which sprite; the print says where the boundary is.
    """
    claimed = {name: seed.copy() for name, seed in seeds.items()}
    frontier = {name: seed.copy() for name, seed in seeds.items()}
    taken = np.zeros_like(mask)
    for seed in seeds.values():
        taken |= seed
    structure = ndi.generate_binary_structure(2, 2)
    while True:
        grew = False
        for name in claimed:
            if not frontier[name].any():
                continue
            grown = ndi.binary_dilation(frontier[name], structure) & mask & ~taken
            if not grown.any():
                frontier[name][:] = False
                continue
            claimed[name] |= grown
            frontier[name] = grown
            taken |= grown
            grew = True
        if not grew:
            break
    return claimed


def trace_uncertainty(cell: CellMasks, region: str, claimed: np.ndarray) -> float:
    """How far this outline moves when the threshold is nudged, in pixels.

    The trace's own repeatability, and the floor under any simplification
    tolerance: a tolerance below it is fitting the choice of threshold rather
    than the glass. Measured by re-masking at the print level plus and minus 5%
    of this cell's print-to-field contrast and taking the median displacement of
    the boundary.
    """
    contrast = float(np.percentile(cell.luma, 97) - np.percentile(cell.luma, 20))
    base = ndi.gaussian_filter(claimed.astype(np.float32), 1.0) - 0.5
    reference = iso_contours(base, MIN_COMPONENT_AREA)
    if not reference:
        return 0.0
    shifts = []
    for delta in (-0.05 * contrast, 0.05 * contrast):
        nudged = (cell.luma > cell.print_level + delta) & claimed_region(cell, region)
        nudged &= ndi.binary_dilation(claimed, ndi.generate_binary_structure(2, 2), 12)
        field = ndi.gaussian_filter(nudged.astype(np.float32), 1.0) - 0.5
        moved = iso_contours(field, MIN_COMPONENT_AREA)
        if not moved:
            continue
        shifts.append(np.median([_nearest_distance(reference, p) for p in np.vstack(moved)]))
    return float(np.mean(shifts)) if shifts else 0.0


def claimed_region(cell: CellMasks, region: str) -> np.ndarray:
    return (
        cell.blue_minus_red < cell.pigment_level
        if region == "red"
        else cell.blue_minus_red >= cell.pigment_level
    )


def _nearest_distance(rings: list[np.ndarray], point: np.ndarray) -> float:
    return min(float(np.hypot(*(ring - point).T).min()) for ring in rings)


class Tracer:
    def __init__(self) -> None:
        self.rgb = load_photo()
        self.lattice = measure_lattice(self.rgb)
        self.registration = Registration(self.lattice)
        self.atlas = json.loads(ATLAS.read_text())
        self.seeds = json.loads(SEEDS.read_text())
        self._cache: dict[tuple[int, int], CellMasks] = {}

    def masks(self, column: int, lane: int) -> CellMasks:
        key = (column, lane)
        if key not in self._cache:
            reg = self.registration
            tx0, ty0, tx1, ty1 = reg.cell_box(column, lane)
            mx = (tx1 - tx0) * WIDE_MARGIN
            my = (ty1 - ty0) * WIDE_MARGIN
            tight = (int(tx0), int(ty0), int(tx1), int(ty1))
            wide = (int(tx0 - mx), int(ty0 - my), int(tx1 + mx), int(ty1 + my))
            self._cache[key] = CellMasks(self.rgb, tight, wide)
        return self._cache[key]

    def pigment(self, column: int, lane: int, region: str) -> np.ndarray:
        """One pigment's mask for one cell, trimmed to this lane's own print.

        The wide window reaches into the lanes above and below so that a sprite
        sitting hard against its box edge is traced whole; a component whose
        centre of mass lands in the next lane belongs to that lane and is
        dropped here.
        """
        cell = self.masks(column, lane)
        mask = (cell.red if region == "red" else cell.cyan).copy()
        wx0, wy0, _, _ = cell.wide
        tx0, ty0, tx1, ty1 = self.registration.cell_box(column, lane)
        labels, count = ndi.label(mask)
        for index in range(1, count + 1):
            component = labels == index
            if component.sum() < MIN_COMPONENT_AREA:
                mask &= ~component
                continue
            ys, xs = np.nonzero(component)
            cy, cx = ys.mean() + wy0, xs.mean() + wx0
            if not (ty0 - 2 < cy < ty1 + 2 and tx0 - 30 < cx < tx1 + 30):
                mask &= ~component
        return mask

    def seed_shape(self, segment_id: str, shape: tuple[int, int]) -> np.ndarray:
        """The segment's frozen prior outline, rasterised into the cell's window.

        Naming, and only naming. Every identification in the atlas was settled by
        evidence recorded in ATLAS-COORDINATES.md - which burst is the capture and
        which the rocket, which of the three white shapes is the dart - and a
        retrace has no business relitigating them from a threshold.

        The *outline* is used rather than the bounding box, because several of
        these families are two or more separate marks - the colon's two dots, the
        burst's two blobs, the sea's row of wave glyphs - and their box is mostly
        the dark glass between them. A box seed puts the colon's name on the
        fuselage it straddles and the burst's name on the dart between its blobs,
        which is how the first attempt at this went wrong.
        """
        cell = self.masks(cell_of(segment_id), lane_of(segment_id))
        wx0, wy0, _, _ = cell.wide
        canvas = Image.new("1", (shape[1], shape[0]), 0)
        draw = ImageDraw.Draw(canvas)
        for ring in _rings_of(self.seeds[segment_id]):
            px, py = self.registration.to_pixels_array(ring[:, 0], ring[:, 1])
            draw.polygon(list(zip(px - wx0, py - wy0)), fill=1)
        return np.asarray(canvas, dtype=bool)

    def seeds_for(self, families: list[str], mask: np.ndarray) -> dict[str, np.ndarray]:
        """Where in `mask` each family starts growing from.

        A mask pixel is seeded for whichever family's prior outline is nearest,
        provided that outline is within `SEED_REACH` - the prior sits a median
        1.2 atlas units from where this trace puts the same print, so the reach
        has to cover that drift without letting one family claim a mark on the
        far side of the cell.
        """
        distances = {
            family: ndi.distance_transform_edt(~self.seed_shape(family, mask.shape))
            for family in families
        }
        stacked = np.stack([distances[f] for f in families])
        nearest = stacked.argmin(axis=0)
        seeds = {}
        for index, family in enumerate(families):
            seeds[family] = mask & (nearest == index) & (stacked[index] < SEED_REACH)
        return seeds

    def rings_for(self, segment_id: str, claimed: np.ndarray, tolerance_px: float):
        """Contour and simplify one segment's claimed pixels, in atlas units."""
        cell = self.masks(cell_of(segment_id), lane_of(segment_id))
        wx0, wy0, _, _ = cell.wide
        field = ndi.gaussian_filter(claimed.astype(np.float32), 1.0) - 0.5
        traced = iso_contours(field, MIN_COMPONENT_AREA)
        rings, deviation = [], 0.0
        for ring in traced:
            simple = douglas_peucker(ring, tolerance_px)
            # The area test is applied again after simplification, not only
            # before it: a mark just over the threshold can be pared below it,
            # and what is left is a three-vertex sliver that draws as nothing and
            # reads in the data as a sub-path someone has to account for.
            if len(simple) < 4 or abs(_signed_area(simple)) < MIN_COMPONENT_AREA:
                continue
            deviation = max(deviation, max_deviation(ring, simple))
            ax, ay = self.registration.to_atlas(simple[:, 0] + wx0, simple[:, 1] + wy0)
            rings.append(np.column_stack([ax, ay]))
        return rings, deviation


def build(tracer: Tracer, tolerance_px: float) -> tuple[dict, list[str]]:
    """Every traced segment's rings, plus the notes the run wants reported."""
    notes: list[str] = []
    result: dict[str, tuple] = {}
    for column in range(7):
        for lane in range(3):
            for region in ("red", "cyan"):
                families = [
                    s["id"]
                    for s in tracer.atlas["segments"]
                    if s["colorRegion"] == region
                    and cell_of(s["id"]) == column
                    and not s["id"].startswith(UNTRACED_PREFIXES)
                    and lane_of(s["id"]) == lane
                ]
                if not families:
                    continue
                mask = tracer.pigment(column, lane, region)
                seeds = tracer.seeds_for(families, mask)
                empty = [family for family, seed in seeds.items() if not seed.any()]
                for family in empty:
                    notes.append(f"{family}: no print under its known position")
                    del seeds[family]
                if not seeds:
                    continue
                claims = geodesic_partition(mask, seeds)
                _absorb_smoke(tracer, column, lane, region, mask, claims)
                notes += _absorb_strays(mask, claims)
                for family, claimed in claims.items():
                    if not claimed.any():
                        notes.append(f"{family}: nothing claimed it - kept its previous outline")
                        continue
                    rings, deviation = tracer.rings_for(family, claimed, tolerance_px)
                    if not rings:
                        # Every ring pared below the minimum area by the
                        # simplifier. It cannot happen at a measured tolerance
                        # and does at `--tolerance 40`, which is what the flag is
                        # for; a sweep that ends in a stack trace teaches nobody
                        # anything, so the segment keeps its outline and says so.
                        notes.append(f"{family}: simplified away entirely - kept its outline")
                        continue
                    result[family] = (rings, deviation)
    return result, notes


def _absorb_strays(mask: np.ndarray, claims: dict[str, np.ndarray]) -> list[str]:
    """Give any mark nothing seeded to whichever family it sits nearest.

    A mark further than `SEED_REACH` from every committed outline gets no seed,
    and nothing grows into it because it touches nothing. That is the right
    default - a stray should not be quietly annexed - but it must not silently
    disappear either, so each one is assigned to the nearest claim and reported.
    """
    taken = np.zeros_like(mask)
    for claimed in claims.values():
        taken |= claimed
    strays, count = ndi.label(mask & ~taken)
    if count == 0:
        return []
    distances = {
        name: ndi.distance_transform_edt(~claimed) for name, claimed in claims.items() if claimed.any()
    }
    if not distances:
        return []
    notes = []
    for index in range(1, count + 1):
        component = strays == index
        nearest = min(distances, key=lambda name: distances[name][component].min())
        gap = distances[nearest][component].min()
        claims[nearest] |= component
        notes.append(
            f"{nearest}: absorbed an unseeded mark of {int(component.sum())} px, "
            f"{gap:.0f} px away"
        )
    return notes


def _absorb_smoke(
    tracer: Tracer,
    column: int,
    lane: int,
    region: str,
    mask: np.ndarray,
    claims: dict[str, np.ndarray],
) -> None:
    """Give the player cell's unclaimed left-hand print to the capture burst.

    This is the point of the retrace rather than a convenience. The player's cell
    prints four things per lane: the capture starburst low on the left, the
    rocket starburst high on the right, the cyan launcher low on the right, and
    **the smoke** - a loose knot of about eleven separate curl marks - high on the
    left. No revision of the atlas has ever carried the smoke, so it has no known
    position to seed from and the geodesic partition leaves it unclaimed: the
    curls do not touch either starburst, so nothing grows into them.

    It belongs to the capture burst. `docs/evidence/open-questions.md` 5a records
    the owner's lit photograph showing the curls glowing in the same event as the
    starburst beside them, as one connected region. So red print in cell 6 left of
    the cell's midline goes to `capture_lane*` - the same left/right discriminator
    that told the two bursts apart in the first place, and the axis the evidence
    is strongest on.
    """
    if column != 6 or region != "red":
        return
    capture = f"capture_lane{lane}"
    if capture not in claims:
        return
    taken = np.zeros_like(mask)
    for claimed in claims.values():
        taken |= claimed
    unclaimed = mask & ~taken
    if not unclaimed.any():
        return
    wx0, _, _, _ = tracer.masks(column, lane).wide
    x0, _, x1, _ = tracer.registration.cell_box(column, lane)
    midline = int((x0 + x1) / 2 - wx0)
    left = np.zeros_like(mask)
    left[:, :midline] = True
    claims[capture] |= unclaimed & left


def measure_tolerance(tracer: Tracer) -> float:
    """The Douglas-Peucker tolerance, in photograph pixels, as a measurement.

    A tolerance chosen by eye is a knob, and the atlas already carries one
    cautionary tale about a judgement frozen into data. This one is bracketed
    from both sides by things that were measured:

    * **Floor.** Nudge the print threshold by +-5% of the cell's own
      print-to-field contrast and the traced boundary moves by about 1.3 px.
      Below that, a simplifier is encoding which threshold the run happened to
      pick, not the shape on the glass. So the tolerance is set *at* the floor:
      it discards nothing the trace can distinguish from its own repeatability.
    * **Ceiling, for the check.** The finest real feature the glass has is the
      control grid's 0.63-unit row spacing (`docs/evidence/tube-mesh.md`), and
      the photograph resolves an edge no finer than 0.59 units. The measured
      floor comes out around 0.076 units - eight times finer than either - so
      there is a wide margin between what is kept and what could possibly be a
      feature. A tolerance that approached the ceiling would be the one to argue
      about.
    """
    shifts = []
    for column, lane, region, name in TOLERANCE_PROBES:
        cell = tracer.masks(column, lane)
        mask = tracer.pigment(column, lane, region)
        claimed = geodesic_partition(mask, tracer.seeds_for([name], mask))[name]
        shifts.append(trace_uncertainty(cell, region, claimed))
    return float(np.median(shifts))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="rewrite src/machine/tube/atlas.json")
    parser.add_argument("--tolerance", type=float, default=None, help="Douglas-Peucker px")
    args = parser.parse_args()

    tracer = Tracer()
    lattice = tracer.lattice
    print(
        f"lattice: cell pitch {lattice['cell_pitch']:.2f} px (max residual "
        f"{lattice['cell_residual']:.1f}), lane pitch {lattice['lane_pitch']:.2f} px "
        f"(max residual {lattice['lane_residual']:.1f})"
    )
    print(
        f"         {lattice['px_per_unit_x']:.3f} px/unit across, "
        f"{lattice['px_per_unit_y']:.3f} down"
    )

    if args.tolerance is not None:
        tolerance = args.tolerance
        print(f"tolerance: {tolerance:.2f} px, overridden on the command line")
    else:
        tolerance = measure_tolerance(tracer)
        print(
            f"tolerance: {tolerance:.2f} px = "
            f"{tolerance / lattice['px_per_unit_x']:.3f} atlas units, measured"
        )

    built, notes = build(tracer, tolerance)
    total_before = 0
    total_after = 0
    worst = 0.0
    for segment in tracer.atlas["segments"]:
        before = segment["path"].count("L") + segment["path"].count("M")
        total_before += before
        if segment["id"] not in built:
            total_after += before
            continue
        rings, deviation = built[segment["id"]]
        worst = max(worst, deviation / lattice["px_per_unit_x"])
        total_after += sum(len(r) for r in rings)
        segment["path"] = to_path(rings)
        segment["bounds"] = bounds_of(rings)
    print(f"vertices: {total_before} -> {total_after}")
    print(f"worst simplification deviation: {worst:.3f} atlas units")
    for note in notes:
        print("note:", note)

    if args.write:
        ATLAS.write_text(json.dumps(tracer.atlas, indent=2) + "\n")
        print(f"wrote {ATLAS}")


if __name__ == "__main__":
    main()
