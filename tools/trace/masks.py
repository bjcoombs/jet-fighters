"""Separate printed phosphor from the dark hatched fill, one printed cell at a time.

The plate is not evenly lit, so a single global threshold takes some cells
cleanly and loses others entirely - the reason the masking is per cell is
recorded in `src/machine/tube/ATLAS-COORDINATES.md`, "Tracing from the bare
tube", along with why the threshold is computed over a tight window and applied
to a wide one.

What is new here is the low-pass. The tube's control grid modulates everything
on the face at a 10.83 px period (`docs/evidence/tube-mesh.md`), so a threshold
applied to raw pixels traces the grid's shadow as well as the print, and the
contour then carries ripple at the grid's period that no simplification
tolerance can distinguish from a real feature. Smoothing below the grid's
frequency before thresholding removes it at source. Sigma is 3.0 px: the grid is
attenuated to a fifth of its amplitude while the finest *printed* feature - the
smoke's curls, 20 px and up - is untouched.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from scipy.ndimage import gaussian_filter

# Below the control grid's 10.83 px period, above the finest printed feature.
MESH_LOWPASS_SIGMA = 3.0

# The photograph's 10-90% edge rise, in pixels; `tools/trace/report.py` measures
# it over 601 printed edges. Used here to convert a difference between two
# thresholds into the width of glass that lies between them.
EDGE_WIDTH_PX = 10.0

# How far past the printed cell box the wide window reaches, as a fraction of
# the cell. Sprites sit hard against the box edge in several cells; the gutter
# beyond it is dark, so taking it in costs nothing but lets a sprite that
# overruns its box be traced whole.
WIDE_MARGIN = 0.14


def otsu(values: np.ndarray, bins: int = 256) -> float:
    """Otsu's threshold over a 1-D sample."""
    counts, edges = np.histogram(values, bins=bins)
    centres = 0.5 * (edges[:-1] + edges[1:])
    weight0 = np.cumsum(counts)
    weight1 = counts.sum() - weight0
    valid = (weight0 > 0) & (weight1 > 0)
    cumulative = np.cumsum(counts * centres)
    total = cumulative[-1]
    mean0 = np.where(weight0 > 0, cumulative / np.maximum(weight0, 1), 0.0)
    mean1 = np.where(weight1 > 0, (total - cumulative) / np.maximum(weight1, 1), 0.0)
    between = weight0 * weight1 * (mean0 - mean1) ** 2
    between = np.where(valid, between, -1.0)
    return float(centres[int(np.argmax(between))])


class CellMasks:
    """The two pigment masks for one printed cell, on the wide window."""

    def __init__(self, rgb: np.ndarray, tight: tuple[int, int, int, int], wide: tuple[int, int, int, int]):
        self.wide = wide
        wx0, wy0, wx1, wy1 = wide
        patch = gaussian_filter(rgb[wy0:wy1, wx0:wx1], (MESH_LOWPASS_SIGMA, MESH_LOWPASS_SIGMA, 0))
        red, green, blue = patch[..., 0], patch[..., 1], patch[..., 2]
        self.luma = 0.299 * red + 0.587 * green + 0.114 * blue
        self.blue_minus_red = blue - red

        tx0, ty0, tx1, ty1 = tight
        inner = (slice(ty0 - wy0, ty1 - wy0), slice(tx0 - wx0, tx1 - wx0))
        self.print_level = otsu(self.luma[inner].ravel())

        printed = self.luma > self.print_level
        # Unlit, the yellow pigment (which emits red-orange) measures around -66
        # on blue-minus-red and the white pigment (which emits cyan) around -28
        # against a dark field near zero, so the split lands nowhere near either
        # class. Otsu over the printed pixels of this cell finds it without a
        # constant, which matters because the plate's lighting varies.
        sample = self.blue_minus_red[printed]
        self.pigment_level = otsu(sample) if sample.size > 500 else -45.0

        # **The print on this glass is three things, not two**, and the third one
        # ruins a two-way split. Measured over cell 2's top lane:
        #
        # | | luma | blue-minus-red |
        # | white phosphor | 189 | +3 |
        # | yellow phosphor | 157 | -53 |
        # | silkscreen cell rules | 155 | -3 |
        # | dark glass | 123 | +5 |
        #
        # The silkscreen box rules are as bright as the yellow phosphor and as
        # neutral as the white, so neither channel separates them alone - and a
        # rule that is neither pigment is not a segment. Left in, cell 0's burst
        # takes the box's right-hand rule into its own component and the traced
        # outline runs the full height of the cell.
        #
        # Two thresholds do separate all three: pigment on blue-minus-red, then
        # phosphor from silkscreen on brightness *among the neutral print only*,
        # which is a two-class question Otsu answers without a constant.
        neutral = self.blue_minus_red >= self.pigment_level
        bright = self.luma[printed & neutral]
        self.phosphor_level = otsu(bright) if bright.size > 500 else self.print_level
        self.red = printed & ~neutral
        self.silkscreen = printed & neutral & (self.luma < self.phosphor_level)

        # The brightness split has a cost that has to be paid back: it puts the
        # white phosphor's boundary at `phosphor_level` while the yellow's is at
        # `print_level`, so every cyan segment comes out a few pixels narrower
        # than every red one - it cost the missile dart a fifth of its depth.
        #
        # The rim between the two levels belongs to the phosphor, so it is grown
        # back: a geodesic dilation of the bright core through the neutral print,
        # limited to the rim's own measured width. That is few enough steps that
        # the silkscreen rules cannot be walked down, which is the whole reason
        # the split existed - a rule touching a burst is annexed for three pixels
        # rather than for its full length.
        core = printed & neutral & (self.luma >= self.phosphor_level)
        contrast = float(np.percentile(self.luma, 98) - np.percentile(self.luma, 15))
        rim = int(round((self.phosphor_level - self.print_level) / max(contrast, 1.0) * EDGE_WIDTH_PX))
        self.rim_px = max(0, rim)
        self.cyan = (
            ndi.binary_dilation(core, ndi.generate_binary_structure(2, 2), self.rim_px)
            & printed
            & neutral
            if self.rim_px
            else core
        )

        # A safety net on top of the pixel rule, because **pigment is a property
        # of a printed mark, not of a pixel**: a whole component that reads as the
        # other class in its own core was misfiled, and is dropped rather than
        # traced. `mixed_components` reports any component that is genuinely both,
        # so a red mark merging into a white one cannot pass silently.
        self.mixed_components: list[float] = []
        self.red = self._reject_misfiled(self.red, lambda core: np.median(core) < self.pigment_level)
        self.cyan = self._reject_misfiled(
            self.cyan, lambda core: np.median(core) >= self.pigment_level
        )

    def _reject_misfiled(self, mask: np.ndarray, belongs) -> np.ndarray:
        """Drop components whose core says they are the other pigment."""
        labels, count = ndi.label(mask)
        kept = np.zeros_like(mask)
        for index in range(1, count + 1):
            component = labels == index
            if component.sum() < 25:
                continue
            # The mark's core, not all of it. A thin mark is mostly edge, and its
            # edge mixes pigment with dark glass, which pulls blue-minus-red
            # toward zero - so a whole-area median calls the smoke's narrowest
            # curls white.
            core = component & (self.luma >= np.percentile(self.luma[component], 55))
            sample = self.blue_minus_red[core if core.sum() >= 25 else component]
            if not belongs(sample):
                continue
            kept |= component
            minority = float((sample > self.pigment_level + 15).mean())
            if 0.25 < minority < 0.75:
                self.mixed_components.append(minority)
        return kept

    def field(self, region: str) -> np.ndarray:
        """A signed field whose zero crossing is the pigment boundary.

        Contouring this rather than walking the boolean mask's pixel boundary is
        what puts the outline between pixels instead of on the staircase - the
        photograph resolves an atlas unit into ~17 px, so a half-pixel of
        contour accuracy is worth having and a staircase is not.
        """
        mask = self.red if region == "red" else self.cyan
        return gaussian_filter(mask.astype(np.float32), 1.0) - 0.5
