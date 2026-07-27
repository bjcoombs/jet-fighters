"""Render the atlas beside the photograph it was traced from, at matched scale.

    python3 tools/trace/preview.py <out.png> [--cells 0,2,6] [--before <atlas.json>]

Three panels per cell, all resampled to the same atlas units per pixel, in the
shape `docs/evidence/tube-mesh-comparison.jpg` established: the atlas as
committed, the atlas as this working tree has it, and the bare tube. Comparing
against the glass at matched magnification is the only check that catches an
outline that is self-consistently wrong.

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

sys.path.insert(0, str(Path(__file__).parent))

from lattice import (  # noqa: E402
    BAND_TOP,
    CELL_H,
    CELL_W,
    FIELD_X,
    Registration,
    load_photo,
    measure_lattice,
)

PIXELS_PER_UNIT = 17.2  # docs/evidence/tube-mesh.md, so panels match that figure
FILL = {"red": (222, 178, 58), "cyan": (226, 226, 220)}
BACKGROUND = (34, 38, 40)


def rings_of(path: str) -> list[np.ndarray]:
    out = []
    for chunk in path.split("M")[1:]:
        points = [
            (float(m[1]), float(m[2]))
            for m in re.finditer(r"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)", chunk)
        ]
        if len(points) >= 3:
            out.append(np.array(points))
    return out


def render(atlas: dict, column: int, scale: float) -> Image.Image:
    x0 = FIELD_X + column * CELL_W
    y0 = BAND_TOP
    width = int(CELL_W * scale)
    height = int(3 * CELL_H * scale)
    image = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(image)
    for segment in atlas["segments"]:
        bounds = segment["bounds"]
        if not (x0 - CELL_W / 2 < bounds["x"] + bounds["width"] / 2 < x0 + 1.5 * CELL_W):
            continue
        for ring in rings_of(segment["path"]):
            pixels = [((x - x0) * scale, (y - y0) * scale) for x, y in ring]
            draw.polygon(pixels, fill=FILL[segment["colorRegion"]])
    return image


def photograph(rgb: np.ndarray, registration: Registration, column: int, scale: float) -> Image.Image:
    x0, y0 = registration.to_pixels(FIELD_X + column * CELL_W, BAND_TOP)
    x1, y1 = registration.to_pixels(FIELD_X + (column + 1) * CELL_W, BAND_TOP + 3 * CELL_H)
    crop = Image.fromarray(rgb[int(y0) : int(y1), int(x0) : int(x1)].astype(np.uint8))
    return crop.resize((int(CELL_W * scale), int(3 * CELL_H * scale)), Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out")
    parser.add_argument("--cells", default="0,2,6")
    parser.add_argument("--before", default=None, help="an earlier atlas.json to put first")
    args = parser.parse_args()

    rgb = load_photo()
    registration = Registration(measure_lattice(rgb))
    current = json.loads(Path("src/machine/tube/atlas.json").read_text())
    before = json.loads(Path(args.before).read_text()) if args.before else None

    columns = [int(c) for c in args.cells.split(",")]
    panels: list[list[Image.Image]] = []
    for column in columns:
        row = []
        if before:
            row.append(render(before, column, PIXELS_PER_UNIT))
        row.append(render(current, column, PIXELS_PER_UNIT))
        row.append(photograph(rgb, registration, column, PIXELS_PER_UNIT))
        panels.append(row)

    gap = 12
    per_row = max(len(r) for r in panels)
    panel_w = max(p.width for row in panels for p in row)
    panel_h = max(p.height for row in panels for p in row)
    sheet = Image.new(
        "RGB",
        (per_row * panel_w + (per_row + 1) * gap, len(panels) * panel_h + (len(panels) + 1) * gap),
        (16, 16, 18),
    )
    for r, row in enumerate(panels):
        for c, panel in enumerate(row):
            sheet.paste(panel, (gap + c * (panel_w + gap), gap + r * (panel_h + gap)))
    sheet.save(args.out)
    print(f"wrote {args.out} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
