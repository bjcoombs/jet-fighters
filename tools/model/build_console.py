"""Build the Jet Fighters console as a glTF, in Blender, from the measured dimensions.

Run headless:

    blender --background --python tools/model/build_console.py -- \\
        --out public/models/console.glb [--render docs/evidence] [--blend /tmp/console.blend]

Every part is built parametrically from ``tools/model/dimensions.json`` (see
``docs/evidence/console-dimensions.md`` for where each figure comes from). The output
is one binary glTF whose nodes are named parts, each carrying ``extras``:

    label     what the part is, one line
    evidence  which photograph shows it
    explode   [x, y, z] in metres, glTF frame (Y up): where the part goes when the
              viewer takes the unit apart, relative to its assembled place

Frame: the unit lies face up. Blender X is across the case (right), Blender Y is up
the face (toward the scope's top, the tab end), Blender Z is out of the face toward
the player. The origin is the centre of the module in X and Y, and the parting line
between the two shells in Z. The exporter turns this into glTF's Y-up: Blender Z
becomes glTF Y (face toward +Y), Blender Y becomes glTF -Z.

Units: the script works in millimetres, which keeps the boolean solver happy, and
scales the whole tree by 0.001 on export so the glTF is in metres.

Nothing here asserts anything about what the program does.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
DIMENSIONS = ROOT / "tools/model/dimensions.json"

# --------------------------------------------------------------------------------------
# Dimensions
# --------------------------------------------------------------------------------------


def load_dims() -> dict:
    data = json.loads(DIMENSIONS.read_text())
    return {k: v["value"] for k, v in data["dimensions"].items()}


D = load_dims()

W = D["case.width"]  # 329.7
H = D["case.module_height"]  # 142.4
WALL = D["depth.wall"]
Z_WING = D["depth.front_shell_wing"]
Z_MODULE = D["depth.front_shell_module"]
Z_BACK = D["depth.back_shell"]
Z_BOARD_TOP = -D["depth.rim_above_board"]
Z_BOARD_BOTTOM = Z_BOARD_TOP - D["pcb.thickness"]
Z_WINDOW = Z_MODULE - D["depth.window_recess"]
Z_CHANNEL = 6.0  # the ribbed channel floor between wing and module; estimated
STIPPLE_RAISE = 1.5  # the raised, stippled blocks on the wings; estimated

WING_TOP = D["case.wing_top_below_module_top"]
WING_BOTTOM = WING_TOP + D["case.wing_height"]
MODULE_X = D["face.module_x"]
LEFT_BLOCK = D["face.left_block_x"]
LEFT_STRIP = D["face.left_strip_x"]
RIGHT_STRIP = D["face.right_strip_x"]
RIGHT_BLOCK = D["face.right_block_x"]
CHANNEL_W = MODULE_X[0] - LEFT_STRIP[1]  # 10.3: the left channel; mirrored on the right


def fx(x: float) -> float:
    """Face mm from the left edge -> Blender X."""
    return x - W / 2


def fy(y: float) -> float:
    """Face mm down from the module's top edge -> Blender Y."""
    return H / 2 - y


# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------

MATERIALS: dict[str, bpy.types.Material] = {}


def material(
    name: str,
    rgb: tuple[float, float, float],
    roughness: float = 0.5,
    metallic: float = 0.0,
    transmission: float = 0.0,
    alpha: float = 1.0,
    emission: tuple[float, float, float] | None = None,
) -> bpy.types.Material:
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(rgb), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if transmission:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*srgb_to_linear(emission), 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    MATERIALS[name] = mat
    return mat


def srgb_to_linear(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def f(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(f(c) for c in rgb)


def hexrgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def materials() -> None:
    # Case red, sampled from device-front-gameplay.jpg's module face and src/ui/case.ts's
    # mid-stop (#c53d20). The stippled blocks are the same pigment, rougher.
    material("red_abs", hexrgb("#c53d20"), roughness=0.55)
    material("red_stipple", hexrgb("#bf3a1e"), roughness=0.9)
    # The fire cap and skill flag: a deep blue, device-front-lit.jpg.
    material("blue_control", hexrgb("#2f3f9e"), roughness=0.45)
    # The sticker: light cornflower, src/ui/case.ts's sample rgb(129,159,213).
    material("sticker_blue", hexrgb("#819fd5"), roughness=0.6)
    material("black_plastic", hexrgb("#1a1a1c"), roughness=0.6)
    material("steel", hexrgb("#b8bcc2"), roughness=0.35, metallic=1.0)
    # The smoked window: near-black tint, some transmission so the tube reads through it.
    material("smoked_glass", hexrgb("#120c0c"), roughness=0.12, transmission=0.6, alpha=0.85)
    # The tube face placeholder; the viewer replaces this with the renderer's canvas.
    material("tube_face", hexrgb("#050607"), roughness=0.3, emission=(0.0, 0.0, 0.0))
    material("pcb_brown", hexrgb("#8a3d20"), roughness=0.7)
    material("glass_clear", hexrgb("#dfe6ea"), roughness=0.05, transmission=0.9, alpha=0.3)
    material("tube_black", hexrgb("#111214"), roughness=0.7)
    material("chip_black", hexrgb("#232326"), roughness=0.5)
    material("resistor_tan", hexrgb("#c9b48a"), roughness=0.6)
    material("cap_blue", hexrgb("#7fb2d8"), roughness=0.5)
    material("cap_grey", hexrgb("#9a9a9a"), roughness=0.5)
    material("yellow_plastic", hexrgb("#e2b62c"), roughness=0.5)
    material("grey_rubber", hexrgb("#4a4a4a"), roughness=0.95)
    material("cream_lamp", hexrgb("#f2ecd8"), roughness=0.2, transmission=0.5, alpha=0.6)


# --------------------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------------------

COLLECTION: bpy.types.Collection | None = None


def new_object(name: str, bm: bmesh.types.BMesh, mat: bpy.types.Material | None) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    if mat is not None:
        mesh.materials.append(mat)
    (COLLECTION or bpy.context.scene.collection).objects.link(obj)
    return obj


def box(name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat=None) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    return new_object(name, bm, mat)


def cylinder(name: str, cx: float, cy: float, r: float, z0: float, z1: float, mat=None, segments: int = 64, axis: str = "Z", r2: float | None = None) -> bpy.types.Object:
    """A cylinder along `axis` through (cx, cy) in the other two axes, from z0 to z1 along it."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r, radius2=r if r2 is None else r2, depth=z1 - z0)
    bmesh.ops.translate(bm, vec=(0, 0, (z0 + z1) / 2), verts=bm.verts)
    if axis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y"), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, cx, cy), verts=bm.verts)
    elif axis == "Y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, "X"), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(cx, 0, cy), verts=bm.verts)
    else:
        bmesh.ops.translate(bm, vec=(cx, cy, 0), verts=bm.verts)
    return new_object(name, bm, mat)


def prism(name: str, points: list[tuple[float, float]], z0: float, z1: float, mat=None) -> bpy.types.Object:
    """A polygon in XY extruded from z0 to z1."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in points]
    top = [bm.verts.new((x, y, z1)) for x, y in points]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(points)
    for i in range(n):
        bm.faces.new((bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, mat)


def apply_boolean(target: bpy.types.Object, other: bpy.types.Object, op: str) -> None:
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = op
    mod.object = other
    mod.solver = "EXACT"
    with bpy.context.temp_override(object=target, active_object=target, selected_objects=[target]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(other, do_unlink=True)


def cut(target: bpy.types.Object, *cutters: bpy.types.Object) -> bpy.types.Object:
    for c in cutters:
        apply_boolean(target, c, "DIFFERENCE")
    return target


def fuse(target: bpy.types.Object, *others: bpy.types.Object) -> bpy.types.Object:
    for o in others:
        apply_boolean(target, o, "UNION")
    return target


def intersect(target: bpy.types.Object, other: bpy.types.Object) -> bpy.types.Object:
    apply_boolean(target, other, "INTERSECT")
    return target


def join(target: bpy.types.Object, *others: bpy.types.Object) -> bpy.types.Object:
    """Join meshes without a boolean: separate shells in one object. Keeps each part's material."""
    if not others:
        return target
    with bpy.context.temp_override(object=target, active_object=target, selected_objects=[target, *others], selected_editable_objects=[target, *others]):
        bpy.ops.object.join()
    return target


def set_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def uv_project_top(obj: bpy.types.Object, x0: float, x1: float, y0: float, y1: float) -> None:
    """UVs for every face from its XY position over the given box: (x0,y0) -> (0,1), (x1,y1) -> (1,0).

    glTF's UV origin is top-left, so v runs down; a canvas drawn with y down maps
    onto the face the right way up when the face's +Y is the case's top.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.verify()
    for face in bm.faces:
        for loop in face.loops:
            x, y = loop.vert.co.x, loop.vert.co.y
            loop[uv].uv = ((x - x0) / (x1 - x0), (y - y0) / (y1 - y0))
    bm.to_mesh(obj.data)
    bm.free()


def extras(obj: bpy.types.Object, label: str, evidence: str, explode: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> None:
    """Name the part for the viewer. `explode` is in mm, Blender frame; stored in metres, glTF frame."""
    ex, ey, ez = explode
    obj["label"] = label
    obj["evidence"] = evidence
    obj["explode"] = [ex / 1000, ez / 1000, -ey / 1000]


def parent(child: bpy.types.Object, to: bpy.types.Object) -> None:
    child.parent = to
    child.matrix_parent_inverse = to.matrix_world.inverted()


def shade_smooth(obj: bpy.types.Object, angle_deg: float = 35.0) -> None:
    for poly in obj.data.polygons:
        poly.use_smooth = True
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))


# --------------------------------------------------------------------------------------
# The case outline, shared by both shells
# --------------------------------------------------------------------------------------


def outline_solid(name: str, z0: float, z1: float, mat, inset: float = 0.0, module_top: float | None = None) -> bpy.types.Object:
    """The case's plan outline - wings and module - extruded from z0 to z1.

    `inset` shrinks the outline uniformly (for a cavity). The module block runs the full
    module height; the wings hang from WING_TOP to WING_BOTTOM.
    """
    i = inset
    wings = box(f"{name}_wings", fx(0 + i), fx(W - i), fy(WING_BOTTOM - i), fy(WING_TOP + i), z0, z1, mat)
    mod = box(f"{name}_module", fx(MODULE_X[0] + i), fx(MODULE_X[1] - i), fy(H - i), fy(0 + i), z0, z1, mat)
    return fuse(wings, mod)


# --------------------------------------------------------------------------------------
# Front shell
# --------------------------------------------------------------------------------------


def window_cutter(name: str, z0: float, z1: float, grow: float = 0.0) -> bpy.types.Object:
    cx, cy = D["scope.circle_centre"]
    r = D["scope.circle_radius"] + grow
    rect = D["scope.rect"]
    circ = cylinder(f"{name}_c", fx(cx), fy(cy), r, z0, z1, segments=128)
    rct = box(f"{name}_r", fx(rect["left"] - grow), fx(cx), fy(rect["bottom"] + grow), fy(rect["top"] - grow), z0, z1)
    return fuse(circ, rct)


def build_front_shell() -> bpy.types.Object:
    red = MATERIALS["red_abs"]
    # Outer solid. The wings stand at Z_WING and the module at Z_MODULE, joined by
    # channels at Z_CHANNEL that carry three ribs each.
    left_wing = box("fs_left", fx(0), fx(LEFT_STRIP[1]), fy(WING_BOTTOM), fy(WING_TOP), 0, Z_WING, red)
    right_wing = box("fs_right", fx(MODULE_X[1] + CHANNEL_W), fx(W), fy(WING_BOTTOM), fy(WING_TOP), 0, Z_WING, red)
    module = box("fs_module", fx(MODULE_X[0]), fx(MODULE_X[1]), fy(H), fy(0), 0, Z_MODULE, red)
    chan_l = box("fs_chan_l", fx(LEFT_STRIP[1]), fx(MODULE_X[0]), fy(WING_BOTTOM), fy(WING_TOP), 0, Z_CHANNEL, red)
    chan_r = box("fs_chan_r", fx(MODULE_X[1]), fx(MODULE_X[1] + CHANNEL_W), fy(WING_BOTTOM), fy(WING_TOP), 0, Z_CHANNEL, red)
    shell = fuse(left_wing, right_wing, module, chan_l, chan_r)
    shell.name = "front_shell"

    # Cavity: the same shapes, inset by the wall, open at the parting line.
    cav = fuse(
        box("cav_l", fx(WALL), fx(LEFT_STRIP[1] - WALL), fy(WING_BOTTOM - WALL), fy(WING_TOP + WALL), -1, Z_WING - WALL),
        box("cav_r", fx(MODULE_X[1] + CHANNEL_W + WALL), fx(W - WALL), fy(WING_BOTTOM - WALL), fy(WING_TOP + WALL), -1, Z_WING - WALL),
        box("cav_m", fx(MODULE_X[0] + WALL), fx(MODULE_X[1] - WALL), fy(H - WALL), fy(WALL), -1, Z_MODULE - WALL),
        box("cav_cl", fx(LEFT_STRIP[1] - WALL), fx(MODULE_X[0] + WALL), fy(WING_BOTTOM - WALL), fy(WING_TOP + WALL), -1, Z_CHANNEL - WALL),
        box("cav_cr", fx(MODULE_X[1] - WALL), fx(MODULE_X[1] + CHANNEL_W + WALL), fy(WING_BOTTOM - WALL), fy(WING_TOP + WALL), -1, Z_CHANNEL - WALL),
    )
    cut(shell, cav)

    # The scope window opening, through the module face.
    cut(shell, window_cutter("win_cut", Z_MODULE - WALL - 1, Z_MODULE + 1))
    # A lip the glass sits in: the opening 1.5 mm wider, only the top 2 mm of the face is
    # left, so the glass at Z_WINDOW is held by the cavity's edge under it.

    # Control openings.
    f = D["controls.fire.centre"]
    cut(shell, cylinder("fire_ring_cut", fx(f[0]), fy(f[1]), D["controls.fire.ring_radius"], Z_WING - 1.5, Z_WING + 1))
    cut(shell, cylinder("fire_hole", fx(f[0]), fy(f[1]), D["controls.fire.cap_radius"] + 0.6, Z_WING - WALL - 1, Z_WING + 1))
    p = D["controls.power.thumb_centre"]
    ps = D["controls.power.thumb_size"]
    tr = D["controls.power.travel_y"]
    cut(shell, box("switch_slot", fx(p[0] - ps[0] / 2 - 0.5), fx(p[0] + ps[0] / 2 + 0.5), fy(tr[1] + ps[1] / 2 + 0.5), fy(tr[0] - ps[1] / 2 - 0.5), Z_WING - WALL - 1, Z_WING + 1))
    lw = D["controls.lever.well_centre"]
    cut(shell, cylinder("lever_well", fx(lw[0]), fy(lw[1]), D["controls.lever.well_radius"], Z_WING - 4, Z_WING + 1))
    sl = D["controls.lever.slot"]
    cut(shell, box("lever_slot", fx(sl["x"][0]), fx(sl["x"][1]), fy(sl["y"][1]), fy(sl["y"][0]), Z_WING - WALL - 5, Z_WING + 1))
    sk = D["controls.skill.hub_centre"]
    cut(shell, cylinder("skill_hole", fx(sk[0]), fy(sk[1]), D["controls.skill.hub_radius"] + 0.5, Z_WING - WALL - 1, Z_WING + 1))

    # Raised, stippled blocks on the wings; the moulded 1/2/3 arc sits on the right one.
    stip = MATERIALS["red_stipple"]
    blocks = [
        box("stipple_l", fx(LEFT_BLOCK[0]), fx(LEFT_BLOCK[1]), fy(WING_BOTTOM - 1), fy(WING_TOP + 1), Z_WING - 0.5, Z_WING + STIPPLE_RAISE, stip),
        box("stipple_r", fx(RIGHT_BLOCK[0]), fx(RIGHT_BLOCK[1]), fy(WING_BOTTOM - 1), fy(WING_TOP + 1), Z_WING - 0.5, Z_WING + STIPPLE_RAISE, stip),
    ]
    for b in blocks:
        # The blocks carry the same openings, so cut them with the same cutters.
        cut(b, cylinder("c1", fx(f[0]), fy(f[1]), D["controls.fire.ring_radius"], Z_WING - 2, Z_WING + 3))
        cut(b, cylinder("c2", fx(lw[0]), fy(lw[1]), D["controls.lever.well_radius"], Z_WING - 5, Z_WING + 3))
        cut(b, cylinder("c3", fx(sk[0]), fy(sk[1]), D["controls.skill.hub_radius"] + 0.5, Z_WING - 3, Z_WING + 3))
    # Ribs in the two channels: three each, running the channel's length.
    ribs = []
    for side, x0 in (("l", LEFT_STRIP[1]), ("r", MODULE_X[1])):
        for k in range(3):
            xc = x0 + CHANNEL_W * (k + 1) / 4
            ribs.append(box(f"rib_{side}{k}", fx(xc - 0.6), fx(xc + 0.6), fy(WING_BOTTOM - 1), fy(WING_TOP + 1), Z_CHANNEL - 0.5, Z_CHANNEL + 1.5, red))
    # The 12 o'clock tab, overlapping the glass.
    tab = D["scope.tab"]
    tab_obj = box("tab", fx(tab["x"][0]), fx(tab["x"][1]), fy(tab["y"][1]), fy(tab["y"][0]), Z_WINDOW + 0.5, Z_MODULE + 0.3, red)
    # Moulded 1/2/3 marks: three short radial bars on the arc above the skill hub.
    marks = []
    mr = D["controls.skill.mark_radius"]
    for k, ang in enumerate((150, 90, 30)):
        a = math.radians(ang)
        cx, cy = fx(sk[0]) + mr * math.cos(a), fy(sk[1]) + mr * math.sin(a)
        m = box(f"mark{k}", -0.5, 0.5, -2.0, 2.0, Z_WING + STIPPLE_RAISE - 0.2, Z_WING + STIPPLE_RAISE + 0.4, red)
        m.rotation_euler = (0, 0, a - math.pi / 2)
        m.location = (cx, cy, 0)
        marks.append(m)
    join(shell, *blocks, *ribs, tab_obj, *marks)
    shade_smooth(shell)
    extras(shell, "Front shell: one red ABS moulding - two wings and the raised scope module, the ribbed channels between them, and the openings for the four controls.", "device-front-lit.jpg, device-front-gameplay.jpg, clip.mov", (0, 0, 120))
    return shell


def build_window(shell: bpy.types.Object) -> bpy.types.Object:
    glass = window_cutter("window", Z_WINDOW - 1.5, Z_WINDOW)
    glass.name = "window"
    set_material(glass, MATERIALS["smoked_glass"])
    cx, cy = D["scope.circle_centre"]
    r = D["scope.circle_radius"]
    rect = D["scope.rect"]
    uv_project_top(glass, fx(rect["left"]), fx(cx + r), fy(cy + r), fy(cy - r))
    shade_smooth(glass)
    extras(glass, "Smoked window: the dark filter over the tube, with the radar-scope silkscreen printed on its inner face. Its UVs cover the window's bounding box so the page can draw the silkscreen onto it.", "device-front-lit.jpg, screen-overlay-closeup.jpg", (0, 0, 40))
    parent(glass, shell)
    return glass


def build_sticker(shell: bpy.types.Object) -> bpy.types.Object:
    s = D["face.sticker"]
    st = box("sticker", fx(s["x"][0]), fx(s["x"][1]), fy(s["y"][1]), fy(s["y"][0]), Z_WING + STIPPLE_RAISE, Z_WING + STIPPLE_RAISE + 0.4, MATERIALS["sticker_blue"])
    extras(st, "The JET FIGHTERS / CGL sticker.", "device-front-gameplay.jpg", (0, 0, 15))
    parent(st, shell)
    return st


def build_controls(shell: bpy.types.Object) -> list[bpy.types.Object]:
    blue = MATERIALS["blue_control"]
    black = MATERIALS["black_plastic"]
    steel = MATERIALS["steel"]
    out = []

    f = D["controls.fire.centre"]
    cap = cylinder("fire_cap", fx(f[0]), fy(f[1]), D["controls.fire.cap_radius"], Z_WING - 3, Z_WING + D["depth.fire_cap_height"], blue, r2=D["controls.fire.cap_radius"] - 0.8)
    # A domed top: a shallow cone on the cap.
    dome = cylinder("fire_dome", fx(f[0]), fy(f[1]), D["controls.fire.cap_radius"] - 0.8, Z_WING + D["depth.fire_cap_height"] - 0.01, Z_WING + D["depth.fire_cap_height"] + 1.2, blue, r2=D["controls.fire.cap_radius"] - 4)
    fuse(cap, dome)
    shade_smooth(cap)
    extras(cap, "Fire button: the blue cap. Pressing it closes the K8 contact, the one input the program reads without strobing.", "device-front-lit.jpg", (0, 0, 25))
    parent(cap, shell)
    out.append(cap)

    p = D["controls.power.thumb_centre"]
    ps = D["controls.power.thumb_size"]
    tr = D["controls.power.travel_y"]
    # Modelled at the OFF end of its travel (toward the case bottom): a unit on a shelf.
    thumb = box("power_thumb", fx(p[0] - ps[0] / 2), fx(p[0] + ps[0] / 2), fy(tr[1] + ps[1] / 2), fy(tr[1] - ps[1] / 2), Z_WING - 4, Z_WING + 2.5, black)
    extras(thumb, "Power switch: a black slide. ON toward the case top, OFF toward the bottom. The only reset the unit has.", "device-front-lit.jpg", (0, 0, 20))
    parent(thumb, shell)
    out.append(thumb)

    sl = D["controls.lever.slot"]
    pin_y = D["controls.lever.pin_y_positions"][1]
    pin = cylinder("lever_pin", fx((sl["x"][0] + sl["x"][1]) / 2), fy(pin_y), 1.6, Z_WING - 6, Z_WING - 0.5 + D["depth.lever_pin_height"], steel, segments=24)
    shade_smooth(pin)
    extras(pin, "Launcher lever: a steel pin in a vertical slot, three positions for the three lanes. Rides on the disc inside.", "device-front-lit.jpg, board-L1001568.jpg", (0, 0, 20))
    parent(pin, shell)
    out.append(pin)

    sk = D["controls.skill.hub_centre"]
    hub_r = D["controls.skill.hub_radius"]
    zf = Z_WING + STIPPLE_RAISE
    hub = cylinder("skill_flag", fx(sk[0]), fy(sk[1]), hub_r, zf - 2, zf + D["depth.skill_flag_height"] - 1.5, blue, segments=48)
    L = D["controls.skill.flag_length"]
    # The flag hangs down and to the right of the hub at rest (skill 1): from the photo,
    # tip at +63, +55 px of the hub in image space, i.e. below-right.
    flag = box("flag", 0, L, -4.0, 4.0, zf - 1.5, zf + D["depth.skill_flag_height"] - 2.5, blue)
    flag.rotation_euler = (0, 0, math.radians(-40))
    flag.location = (fx(sk[0]), fy(sk[1]), 0)
    join(hub, flag)
    screw = cylinder("skill_screw", fx(sk[0]), fy(sk[1]), 2.2, zf + D["depth.skill_flag_height"] - 1.6, zf + D["depth.skill_flag_height"] - 0.9, steel, segments=24)
    join(hub, screw)
    shade_smooth(hub)
    extras(hub, "Skill lever: a blue flag on a screwed hub, turned to 1, 2 or 3 against the moulded marks. Sets which K line the strobe finds closed.", "device-front-lit.jpg", (0, 0, 20))
    parent(hub, shell)
    out.append(hub)
    return out


# --------------------------------------------------------------------------------------
# Back shell and door
# --------------------------------------------------------------------------------------


def build_back_shell() -> bpy.types.Object:
    red = MATERIALS["red_abs"]
    shell = outline_solid("back_shell", -Z_BACK, 0, red)
    shell.name = "back_shell"
    cav = outline_solid("back_cav", -Z_BACK + WALL, 1, None, inset=WALL)
    cut(shell, cav)

    # Battery door opening in the back face, under the left wing.
    bb_x = D["battery_box.x"]
    bb_y = D["battery_box.y"]
    door = (fx(bb_x[0] + 1.0), fx(bb_x[1] - 0.5), fy(bb_y[1] - 1.0), fy(bb_y[0] + 1.0))
    cut(shell, box("door_cut", door[0], door[1], door[2], door[3], -Z_BACK - 1, -Z_BACK + WALL + 0.5))
    # A ledge the door rests on: leave the wall inset around the opening. Approximated by
    # cutting the opening 1 mm smaller through the outer 1 mm only - skipped; the door
    # sits flush in the opening.

    # Instruction label recess on the module's back, centred.
    lab_w, lab_h = 60.0, 40.0
    lab_cx = (MODULE_X[0] + MODULE_X[1]) / 2
    lab_cy = H / 2
    cut(shell, box("label_cut", fx(lab_cx - lab_w / 2), fx(lab_cx + lab_w / 2), fy(lab_cy + lab_h / 2), fy(lab_cy - lab_h / 2), -Z_BACK - 1, -Z_BACK + 0.6))
    label = box("back_label", fx(lab_cx - lab_w / 2 + 0.3), fx(lab_cx + lab_w / 2 - 0.3), fy(lab_cy + lab_h / 2 - 0.3), fy(lab_cy - lab_h / 2 + 0.3), -Z_BACK + 0.55, -Z_BACK + 0.6, material("label_paper", hexrgb("#e9e6dc"), roughness=0.8))

    # Diagonal ribs across the back face, 45 degrees, clipped to the outline and kept off
    # the door and the label.
    rib_w, rib_h, pitch = 7.0, 1.2, 24.0
    bars = []
    span = W + H
    k = 0
    d = -span
    while d < span:
        bar = box(f"bar{k}", -span, span, d - rib_w / 2, d + rib_w / 2, -Z_BACK - rib_h, -Z_BACK + 0.2, red)
        bar.rotation_euler = (0, 0, math.radians(45))
        bars.append(bar)
        d += pitch
        k += 1
    ribs = join(bars[0], *bars[1:])
    ribs.name = "back_ribs"
    clip = outline_solid("rib_clip", -Z_BACK - rib_h - 1, -Z_BACK + 0.3, None, inset=3.0)
    cut(clip, box("clip_door", door[0] - 2, door[1] + 2, door[2] - 2, door[3] + 2, -Z_BACK - 3, 1))
    cut(clip, box("clip_label", fx(lab_cx - lab_w / 2 - 3), fx(lab_cx + lab_w / 2 + 3), fy(lab_cy + lab_h / 2 + 3), fy(lab_cy - lab_h / 2 - 3), -Z_BACK - 3, 1))
    intersect(ribs, clip)
    join(shell, ribs, label)
    shade_smooth(shell)
    extras(shell, "Back shell: the same outline, moulded with diagonal ribs, the battery door opening and the instruction label's recess. The board sits on its bosses.", "back-instructions-label.jpg, board-L1001568.jpg", (0, 0, -80))
    return shell


def build_battery_door(shell: bpy.types.Object) -> bpy.types.Object:
    bb_x = D["battery_box.x"]
    bb_y = D["battery_box.y"]
    door = box("battery_door", fx(bb_x[0] + 1.3), fx(bb_x[1] - 0.8), fy(bb_y[1] - 1.3), fy(bb_y[0] + 1.3), -Z_BACK, -Z_BACK + WALL, MATERIALS["red_abs"])
    # The OPEN arrow: a shallow triangular recess near the door's end, as photographed.
    ax = fx((bb_x[0] + bb_x[1]) / 2)
    ay = fy(bb_y[0] + 14)
    arrow = prism("arrow", [(ax - 5, ay - 4), (ax + 5, ay - 4), (ax, ay + 5)], -Z_BACK - 1, -Z_BACK + 0.5)
    cut(door, arrow)
    # Grip ridges across the door's far end.
    for k in range(6):
        y = fy(bb_y[1] - 6 - k * 3.0)
        cut(door, box(f"ridge{k}", fx(bb_x[0] + 6), fx(bb_x[1] - 6), y - 0.6, y + 0.6, -Z_BACK - 1, -Z_BACK + 0.4))
    extras(door, "Battery door, with its OPEN arrow and grip ridges.", "board-L1001568.jpg (loose, top left)", (0, 0, -130))
    parent(door, shell)
    return door


# --------------------------------------------------------------------------------------
# Scene, export, render
# --------------------------------------------------------------------------------------


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global COLLECTION
    COLLECTION = bpy.data.collections.new("console")
    bpy.context.scene.collection.children.link(COLLECTION)


def build_root() -> bpy.types.Object:
    root = bpy.data.objects.new("console", None)
    root.scale = (0.001, 0.001, 0.001)
    COLLECTION.objects.link(root)
    root["label"] = "CGL Jet Fighters (Gakken, 1979). Built from tools/model/dimensions.json."
    root["evidence"] = "docs/evidence/console-dimensions.md"
    return root


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_extras=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_lights=False,
        export_cameras=False,
        export_skins=False,
        export_morph=False,
        export_image_format="NONE",
        use_selection=False,
    )


def setup_render(width: int, height: int, samples: int = 32) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.eevee.taa_render_samples = samples
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.35, 0.36, 0.4, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    sun.angle = math.radians(8)
    sun_obj = bpy.data.objects.new("sun", sun)
    sun_obj.rotation_euler = (math.radians(35), math.radians(-20), math.radians(20))
    scene.collection.objects.link(sun_obj)
    area = bpy.data.lights.new("fill", "AREA")
    area.energy = 2500.0
    area.size = 600.0
    fill = bpy.data.objects.new("fill", area)
    fill.location = (-200, 300, 600)
    fill.rotation_euler = (math.radians(20), math.radians(-15), 0)
    scene.collection.objects.link(fill)


def camera_matched(name: str, target_width_mm: float, frame_fraction: float, width: int, height: int, focal_mm: float, look_from_z: float) -> bpy.types.Object:
    """A camera above the origin looking straight down, framed so `target_width_mm`
    spans `frame_fraction` of the image width at the given focal length (36 mm sensor)."""
    cam = bpy.data.cameras.new(name)
    cam.lens = focal_mm
    cam.sensor_width = 36.0
    cam.sensor_fit = "HORIZONTAL"
    hfov = 2 * math.atan(36.0 / (2 * focal_mm))
    half = target_width_mm / 2 / frame_fraction
    dist = half / math.tan(hfov / 2)
    obj = bpy.data.objects.new(name, cam)
    obj.location = (0, 0, look_from_z + dist)
    obj.rotation_euler = (0, 0, 0)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    return obj


def render_to(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "public/models/console.glb")
    ap.add_argument("--render", type=Path, help="directory for the comparison renders")
    ap.add_argument("--blend", type=Path, help="also save a .blend to open in the app")
    args = ap.parse_args(argv)

    reset_scene()
    materials()
    root = build_root()

    front = build_front_shell()
    build_window(front)
    build_sticker(front)
    build_controls(front)
    back = build_back_shell()
    build_battery_door(back)

    for obj in (front, back):
        parent(obj, root)

    export_glb(args.out)
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend))

    if args.render:
        setup_render(1422, 800)
        # device-front-lit.jpg: the case spans 1187 of 1422 px. A phone's main camera is
        # about a 26 mm equivalent; the exact value only changes perspective at the
        # edges, which the comparison tolerates.
        camera_matched("cam_front", W, 1187 / 1422, 1422, 800, 26.0, Z_MODULE)
        render_to(args.render / "console-model-front.png")
        # board-L1001568.jpg: the shell spans 3065 of 4000 px at 28 mm, front shell off.
        front.hide_render = True
        for child in front.children:
            child.hide_render = True
        bpy.context.scene.render.resolution_x = 2000
        bpy.context.scene.render.resolution_y = 1334
        camera_matched("cam_board", W, 3065 / 4000, 2000, 1334, 28.0, 0.0)
        render_to(args.render / "console-model-board.png")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    main(argv)
