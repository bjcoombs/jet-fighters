#!/usr/bin/env python3
"""Turn pixel reads off the reference photographs into millimetres.

Input:  tools/model/pixels.json  - named pixel coordinates, one block per photograph,
                                   each read marked with how it was taken.
Output: tools/model/dimensions.json - every figure the Blender script consumes, in mm,
                                      each marked measured or estimated with its source.

Scale
-----
The board photograph (``board-L1001568.jpg``) carries the one object of known size:
the TMS1370, a 40-pin DIP whose pin pitch is 2.54 mm. Its pitch in pixels gives the
scale *at the board plane*. The shell's rim is nearer the camera than the board, so a
read on the rim is corrected by the ratio of the two distances, which the camera model
(28 mm on full frame, full-frame file) lets us solve for: the shell's angular width
fixes the rim distance for a given shell width, and the shell width follows from the
rim distance. Two iterations converge.

The front photograph has nothing of known size in it. It is scaled from the shell
width derived on the board photograph; everything read on it lies in the face plane,
so one factor serves.

Run ``python3 tools/model/measure.py`` from the repo root. ``--overlay docs/evidence``
also writes each photograph with its reads drawn on (``console-dimensions-board.jpg``,
``console-dimensions-front.jpg``), which is how a read is checked and is what
``docs/evidence/console-dimensions.md`` shows.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIXELS = ROOT / "tools/model/pixels.json"
DIMENSIONS = ROOT / "tools/model/dimensions.json"


def _r(value: float, places: int = 1) -> float:
    return round(value + 0.0, places)


class Dims:
    """Accumulates named dimensions with their provenance."""

    def __init__(self) -> None:
        self.entries: dict[str, dict] = {}

    def measured(self, name: str, value, source: str, note: str | None = None) -> None:
        e = {"value": value, "kind": "measured", "source": source}
        if note:
            e["note"] = note
        self.entries[name] = e

    def estimated(self, name: str, value, basis: str, bound_mm: float) -> None:
        self.entries[name] = {
            "value": value,
            "kind": "estimated",
            "basis": basis,
            "bound_mm": bound_mm,
        }


def board_scale(px: dict) -> tuple[float, float, dict]:
    """mm per pixel at the board plane and at the rim plane of the board photograph."""
    photo = px["photographs"]["board"]
    bar = photo["scale_bar"]
    s_board = bar["pitch_mm"] / bar["pitch_px"]

    cam = photo["camera"]
    width_px = photo["size"][0]
    hfov = 2 * math.atan(cam["sensor_width_mm"] / (2 * cam["focal_length_mm"]))
    shell = px["board"]["shell"]
    shell_px = shell["right"] - shell["left"]
    ang = 2 * math.atan((shell_px / width_px) * math.tan(hfov / 2))
    rim_above = shell["rim_above_board_mm"]["value"]

    # Iterate: shell width -> rim distance -> board distance -> rim scale -> width.
    width_mm = shell_px * s_board
    for _ in range(8):
        d_rim = (width_mm / 2) / math.tan(ang / 2)
        d_board = d_rim + rim_above
        s_rim = s_board * d_rim / d_board
        width_mm = shell_px * s_rim
    detail = {
        "mm_per_px_board": _r(s_board, 5),
        "mm_per_px_rim": _r(s_rim, 5),
        "perspective_factor": _r(s_rim / s_board, 4),
        "rim_distance_mm": _r(d_rim, 0),
        "horizontal_fov_deg": _r(math.degrees(hfov), 1),
        "shell_angular_width_deg": _r(math.degrees(ang), 1),
    }
    return s_board, s_rim, detail


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pixels", type=Path, default=PIXELS)
    ap.add_argument("--out", type=Path, default=DIMENSIONS)
    ap.add_argument("--overlay", type=Path, help="directory to write annotated photographs into")
    args = ap.parse_args(argv)

    px = json.loads(args.pixels.read_text())
    s_board, s_rim, scale_detail = board_scale(px)
    d = Dims()
    B = px["board"]
    F = px["front"]
    src_b = "board-L1001568.jpg"
    src_f = "device-front-lit.jpg"

    # ---- The case envelope, from the back shell's rim ------------------------------
    sh = B["shell"]
    case_w = (sh["right"] - sh["left"]) * s_rim
    d.measured("case.width", _r(case_w), f"{src_b} shell.left..right, rim scale")
    module_h_b = (sh["module_bottom"] - sh["module_top"]) * s_rim
    wing_h_b = (sh["wing_bottom"] - sh["wing_top"]) * s_rim

    # The front photograph is scaled from the case width.
    fs = F["shell"]
    s_front = case_w / (fs["right"] - fs["left"])
    scale_detail["mm_per_px_front"] = _r(s_front, 5)

    module_h_f = (fs["module_bottom"] - fs["module_top"]) * s_front
    wing_h_f = (fs["wing_bottom"] - fs["wing_top"]) * s_front
    d.measured(
        "case.module_height",
        _r((module_h_b + module_h_f) / 2),
        f"mean of {src_b} ({_r(module_h_b)}) and {src_f} ({_r(module_h_f)})",
    )
    d.measured(
        "case.wing_height",
        _r((wing_h_b + wing_h_f) / 2),
        f"mean of {src_b} ({_r(wing_h_b)}) and {src_f} ({_r(wing_h_f)})",
    )
    d.measured(
        "case.wing_top_below_module_top",
        _r((fs["wing_top"] - fs["module_top"]) * s_front),
        f"{src_f} shell.wing_top - module_top",
    )
    d.measured(
        "case.wing_bottom_below_module_bottom",
        _r((fs["wing_bottom"] - fs["module_bottom"]) * s_front),
        f"{src_f} shell.wing_bottom - module_bottom",
    )

    # Bands across the face, as x ranges from the case's left edge.
    bands = F["bands"]
    x0 = fs["left"]

    def band(name: str, key: str) -> None:
        a, b = bands[key]
        d.measured(f"face.{name}_x", [_r((a - x0) * s_front), _r((b - x0) * s_front)], f"{src_f} bands.{key}")

    band("left_block", "left_block_x")
    band("left_strip", "left_strip_x")
    band("module", "module_x")
    band("right_strip", "right_strip_x")
    band("right_block", "right_block_x")
    module_w_b = (sh["module_right"] - sh["module_left"]) * s_rim
    module_w_f = (bands["module_x"][1] - bands["module_x"][0]) * s_front
    d.measured(
        "face.module_width_crosscheck",
        {"board_photo": _r(module_w_b), "front_photo": _r(module_w_f)},
        f"{src_b} shell.module_left..right against {src_f} bands.module_x",
        "The board photograph reads the module's outer wall at the rim; the front reads the raised face. Model uses the front read.",
    )

    # Scope window, in face mm from the case's top-left corner (module top).
    sc = F["scope"]
    y0 = fs["module_top"]

    def fx(x: float) -> float:
        return _r((x - x0) * s_front)

    def fy(y: float) -> float:
        return _r((y - y0) * s_front)

    d.measured("scope.circle_centre", [fx(sc["circle_centre"][0]), fy(sc["circle_centre"][1])], f"{src_f} scope.circle_centre")
    d.measured("scope.circle_radius", _r(sc["circle_radius"] * s_front), f"{src_f} scope.circle_radius")
    d.measured("scope.rect", {"left": fx(sc["rect_left"]), "top": fy(sc["rect_top"]), "bottom": fy(sc["rect_bottom"])}, f"{src_f} scope.rect_*")
    tab = F["tab"]
    d.measured("scope.tab", {"x": [fx(tab["x"][0]), fx(tab["x"][1])], "y": [fy(tab["y"][0]), fy(tab["y"][1])]}, f"{src_f} tab")

    # Controls on the face.
    fb = F["fire_button"]
    d.measured("controls.fire.centre", [fx(fb["centre"][0]), fy(fb["centre"][1])], f"{src_f} fire_button.centre")
    d.measured("controls.fire.cap_radius", _r(fb["cap_radius"] * s_front), f"{src_f} fire_button.cap_radius")
    d.measured("controls.fire.ring_radius", _r(fb["ring_radius"] * s_front), f"{src_f} fire_button.ring_radius")
    d.measured("controls.fire.body_radius", _r(B["fire_button_body"]["radius"] * s_board), f"{src_b} fire_button_body.radius", "The switch body under the cap, seen from inside.")
    ps = F["power_switch"]
    d.measured("controls.power.thumb_centre", [fx(ps["thumb_centre"][0]), fy(ps["thumb_centre"][1])], f"{src_f} power_switch.thumb_centre")
    d.measured("controls.power.thumb_size", [_r(ps["thumb_size"][0] * s_front), _r(ps["thumb_size"][1] * s_front)], f"{src_f} power_switch.thumb_size")
    d.measured("controls.power.travel_y", [fy(ps["travel_y"][0]), fy(ps["travel_y"][1])], f"{src_f} power_switch.travel_y")
    lw = F["lever_well"]
    d.measured("controls.lever.well_centre", [fx(lw["centre"][0]), fy(lw["centre"][1])], f"{src_f} lever_well.centre")
    d.measured("controls.lever.well_radius", _r(lw["radius"] * s_front), f"{src_f} lever_well.radius")
    d.measured("controls.lever.slot", {"x": [fx(lw["slot_x"][0]), fx(lw["slot_x"][1])], "y": [fy(lw["slot_y"][0]), fy(lw["slot_y"][1])]}, f"{src_f} lever_well.slot_*")
    d.measured("controls.lever.pin_y_positions", [fy(y) for y in lw["pin_y_positions"]], f"{src_f} lever_well.pin_y_positions", "Top, middle, bottom lane.")
    d.measured("controls.lever.disc_radius", _r(B["lever_disc"]["radius"] * s_board), f"{src_b} lever_disc.radius", "The disc the pin rides on, inside.")
    sk = F["skill_flag"]
    d.measured("controls.skill.hub_centre", [fx(sk["hub_centre"][0]), fy(sk["hub_centre"][1])], f"{src_f} skill_flag.hub_centre")
    d.measured("controls.skill.hub_radius", _r(sk["hub_radius"] * s_front), f"{src_f} skill_flag.hub_radius")
    d.measured("controls.skill.flag_length", _r(math.hypot(sk["tip"][0] - sk["hub_centre"][0], sk["tip"][1] - sk["hub_centre"][1]) * s_front), f"{src_f} skill_flag.tip - hub_centre")
    d.measured("controls.skill.mark_radius", _r(sk["mark_radius"] * s_front), f"{src_f} skill_flag.mark_radius")
    st = F["sticker"]
    d.measured("face.sticker", {"x": [fx(st["x"][0]), fx(st["x"][1])], "y": [fy(st["y"][0]), fy(st["y"][1])]}, f"{src_f} sticker")

    # ---- Inside, from the board photograph. Board-plane scale, origin the shell's
    # top-left corner (module top, left edge) so the two photographs share a frame.
    bx0 = sh["left"]
    by0 = sh["module_top"]

    def bx(x: float) -> float:
        return _r((x - bx0) * s_board)

    def by(y: float) -> float:
        return _r((y - by0) * s_board)

    def bxr(a, b) -> list[float]:
        return [bx(a), bx(b)]

    def byr(a, b) -> list[float]:
        return [by(a), by(b)]

    pcb = B["pcb"]
    d.measured("pcb.x", bxr(*pcb["x"]), f"{src_b} pcb.x")
    d.measured("pcb.y", byr(*pcb["y"]), f"{src_b} pcb.y")
    d.measured("pcb.outline", [[bx(x), by(y)] for x, y in pcb["outline"]], f"{src_b} pcb.outline", "Corners clockwise from top-left, in plan.")
    d.estimated("pcb.thickness", 1.6, "Standard single-sided phenolic board of the period.", 0.4)

    tube = B["tube"]
    d.measured("tube.shroud_x", bxr(*tube["shroud_x"]), f"{src_b} tube.shroud_x")
    d.measured("tube.shroud_y", byr(*tube["shroud_y"]), f"{src_b} tube.shroud_y")
    d.measured("tube.glass_x", bxr(*tube["glass_x"]), f"{src_b} tube.glass_x")
    d.measured("tube.glass_y", byr(*tube["glass_y"]), f"{src_b} tube.glass_y")
    d.measured("tube.face_x", bxr(*tube["face_x"]), f"{src_b} tube.face_x")
    d.measured("tube.face_y", byr(*tube["face_y"]), f"{src_b} tube.face_y")
    d.estimated("tube.thickness", 11.0, "Flat VFD envelopes of this size are 9-12 mm thick, front glass to back glass. No side view exists.", 2.0)
    d.estimated("tube.face_above_board", 8.0, "The envelope sits on its shroud on the board; the phosphor is on the back glass, the segments read through the front glass.", 3.0)

    chip = B["chip"]
    d.measured("chip.pins_x", bxr(*chip["pins_x"]), f"{src_b} chip.pins_x", "20 pins a side; the body is 0.6 in wide by convention for this package.")
    d.measured("chip.body_y", byr(*chip["body_y"]), f"{src_b} chip.body_y")
    d.measured("chip.body_length", _r((chip["body_x"][1] - chip["body_x"][0]) * s_board), f"{src_b} chip.body_x", "A 40-pin 0.6 in DIP body is 51.5-52.6 mm; this is the check on the scale bar.")

    bb = B["battery_box"]
    d.measured("battery_box.x", bxr(*bb["x"]), f"{src_b} battery_box.x")
    d.measured("battery_box.y", byr(*bb["y"]), f"{src_b} battery_box.y")
    d.estimated("battery_box.height", 28.0, "The box is as tall as the cells it holds plus a wall; no side view. Sized to the rim height.", 6.0)

    for name in ("power_switch_body", "dc_jack", "resistor_row", "lamp"):
        e = B[name]
        d.measured(f"{name}.x", bxr(*e["x"]), f"{src_b} {name}.x")
        d.measured(f"{name}.y", byr(*e["y"]), f"{src_b} {name}.y")
    d.measured("resistor_row.count", B["resistor_row"]["count"], f"{src_b} resistor_row.count")
    for name in ("fire_button_body", "lever_disc", "skill_hub", "buzzer"):
        e = B[name]
        d.measured(f"{name}.centre", [bx(e["centre"][0]), by(e["centre"][1])], f"{src_b} {name}.centre")
        if "radius" in e:
            d.measured(f"{name}.radius", _r(e["radius"] * s_board), f"{src_b} {name}.radius")
    d.measured("lever_disc.pin", {"x": bxr(*B["lever_disc"]["pin_x"]), "y": byr(*B["lever_disc"]["pin_y"])}, f"{src_b} lever_disc.pin_*")
    so = B["standoffs"]
    d.measured("standoffs.centres", [[bx(x), by(y)] for x, y in so["centres"]], f"{src_b} standoffs.centres")
    d.measured("standoffs.radius", _r(so["radius"] * s_board), f"{src_b} standoffs.radius")
    d.measured("screws.centres", [[bx(x), by(y)] for x, y in B["screws"]["centres"]], f"{src_b} screws.centres")
    d.measured("electrolytics.cans", [[bx(a), by(b), bx(c), by(e)] for a, b, c, e in B["electrolytics"]["cans"]], f"{src_b} electrolytics.cans")

    # ---- Cross-check against the flat page's SVG, scaled so its body width is the
    # measured case width. Reported, not used: the model follows the photographs.
    svg = px["svg"]
    u = case_w / (svg["body_x"][1] - svg["body_x"][0])
    sx0, sy0 = svg["body_x"][0], svg["module_y"][0]

    def ux(x: float) -> float:
        return _r((x - sx0) * u)

    def uy(y: float) -> float:
        return _r((y - sy0) * u)

    cx_, cy_, cr = svg["circle"]
    rx, ry, rw, rh = svg["rect"]
    d.measured(
        "svg_crosscheck",
        {
            "mm_per_unit": _r(u, 4),
            "module_height": {"svg": uy(svg["module_y"][1]), "photo": d.entries["case.module_height"]["value"]},
            "wing_height": {"svg": _r((svg["wing_y"][1] - svg["wing_y"][0]) * u), "photo": d.entries["case.wing_height"]["value"]},
            "module_x": {"svg": [ux(svg["module_x"][0]), ux(svg["module_x"][1])], "photo": d.entries["face.module_x"]["value"]},
            "circle_centre": {"svg": [ux(cx_), uy(cy_)], "photo": d.entries["scope.circle_centre"]["value"]},
            "circle_radius": {"svg": _r(cr * u), "photo": d.entries["scope.circle_radius"]["value"]},
            "rect_left": {"svg": ux(rx), "photo": d.entries["scope.rect"]["value"]["left"]},
            "rect_top": {"svg": uy(ry), "photo": d.entries["scope.rect"]["value"]["top"]},
            "rect_bottom": {"svg": uy(ry + rh), "photo": d.entries["scope.rect"]["value"]["bottom"]},
        },
        "src/ui/geometry.ts and src/ui/case.ts, scaled so the SVG body width equals case.width",
        "Where the two disagree the model follows the photographs and the SVG is left alone.",
    )

    # ---- Depth. Nothing photographs the unit edge-on, so every figure here is an
    # estimate with its basis; the bound is what a side view would be expected to move it by.
    d.estimated("depth.rim_above_board", sh["rim_above_board_mm"]["value"], sh["rim_above_board_mm"]["$comment"], 10.0)
    d.estimated("depth.back_shell", 22.0, "Board 5 mm off the back floor on its bosses, rim 15 mm above the board, 2 mm wall.", 6.0)
    d.estimated("depth.front_shell_wing", 14.0, "Wing face must clear the fire switch body and the lever disc; both about 12 mm tall over the board.", 5.0)
    d.estimated("depth.front_shell_module", 20.0, "Module face must clear the tube (11 mm) on its shroud plus the window glass; and the module stands proud of the wings by a visible step.", 5.0)
    d.estimated("depth.window_recess", 2.0, "The silkscreened smoked window sits a little below the module face, inside a lip.", 1.0)
    d.estimated("depth.wall", 2.0, "Injection-moulded ABS of the period.", 0.5)
    d.estimated("depth.fire_cap_height", 6.0, "The cap stands proud of its ring in device-front-lit.jpg by about its own radius's quarter.", 2.0)
    d.estimated("depth.lever_pin_height", 4.0, "The steel pin protrudes from the well floor to just under the wing face.", 2.0)
    d.estimated("depth.skill_flag_height", 5.0, "The blue flag sits on a hub proud of the face.", 2.0)

    out = {
        "$comment": "Generated by tools/model/measure.py from tools/model/pixels.json. Do not edit; change a read there and re-run. Units mm. Origin for face.* and scope.* and controls.*: the case's top-left corner at the module's top edge, x right, y down, on the front face. Origin for pcb.*, tube.*, chip.* and the rest: the same corner in plan, at the board plane.",
        "scale": scale_detail,
        "dimensions": dict(sorted(d.entries.items())),
    }
    args.out.write_text(json.dumps(out, indent=2, sort_keys=False) + "\n")
    print(f"wrote {args.out.relative_to(ROOT)}: {len(d.entries)} dimensions, case width {d.entries['case.width']['value']} mm")

    if args.overlay:
        write_overlays(px, args.overlay)
    return 0


def write_overlays(px: dict, out_dir: Path) -> None:
    """Draw every read on its photograph so it can be checked by eye."""
    from PIL import Image, ImageDraw  # optional dependency, only for --overlay

    out_dir.mkdir(parents=True, exist_ok=True)
    for key, photo in px["photographs"].items():
        im = Image.open(ROOT / photo["file"]).convert("RGB")
        dr = ImageDraw.Draw(im)
        lw = max(2, im.width // 1000)
        reads = px[key]

        def rect(x0, y0, x1, y1, col):
            dr.rectangle([x0, y0, x1, y1], outline=col, width=lw)

        def circ(cx, cy, r, col):
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=lw)

        for name, e in reads.items():
            if name in ("shell", "bands"):
                continue
            col = (0, 255, 0)
            if "x" in e and "y" in e and isinstance(e["x"], list):
                rect(e["x"][0], e["y"][0], e["x"][1], e["y"][1], col)
            if "centre" in e and "radius" in e:
                circ(*e["centre"], e["radius"], (0, 200, 255))
            if "centres" in e:
                for cx, cy in e["centres"]:
                    circ(cx, cy, e.get("radius", 20), (255, 0, 255))
            for k in ("shroud", "glass", "face", "body", "slot"):
                if f"{k}_x" in e and f"{k}_y" in e:
                    rect(e[f"{k}_x"][0], e[f"{k}_y"][0], e[f"{k}_x"][1], e[f"{k}_y"][1], (255, 255, 0))
            if "pins_x" in e:
                dr.line([e["pins_x"][0], e["pin_row_top_y"], e["pins_x"][1], e["pin_row_top_y"]], fill=(255, 0, 0), width=lw)
            if "cans" in e:
                for a, b, c, d_ in e["cans"]:
                    rect(a, b, c, d_, (255, 128, 0))
            if "circle_centre" in e:
                circ(*e["circle_centre"], e["circle_radius"], (0, 255, 255))
                dr.line([e["rect_left"], e["rect_top"], e["rect_left"], e["rect_bottom"]], fill=(0, 255, 255), width=lw)
                dr.line([e["rect_left"], e["rect_top"], e["circle_centre"][0], e["rect_top"]], fill=(0, 255, 255), width=lw)
                dr.line([e["rect_left"], e["rect_bottom"], e["circle_centre"][0], e["rect_bottom"]], fill=(0, 255, 255), width=lw)
            if "cap_radius" in e:
                circ(*e["centre"], e["cap_radius"], (0, 200, 255))
                circ(*e["centre"], e["ring_radius"], (0, 200, 255))
            if "thumb_centre" in e:
                cx, cy = e["thumb_centre"]
                w, h = e["thumb_size"]
                rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, (0, 200, 255))
            if "hub_centre" in e:
                circ(*e["hub_centre"], e["hub_radius"], (0, 200, 255))
                dr.line([*e["hub_centre"], *e["tip"]], fill=(0, 200, 255), width=lw)
            if "outline" in e:
                pts = [(x, y) for x, y in e["outline"]]
                dr.line(pts + pts[:1], fill=(255, 0, 255), width=lw)
        sh = reads["shell"]
        rect(sh["left"], sh["module_top"], sh["right"], sh["module_bottom"], (255, 0, 0))
        rect(sh["left"], sh["wing_top"], sh["right"], sh["wing_bottom"], (255, 128, 128))
        if "module_left" in sh:
            dr.line([sh["module_left"], sh["module_top"], sh["module_left"], sh["module_bottom"]], fill=(255, 0, 0), width=lw)
            dr.line([sh["module_right"], sh["module_top"], sh["module_right"], sh["module_bottom"]], fill=(255, 0, 0), width=lw)
        if "bands" in reads:
            for k, v in reads["bands"].items():
                if not isinstance(v, list):
                    continue
                a, b = v
                dr.line([a, sh["wing_top"], a, sh["wing_bottom"]], fill=(255, 255, 255), width=lw)
                dr.line([b, sh["wing_top"], b, sh["wing_bottom"]], fill=(255, 255, 255), width=lw)
        target = out_dir / f"console-dimensions-{key}.jpg"
        scale = min(1.0, 2000 / im.width)
        if scale < 1:
            im = im.resize((int(im.width * scale), int(im.height * scale)))
        im.save(target, quality=88)
        print(f"wrote {target}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
