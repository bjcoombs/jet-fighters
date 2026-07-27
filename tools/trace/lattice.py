"""Register `tube-unlit-full.jpg` against the atlas coordinate space.

The lattice comes from the **print** - the cell boxes silkscreened on the glass -
never from the sprites inside them, for the reason recorded in
`src/machine/tube/ATLAS-COORDINATES.md` ("The lattice comes from the print, not
from the sprites"): deriving cell positions from artwork centroids makes the
artwork define the cells it sits in, so a systematic offset becomes invisible by
construction. That happened once already.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d

Image.MAX_IMAGE_PIXELS = None

PHOTO = "assets/reference/tube-teardown/tube-unlit-full.jpg"

# src/machine/tube/layout.ts, evaluated. FIELD.x / CELL.width / BAND_TOP / CELL.height.
FIELD_X = 95.832
CELL_W = 217.8 / 7  # 31.114285...
BAND_TOP = 113.76
CELL_H = 53.04 / 3  # 17.68

COLUMN_COUNT = 7
LANE_COUNT = 3

# Approximate seeds for the eight printed cell boundaries and four lane borders,
# read off the photograph once. Each is then refined to the gutter's own minimum,
# so the seeds only have to be within a rule's width.
CELL_BOUNDARY_SEEDS = [1700, 2222, 2748, 3272, 3795, 4318, 4845, 5375]
LANE_BOUNDARY_SEEDS = [943, 1268, 1578, 1892]

# Two of the eight vertical boundaries are excluded from the fit, and it is worth
# saying which and why rather than leaving a magic list.
#
# Boundary 1 is cell 0's right-hand rule, and the battleship's dark surround
# reaches it; boundary 7 is the field's outer right border, against the tube's
# end structure rather than against another cell. Both pull a minimum-finder off
# the gutter by tens of pixels. The other six fit a straight lattice to within
# 2.1 px - an eighth of an atlas unit - and predict the two excluded ones at
# 2221 and 5364 against raw readings of 2278 and 5410, which is how they were
# identified as contaminated rather than as evidence of an uneven lattice.
CELL_BOUNDARY_EXCLUDED = (1, 7)

# The same exclusion, for the same reason, on the other axis. Boundaries 1 and 2
# are the dividers *between* lane boxes; 0 and 3 are the cell box's own outer top
# and bottom frame, where the dark run is the frame plus its gap rather than a
# gutter between two equal neighbours. They read 12.9 px and 6.3 px outside the
# lattice the two dividers define, in opposite directions - an asymmetry a real
# lane pitch cannot have, and the tell that they are a different feature.
LANE_BOUNDARY_EXCLUDED = (0, 3)


def load_photo() -> np.ndarray:
    """The tracing source as float RGB."""
    return np.asarray(Image.open(PHOTO).convert("RGB")).astype(np.float32)


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def _gutter_centre(profile: np.ndarray, seed: int, half_width: int) -> float:
    """Sub-pixel centre of the dark gutter around `seed`.

    Each printed boundary is a triple of dark runs - one cell's right rule, the
    gutter between the boxes, the next cell's left rule - and the gutter is by
    far the deepest, so the profile's minimum is on it. A parabola through the
    minimum and its neighbours gives the centre to a fraction of a pixel; the
    profile is detrended first so the plate's uneven lighting cannot tilt it.
    """
    detrended = profile - gaussian_filter1d(profile, 120.0)
    lo, hi = seed - half_width, seed + half_width + 1
    index = int(np.argmin(detrended[lo:hi])) + lo
    x = np.arange(index - 5, index + 6, dtype=np.float64)
    a, b, _ = np.polyfit(x, detrended[index - 5 : index + 6], 2)
    return float(-b / (2 * a))


def measure_lattice(rgb: np.ndarray) -> dict:
    """The printed lattice, sub-pixel, with the residuals it was fitted at."""
    y = luma(rgb)

    # Vertical rules: profiled over the cell band only, so the tube's mounting
    # hardware above and below the print contributes nothing.
    column_profile = gaussian_filter1d(y[960:1860, :].mean(axis=0), 3.0)
    cell_boundaries = np.array([_gutter_centre(column_profile, s, 40) for s in CELL_BOUNDARY_SEEDS])

    # Horizontal rules: profiled across cells 0-6 only, clear of the SCORE block
    # and of the tube's end structure.
    row_profile = gaussian_filter1d(y[:, 1800:5300].mean(axis=1), 3.0)
    lane_boundaries = np.array([_gutter_centre(row_profile, s, 40) for s in LANE_BOUNDARY_SEEDS])

    def fit(values: np.ndarray, used: np.ndarray) -> tuple[float, float, float]:
        index = np.arange(len(values), dtype=np.float64)
        design = np.vstack([index, np.ones_like(index)]).T
        (pitch, origin), *_ = np.linalg.lstsq(design[used], values[used], rcond=None)
        residual = (values - design @ [pitch, origin])[used]
        return float(pitch), float(origin), float(np.abs(residual).max())

    keep_cells = np.ones(len(cell_boundaries), bool)
    keep_cells[list(CELL_BOUNDARY_EXCLUDED)] = False
    keep_lanes = np.ones(len(lane_boundaries), bool)
    keep_lanes[list(LANE_BOUNDARY_EXCLUDED)] = False
    cell_pitch, cell_origin, cell_residual = fit(cell_boundaries, keep_cells)
    lane_pitch, lane_origin, lane_residual = fit(lane_boundaries, keep_lanes)

    return {
        "cell_boundaries": cell_boundaries,
        "lane_boundaries": lane_boundaries,
        "cell_pitch": cell_pitch,
        "cell_origin": cell_origin,
        "cell_residual": cell_residual,
        "lane_pitch": lane_pitch,
        "lane_origin": lane_origin,
        "lane_residual": lane_residual,
        # Photograph pixels per atlas unit, on each axis independently. They
        # differ by a few percent; see "The two-unit border disagreement" in
        # docs/evidence/open-questions.md - the atlas's lane pitch comes from
        # the lit close-ups and its cell pitch from this photograph.
        "px_per_unit_x": cell_pitch / CELL_W,
        "px_per_unit_y": lane_pitch / CELL_H,
    }


class Registration:
    """Photograph pixels <-> atlas units, anchored on the printed lattice."""

    def __init__(self, lattice: dict):
        self.sx = lattice["cell_pitch"] / CELL_W
        self.sy = lattice["lane_pitch"] / CELL_H
        # Printed cell boundary 0 is the left edge of cell 0, which the atlas
        # puts at FIELD.x; printed lane boundary 0 is the top of lane 0, at
        # BAND_TOP.
        self.x0 = lattice["cell_origin"]
        self.y0 = lattice["lane_origin"]

    def to_atlas(self, px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return FIELD_X + (px - self.x0) / self.sx, BAND_TOP + (py - self.y0) / self.sy

    def to_pixels(self, ax: float, ay: float) -> tuple[float, float]:
        return self.x0 + (ax - FIELD_X) * self.sx, self.y0 + (ay - BAND_TOP) * self.sy

    def to_pixels_array(self, ax: np.ndarray, ay: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self.x0 + (ax - FIELD_X) * self.sx, self.y0 + (ay - BAND_TOP) * self.sy

    def cell_box(self, column: int, lane: int) -> tuple[float, float, float, float]:
        """The printed cell's pixel box: (x0, y0, x1, y1)."""
        x0, y0 = self.to_pixels(FIELD_X + column * CELL_W, BAND_TOP + lane * CELL_H)
        x1, y1 = self.to_pixels(FIELD_X + (column + 1) * CELL_W, BAND_TOP + (lane + 1) * CELL_H)
        return x0, y0, x1, y1


if __name__ == "__main__":
    rgb = load_photo()
    lattice = measure_lattice(rgb)
    print("printed cell boundaries:", np.round(lattice["cell_boundaries"], 1).tolist())
    print(
        f"  pitch {lattice['cell_pitch']:.2f} px  origin {lattice['cell_origin']:.1f}"
        f"  max residual {lattice['cell_residual']:.1f} px"
        f"  -> {lattice['px_per_unit_x']:.3f} px/unit"
    )
    print("printed lane boundaries:", np.round(lattice["lane_boundaries"], 1).tolist())
    print(
        f"  pitch {lattice['lane_pitch']:.2f} px  origin {lattice['lane_origin']:.1f}"
        f"  max residual {lattice['lane_residual']:.1f} px"
        f"  -> {lattice['px_per_unit_y']:.3f} px/unit"
    )
