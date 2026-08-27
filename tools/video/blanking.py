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
            # Start-to-start, and **not** start-to-end-of-the-last-window.
            # Reviewed as a bug on the reasoning that the sound is still
            # sounding through the final window's own 23.2 ms span, so omitting
            # it makes every duration short. Calibrated against tone bursts of
            # known length, that reasoning is wrong and the correction is worse
            # than the defect - see `calibrate` below. The windows overlap
            # sixteen to one, so the first qualifying window starts slightly
            # *before* the note and the last slightly before its end; the two
            # offsets very nearly cancel.
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


# The band the blanking notes live in, and the share of total energy a note must
# hold. Separate from FIRE_BAND: this one is `jetMarch`'s.
NOTE_BAND = (600, 660)
NOTE_MIN_SHARE = 0.08
NOTE_MIN_MS = 60.0


def band_notes(signal: np.ndarray, rate: int) -> list[float]:
    """Durations of every sustained note in {@link NOTE_BAND}, in ms.

    **Committed because the figure it produces was quoted before it was
    re-derivable.** `open-questions.md` §16 states the blanking windows' notes as
    130-210 ms and 103-288 ms, and those came from a scratch pass that lived
    nowhere. A length quoted in a document with no tool behind it is exactly what
    this directory exists to stop.
    """
    size, hop = 1024, 64
    count = 1 + (len(signal) - size) // hop
    window = np.hanning(size)
    freq = np.fft.rfftfreq(size, 1 / rate)
    band = (freq >= NOTE_BAND[0]) & (freq < NOTE_BAND[1])
    share = np.empty(count)
    for i in range(count):
        spectrum = np.abs(np.fft.rfft(signal[i * hop : i * hop + size] * window))
        share[i] = spectrum[band].sum() / max(spectrum.sum(), 1e-9)
    times = np.arange(count) * hop / rate
    on = share > NOTE_MIN_SHARE
    found, i = [], 0
    while i < count:
        if on[i]:
            j = i
            while j < count and on[j]:
                j += 1
            # Start-to-start; see `fire_blips` and `calibrate`.
            length = (times[j - 1] - times[i]) * 1000
            if length >= NOTE_MIN_MS:
                found.append(float(length))
            i = j
        else:
            i += 1
    return found


def calibrate(rate: int = 44100) -> list[tuple[int, float, float]]:
    """Measure both length estimators against notes of known duration.

    **The check that decides between two defensible readings of the same code.**
    A review held that `length` should run to the *end* of the last qualifying
    window rather than to its start, on the ground that the note is still
    sounding through that window's 23.2 ms. That is sound reasoning and it is
    empirically wrong, because the windows overlap sixteen to one: the first
    qualifying window starts before the note and the last starts before the
    note's end, and the offsets nearly cancel.

    Measured on 626 Hz bursts in noise, reported minus true:

    | true | start-to-start | plus the window span |
    | 60   | +7             | +30                  |
    | 100  | +7             | +31                  |
    | 200  | +6             | +29                  |
    | 300  | +6             | +29                  |

    So the estimator in use is long by about 6-7 ms - a quarter of a window -
    and the proposed correction would make it long by about 30. Every duration
    quoted from this tool carries that +6-7 ms, which is well inside the
    distinctions §16 draws with them and is recorded rather than removed.

    Run it with `python3 tools/video/blanking.py --calibrate`.
    """
    import numpy as _np

    rng = _np.random.default_rng(3)
    size, hop = 1024, 64
    out = []
    for true_ms in (60, 80, 100, 150, 200, 300):
        signal = rng.normal(0, 0.004, int(rate * 2.0))
        start = int(rate * 0.6)
        stop = start + int(rate * true_ms / 1000)
        span = _np.arange(stop - start) / rate
        signal[start:stop] += _np.sign(_np.sin(2 * _np.pi * 626 * span)) * 0.25
        signal = signal.astype(_np.float32)
        count = 1 + (len(signal) - size) // hop
        window = _np.hanning(size)
        freq = _np.fft.rfftfreq(size, 1 / rate)
        band = (freq >= NOTE_BAND[0]) & (freq < NOTE_BAND[1])
        share = _np.empty(count)
        for i in range(count):
            spectrum = _np.abs(_np.fft.rfft(signal[i * hop : i * hop + size] * window))
            share[i] = spectrum[band].sum() / max(spectrum.sum(), 1e-9)
        times = _np.arange(count) * hop / rate
        on = share > NOTE_MIN_SHARE
        i, plain, padded = 0, [], []
        while i < count:
            if on[i]:
                j = i
                while j < count and on[j]:
                    j += 1
                plain.append((times[j - 1] - times[i]) * 1000)
                padded.append((times[j - 1] - times[i] + size / rate) * 1000)
                i = j
            else:
                i += 1
        if plain:
            out.append((true_ms, plain[0] - true_ms, padded[0] - true_ms))
    return out


def report(video: Path, start: float, length: float) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        lit, wav = extract(video, start, length, Path(tmp))
        signal, rate = audio.read_wav(wav)
        runs, dark = dark_runs(lit)
        span = len(lit) / FPS

        print(f"{video.name}  t = {start}-{start + length} s   {len(lit)} frames")
        print(f"  {dark.mean()*100:.1f}% of frames dark, {len(runs)} runs of "
              f"{LONGEST_SOUND_BLANK*1000:.0f} ms or less")
        # --- how long are the notes in the band the blanks belong to? -----
        #
        # **Printed before the dark-run early return, deliberately.** The window
        # this section's argument turns on is t=120, which has notes and *no*
        # blanking - so a census that only ran when dark runs existed would be
        # silent about the one case that discriminates.
        notes = band_notes(signal, rate)
        if notes:
            print(f"  sustained {NOTE_BAND[0]}-{NOTE_BAND[1]} Hz notes "
                  f"(>{NOTE_MIN_SHARE*100:.0f}% of energy for >{NOTE_MIN_MS:.0f} ms): "
                  f"{len(notes)}, {min(notes):.0f}-{max(notes):.0f} ms")
        else:
            print(f"  no sustained {NOTE_BAND[0]}-{NOTE_BAND[1]} Hz note in this window")

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
    if sys.argv[1:2] == ["--calibrate"]:
        print("note duration estimator, reported minus true (ms):")
        print("  true   start-to-start   plus the window span")
        for true_ms, plain, padded in calibrate():
            print(f"  {true_ms:4d}   {plain:+14.1f}   {padded:+20.1f}")
    else:
        report(Path(sys.argv[1]).expanduser(), float(sys.argv[2]), float(sys.argv[3]))
