"""Decode a gameplay clip and register every frame against the printed silkscreen.

The clip is a phone recording of somebody holding the unit, so the case drifts
across the frame. Every measurement downstream is a position on the tube, so the
drift has to come out first - and it has to come out **against the print**, never
against the sprites, for the reason `tools/trace/lattice.py` records: registering
on the artwork makes the artwork define the coordinates it is measured in.

The print is the cell boxes, the ruler and the zone labels silkscreened on the
glass. They are fixed to the case, so a frame aligned on them is aligned on the
tube.

Usage:

    python3 tools/video/clip.py ~/Downloads/'jetfighers video.mov' /tmp/jf

Writes `frames.npy` (registered RGB), `shifts.npy` and `audio.wav` into the work
directory. `measure.py` reads them.

Needs NumPy, SciPy, Pillow and `ffmpeg` on PATH. Paths in this file are relative
to the repository root.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

# The tube face in the owner's 1620x1080 clip, with room to spare on every side.
# Wide enough that the ruler and both zone labels are inside it, which is what
# gives the registration something to lock onto.
WINDOW = (540, 400, 1100, 730)  # x0, y0, x1, y1

# How far the camera is allowed to have moved between a frame and the reference.
# The drift measured over the owner's clip is 55 px in x and 43 px in y, so 40 px
# either side of a mid-clip reference covers it with room to spare - and it has
# to, because a search that clamps reports its own bound as a measurement. It is
# deliberately not wider: the ruler is a row of evenly spaced ticks, and an
# unrestricted search locks onto the wrong tick on frames where the tube is dark.
# The first pass of this analysis reported a 235 px jump that way.
SEARCH_RADIUS = 40

LUMA = np.array([0.299, 0.587, 0.114], np.float32)


def extract(video: Path, work: Path) -> int:
    """Decode the clip to PNG frames and mono PCM. Returns the frame count."""
    frames = work / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vsync", "0",
         str(frames / "f_%04d.png")],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vn", "-ac", "1",
         "-ar", "44100", "-c:a", "pcm_s16le", str(work / "audio.wav")],
        check=True,
    )
    return len(list(frames.glob("f_*.png")))


def load(work: Path, index: int) -> np.ndarray:
    x0, y0, x1, y1 = WINDOW
    image = Image.open(work / "frames" / f"f_{index:04d}.png").convert("RGB")
    return np.asarray(image).astype(np.float32)[y0:y1, x0:x1]


def print_only(rgb: np.ndarray) -> np.ndarray:
    """The frame with the lit phosphor taken out, band-passed for correlation.

    A lit segment is strongly coloured; the silkscreen is neutral white. Coloured
    pixels are replaced by the local neutral level, so a jet that stepped between
    two frames contributes nothing to the alignment between them.
    """
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = rgb @ LUMA
    lit = (np.minimum(green, blue) - red > 18) | (red - np.maximum(green, blue) > 18)
    lit = gaussian_filter(lit.astype(np.float32), 2.0) > 0.05
    clean = np.where(lit, gaussian_filter(luma, 8.0), luma)
    band = gaussian_filter(clean, 1.0) - gaussian_filter(clean, 8.0)
    return band - band.mean()


def _parabola(line: np.ndarray, peak: int) -> float:
    if peak <= 0 or peak >= len(line) - 1:
        return 0.0
    a, b, c = line[peak - 1], line[peak], line[peak + 1]
    denominator = a - 2 * b + c
    return 0.0 if denominator == 0 else float(0.5 * (a - c) / denominator)


def shift_against(reference_spectrum, image, window) -> tuple[float, float]:
    """Plain cross-correlation, deliberately **not** phase correlation.

    Phase correlation whitens the spectrum. On a tube face that is mostly dark
    that amplifies sensor noise until the alignment is worse than doing nothing:
    measured, it produced a mean stack blurrier than the unregistered one and
    moved a printed rule's spread from 2.3 px to 6.3 px. Plain correlation on the
    band-passed print doubles the mean stack's edge energy instead.
    """
    spectrum = np.fft.rfft2(image * window)
    correlation = np.fft.irfft2(reference_spectrum * np.conj(spectrum), s=image.shape)
    radius = SEARCH_RADIUS
    near = np.roll(np.roll(correlation, radius, 0), radius, 1)[: 2 * radius + 1, : 2 * radius + 1]
    peak = np.unravel_index(np.argmax(near), near.shape)
    dy = peak[0] - radius + _parabola(near[:, peak[1]], peak[0])
    dx = peak[1] - radius + _parabola(near[peak[0], :], peak[1])
    return float(dy), float(dx)


def register(work: Path, count: int, reference: int | None = None) -> np.ndarray:
    """Per-frame (dy, dx) that carries a frame onto the reference frame."""
    if reference is None:
        reference = count // 2
    base = print_only(load(work, reference))
    window = np.outer(np.hanning(base.shape[0]), np.hanning(base.shape[1])).astype(np.float32)
    spectrum = np.fft.rfft2(base * window)
    return np.array([shift_against(spectrum, print_only(load(work, i)), window)
                     for i in range(1, count + 1)])


def stack(work: Path, count: int, shifts: np.ndarray) -> np.ndarray:
    """Every frame, shifted onto the reference, as one uint8 array.

    The shift is rounded to whole pixels. Resampling at sub-pixel offsets is a
    low-pass filter, and blurring 697 frames to remove a drift of half a pixel
    costs more than the drift does - the lattice below fits to 1.5 px on integer
    shifts alone.
    """
    out = None
    for i in range(1, count + 1):
        dy, dx = int(round(shifts[i - 1, 0])), int(round(shifts[i - 1, 1]))
        rgb = np.roll(np.roll(load(work, i), dy, 0), dx, 1)
        if out is None:
            out = np.zeros((count,) + rgb.shape, np.uint8)
        out[i - 1] = np.clip(rgb, 0, 255).astype(np.uint8)
    assert out is not None
    return out


def edge_energy(image: np.ndarray) -> float:
    """Mean absolute gradient - the sharpness check on a mean stack.

    A mean stack of correctly registered frames is sharp; one of misregistered
    frames is blurred. It is the check that caught the sign error and the phase
    correlation, and it needs no feature to be picked by hand.
    """
    luma = image @ LUMA
    return float(np.abs(np.diff(luma, axis=1)).mean() + np.abs(np.diff(luma, axis=0)).mean())


def main() -> None:
    video = Path(sys.argv[1]).expanduser()
    work = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/jf")
    work.mkdir(parents=True, exist_ok=True)
    count = extract(video, work)
    shifts = register(work, count)
    np.save(work / "shifts.npy", shifts)
    frames = stack(work, count, shifts)
    np.save(work / "frames.npy", frames)

    raw = np.mean([load(work, i) for i in range(1, count + 1)], axis=0)
    clamped = np.flatnonzero((np.abs(shifts[:, 1]) >= SEARCH_RADIUS - 0.5)
                             | (np.abs(shifts[:, 0]) >= SEARCH_RADIUS - 0.5))
    print(f"{count} frames, window {WINDOW}")
    print(f"drift dx {shifts[:,1].min():+.1f}..{shifts[:,1].max():+.1f} px, "
          f"dy {shifts[:,0].min():+.1f}..{shifts[:,0].max():+.1f} px")
    # A search that hits its own bound has reported the bound, not a measurement.
    # On the owner's clip three frames do, all after t=22.4 s where he lowers the
    # unit and the tube is already dark; nothing is measured there.
    print(f"frames at the search bound: {len(clamped)}"
          + (f" ({(clamped + 1).tolist()})" if len(clamped) else ""))
    print(f"mean-stack edge energy: registered {edge_energy(frames.astype(np.float32).mean(axis=0)):.3f}"
          f"  unregistered {edge_energy(raw):.3f}"
          "  (higher is sharper; registered must win)")


if __name__ == "__main__":
    main()
