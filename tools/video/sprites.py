"""Read the lit sprites off a registered clip, and time what they do.

Colour excess, never luminance, exactly as `docs/evidence/timing-analysis.md`
fixes it: red is `R - max(G,B) > thr`, cyan `min(G,B) - R > thr`. The tube is
multiplexed and a phone shutter is short, so a lit segment is missed in a
minority of frames; every episode rule here tolerates a short gap for that and
none of them tolerates a long one.

Paths in this file are relative to the repository root.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi

FPS = 30.0

# The flying zone inside the registered window. The left bound clears the SCORE
# block, which is lit cyan for most of the clip and would otherwise read as a
# sprite parked at column -2.
FIELD = (112, 195, 100, 420)  # y0, y1, x0, x1
# The same, for cyan: the score digits reach further right than the red field's
# left bound, so cyan needs its own.
CYAN_FIELD = (112, 195, 140, 420)

# Colour excess above which a pixel is lit. Every figure below is recomputed at
# 25, 30 and 40 and is unchanged, which is the same robustness check
# `timing-analysis.md` applies at 28 and 40.
THRESHOLD = 30.0


class Lattice:
    """Cell coordinates on one registered clip.

    **Fitted per clip, never written down.** The registered window's origin
    depends on which frame the registration was anchored to, so a pitch and an
    origin carried over from another run are a coordinate system for a different
    picture. An earlier pass hard-coded them and every lane label came out one
    lane wrong when the reference frame moved.
    """

    def __init__(self, pitch: float, origin: float, lanes, residual: float, inliers: int):
        self.pitch = pitch
        self.origin = origin
        self.lanes = tuple(lanes)
        self.residual = residual
        self.inliers = inliers

    def column(self, x: float) -> float:
        return (x - self.origin) / self.pitch

    def lane(self, y: float) -> int:
        return int(np.argmin([abs(y - centre) for centre in self.lanes]))

    def __repr__(self) -> str:
        return (f"Lattice(pitch={self.pitch:.2f}, origin={self.origin:.2f}, "
                f"lanes={tuple(round(c, 1) for c in self.lanes)}, "
                f"residual={self.residual:.2f} px over {self.inliers} centres)")


def excess(frames: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(red, cyan) colour excess for every frame."""
    f = frames.astype(np.float32)
    red, green, blue = f[..., 0], f[..., 1], f[..., 2]
    return red - np.maximum(green, blue), np.minimum(green, blue) - red


def sprite_centres(red: np.ndarray, threshold: float = 45.0, min_area: int = 60):
    """Where a red sprite was ever lit, as blob centres of the max projection."""
    y0, y1, x0, x1 = FIELD
    inside = np.zeros(red.shape[1:], bool)
    inside[y0:y1, x0:x1] = True
    labels, count = ndi.label((red.max(axis=0) > threshold) & inside)
    sizes = np.bincount(labels.ravel())[1:]
    return [tuple(float(v) for v in ndi.center_of_mass(labels == index))
            for index in range(1, count + 1) if sizes[index - 1] >= min_area]


def fit_lattice(red: np.ndarray) -> Lattice:
    """Fit the cell lattice to where red sprites were ever seen.

    The sprites are the only thing on this clip that lands on the lattice often
    enough to fit it. The print's cell rules are visible but the ruler's ticks are
    finer than the cells and a profile finder walks onto them - so this is a
    weaker anchor than `tools/trace/lattice.py`'s printed one, and it is recorded
    as weaker. What makes it usable is that the fit is heavily over-determined
    (a dozen-plus centres, six columns) and that it is **allowed to fail**: the
    residual it reports is measured over the centres it claims, so a lattice the
    sprites had invented for themselves could not come out at a fraction of a
    pixel by accident.

    The fit is robust rather than least-squares. Two of the centres sit off the
    lattice - one is the battleship, which is wider than a cell and sits half a
    column out, and one is a burst spanning two cells - and a least-squares fit
    lets either drag the origin a third of a cell.
    """
    centres = sprite_centres(red)
    xs = np.array(sorted(c[1] for c in centres))
    ys = np.array([c[0] for c in centres])

    best = None
    for pitch in np.arange(36.0, 42.0, 0.02):
        for origin in np.arange(xs.min() - pitch / 2, xs.min() + pitch / 2, 0.1):
            residual = np.abs(xs - (origin + pitch * np.round((xs - origin) / pitch)))
            inliers = residual <= 3.0
            score = (int(inliers.sum()), -float(residual[inliers].max() if inliers.any() else 9e9))
            if best is None or score > best[0]:
                best = (score, float(pitch), float(origin), inliers)
    _, pitch, origin, inliers = best
    # Put the origin on the leftmost *inlier* so column indices are stable.
    origin = origin + pitch * round((xs[inliers].min() - origin) / pitch)
    residual = np.abs(xs[inliers] - (origin + pitch * np.round((xs[inliers] - origin) / pitch)))

    # Three lanes, fitted the same robust way and for the same reason: a sprite
    # straddling a lane boundary drags a cluster mean, and `timing-analysis.md`'s
    # Trap 1 is precisely a lane band that has moved onto its neighbour.
    lane_best = None
    for lane_pitch in np.arange(15.0, 28.0, 0.05):
        for top in np.arange(ys.min() - 4, ys.min() + 5, 0.1):
            centres_y = top + lane_pitch * np.arange(3)
            offsets = np.abs(ys[:, None] - centres_y[None, :]).min(axis=1)
            score = (int((offsets <= 3.0).sum()), -float(offsets[offsets <= 3.0].sum()))
            if lane_best is None or score > lane_best[0]:
                lane_best = (score, centres_y)
    return Lattice(pitch, origin, lane_best[1], float(residual.max()), int(inliers.sum()))


def components(field: np.ndarray, bounds, threshold=THRESHOLD, min_area=40):
    """Connected lit regions per frame, with centroid and lit width."""
    y0, y1, x0, x1 = bounds
    inside = np.zeros(field.shape[1:], bool)
    inside[y0:y1, x0:x1] = True
    per_frame = []
    for index in range(field.shape[0]):
        labels, count = ndi.label((field[index] > threshold) & inside)
        found = []
        for i in range(1, count + 1):
            mask = labels == i
            area = int(mask.sum())
            if area < min_area:
                continue
            cy, cx = ndi.center_of_mass(mask)
            ys, xs = np.nonzero(mask)
            found.append({"frame": index, "y": float(cy), "x": float(cx), "area": area,
                          "w": int(xs.max() - xs.min() + 1)})
        per_frame.append(found)
    return per_frame


def link(per_frame, direction: int, max_step=48.0, max_lane_drift=8.0, max_gap=5):
    """Nearest-neighbour linking, constrained to one direction of travel.

    `direction` is +1 for the squadron (which marches toward the G line) and -1
    for the player's missile (which flies away from it). **The constraint is what
    makes a track a track**: allowing either direction joins a jet that was just
    shot down to a different jet entering behind it, and the join reads as a step
    in the wrong direction. Two of those appeared in the first pass here.
    """
    tracks, live = [], []
    for index, found in enumerate(per_frame):
        used = set()
        for track in list(live):
            last = track[-1]
            if index - last["frame"] > max_gap:
                live.remove(track)
                tracks.append(track)
                continue
            best, best_distance = None, np.inf
            for j, candidate in enumerate(found):
                if j in used:
                    continue
                dx = (candidate["x"] - last["x"]) * direction
                dy = abs(candidate["y"] - last["y"])
                if dx < -8.0 or dx > max_step or dy > max_lane_drift:
                    continue
                distance = abs(dx) + 2 * dy
                if distance < best_distance:
                    best, best_distance = j, distance
            if best is not None:
                used.add(best)
                track.append(found[best])
        for j, candidate in enumerate(found):
            if j not in used:
                live.append([candidate])
    tracks.extend(live)
    return tracks


def steps(track, lattice: Lattice, direction: int, tolerance=0.30):
    """Frames at which the track first occupies the next cell along.

    The onset is the first frame in which the sprite is *measured* at the new
    column, which is the definition `timing-analysis.md` fixes for a stepping
    sprite. The tolerance is a third of a cell: a sprite mid-handoff reads
    between two columns, and a reading that is neither is a track that has jumped
    to a different object rather than a step.

    **The held column starts at the track's own first reading, not at the nearest
    integer.** The player's missile flies on a lattice offset half a cell from
    the jets' - it sits at +4.4, +3.4, +2.4 - so rounding its start to 4 makes
    every subsequent step miss the tolerance and the flight reads as motionless.
    That is exactly the false *absence* of motion `timing-analysis.md` warns
    about, arrived at by arithmetic instead of by a stalled tube.
    """
    out = []
    held = lattice.column(track[0]["x"])
    for entry in track[1:]:
        here = lattice.column(entry["x"])
        if abs(here - (held + direction)) <= tolerance:
            held += direction
            out.append((entry["frame"], held))
        elif abs(here - held) > tolerance:
            held = here
    return out
