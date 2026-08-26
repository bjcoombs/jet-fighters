"""Read the score off a registered clip, with the evidence attached to the reading.

Four mistakes were made reading this readout by hand, and every one of them
reached a committed document before it was caught. This tool exists to make each
one impossible rather than to remember not to make it.

    python3 tools/video/score_windows.py /tmp/jf

**1. The readout is dark for more of the clip than it is lit.** Sampling it at
wall-clock instants - "the score at t=17, t=18, t=19" - reads darkness as absence
and produces statements like "unlit at every sample after 17.00 s" about a
readout that is lit in nine separate windows after 17.00 s. So this tool never
samples: it finds the windows in which the digits are lit, and reports those.

**2. A contact sheet whose panels are not labelled cannot be read safely.** A
sheet built from a frame list containing a duplicated index put one panel under
the wrong timestamp, and a row of data that was never observed reached a merged
document. Every panel this tool emits carries its own frame index and timestamp
burned into the image, so a panel cannot be attributed to a frame it did not come
from.

**3. An overexposed frame must stay overexposed.** The clip's final flash is
saturated and its tens digit reads 3 where every reading before it reads 2. That
is either a real end-of-game behaviour or bloom, and it is unresolved - so the
tool flags saturation and does not normalise it away, because a contrast stretch
that made that panel comfortable to read would also have made it agree.

**4. A dead reader prints an empty table, and an empty table reads as darkness.**
The failure this repository has hit five times in `tools/probe/drives/`. So the
tool asserts its own non-vacuity: it exits non-zero if it finds no windows, or if
the digit box never reaches the lit level a known-lit frame reaches.

**What it does not do: decode the digits.** Segment decoding was tried and is not
reliable on this footage - at the tube's scale the phosphor blooms and the two
digits merge into one lit blob in the colour-excess channel, so a decoder would be
confidently wrong some of the time. Reading them is left to a person, which is
what the labelled sheet and the lit-pixel counts are for. A reading is recorded
with the frame index and count that back it, and can be checked by anyone.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FPS = 30.0

# The digit pair, in the registered window's coordinates. Below the SCORE label,
# which is lit whenever the digits are and would otherwise mask a dark readout.
DIGITS = (150, 178, 60, 120)  # y0, y1, x0, x1

# Colour excess above which a pixel counts as lit phosphor. The same rule the
# rest of tools/video/ uses: cyan is min(G,B) - R.
LIT_EXCESS = 45

# Lit pixels in the digit box before the readout is called lit. Measured: a lit
# window peaks at 263-1160 px and a dark frame sits at 0. Forty is far above the
# noise floor and far below the weakest real window.
LIT_FLOOR = 40

# Frames a window needs before it is a window rather than a single-frame flicker.
MIN_WINDOW_FRAMES = 2

# How far apart panels may be inside one lit window, in seconds.
#
# **A window is not a reading.** The owner's clip holds one lit stretch from 0.23
# to 11.30 s across which the score goes 0, 1, 3 and 6 - so offering a window its
# single brightest frame would silently drop three score changes. Segmenting the
# window by lit-pixel count does not work either: the count is dominated by which
# part of the multiplex scan the frame caught, and swings 252 to 987 inside one
# unchanging score. So a long window is simply sampled at this spacing and every
# panel is labelled, which is safe where an unlabelled sheet was not.
PANEL_SPACING_S = 0.5

# Panels a contact-sheet row holds before it wraps. A single row of 43 panels is
# 16,000 px wide and nothing will display it at a size the digits can be read at.
PANELS_PER_ROW = 12

# A panel is flagged clipped when its brightest pixel reaches this luminance.
#
# **Measured, after a first attempt at this measured the wrong thing.** Counting
# lit pixels at the channel ceiling flagged almost every window and missed the
# one that matters: a normal cyan digit has its blue channel near 255 as a matter
# of course, while the clip's blown final flash is *white* - low colour excess -
# so few of its pixels pass the lit test at all. Peak luminance separates them
# cleanly: 246 on the final flash against 209-216 on every ordinary window.
CLIPPED_LUMA = 240
_LUMA = (0.299, 0.587, 0.114)


def lit_per_frame(frames: np.ndarray) -> np.ndarray:
    y0, y1, x0, x1 = DIGITS
    box = frames[:, y0:y1, x0:x1].astype(np.float32)
    red, green, blue = box[..., 0], box[..., 1], box[..., 2]
    return ((np.minimum(green, blue) - red) > LIT_EXCESS).sum(axis=(1, 2))


def peak_luma(frames: np.ndarray, index: int) -> float:
    """The panel's brightest pixel, as luminance.

    Reported rather than corrected. A contrast stretch that made the clip's final
    flash comfortable to read would also have made it agree with the readings
    before it, and whether it agrees is exactly the open question.
    """
    y0, y1, x0, x1 = DIGITS
    box = frames[index, y0:y1, x0:x1].astype(np.float32)
    return float((box[..., 0] * _LUMA[0] + box[..., 1] * _LUMA[1] + box[..., 2] * _LUMA[2]).max())


def windows(lit: np.ndarray):
    """(first, last, peak) frame indices for every stretch the digits are lit."""
    on = lit >= LIT_FLOOR
    found, index = [], 0
    while index < len(on):
        if on[index]:
            end = index
            while end < len(on) and on[end]:
                end += 1
            if end - index >= MIN_WINDOW_FRAMES:
                found.append((index, end - 1, int(lit[index:end].max())))
            index = end
        else:
            index += 1
    return found


def contact_sheet(frames: np.ndarray, picks, path: Path, scale: int = 5) -> None:
    """One labelled panel per window, the label burned into the panel.

    **The label is drawn into the pixels, not printed beside them.** A caption
    kept in a separate list is exactly what went wrong before: the list and the
    panels drifted by one and nothing in the image said so.
    """
    y0, y1, x0, x1 = DIGITS
    pad = 12
    panels = []
    for index in picks:
        crop = frames[index, y0 - 22 : y1 + 2, x0 - 8 : x1 + 8]
        image = Image.fromarray(crop.astype(np.uint8)).resize(
            ((x1 + 8 - x0 + 8) * scale, (y1 + 2 - y0 + 22) * scale), Image.LANCZOS
        )
        labelled = Image.new("RGB", (image.width, image.height + pad + 4), (0, 0, 0))
        labelled.paste(image, (0, pad + 4))
        ImageDraw.Draw(labelled).text(
            (3, 2), f"f{index}  {index / FPS:.2f}s", fill=(255, 220, 0)
        )
        panels.append(np.asarray(labelled))
    if not panels:
        return
    height = max(panel.shape[0] for panel in panels)
    width = max(panel.shape[1] for panel in panels)
    padded = [
        np.pad(p, ((0, height - p.shape[0]), (0, width - p.shape[1] + 2), (0, 0)))
        for p in panels
    ]
    rows = []
    for start in range(0, len(padded), PANELS_PER_ROW):
        row = padded[start : start + PANELS_PER_ROW]
        while len(row) < PANELS_PER_ROW:
            row.append(np.zeros_like(padded[0]))
        rows.append(np.concatenate(row, axis=1))
    Image.fromarray(np.concatenate(rows, axis=0)).save(path)


def report(work: Path) -> int:
    frames = np.load(work / "frames.npy")
    lit = lit_per_frame(frames)
    found = windows(lit)

    print(f"digit box {DIGITS}, lit at colour excess > {LIT_EXCESS}")
    print(f"{len(found)} windows in which the score digits are lit\n")
    print("  window (s)        frames        peak lit px   peak luma   read as")
    picks = []
    for first, last, peak in found:
        # Panels at a bounded spacing, each the locally brightest frame - the one
        # whose segments are most complete, rather than one that caught the
        # multiplex mid-scan.
        step = max(1, int(PANEL_SPACING_S * FPS))
        for start in range(first, last + 1, step):
            stop = min(start + step, last + 1)
            picks.append(int(start + np.argmax(lit[start:stop])))
        best = int(first + np.argmax(lit[first : last + 1]))
        luma = peak_luma(frames, best)
        flag = f"CLIPPED {luma:.0f}" if luma >= CLIPPED_LUMA else f"{luma:.0f}"
        print(
            f"  {first/FPS:6.2f}-{last/FPS:6.2f}   f{first}-f{last:<6}  "
            f"{peak:6d}       {flag:<10}  ({len(range(first, last + 1, step))} panels, "
            f"brightest f{best})"
        )

    contact_sheet(frames, picks, work / "score_windows.png")
    print(f"\nlabelled contact sheet: {work / 'score_windows.png'}")
    print("Every panel carries its own frame index. Read the digits off the sheet")
    print("and record them against that index, not against a position in a list.")

    # --- non-vacuity, asserted rather than hoped -------------------------
    problems = []
    if not found:
        problems.append("no lit windows found - a dead reader prints exactly this")
    if lit.max() < LIT_FLOOR * 4:
        problems.append(
            f"the digit box never exceeded {int(lit.max())} lit pixels; a real "
            f"window peaks in the hundreds, so the box is probably misplaced"
        )
    if problems:
        print("\nFAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    clipped = sum(1 for i in picks if peak_luma(frames, i) >= CLIPPED_LUMA)
    print(f"\nnon-vacuity: {len(found)} windows, {len(picks)} panels, "
          f"brightest {int(lit.max())} lit px, {clipped} panels clipped")
    return 0


if __name__ == "__main__":
    sys.exit(report(Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/jf")))
