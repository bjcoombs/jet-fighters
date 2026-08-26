"""What is in the audio when the real unit's display goes dark?

`docs/evidence/vfd-appearance.md` section 5 measures the blanking and ties it to
the speaker in aggregate - `P(dark | speaker loud) = 0.37-0.46` against
`P(dark | quiet) = 0.04` - and states the mechanism as "every time the speaker
sounds". What it does not say is **which** sound, and that is what
`open-questions.md` leaves open: the tube blinks in runs of 133-167 ms roughly
once a second, and the march note as the ROM emits it is 71.8 ms.

This answers the narrower question the open item poses - locate every dark run
and ask what the audio is doing at that instant - by classifying each dark run
by **its own dominant bin**, the way `timing-analysis.md`'s onset analysis
classifies a beep rather than trusting the band it was found in.

Usage, on any window of any recording:

    python3 tools/video/blanking.py ~/Downloads/IMG_6113.mov 210 20

**Every coincidence rate is reported against a phase-shuffled null.** Dark runs
cover a tenth of the timeline and onsets are frequent, so a rate without a null
is not a measurement - the failure mode is a census that finds everything
correlated with everything.

Needs `ffmpeg`. Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))

import clicks as audio  # noqa: E402

FPS = 30.0

# The tube face, as a fraction of the frame. Generous, and it does not need to be
# tight: the question is whether *anything* on the glass is lit, and the case
# outside it contributes nothing to a colour-excess test because it is red only
# in the sense the whole moulding is - a red sprite on a dark tube is what the
# threshold selects, not a red plastic shell in shadow.
TUBE = (0.40, 0.68, 0.50, 0.92)  # y0, y1, x0, x1

# A dark run longer than this is not the sweep pausing for a sound - it is the
# tube between games, or the camera moving.
LONGEST_SOUND_BLANK = 0.6

# Bands named in `audio-reference.md`, used only to *label* a run's own measured
# dominant. Nothing here searches inside a band.
BANDS = (
    (600, 650, "jetMarch"),
    (1480, 1632, "missileFire"),
    (455, 545, "launcherHitWarning"),
)


def extract(video: Path, start: float, length: float, work: Path) -> tuple[np.ndarray, Path]:
    frames = work / "f"
    frames.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-t", str(length),
         "-i", str(video), "-vf", "scale=810:-1", "-an", str(frames / "%04d.png")],
        check=True,
    )
    wav = work / "a.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-t", str(length),
         "-i", str(video), "-vn", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(wav)],
        check=True,
    )
    lit = []
    for path in sorted(frames.glob("*.png")):
        image = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
        height, width = image.shape[:2]
        y0, y1, x0, x1 = TUBE
        box = image[int(y0 * height):int(y1 * height), int(x0 * width):int(x1 * width)]
        red, green, blue = box[..., 0], box[..., 1], box[..., 2]
        cyan = np.minimum(green, blue) - red
        excess = red - np.maximum(green, blue)
        lit.append(int(((cyan > 30) | (excess > 30)).sum()))
    return np.array(lit), wav


def dark_runs(lit: np.ndarray, fraction: float = 0.10):
    """(start, duration) of every dark run, in seconds."""
    level = np.median(lit[lit > 5])
    dark = lit < level * fraction
    runs, index = [], 0
    while index < len(dark):
        if dark[index]:
            end = index
            while end < len(dark) and dark[end]:
                end += 1
            runs.append((index / FPS, (end - index) / FPS))
            index = end
        else:
            index += 1
    return [r for r in runs if r[1] <= LONGEST_SOUND_BLANK], dark


def label(hz: float) -> str:
    for low, high, name in BANDS:
        if low <= hz < high:
            return name
    return "-"


# A fire blip's band, and the share of total energy it must hold to be one.
#
# **A dominant bin is not a detection.** The dark runs this tool labels
# `missileFire` do so on their loudest bin, and their tonality is 0.13-0.40
# against 0.59-0.80 for the march notes - so the label is weak on its own and
# needs corroborating by the band actually being loud. Measured, a real blip
# holds 12-18% of total energy for 20-48 ms; the threshold crossings that are not
# blips last 1-6 ms.
FIRE_BAND = (1480, 1632)
FIRE_MIN_SHARE = 0.12
FIRE_MIN_MS = 15.0


def fire_blips(signal: np.ndarray, rate: int) -> list[tuple[float, float]]:
    """(start, duration) of every event the fire band actually carries."""
    size, hop = 1024, 64
    count = 1 + (len(signal) - size) // hop
    window = np.hanning(size)
    freq = np.fft.rfftfreq(size, 1 / rate)
    band = (freq >= FIRE_BAND[0]) & (freq < FIRE_BAND[1])
    share = np.empty(count)
    for i in range(count):
        spectrum = np.abs(np.fft.rfft(signal[i * hop : i * hop + size] * window))
        share[i] = spectrum[band].sum() / max(spectrum.sum(), 1e-9)
    times = np.arange(count) * hop / rate
    on = share > FIRE_MIN_SHARE
    found, i = [], 0
    while i < count:
        if on[i]:
            j = i
            while j < count and on[j]:
                j += 1
            length = (times[j - 1] - times[i]) * 1000
            if length >= FIRE_MIN_MS:
                found.append((float(times[i]), float(length)))
            i = j
        else:
            i += 1
    merged, last = [], -9.0
    for start, length in found:
        if start - last > 0.08:
            merged.append((start, length))
            last = start
    return merged


def report(video: Path, start: float, length: float) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        lit, wav = extract(video, start, length, Path(tmp))
        signal, rate = audio.read_wav(wav)
        runs, dark = dark_runs(lit)
        span = len(lit) / FPS

        print(f"{video.name}  t = {start}-{start + length} s   {len(lit)} frames")
        print(f"  {dark.mean()*100:.1f}% of frames dark, {len(runs)} runs of "
              f"{LONGEST_SOUND_BLANK*1000:.0f} ms or less")
        if not runs:
            print("  no dark runs - nothing to classify")
            return
        lengths = np.array([d for _, d in runs])
        print(f"  run lengths: median {np.median(lengths)*1000:.0f} ms, "
              f"{np.round(np.sort(lengths)*1000).astype(int).tolist()}")

        # --- is it the speaker at all? ------------------------------------
        starts = np.array([s for s, _ in runs])
        onsets = audio.onsets(signal, rate)
        for window in (0.05, 0.10):
            seen = audio.coincidence(starts, onsets, window)
            expected, p95 = audio.chance(starts, onsets, window, span)
            verdict = "ABOVE CHANCE" if seen > p95 else "at chance"
            print(f"  dark runs within +/-{window*1000:3.0f} ms of an audio onset "
                  f"(n={len(onsets):3d}): {seen*100:3.0f}%  chance {expected*100:3.0f}% "
                  f"(p95 {p95*100:3.0f}%) - {verdict}")

        envelope = audio.envelope(signal, rate, ms=5.0)
        level = np.array([
            envelope[int(f / FPS * rate):int((f + 1) / FPS * rate)].max()
            for f in range(len(lit))
        ])
        loud = level > np.percentile(level, 75)
        print(f"  P(dark | loud) = {dark[loud].mean():.2f}   "
              f"P(dark | quiet) = {dark[~loud].mean():.2f}")

        # --- which sound? classify each run by its own dominant ------------
        print("\n  each dark run, classified by its own dominant bin:")
        print("    at (s)  blank (ms)  dominant (Hz)  tonality  band")
        counts: dict[str, int] = {}
        for at, duration in runs:
            found = audio.dominant(signal, rate, max(0.0, at - 0.02), ms=60.0)
            if found is None:
                continue
            hz, tonality = found
            name = label(hz)
            counts[name] = counts.get(name, 0) + 1
            print(f"    {at:6.2f}  {duration*1000:9.0f}  {hz:13.0f}  {tonality:8.2f}  {name}")
        print("  tally:", ", ".join(f"{k} x{v}" for k, v in sorted(counts.items())))

        # --- does the blank last as long as the sound? --------------------
        print("\n  blank length against the length of the sound under it:")
        threshold = np.percentile(envelope, 80)
        pairs = []
        for at, duration in runs:
            index = int(at * rate)
            low = index
            while low > 0 and envelope[low] > threshold:
                low -= 1
            high = index
            while high < len(envelope) - 1 and envelope[high] > threshold:
                high += 1
            pairs.append((duration * 1000, (high - low) / rate * 1000))
        blanks = np.array([p[0] for p in pairs])
        sounds = np.array([p[1] for p in pairs])
        print(f"    median blank {np.median(blanks):.0f} ms, "
              f"median sound {np.median(sounds):.0f} ms, "
              f"r = {np.corrcoef(blanks, sounds)[0,1]:+.2f} over {len(blanks)} runs")

        # --- does the fire blip blank the display? ------------------------
        #
        # **The null is built for the subset shape.** Blips are rarer than dark
        # runs, so the question is whether a dark run lands on a blip, not
        # whether every blip has a dark run - a one-to-one null would reject on
        # arithmetic before it looked at the data.
        blips = fire_blips(signal, rate)
        print(f"\n  fire blips in {FIRE_BAND[0]}-{FIRE_BAND[1]} Hz holding "
              f">{FIRE_MIN_SHARE*100:.0f}% of energy for >{FIRE_MIN_MS:.0f} ms: {len(blips)}")
        for at, ms in blips:
            print(f"    {at:6.2f} s  {ms:4.0f} ms")
        if blips:
            times = np.array([at for at, _ in blips])
            for window in (0.05, 0.10):
                seen = audio.coincidence(starts, times, window)
                expected, p95 = audio.chance(starts, times, window, span)
                verdict = "ABOVE CHANCE" if seen > p95 else "at chance"
                print(f"    dark runs within +/-{window*1000:3.0f} ms of a blip: "
                      f"{seen*100:3.0f}%  chance {expected*100:3.0f}% (p95 {p95*100:3.0f}%)"
                      f" - {verdict}")
            covered = audio.coincidence(times, starts, 0.10)
            print(f"    and the converse, stated because it is the stronger claim: "
                  f"{covered*100:.0f}% of blips ({int(round(covered*len(times)))} of "
                  f"{len(times)}) have a dark run within 100 ms")


if __name__ == "__main__":
    report(Path(sys.argv[1]).expanduser(), float(sys.argv[2]), float(sys.argv[3]))
