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

from score import measure_boxes  # noqa: E402
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
    """The sub-paths of an atlas `path`, as arrays of atlas-unit points.

    Traced outlines are `M x,y L x,y ... Z` and need nothing but the coordinate
    pairs. `H` and `V` are here for the *older* atlases this tool is pointed at
    with `--before`: v1's hand-authored score digits were axis-aligned
    rectangles written with them, and a parser that reads only pairs renders
    each one as a single point - which is a blank left-hand panel, and a blank
    panel reads as "there was nothing there before" rather than as "this tool
    cannot read it".
    """
    out = []
    for chunk in path.split("M")[1:]:
        points: list[tuple[float, float]] = []
        for token in re.finditer(r"([HV])\s*(-?[\d.]+)|(-?[\d.]+),(-?[\d.]+)", chunk):
            if token.group(3) is not None:
                points.append((float(token.group(3)), float(token.group(4))))
            elif points:
                x, y = points[-1]
                value = float(token.group(2))
                points.append((value, y) if token.group(1) == "H" else (x, value))
        if len(points) >= 3:
            out.append(np.array(points))
    return out


def cell_rect(column: int) -> tuple[float, float, float, float]:
    """One printed cell's three lanes, in atlas units: (x, y, width, height)."""
    return FIELD_X + column * CELL_W, BAND_TOP, CELL_W, 3 * CELL_H


def score_rect(registration: Registration, rgb: np.ndarray) -> tuple[float, float, float, float]:
    """The score block, in atlas units, from the printed boxes `score.py` finds.

    Taken from the boxes rather than from the segments inside them, so that a
    segment which escaped its box shows as running off the panel instead of
    quietly recentring it - the same reason the playfield panels are cut on the
    printed cell rather than on the sprite.
    """
    boxes = measure_boxes(rgb).values()
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    ax0, ay0 = registration.to_atlas(np.array([x0]), np.array([y0]))
    ax1, ay1 = registration.to_atlas(np.array([x1]), np.array([y1]))
    return float(ax0[0]), float(ay0[0]), float(ax1[0] - ax0[0]), float(ay1[0] - ay0[0])


def render(atlas: dict, rect: tuple[float, float, float, float], scale: float) -> Image.Image:
    x0, y0, width, height = rect
    image = Image.new("RGB", (int(width * scale), int(height * scale)), BACKGROUND)
    draw = ImageDraw.Draw(image)
    for segment in atlas["segments"]:
        bounds = segment["bounds"]
        centre_x = bounds["x"] + bounds["width"] / 2
        centre_y = bounds["y"] + bounds["height"] / 2
        inside_x = x0 - width / 2 < centre_x < x0 + 1.5 * width
        inside_y = y0 - height / 2 < centre_y < y0 + 1.5 * height
        if not (inside_x and inside_y):
            continue
        for ring in rings_of(segment["path"]):
            pixels = [((x - x0) * scale, (y - y0) * scale) for x, y in ring]
            draw.polygon(pixels, fill=FILL[segment["colorRegion"]])
    return image


def photograph(
    rgb: np.ndarray,
    registration: Registration,
    rect: tuple[float, float, float, float],
    scale: float,
) -> Image.Image:
    ax, ay, width, height = rect
    x0, y0 = registration.to_pixels(ax, ay)
    x1, y1 = registration.to_pixels(ax + width, ay + height)
    crop = Image.fromarray(rgb[int(y0) : int(y1), int(x0) : int(x1)].astype(np.uint8))
    return crop.resize((int(width * scale), int(height * scale)), Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out")
    parser.add_argument("--cells", default="0,2,6")
    parser.add_argument(
        "--score",
        action="store_true",
        help="the SCORE readout instead of playfield cells",
    )
    parser.add_argument("--before", default=None, help="an earlier atlas.json to put first")
    parser.add_argument(
        "--scale",
        type=float,
        default=PIXELS_PER_UNIT,
        help="pixels per atlas unit; all three panels share it",
    )
    args = parser.parse_args()

    rgb = load_photo()
    registration = Registration(measure_lattice(rgb))
    current = json.loads(Path("src/machine/tube/atlas.json").read_text())
    before = json.loads(Path(args.before).read_text()) if args.before else None

    if args.score:
        rects = [score_rect(registration, rgb)]
    else:
        rects = [cell_rect(int(c)) for c in args.cells.split(",")]
    panels: list[list[Image.Image]] = []
    for rect in rects:
        row = []
        if before:
            row.append(render(before, rect, args.scale))
        row.append(render(current, rect, args.scale))
        row.append(photograph(rgb, registration, rect, args.scale))
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
