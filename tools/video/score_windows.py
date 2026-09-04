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

**The general test, which cost more to learn than the four traps.** Point the
instrument at the case it exists for and confirm it fires. The clipping flag here
first counted lit pixels at the channel ceiling, and that version flagged fourteen
of fifteen windows while **missing the blown final flash it was built for** - a
normal cyan digit has its blue channel near 255 as a matter of course, and the blown
flash is white, so it barely passes the lit test at all. It was a detector
anti-correlated with its own subject, and it would have shipped, because it ran
without error and produced a plausible column. Verified now: the flag picks exactly
the two clipped windows and no others. **Do not trim that check** - a flag that fires
on everything except the case it was written for is worse than no flag.

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

## The second input: the committed crop

Everything above reads `frames.npy`, which comes from the owner's 34 MB clip
through `tools/video/clip.py`. **That clip is not in this repository**, so nothing
built on it was re-derivable by anybody else - which is the whole complaint that
produced this tool. So the tool also reads `assets/reference/skill3-video-tube.mp4`,
the 1 MB crop that is committed and that `tools/video/cells.py` already uses:

    python3 tools/video/score_windows.py --video --csv

That path writes `assets/reference/skill3-video-score.csv`, one row per frame, and
`tools/probe/drives/score-windows.ts` reads that CSV in `npm test`. The drive needs
no ffmpeg, NumPy or video decode, for the reason `drives/README.md` records: a drive
that shells out to ffmpeg could not run in a clean checkout.

The two inputs are different crops of the same recording at different scales, so
**the frame indices agree and the lit-pixel counts do not.** The census is the
figure that carries across: fifteen windows at the same frame indices, the same two
of them clipped, and frame 640 dark in both.

## Why the crop needs a second registration step

`cells.register` locks a frame to the tube by phase correlation on the whole
playfield window, and a frame with no lit tube has nothing to lock onto - the
correlation peak lands anywhere and the local-median fallback is a guess between two
dark neighbours. The score readout flashes on its own during the end-of-game display
and at 17.03 s, which is exactly where that fallback is worst: run on the global
shifts alone, the reader finds **fourteen** windows and drops 17.03-17.07 s, one of
the two readings §15a uses to bracket the third tone episode.

So the digit box is placed by the readout's own SCORE label, which is lit whenever
the digits are: the label block is averaged over the frames that both locked and had
lit digits, and that template is then matched per frame within +-22 px. Fifteen
windows, and the anchor frames gain 8-40% more lit pixels because the box lands
squarely on the digits rather than half off them.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.signal import fftconvolve

sys.path.insert(0, str(Path(__file__).parent))

import cells  # noqa: E402

FPS = 30.0

REPO = Path(__file__).resolve().parents[2]
TUBE_MP4 = REPO / "assets/reference/skill3-video-tube.mp4"
SCORE_CSV = REPO / "assets/reference/skill3-video-score.csv"

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


def contact_sheet(frames: np.ndarray, picks, path: Path, box=None, scale: int = 5) -> None:
    """One labelled panel per window, the label burned into the panel.

    **The label is drawn into the pixels, not printed beside them.** A caption
    kept in a separate list is exactly what went wrong before: the list and the
    panels drifted by one and nothing in the image said so.
    """
    y0, y1, x0, x1 = box or DIGITS
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



# --- the committed crop -------------------------------------------------
#
# assets/reference/skill3-video-tube.mp4 is a different crop of the same
# recording at a different scale, so it needs its own boxes. They were measured
# off the crop's own registered stack, the same way DIGITS was measured off the
# full clip's.

# The SCORE label block, in the crop's registered coordinates. The label is the
# anchor rather than part of the measurement: it is lit whenever the digits are,
# so it is present to be matched on exactly the isolated flashes where the
# playfield registration has nothing to lock onto.
CROP_LABEL = (146, 176, 164, 232)  # y0, y1, x0, x1

# The digit pair in the crop's registered coordinates, directly below the label.
# 31x54 px against the full clip's 28x60, which is the two crops' scales.
CROP_DIGITS = (177, 208, 166, 220)

# How far the label may be from where the playfield registration put it. The
# measured residual on locked frames is under 3 px; 22 covers the unlocked
# frames, whose global shift is a guess between two dark neighbours and can be
# 20 px out.
CROP_SEARCH = 22

# Frames whose digit box is at least this lit contribute to the label template.
# Above it the readout is fully scanned rather than caught mid-multiplex, so the
# label edges average sharp instead of smeared.
TEMPLATE_LIT = 800


def crop_frames(video: Path) -> np.ndarray:
    """Every frame of the committed crop, RGB, unregistered."""
    if not video.exists():
        sys.exit(f"{video} is not there - this tool reads the committed crop by path")
    with tempfile.TemporaryDirectory() as tmp:
        paths = cells.extract_frames(str(video), tmp)
        stack = np.stack([np.asarray(Image.open(p).convert("RGB")) for p in paths])
    return stack


def cyan_excess(frames: np.ndarray) -> np.ndarray:
    box = frames.astype(np.float32)
    return np.clip(np.minimum(box[..., 1], box[..., 2]) - box[..., 0], 0, None)


def _box(excess: np.ndarray, index: int, box, shift) -> np.ndarray:
    y0, y1, x0, x1 = box
    dy, dx = shift
    return excess[index, y0 - dy : y1 - dy, x0 - dx : x1 - dx]


def playfield_shifts(excess: np.ndarray) -> np.ndarray:
    """(dy, dx) per frame from `cells.register` - the shared tube registration."""
    y0, y1, x0, x1 = cells.WINDOW
    pad = cells.PAD
    shifts, locked = cells.register(excess[:, y0 - pad : y1 + pad, x0 - pad : x1 + pad])
    print(f"{len(excess)} frames, {locked.sum()} locked to the tube "
          f"({100 * locked.mean():.0f}%)")
    return shifts, locked


def label_template(excess: np.ndarray, shifts, locked) -> np.ndarray:
    """The SCORE label averaged over frames that locked with the digits lit."""
    chosen = [
        i for i in range(len(excess))
        if locked[i] and (_box(excess, i, CROP_DIGITS, shifts[i]) > LIT_EXCESS).sum() >= TEMPLATE_LIT
    ]
    if not chosen:
        sys.exit(
            "no frame both locked to the tube and had a lit digit box, so there is "
            "nothing to build the label template from - the boxes are misplaced"
        )
    print(f"label template averaged over {len(chosen)} locked, lit frames")
    template = np.mean([_box(excess, i, CROP_LABEL, shifts[i]) for i in chosen], axis=0)
    return template - template.mean()


def locate(excess: np.ndarray, template: np.ndarray) -> np.ndarray:
    """(dy, dx) per frame that puts the label template where the label is.

    Cross-correlation over a +-CROP_SEARCH search box, one frame at a time. The
    template is mean-subtracted, so this is the offset at which the label's own
    shape - a bright bar over a dark surround - lines up, not simply the
    brightest place to put a box.
    """
    y0, y1, x0, x1 = CROP_LABEL
    reversed_template = template[::-1, ::-1]
    found = np.zeros((len(excess), 2), np.int32)
    for index in range(len(excess)):
        patch = excess[index, y0 - CROP_SEARCH : y1 + CROP_SEARCH,
                       x0 - CROP_SEARCH : x1 + CROP_SEARCH]
        scores = fftconvolve(patch, reversed_template, mode="valid")
        peak = np.unravel_index(np.argmax(scores), scores.shape)
        found[index] = (CROP_SEARCH - peak[0], CROP_SEARCH - peak[1])
    return found


def crop_series(video: Path):
    """(lit pixels, peak luma) per frame of the committed crop."""
    frames = crop_frames(video)
    excess = cyan_excess(frames)
    shifts, locked = playfield_shifts(excess)
    shifts = locate(excess, label_template(excess, shifts, locked))

    lit = np.zeros(len(frames), np.int32)
    luma = np.zeros(len(frames), np.float32)
    y0, y1, x0, x1 = CROP_DIGITS
    for index, (dy, dx) in enumerate(shifts):
        lit[index] = (_box(excess, index, CROP_DIGITS, (dy, dx)) > LIT_EXCESS).sum()
        box = frames[index, y0 - dy : y1 - dy, x0 - dx : x1 - dx].astype(np.float32)
        luma[index] = (box[..., 0] * _LUMA[0] + box[..., 1] * _LUMA[1]
                       + box[..., 2] * _LUMA[2]).max()
    return frames, lit, luma


def write_csv(path: Path, video: Path, lit: np.ndarray, luma: np.ndarray) -> None:
    """The series, frozen, so a drive can assert on it without decoding video."""
    lines = [
        f"# Score-readout lit-pixel series from {video.relative_to(REPO)}, written by",
        "#",
        "#     python3 tools/video/score_windows.py --video --csv",
        "#",
        "# One row per video frame at 30 fps. lit_pixels is the count of pixels in the",
        f"# digit box {CROP_DIGITS} whose cyan excess min(G,B)-R exceeds {LIT_EXCESS},",
        "# after the box is placed by matching the readout's own SCORE label. lit = 1",
        f"# when lit_pixels >= {LIT_FLOOR}, the floor the digits must clear before any",
        "# reading is taken off them - the fabricated row this tool exists to prevent",
        "# was read off a frame with 0.",
        "# peak_luma is the brightest pixel in the same box, 0.299R+0.587G+0.114B. It is",
        f"# reported and never corrected: >= {CLIPPED_LUMA} means the panel is clipped and",
        "# the digits on it may not be what the readout was showing.",
        "frame,lit_pixels,lit,peak_luma",
    ]
    for index in range(len(lit)):
        lines.append(
            f"{index},{int(lit[index])},{1 if lit[index] >= LIT_FLOOR else 0},"
            f"{luma[index]:.1f}"
        )
    path.write_text("\n".join(lines) + "\n")
    print(f"wrote {path}")


# --- reporting, shared by both inputs ------------------------------------


def print_windows(lit: np.ndarray, luma_at, found) -> list[int]:
    """The window table. Returns the panel picks, in frame order."""
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
        value = luma_at(best)
        flag = f"CLIPPED {value:.0f}" if value >= CLIPPED_LUMA else f"{value:.0f}"
        print(
            f"  {first/FPS:6.2f}-{last/FPS:6.2f}   f{first}-f{last:<6}  "
            f"{peak:6d}       {flag:<10}  ({len(range(first, last + 1, step))} panels, "
            f"brightest f{best})"
        )
    return picks


def vacuity(lit: np.ndarray, found) -> list[str]:
    """What must be true of any run for its table to mean anything."""
    problems = []
    if not found:
        problems.append("no lit windows found - a dead reader prints exactly this")
    if lit.max() < LIT_FLOOR * 4:
        problems.append(
            f"the digit box never exceeded {int(lit.max())} lit pixels; a real "
            f"window peaks in the hundreds, so the box is probably misplaced"
        )
    return problems


def strict_read(lit: np.ndarray, frame: int, strict: bool) -> int:
    """Ask the tool to read one frame. `--strict` refuses a dark one.

    This is the fabricated row, re-run: `--frame 640 --strict` is the exact
    request that produced "21.33 s, SCORE 20", and it now exits non-zero instead
    of handing back a panel to read digits off.
    """
    if not 0 <= frame < len(lit):
        print(f"frame {frame} is outside the clip's 0-{len(lit) - 1}")
        return 1
    count = int(lit[frame])
    state = "lit" if count >= LIT_FLOOR else "DARK"
    print(f"\nframe {frame} ({frame / FPS:.2f} s): {count} lit px, {state}")
    if count < LIT_FLOOR:
        print(f"  the digit box is below the {LIT_FLOOR}-pixel floor. Nothing is on the")
        print("  readout to read; a digit read off this frame would be invented.")
        if strict:
            return 1
    return 0


def report(work: Path, sheet: Path | None = None) -> int:
    frames = np.load(work / "frames.npy")
    lit = lit_per_frame(frames)
    found = windows(lit)

    print(f"digit box {DIGITS}, lit at colour excess > {LIT_EXCESS}")
    picks = print_windows(lit, lambda i: peak_luma(frames, i), found)

    destination = sheet if sheet is not None else work / "score_windows.png"
    contact_sheet(frames, picks, destination)
    print(f"\nlabelled contact sheet: {destination}")
    print("Every panel carries its own frame index. Read the digits off the sheet")
    print("and record them against that index, not against a position in a list.")

    # --- non-vacuity, asserted rather than hoped -------------------------
    problems = vacuity(lit, found)
    if problems:
        print("\nFAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    clipped = sum(1 for i in picks if peak_luma(frames, i) >= CLIPPED_LUMA)
    print(f"\nnon-vacuity: {len(found)} windows, {len(picks)} panels, "
          f"brightest {int(lit.max())} lit px, {clipped} panels clipped")
    return 0


def crop_report(video: Path, csv: Path | None, sheet: Path | None,
                frame: int | None, strict: bool) -> int:
    frames, lit, luma = crop_series(video)
    found = windows(lit)

    print(f"\ndigit box {CROP_DIGITS}, lit at colour excess > {LIT_EXCESS}")
    picks = print_windows(lit, lambda i: float(luma[i]), found)

    if sheet is not None:
        contact_sheet(frames, picks, sheet, CROP_DIGITS)
        print(f"\nlabelled contact sheet: {sheet}")

    problems = vacuity(lit, found)
    if problems:
        print("\nFAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    clipped = sum(1 for first, last, _ in found
                  if luma[first + int(np.argmax(lit[first : last + 1]))] >= CLIPPED_LUMA)
    print(f"\nnon-vacuity: {len(found)} windows, {len(picks)} panels, "
          f"brightest {int(lit.max())} lit px, {clipped} windows clipped")

    if csv is not None:
        write_csv(csv, video, lit, luma)
    if frame is not None:
        return strict_read(lit, frame, strict)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("work", nargs="?", default="/tmp/jf",
                        help="work directory holding frames.npy from tools/video/clip.py")
    parser.add_argument("--video", nargs="?", const=str(TUBE_MP4), default=None,
                        help=f"read the committed crop instead (default {TUBE_MP4.name})")
    parser.add_argument("--csv", nargs="?", const=str(SCORE_CSV), default=None,
                        help=f"write the per-frame series (default {SCORE_CSV.name}); --video only")
    parser.add_argument("--sheet", default=None,
                        help="write the labelled contact sheet here instead of "
                             "<work>/score_windows.png")
    parser.add_argument("--frame", type=int, default=None,
                        help="report one frame's lit-pixel count; --video only")
    parser.add_argument("--strict", action="store_true",
                        help="with --frame, exit non-zero when the frame is dark")
    args = parser.parse_args()

    if args.video is None:
        if args.csv or args.frame is not None:
            parser.error("--csv and --frame read the committed crop; pass --video")
        return report(Path(args.work), Path(args.sheet) if args.sheet else None)
    return crop_report(
        Path(args.video),
        Path(args.csv) if args.csv else None,
        Path(args.sheet) if args.sheet else None,
        args.frame,
        args.strict,
    )


if __name__ == "__main__":
    sys.exit(main())
