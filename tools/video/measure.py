"""Every figure `docs/evidence/timing-analysis.md` takes from the owner's clip.

    python3 tools/video/clip.py ~/Downloads/'jetfighers video.mov' /tmp/jf
    python3 tools/video/measure.py /tmp/jf

The clip is not committed - it is a 34 MB phone recording and is referenced by
path, as `IMG_6113.mov` is. Paths in this file are relative to the repository
root.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

import clicks as audio  # noqa: E402
import sprites as S  # noqa: E402

FPS = S.FPS
# Where a missile is first seen after it leaves the station, in columns. The
# station itself sits at +5.4, half a cell out from the jets' lattice; the
# missile's own flight columns are offset by the same 0.4.
MISSILE_ENTRY = 4.2


def jet_chains(red, lattice):
    """Tracks that stepped, with the interval between consecutive steps."""
    tracks = S.link(S.components(red, S.FIELD), direction=+1)
    rows = []
    for track in tracks:
        if len(track) < 6:
            continue
        made = S.steps(track, lattice, +1)
        if not made:
            continue
        lanes = sorted({lattice.lane(c["y"]) for c in track})
        intervals = [round((b[0] - a[0]) / FPS * 1000) for a, b in zip(made, made[1:])]
        rows.append({"lane": lanes, "steps": [(f, round(k)) for f, k in made],
                     "intervals": intervals,
                     "from": track[0]["frame"], "to": track[-1]["frame"]})
    return sorted(rows, key=lambda r: r["from"])


def missile_flights(cyan, lattice):
    """Launch frames and per-column step frames for every missile flight."""
    flights = []
    for track in S.link(S.components(cyan, S.CYAN_FIELD, min_area=25), direction=-1):
        if len(track) < 6:
            continue
        columns = [lattice.column(c["x"]) for c in track]
        if columns[0] < MISSILE_ENTRY or columns[0] - columns[-1] < 1.0:
            continue
        made = S.steps(track, lattice, -1)
        flights.append({"launch": track[0]["frame"], "steps": [m[0] for m in made]})
    return sorted(flights, key=lambda f: f["launch"])


def report(work: Path) -> None:
    frames = np.load(work / "frames.npy")
    red, cyan = S.excess(frames)
    span = frames.shape[0] / FPS

    lattice = S.fit_lattice(red)
    print("## Lattice")
    print(f"  {lattice}")

    print("\n## The squadron's column steps")
    chains = jet_chains(red, lattice)
    intervals: list[int] = []
    for row in chains:
        stamps = ", ".join(f"{f/FPS:.2f}s->c{k}" for f, k in row["steps"])
        note = f"intervals {row['intervals']} ms" if row["intervals"] else "single step"
        print(f"  {row['from']/FPS:6.2f}-{row['to']/FPS:6.2f}s lane {row['lane']}: {stamps}  ({note})")
        intervals.extend(row["intervals"])
    array = np.array(intervals)
    print(f"  {len(array)} intervals between two steps of the same aircraft: "
          f"{sorted(array.tolist())} ms")
    if len(array):
        print(f"  median {np.median(array):.0f} ms, mean {array.mean():.0f} ms, "
              f"range {array.min()}-{array.max()} ms, "
              f"quantisation +/-{1000/FPS:.0f} ms per reading")

    print("\n## The player's missile")
    flights = missile_flights(cyan, lattice)
    per_column: list[int] = []
    for flight in flights:
        stamps = flight["steps"]
        per_column.extend([b - a for a, b in zip(stamps, stamps[1:])])
    columns = np.array(per_column)
    print(f"  {len(flights)} flights, {len(columns)} column steps")
    if len(columns):
        counts = np.bincount(columns)
        print("  frames per column: " + ", ".join(
            f"{n}f x{c}" for n, c in enumerate(counts) if c))
        print(f"  median {np.median(columns)/FPS*1000:.0f} ms, "
              f"mean {columns.mean()/FPS*1000:.0f} ms per column")

    print("\n## The audio")
    signal, rate = audio.read_wav(work / "audio.wav")
    lag, strength = audio.repetition(signal, rate)
    print(f"  envelope repetition: strongest lag {lag*1000:.0f} ms, r={strength:.2f}")

    times = audio.onsets(signal, rate)
    classified = [(t, *audio.dominant(signal, rate, t)) for t in times
                  if audio.dominant(signal, rate, t) is not None]
    tonal = [(t, hz, q) for t, hz, q in classified if abs(hz - 2576) < 25 and q > 0.40]
    launches = np.array([f["launch"] / FPS for f in flights])
    print(f"  {len(classified)} onsets; {len(tonal)} of them a tone at 2576 Hz with "
          f"tonality > 0.40")
    if tonal:
        pitches = np.array([hz for _, hz, _ in tonal])
        stamps = np.array([t for t, _, _ in tonal])
        offsets = np.array([stamps[np.argmin(np.abs(stamps - f))] - f for f in launches])
        matched = np.array([np.min(np.abs(launches - t)) <= 0.10 for t, _, _ in tonal])
        print(f"    pitch {pitches.mean():.0f} Hz, sd {pitches.std(ddof=1):.1f} Hz")
        print(f"    {matched.sum()} of {len(tonal)} within 100 ms of a missile launch")
        near = offsets[np.abs(offsets) <= 0.15]
        print(f"    tone leads the visible launch by {-np.median(near)*1000:.0f} ms "
              f"(n={len(near)} of {len(launches)} launches)")

    print("\n  does the transient train keep time with anything visible?")
    steps_seen = np.array(sorted({f / FPS for row in chains for f, _ in row["steps"]}))
    missile_steps = np.array(sorted(f / FPS for flight in flights for f in flight["steps"]))
    for name, events in (("missile launches", launches),
                         ("missile column steps", missile_steps),
                         ("jet column steps", steps_seen)):
        for window in (0.05, 0.10):
            rate_seen = audio.coincidence(times, events, window)
            expected, p95 = audio.chance(times, events, window, span)
            verdict = "above chance" if rate_seen > p95 else "at chance"
            print(f"    onsets within +/-{window*1000:3.0f} ms of {name:21s} (n={len(events):3d}): "
                  f"{rate_seen*100:3.0f}%  chance {expected*100:3.0f}% "
                  f"(p95 {p95*100:3.0f}%) - {verdict}")


if __name__ == "__main__":
    report(Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/jf"))
