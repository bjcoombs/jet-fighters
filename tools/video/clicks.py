"""The clip's audio: where the transients are, and what each one is made of.

The question this exists for is not "what sounds are there" - `audio-reference.md`
answers that from the owner's isolated recordings, which are clean. It is
narrower and it needs the picture: **is a given sound the machine or the person
holding it?** Nothing in a waveform answers that. What answers it is whether the
sound keeps time with something visible.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import wave

import numpy as np
from scipy.ndimage import median_filter


def read_wav(path):
    with wave.open(str(path), "rb") as handle:
        assert handle.getnchannels() == 1 and handle.getsampwidth() == 2
        raw = handle.readframes(handle.getnframes())
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0, handle.getframerate()


def envelope(x: np.ndarray, rate: int, ms: float = 1.0) -> np.ndarray:
    width = max(1, int(rate * ms / 1000))
    return np.convolve(np.abs(x), np.ones(width, np.float32) / width, mode="same")


def onsets(x: np.ndarray, rate: int, factor: float = 6.0, refractory_ms: float = 40.0):
    """Transient onsets against a rolling-median background.

    A fixed threshold cannot be used: the clip's level changes by 8 dB across it.
    The background is the 500 ms rolling median of the envelope, so a burst is
    measured against the noise floor it sits on rather than against the clip's.
    """
    env = envelope(x, rate)
    step = int(rate / 100)
    background = np.interp(
        np.arange(len(env)),
        np.arange(0, len(env), step),
        median_filter(env, size=int(rate * 0.5))[::step],
    )
    above = env > np.maximum(background * factor, 1e-4)
    starts = np.flatnonzero(above & ~np.concatenate([[False], above[:-1]]))
    kept, last = [], -np.inf
    gap = rate * refractory_ms / 1000
    for index in starts:
        if index - last >= gap:
            kept.append(index)
            last = index
    return np.array(kept) / rate


def dominant(x: np.ndarray, rate: int, when: float, ms: float = 30.0):
    """(peak frequency, tonality) of the 30 ms starting at `when`.

    Tonality is the fraction of the band's energy within +/-10% of the peak. It
    is the measurement that separates a *tone* from a *transient*, and it is the
    one that mattered here: a piezo blip is narrow-band and a knock is not, so a
    peak frequency alone says nothing until this number is beside it.
    """
    width = int(rate * ms / 1000)
    start = int(when * rate)
    segment = x[start : start + width]
    if len(segment) < width:
        return None
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(width), 4096))
    frequency = np.fft.rfftfreq(4096, 1 / rate)
    band = (frequency > 150) & (frequency < 8000)
    spectrum, frequency = spectrum[band], frequency[band]
    peak = int(np.argmax(spectrum))
    near = np.abs(frequency - frequency[peak]) < 0.1 * frequency[peak]
    tonality = float((spectrum[near] ** 2).sum() / max((spectrum**2).sum(), 1e-12))
    return float(frequency[peak]), tonality


def repetition(x: np.ndarray, rate: int, low=0.08, high=0.6):
    """The envelope's strongest repetition lag, and how strong it is.

    A period found this way is a real property of the recording. What it *is* is
    a separate question, and this function does not answer it.
    """
    env = envelope(x, rate, ms=2.0)
    decimate = rate // 1000
    coarse = env[: len(env) // decimate * decimate].reshape(-1, decimate).mean(axis=1)
    coarse = coarse - coarse.mean()
    correlation = np.correlate(coarse, coarse, "full")[len(coarse) - 1 :]
    correlation /= correlation[0]
    lags = np.arange(len(correlation)) / 1000.0
    window = (lags > low) & (lags < high)
    peak = int(np.argmax(correlation[window]))
    return float(lags[window][peak]), float(correlation[window][peak])


def coincidence(clicks: np.ndarray, events: np.ndarray, window: float) -> float:
    """Fraction of clicks with an event inside +/-`window`."""
    if len(events) == 0 or len(clicks) == 0:
        return 0.0
    return float(np.mean([np.min(np.abs(events - c)) <= window for c in clicks]))


def chance(clicks, events, window, span, trials=2000, seed=3):
    """The same fraction with the events slid to a random phase.

    **Without this the coincidence rate means nothing.** 120 onsets over 23.2 s
    put one every 194 ms, so a +/-100 ms window covers most of the timeline and
    a high rate is what *any* event list would score.
    """
    rng = np.random.default_rng(seed)
    scores = [coincidence(clicks, np.sort((events + rng.uniform(0, span)) % span), window)
              for _ in range(trials)]
    return float(np.mean(scores)), float(np.percentile(scores, 95))
