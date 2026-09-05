#!/usr/bin/env python3
"""Rectify the case photographs into textures the model wears.

    python3 tools/model/photos.py

For the front and the back, four pixel reads in ``pixels.json`` (``textures``) say
where known face coordinates fall in the photograph; a homography from those to the
face's millimetre frame turns the photograph into an image whose pixels are face
millimetres, top-left at the module's top-left corner. The Blender script projects
that image onto the shell's outward faces, so the moulded stipple, the printed
ON/OFF, the moulded 1/2/3, the sticker and the back label are the photograph's own
pixels and stay sharp when the camera comes close.

Output: ``tools/model/textures/front.jpg`` and ``back.jpg``, PIXELS_PER_MM across the
whole face, JPEG. Generated and committed, so the Blender step needs no image
library. Regenerate after changing a read.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PIXELS = json.loads((ROOT / "tools/model/pixels.json").read_text())
DIMS = json.loads((ROOT / "tools/model/dimensions.json").read_text())["dimensions"]
OUT = ROOT / "tools/model/textures"

PIXELS_PER_MM = 9
JPEG_QUALITY = 84


def homography(src: list[list[float]], dst: list[list[float]]) -> np.ndarray:
    """The 3x3 map taking each src (x, y) to its dst (x, y). Four correspondences."""
    a = []
    b = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b += [u, v]
    h = np.linalg.solve(np.array(a, float), np.array(b, float))
    return np.append(h, 1.0).reshape(3, 3)


def rectify(photo: Path, corners_px: list[list[float]], corners_mm: list[list[float]], width_mm: float, height_mm: float) -> Image.Image:
    """Warp so that face millimetres map to pixels at PIXELS_PER_MM."""
    w = round(width_mm * PIXELS_PER_MM)
    h = round(height_mm * PIXELS_PER_MM)
    dst = [[x * PIXELS_PER_MM, y * PIXELS_PER_MM] for x, y in corners_mm]
    # PIL wants the map from output pixels back to input pixels.
    inv = homography(dst, corners_px)
    coeffs = (inv / inv[2, 2]).flatten()[:8]
    im = Image.open(photo).convert("RGB")
    return im.transform((w, h), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    width = DIMS["case.width"]["value"]
    # The whole silhouette: the wings hang below the module's bottom edge.
    height = DIMS["case.wing_top_below_module_top"]["value"] + DIMS["case.wing_height"]["value"]
    for side in ("front", "back"):
        spec = PIXELS["textures"][side]
        im = rectify(ROOT / spec["file"], spec["corners_px"], spec["corners_mm"], width, height)
        target = OUT / f"{side}.jpg"
        im.save(target, quality=JPEG_QUALITY, optimize=True)
        print(f"wrote {target.relative_to(ROOT)} {im.size[0]}x{im.size[1]} ({target.stat().st_size} bytes)")
    # The plastic's colour, for the faces the photographs do not cover: the mean of
    # the module's face above the window, left of the tab, where the light is even.
    front = np.array(Image.open(OUT / "front.jpg").convert("RGB")).astype(float)
    module = DIMS["face.module_x"]["value"]
    y0, y1 = 6 * PIXELS_PER_MM, 26 * PIXELS_PER_MM
    x0, x1 = round((module[0] + 8) * PIXELS_PER_MM), round((module[0] + 40) * PIXELS_PER_MM)
    mean = front[y0:y1, x0:x1].reshape(-1, 3).mean(0)
    colour = "#%02x%02x%02x" % tuple(int(round(c)) for c in mean)
    (OUT / "plastic.json").write_text(json.dumps({"red_abs_srgb": colour, "sampled": "front.jpg, module face above the window, face x module+8..40 mm, y 6-26 mm"}, indent=2) + "\n")
    print(f"plastic red {colour}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
