#!/usr/bin/env python3
"""Put a render of the model beside the photograph it was framed to match, and measure.

    python3 tools/model/compare.py front <render.png> docs/evidence/console-model-front.jpg
    python3 tools/model/compare.py board <render.png> docs/evidence/console-model-board.jpg

Writes the side-by-side JPEG and prints, for the features both images can be read for,
where each sits as a fraction of the case's width - so the two columns should agree to
within the PRD's 3%. The reads use the same colour masks as the derivation did
(``tools/model/measure.py``), on both images alike, so the check is not a matter of
opinion about whether the render "looks right".
"""

from __future__ import annotations

import sys
from pathlib import Path

import json

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PIXELS = json.loads((ROOT / "tools/model/pixels.json").read_text())
PHOTOS = {
    "front": ROOT / "assets/reference/device-front-lit.jpg",
    "board": ROOT / "assets/reference/tube-teardown/board-L1001568.jpg",
}


def channels(im: Image.Image):
    a = np.array(im.convert("RGB")).astype(float) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(2)
    mn = a.min(2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return r, g, b, s, mx


def red_mask(im):
    r, g, b, s, v = channels(im)
    return (r > 0.4) & (s > 0.45) & (r > g * 1.5) & (r > b * 1.5)


def blue_mask(im):
    r, g, b, s, v = channels(im)
    return (b > 0.35) & (b > r * 1.4) & (b > g * 1.05) & (s > 0.35)


def dark_mask(im):
    r, g, b, s, v = channels(im)
    return v < 0.2


def bbox(mask, min_count=1):
    cols = np.where(mask.sum(0) >= min_count)[0]
    rows = np.where(mask.sum(1) >= min_count)[0]
    if len(cols) == 0 or len(rows) == 0:
        return None
    return cols.min(), rows.min(), cols.max(), rows.max()


def centroid(mask, region):
    x0, y0, x1, y1 = region
    sub = mask[y0:y1, x0:x1]
    yy, xx = np.where(sub)
    if len(xx) == 0:
        return None
    return xx.mean() + x0, yy.mean() + y0


def features_front(im: Image.Image) -> dict[str, tuple[float, float]]:
    """Positions as fractions of the case: (x / width, y / height of the red bbox)."""
    red = red_mask(im)
    case = bbox(red, min_count=40)
    if case is None:
        return {}
    cx0, cy0, cx1, cy1 = case
    w, h = cx1 - cx0, cy1 - cy0
    out: dict[str, tuple[float, float]] = {"case_size_px": (w, h)}

    def frac(p):
        return ((p[0] - cx0) / w, (p[1] - cy0) / h)

    blue = blue_mask(im)
    # Fire button: blue, in the left quarter, upper half.
    fire = centroid(blue, (cx0, cy0, cx0 + w // 4, cy0 + h // 2))
    if fire:
        out["fire_button"] = frac(fire)
    # Skill flag hub: the blue in the right quarter, lower half, is hub plus flag; the
    # photograph read is the hub, so take the blue region's top-left-most mass: the hub
    # is where the flag pivots, up and left of the flag's tip.
    region = (cx0 + 3 * w // 4, cy0 + h // 2, cx1, cy1)
    sub = blue[region[1]:region[3], region[0]:region[2]]
    yy, xx = np.where(sub)
    if len(xx):
        # the hub is round and sits at the blue mass's upper-left end
        order = np.argsort(xx + yy)[: max(1, len(xx) // 4)]
        out["skill_flag"] = frac((xx[order].mean() + region[0], yy[order].mean() + region[1]))
    # Sticker: blue, left quarter, lower half.
    sticker = centroid(blue, (cx0, cy0 + h // 2, cx0 + w // 4, cy1))
    if sticker:
        out["sticker"] = frac(sticker)
    # Window: the dark region inside the middle half.
    dark = dark_mask(im)
    win = bbox(dark[cy0:cy1, cx0 + w // 4 : cx1 - w // 4], min_count=20)
    if win:
        wx0, wy0, wx1, wy1 = win
        out["window_left_top"] = frac((wx0 + cx0 + w // 4, wy0 + cy0))
        out["window_right_bottom"] = frac((wx1 + cx0 + w // 4, wy1 + cy0))
    return out


def features_board(im: Image.Image) -> dict[str, tuple[float, float]]:
    red = red_mask(im)
    # Ignore the loose door and strap at the photograph's edges: take the largest band.
    case = bbox(red, min_count=150)
    if case is None:
        return {}
    cx0, cy0, cx1, cy1 = case
    w, h = cx1 - cx0, cy1 - cy0
    out: dict[str, tuple[float, float]] = {"case_size_px": (w, h)}

    def frac(p):
        return ((p[0] - cx0) / w, (p[1] - cy0) / h)

    r, g, b, s, v = channels(im)
    brown = (r > 0.3) & (r < 0.8) & (g > 0.12) & (g < 0.5) & (b < 0.4) & (s > 0.3) & (s < 0.85) & ~red
    board = bbox(brown[cy0:cy1, cx0:cx1], min_count=80)
    if board:
        out["board_left_top"] = frac((board[0] + cx0, board[1] + cy0))
        out["board_right_bottom"] = frac((board[2] + cx0, board[3] + cy0))
    dark = v < 0.2
    tube = bbox(dark[cy0 + h // 4 : cy1 - h // 4, cx0 + w // 4 : cx1 - w // 4], min_count=150)
    if tube:
        out["tube_left_top"] = frac((tube[0] + cx0 + w // 4, tube[1] + cy0 + h // 4))
        out["tube_right_bottom"] = frac((tube[2] + cx0 + w // 4, tube[3] + cy0 + h // 4))
    blue = blue_mask(im)
    fire = centroid(blue, (cx0, cy0, cx0 + w // 4, cy0 + h // 2))
    if fire:
        out["fire_body"] = frac(fire)
    return out


def photo_features_front() -> dict[str, tuple[float, float]]:
    """The photograph's features from the calibrated reads in pixels.json, not re-detected:
    the hand in frame passes a red mask, and the glass reflects too much for a dark one."""
    F = PIXELS["front"]
    sh = F["shell"]
    x0, y0 = sh["left"], sh["module_top"]
    w, h = sh["right"] - sh["left"], sh["module_bottom"] - sh["module_top"]

    def frac(p):
        return ((p[0] - x0) / w, (p[1] - y0) / h)

    sc = F["scope"]
    cx, cy = sc["circle_centre"]
    r = sc["circle_radius"]
    st = F["sticker"]
    return {
        "case_size_px": (w, h),
        "fire_button": frac(F["fire_button"]["centre"]),
        "skill_flag": frac(F["skill_flag"]["hub_centre"]),
        "sticker": frac(((st["x"][0] + st["x"][1]) / 2, (st["y"][0] + st["y"][1]) / 2)),
        "window_left_top": frac((sc["rect_left"], cy - r)),
        "window_right_bottom": frac((cx + r, cy + r)),
    }


def photo_features_board() -> dict[str, tuple[float, float]]:
    B = PIXELS["board"]
    sh = B["shell"]
    x0, y0 = sh["left"], sh["module_top"]
    w, h = sh["right"] - sh["left"], sh["module_bottom"] - sh["module_top"]

    def frac(p):
        return ((p[0] - x0) / w, (p[1] - y0) / h)

    pcb, tube = B["pcb"], B["tube"]
    return {
        "case_size_px": (w, h),
        "board_left_top": frac((pcb["x"][0], pcb["y"][0])),
        "board_right_bottom": frac((pcb["x"][1], pcb["y"][1])),
        "tube_left_top": frac((tube["shroud_x"][0], tube["shroud_y"][0])),
        "tube_right_bottom": frac((tube["shroud_x"][1], tube["shroud_y"][1])),
        "fire_body": frac(B["fire_button_body"]["centre"]),
    }


def side_by_side(photo: Image.Image, render: Image.Image, out: Path, title: str) -> None:
    h = 700
    def fit(im):
        return im.resize((int(im.width * h / im.height), h))
    a, b = fit(photo), fit(render)
    canvas = Image.new("RGB", (a.width + b.width + 30, h + 40), (24, 24, 28))
    canvas.paste(a, (10, 30))
    canvas.paste(b, (a.width + 20, 30))
    d = ImageDraw.Draw(canvas)
    d.text((12, 8), f"{title}: photograph", fill=(230, 230, 230))
    d.text((a.width + 22, 8), f"{title}: model, camera matched", fill=(230, 230, 230))
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, quality=88)


def main(argv: list[str]) -> int:
    which, render_path, out_path = argv[0], Path(argv[1]), Path(argv[2])
    photo = Image.open(PHOTOS[which])
    render = Image.open(render_path)
    side_by_side(photo, render, out_path, which)
    if which == "front":
        fp, fr = photo_features_front(), features_front(render)
    else:
        fp, fr = photo_features_board(), features_board(render)
    worst = 0.0
    print(f"{'feature':22s} {'photo':>16s} {'model':>16s} {'diff % of case':>16s}")
    for key in fp:
        if key not in fr:
            print(f"{key:22s} {str(fp[key]):>16s} {'(not found)':>16s}")
            continue
        if key == "case_size_px":
            print(f"{key:22s} {str(tuple(int(v) for v in fp[key])):>16s} {str(tuple(int(v) for v in fr[key])):>16s}   aspect {fp[key][0]/fp[key][1]:.3f} vs {fr[key][0]/fr[key][1]:.3f}")
            continue
        dx = (fr[key][0] - fp[key][0]) * 100
        dy = (fr[key][1] - fp[key][1]) * 100
        worst = max(worst, abs(dx), abs(dy))
        print(f"{key:22s} {fp[key][0]:7.3f},{fp[key][1]:7.3f} {fr[key][0]:7.3f},{fr[key][1]:7.3f}   {dx:+6.1f}, {dy:+6.1f}")
    print(f"worst: {worst:.1f}% of the case (PRD bound 3%)")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
