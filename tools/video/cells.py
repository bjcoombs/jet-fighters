"""Turn a recording of the real tube into a per-cell brightness series.

Reads `assets/reference/skill3-video-tube.mp4` - a crop of the owner's skill-3
recording around the tube - and writes `assets/reference/skill3-video-cells.csv`,
one row per frame, one column per (playfield cell, row).

This lives in `tools/video/` with the other gameplay-recording tools and shares
their status: **not part of the
build and never run by `npm test`.** It needs NumPy, Pillow and `ffmpeg` on PATH.
`tools/probe/drives/missile-transit.ts` reads the CSV it produces and needs none
of those, which is deliberate - `drives/README.md` records a drive that shelled
out to ffmpeg and so could not run in a clean checkout.

Why a CSV and not the video: the measurement that matters is a per-cell time
series, and freezing it means the drive, the test and any reviewer all argue
about the same numbers. Re-run this only when the extraction itself changes.

The three steps, and why each is there:

1. **Cyan isolation.** The tube is blue-green on a dark case, so
   `min(G, B) - R` separates lit phosphor from room light and from the orange
   case, neither of which is cyan.

2. **Registration.** The recording is handheld and drifts by up to ~70 px. Every
   frame is aligned to a reference (the mean of the 40 brightest frames) by FFT
   phase correlation. Frames whose shift departs from the local median by more
   than `RESIDUAL_TOLERANCE` px did not lock - the tube blanks during a note, and
   a correlation peak against a blank frame lands anywhere - and are marked
   `registered = 0` rather than being silently trusted. A consumer that reads
   those rows as darkness will measure the blanking, not the game.

3. **Cell integration.** A box at each cell centre, summed. Cell centres came
   from the max projection of the registered stack; they agree with the printed
   overlay in `assets/reference/screen-closeup-gameplay.jpg` - seven cells with
   the BATTLE SHIP ZONE at one end and the MISSILE STATION ZONE at the other,
   which is the geometry `ATLAS-COORDINATES.md` arrived at independently.

Usage: python3 tools/video/cells.py [--video PATH] [--out PATH]
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

# Cell centres in the cropped video's own pixel coordinates. Columns run left to
# right across the printed overlay: c0 is the BATTLE SHIP ZONE, c1..c5 the JET
# FIGHTER FLYING ZONE, c6 the MISSILE STATION ZONE - the G line, where the
# launcher sits and where a shot starts.
COLUMN_X = [247, 285, 320, 357, 399, 436, 478]
ROW_Y = [158, 181, 201]
BOX_HALF_W, BOX_HALF_H = 15, 9

# Registration window, generously padded so a drifting frame still has image to
# shift into.
WINDOW = (80, 280, 80, 580)  # y0, y1, x0, x1
PAD = 75

REFERENCE_FRAMES = 40
RESIDUAL_TOLERANCE = 6.0  # px from the local median before a lock is disbelieved
MEDIAN_WINDOW = 9
SMOOTH_HALF_WIDTH = 1  # frames either side, over registered frames only
LIT_TUBE_THRESHOLD = 0.25  # summed normalised brightness below this = tube dark


def cyan(path: str) -> np.ndarray:
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    return np.clip(np.minimum(rgb[:, :, 1], rgb[:, :, 2]) - rgb[:, :, 0], 0, None)


def extract_frames(video: str, into: str) -> list[str]:
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is not on PATH; this tracer is not part of `npm test` and needs it")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video, "-vsync", "0", os.path.join(into, "f%04d.png")],
        check=True,
    )
    return sorted(glob.glob(os.path.join(into, "*.png")))


def median_filter(x: np.ndarray, width: int) -> np.ndarray:
    out = np.empty_like(x)
    for i in range(len(x)):
        lo, hi = max(0, i - width // 2), min(len(x), i + width // 2 + 1)
        out[i] = np.median(x[lo:hi])
    return out


def register(stack: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (shifts, locked) - integer (dy, dx) per frame and whether to trust it."""
    n, h, w = stack.shape
    energy = stack.reshape(n, -1).sum(1)
    reference = stack[np.argsort(energy)[-REFERENCE_FRAMES:]].mean(0)
    ref_f = np.fft.rfft2(reference - reference.mean())

    rows = np.r_[0 : PAD + 1, h - PAD : h]
    cols = np.r_[0 : PAD + 1, w - PAD : w]
    shifts = np.zeros((n, 2), np.int32)
    for i in range(n):
        centred = stack[i] - stack[i].mean()
        correlation = np.fft.irfft2(ref_f * np.conj(np.fft.rfft2(centred)), s=(h, w))
        peak_map = np.full((h, w), -np.inf, np.float32)
        peak_map[np.ix_(rows, cols)] = correlation[np.ix_(rows, cols)]
        py, px = np.unravel_index(np.argmax(peak_map), peak_map.shape)
        shifts[i] = (py if py <= PAD else py - h, px if px <= PAD else px - w)

    smooth_y = median_filter(shifts[:, 0].astype(float), MEDIAN_WINDOW)
    smooth_x = median_filter(shifts[:, 1].astype(float), MEDIAN_WINDOW)
    residual = np.hypot(shifts[:, 0] - smooth_y, shifts[:, 1] - smooth_x)
    locked = residual <= RESIDUAL_TOLERANCE

    # An unlocked frame still needs *some* alignment so its cell boxes land in
    # roughly the right place; the local median is the best available guess. It
    # is reported as unlocked regardless.
    for i in np.flatnonzero(~locked):
        shifts[i] = (int(round(smooth_y[i])), int(round(smooth_x[i])))
    np.clip(shifts, -PAD, PAD, out=shifts)
    return shifts, locked


def main() -> None:
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", default=os.path.join(here, "assets/reference/skill3-video-tube.mp4"))
    parser.add_argument("--out", default=os.path.join(here, "assets/reference/skill3-video-cells.csv"))
    args = parser.parse_args()

    y0, y1, x0, x1 = WINDOW
    with tempfile.TemporaryDirectory() as tmp:
        frames = extract_frames(args.video, tmp)
        stack = np.zeros((len(frames), (y1 - y0) + 2 * PAD, (x1 - x0) + 2 * PAD), np.float32)
        for i, frame in enumerate(frames):
            stack[i] = cyan(frame)[y0 - PAD : y1 + PAD, x0 - PAD : x1 + PAD]

    shifts, locked = register(stack)
    print(f"{len(frames)} frames, {locked.sum()} locked to the tube ({100 * locked.mean():.0f}%)")

    raw = np.zeros((len(frames), len(COLUMN_X), len(ROW_Y)), np.float32)
    for i, (dy, dx) in enumerate(shifts):
        frame = stack[i, PAD - dy : PAD - dy + (y1 - y0), PAD - dx : PAD - dx + (x1 - x0)]
        for c, cx in enumerate(COLUMN_X):
            for r, cy in enumerate(ROW_Y):
                box = frame[cy - y0 - BOX_HALF_H : cy - y0 + BOX_HALF_H + 1,
                            cx - x0 - BOX_HALF_W : cx - x0 + BOX_HALF_W + 1]
                raw[i, c, r] = box.sum()

    smoothed = np.zeros_like(raw)
    for i in range(len(frames)):
        lo, hi = max(0, i - SMOOTH_HALF_WIDTH), min(len(frames), i + SMOOTH_HALF_WIDTH + 1)
        window = locked[lo:hi]
        smoothed[i] = raw[lo:hi][window].mean(0) if window.any() else 0.0

    floor = np.percentile(smoothed, 20, axis=0)
    ceiling = np.percentile(smoothed, 99, axis=0)
    scaled = np.clip((smoothed - floor) / (ceiling - floor + 1e-9), 0, 1)
    lit = scaled.sum((1, 2)) > LIT_TUBE_THRESHOLD
    usable = locked & lit
    print(f"{usable.sum()} frames locked with the tube lit ({100 * usable.mean():.0f}%)")

    header = [line for line in __doc__.splitlines() if False]  # provenance written below
    del header
    lines = [
        "# Per-cell tube brightness from assets/reference/skill3-video-tube.mp4, written by",
        "# tools/video/cells.py. One row per video frame at 30 fps.",
        "# Each cell is the summed cyan energy in a box at that cell's centre, after every",
        "# frame is registered against the tube, smoothed +-1 frame over registered frames",
        "# only, then scaled per cell to its own [p20, p99].",
        "# registered = 1 when the frame locked to the tube AND the tube was lit. A row with",
        "# registered = 0 carries no measurement: skip it, do not read it as darkness. The",
        "# tube blanks while a note plays, which is most of what those rows are.",
        "# Columns run left to right across the printed overlay: c0 = BATTLE SHIP ZONE,",
        "# c1..c5 = JET FIGHTER FLYING ZONE, c6 = MISSILE STATION ZONE (the G line).",
        "# Rows r0..r2 are the tube's three rows, top to bottom.",
        ",".join(["frame", "registered"] + [f"c{c}r{r}" for c in range(len(COLUMN_X)) for r in range(len(ROW_Y))]),
    ]
    for i in range(len(frames)):
        cells = [f"{scaled[i, c, r]:.4f}" for c in range(len(COLUMN_X)) for r in range(len(ROW_Y))]
        lines.append(",".join([str(i), "1" if usable[i] else "0"] + cells))
    with open(args.out, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
