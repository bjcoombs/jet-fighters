"""Trace the SCORE readout from the bare tube.

The score block is a different structure from the playfield, which is why it is
a module of its own rather than another case in `trace_atlas.py`. The playfield
is a lattice - seven equal cell slots by three equal lanes - and every sprite in
it is named by the cell it stands in. The score block is three printed boxes of
three different sizes, and the marks inside them are named by where they sit
inside a seven-segment digit. Nothing about a cell pitch applies.

What is shared is everything that decides a coordinate: the registration in
`lattice.py`, so a score segment lands in the same atlas space as a jet by the
same printed lattice; the marching-squares contour and the measured
simplification tolerance in `contour.py`; and the doctrine that a mark is named
by where it is rather than by what it looks like.

Three stages:

1. **Find the printed boxes.** Otsu over the score block separates the boxes'
   dark hatched fill from the light surround between and around them; filling
   the holes the phosphor punches in that mask closes the letters back up, and
   the three largest components are the three boxes. Nothing is typed in, and
   the result moves by at most 2 px as the analysis window is swept.
2. **Mask each box.** One threshold, not the playfield's two: the score block
   prints a single pigment - the white/cream one that emits cyan - so the
   blue-minus-red split `masks.py` needs would be Otsu asked a question with one
   answer. `pigment_check` reports the mask's blue-minus-red so that a red mark
   appearing in the score block cannot pass silently.
3. **Name each mark by position.** A seven-segment digit has seven marks in
   seven known places: three bars wider than they are tall - top, middle, bottom
   - and four strokes taller than wide, left and right of each half. That is a
   question about position, which is the form ATLAS-COORDINATES.md records as
   the one that works; ranking by size or by area is the form that fails.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from scipy.ndimage import gaussian_filter

from contour import iso_contours
from masks import EDGE_WIDTH_PX, MESH_LOWPASS_SIGMA, otsu

# The score block, in photograph pixels: everything left of the playfield's
# first printed cell boundary (x = 1697 on this photograph) and inside the
# printed band. Generous on every side - it is swept for the box detection
# below, and the boxes it finds do not depend on where it is cut.
SCORE_REGION = (900, 875, 1690, 1960)

# Smoothing for the box detection only. The boxes are 250-600 px across and the
# feature being found is their fill against the surround, so this is well above
# the mesh period and well below the box.
BOX_SIGMA = 4.0

# Opening radius for the box detection, in px. Removes the leads and the tube
# structure, which are dark but thin, without moving a box edge.
BOX_OPENING = 15

# Smallest phosphor mark kept, in px. One resolution cell squared, the same
# figure `trace_atlas.py` uses on the playfield.
MIN_MARK_AREA = 100.0

# A digit's seven marks, and the only thing that distinguishes a bar from a
# stroke: the aspect ratio of its own bounding box. The printed bars measure
# about 5:1 and the strokes about 1:3, so anything near 1:1 is neither and the
# naming refuses rather than guessing.
BAR_MIN_ASPECT = 1.6
STROKE_MAX_ASPECT = 0.8

SEVEN_SEGMENT_KEYS = ("a", "b", "c", "d", "e", "f", "g")


class ScoreMasks:
    """The phosphor mask inside one printed score box.

    The box's own hatched fill is the background, and there is nothing else in
    the box: no second pigment and no silkscreen rule, both of which are outside
    it. So the pigment split `masks.py` needs on the playfield is not needed
    here - but its **second** split is, and for exactly the reason recorded
    there.

    A single Otsu over the box lands at 148 against a fill near 122 and phosphor
    near 195, because the fill outnumbers the print about nine to one and Otsu
    is pulled toward the larger class. At 148 the bloom between two neighbouring
    letters clears the threshold and `SCORE` masks as one blob. Taking Otsu
    again over the printed pixels alone puts the boundary at 175, which
    separates all five letters and all seven segments - and then the rim between
    the two levels is grown back through the print, limited to the rim's own
    measured width, exactly as `masks.py` does for the cyan playfield segments.
    The score readout is drawn in that same cyan-emitting pigment, so it ends up
    on the same mask boundary convention as every other cyan segment in the
    atlas rather than a stricter one of its own.
    """

    def __init__(self, rgb: np.ndarray, box: tuple[int, int, int, int]):
        x0, y0, x1, y1 = box
        self.box = box
        patch = gaussian_filter(rgb[y0:y1, x0:x1], (MESH_LOWPASS_SIGMA, MESH_LOWPASS_SIGMA, 0))
        red, green, blue = patch[..., 0], patch[..., 1], patch[..., 2]
        self.luma = 0.299 * red + 0.587 * green + 0.114 * blue
        self.blue_minus_red = blue - red

        # The threshold is computed on an inset window and applied to the whole
        # box - the same tight/wide split `masks.py` uses. The box's own edge is
        # a transition into the light surround, and a few hundred pixels of it
        # in the sample drag the threshold down; the inset is twice the
        # photograph's 10 px edge rise, so none of that transition is sampled.
        inset = int(round(2 * EDGE_WIDTH_PX))
        inner = self.luma[inset:-inset, inset:-inset]
        self.print_level = otsu(inner.ravel())
        printed = self.luma > self.print_level
        self.phosphor_level = otsu(self.luma[printed].ravel())

        contrast = float(np.percentile(self.luma, 98) - np.percentile(self.luma, 15))
        self.rim_px = max(
            0, int(round((self.phosphor_level - self.print_level) / max(contrast, 1.0) * EDGE_WIDTH_PX))
        )
        self.phosphor = self._phosphor_at(self.print_level, self.phosphor_level)

    def _phosphor_at(self, print_level: float, phosphor_level: float) -> np.ndarray:
        """The phosphor mask this box would have at a given pair of levels.

        Split out of the constructor so that `uncertainty` can rebuild the mask
        at nudged levels rather than approximate what a nudge would do. The rim
        width is held at the one measured on the committed levels: it is a
        property of how far the print's edge runs, not of where inside that edge
        the threshold was put.
        """
        core = self.luma >= phosphor_level
        if not self.rim_px:
            return core
        grown = ndi.binary_dilation(core, ndi.generate_binary_structure(2, 2), self.rim_px)
        return grown & (self.luma > print_level)

    @property
    def pigment_check(self) -> float:
        """Median blue-minus-red over the masked print.

        The score block is drawn wholly in the cyan-emitting pigment, which
        reads near neutral unlit; the red-emitting one reads around -66 (see
        ATLAS-COORDINATES.md, "Tracing from the bare tube"). A figure down there
        would mean this mask has taken in playfield print, so `trace_atlas.py`
        prints it on every run rather than trusting it.
        """
        if not self.phosphor.any():
            return 0.0
        return float(np.median(self.blue_minus_red[self.phosphor]))

    def marks(self) -> list[np.ndarray]:
        """The separate printed marks in this box, ordered across it.

        A component touching the window's border is the box's own edge rather
        than a printed mark, and is dropped. The phosphor never reaches the
        border: the closest mark on this glass, the units digit's upper-right
        stroke, stands 16 px clear of its box.
        """
        labels, count = ndi.label(self.phosphor, structure=np.ones((3, 3)))
        border = set(
            np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
        )
        out = [
            labels == index
            for index in range(1, count + 1)
            if index not in border and (labels == index).sum() >= MIN_MARK_AREA
        ]
        out.sort(key=lambda m: _extent(m)[0])
        return out

    def uncertainty(self, mask: np.ndarray) -> float:
        """How far this mark's traced boundary moves when the threshold is
        nudged, in photograph pixels.

        The score block's own trace repeatability, and the reason it is worth
        measuring separately: the simplification tolerance is measured on the
        *playfield* probes, and the score block is a dimmer part of the plate
        against a different background, so that the tolerance covers it here is
        a thing to check rather than to assume. `trace_atlas.py` prints it
        beside the tolerance on every run.

        Two things differ from `trace_atlas.trace_uncertainty`, and neither is
        cosmetic:

        **Both levels are nudged.** On the playfield the red segments' boundary
        *is* the print level, so nudging that alone is the whole measurement.
        Here - as for every cyan segment anywhere on the tube - the boundary is
        the rim grown out of the bright core, which the phosphor level sets and
        the print level only caps. Nudging the print level alone would move a
        boundary this trace does not use, and report a repeatability far better
        than the trace actually has.

        **The displacement is measured between traced contours.** An
        area-equivalent radius is not a distance any point on the outline moves,
        and the tolerance it would be compared against is one.

        What the figure is not: it is a nearest-*vertex* distance, and a traced
        contour carries a vertex about every pixel, so it cannot resolve a shift
        much below 1 px and it does not read zero for two coincident contours.
        That is deliberate - it is the same estimator
        `trace_atlas.trace_uncertainty` uses, and the figure exists to be
        compared against the tolerance that one produces, which needs the same
        floor under both. Read it as "no worse than the playfield", not as an
        absolute.
        """
        contrast = float(np.percentile(self.luma, 97) - np.percentile(self.luma, 20))
        reference = iso_contours(_signed_field(mask), MIN_MARK_AREA)
        if not reference:
            return 0.0
        reach = ndi.binary_dilation(mask, ndi.generate_binary_structure(2, 2), 12)
        shifts = []
        for delta in (-0.05 * contrast, 0.05 * contrast):
            nudged = (
                self._phosphor_at(self.print_level + delta, self.phosphor_level + delta) & reach
            )
            moved = iso_contours(_signed_field(nudged), MIN_MARK_AREA)
            if not moved:
                continue
            shifts.append(
                float(np.median([_nearest_distance(reference, p) for p in np.vstack(moved)]))
            )
        return float(np.mean(shifts)) if shifts else 0.0


def _signed_field(mask: np.ndarray) -> np.ndarray:
    """A signed field whose zero crossing is the mask's boundary.

    The same construction `masks.py` contours: the photograph resolves an atlas
    unit into about 17 px, so a half-pixel of contour accuracy is worth having
    and the staircase of a boolean mask's own boundary is not.
    """
    return gaussian_filter(mask.astype(np.float32), 1.0) - 0.5


def _nearest_distance(rings: list[np.ndarray], point: np.ndarray) -> float:
    return min(float(np.hypot(*(ring - point).T).min()) for ring in rings)


def measure_boxes(rgb: np.ndarray) -> dict[str, tuple[int, int, int, int]]:
    """The three printed boxes of the score block, in photograph pixels.

    Measured rather than typed in, and measured off the print rather than off
    the marks inside it - the same rule the cell lattice follows. The phosphor
    punches holes in the fill mask, so the holes are filled before the
    components are taken; without that a digit's box comes back as the ring
    around the digit.

    Returns `label`, `tens` (which also carries the half-digit) and `units`.
    """
    rx0, ry0, rx1, ry1 = SCORE_REGION
    smooth = gaussian_filter(
        0.299 * rgb[ry0:ry1, rx0:rx1, 0]
        + 0.587 * rgb[ry0:ry1, rx0:rx1, 1]
        + 0.114 * rgb[ry0:ry1, rx0:rx1, 2],
        BOX_SIGMA,
    )
    fill = ndi.binary_fill_holes(smooth < otsu(smooth.ravel()))
    fill = ndi.binary_opening(fill, np.ones((BOX_OPENING, BOX_OPENING)))
    labels, count = ndi.label(fill)
    areas = ndi.sum(fill, labels, range(1, count + 1))
    boxes = []
    for index in np.argsort(areas)[::-1][:3]:
        rows, columns = ndi.find_objects(labels)[index]
        boxes.append(
            (columns.start + rx0, rows.start + ry0, columns.stop + rx0, rows.stop + ry0)
        )
    # The label box is the one that sits above the other two; of those two the
    # left one carries the half-digit and the tens, the right one the units.
    boxes.sort(key=lambda b: b[1])
    label = boxes[0]
    digits = sorted(boxes[1:], key=lambda b: b[0])
    return {"label": label, "tens": digits[0], "units": digits[1]}


def _extent(mask: np.ndarray) -> tuple[int, int, int, int]:
    rows, columns = np.nonzero(mask)
    return int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1


def _centroid(mask: np.ndarray) -> tuple[float, float]:
    rows, columns = np.nonzero(mask)
    return float(columns.mean()), float(rows.mean())


def name_seven_segment(marks: list[np.ndarray]) -> dict[str, np.ndarray]:
    """Name a digit's seven marks a-g by where each one sits.

    The classic seven-segment naming: `a` top bar, `b` upper right, `c` lower
    right, `d` bottom bar, `e` lower left, `f` upper left, `g` middle bar. A
    mark is a bar or a stroke by its own aspect ratio - the printed bars measure
    about 5:1 and the strokes about 1:3, so the two classes do not come close to
    meeting - and then the three bars are ordered down the digit and the four
    strokes are split by which half and which side they are in.

    The digits on this glass are italic, so a stroke's left and right are taken
    from its centroid against the *half* it is in rather than against the whole
    digit: the lower half sits about a stroke's width to the left of the upper.

    Raises if the marks do not form a digit, rather than returning six names and
    a shrug - a threshold that has merged two segments is a thing to look at,
    not to absorb.
    """
    if len(marks) != 7:
        raise ValueError(f"a seven-segment digit has seven marks, found {len(marks)}")
    bars, strokes = [], []
    for mark in marks:
        x0, y0, x1, y1 = _extent(mark)
        aspect = (x1 - x0) / (y1 - y0)
        if aspect >= BAR_MIN_ASPECT:
            bars.append(mark)
        elif aspect <= STROKE_MAX_ASPECT:
            strokes.append(mark)
        else:
            raise ValueError(f"a mark of aspect {aspect:.2f} is neither a bar nor a stroke")
    if len(bars) != 3 or len(strokes) != 4:
        raise ValueError(f"expected 3 bars and 4 strokes, found {len(bars)} and {len(strokes)}")
    bars.sort(key=lambda m: _centroid(m)[1])
    named = {"a": bars[0], "g": bars[1], "d": bars[2]}
    middle = _centroid(bars[1])[1]
    upper = sorted((m for m in strokes if _centroid(m)[1] < middle), key=lambda m: _centroid(m)[0])
    lower = sorted((m for m in strokes if _centroid(m)[1] >= middle), key=lambda m: _centroid(m)[0])
    if len(upper) != 2 or len(lower) != 2:
        raise ValueError(f"expected two strokes each side of the middle bar, found {len(upper)} and {len(lower)}")
    named["f"], named["b"] = upper
    named["e"], named["c"] = lower
    return named


def split_tens_box(marks: list[np.ndarray]) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Separate the half-digit's two strokes from the tens digit's seven.

    Nine marks in one box, and the split is positional: the half-digit `1` is
    printed hard against the box's left edge and the seven-segment digit fills
    the rest, so ordering the marks across the box and cutting at the widest gap
    separates them without a threshold. The gap measures about four times the
    widest gap inside the digit, so the cut is not a close call.
    """
    if len(marks) != 9:
        raise ValueError(f"the tens box prints nine marks, found {len(marks)}")
    ordered = sorted(marks, key=lambda m: _extent(m)[0])
    lefts = [_extent(m)[0] for m in ordered]
    rights = [_extent(m)[2] for m in ordered]
    # The gap between mark i and mark i+1, measured against the furthest right
    # edge seen so far so that a tall stroke overlapping a bar cannot open one.
    gaps = [lefts[i + 1] - max(rights[: i + 1]) for i in range(len(ordered) - 1)]
    cut = int(np.argmax(gaps)) + 1
    if cut != 2:
        raise ValueError(f"the half-digit is two strokes; the widest gap left {cut}")
    return ordered[:2], ordered[2:]
