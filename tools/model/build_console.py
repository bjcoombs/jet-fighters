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
    """Parent without a parent-inverse matrix.

    Blender's default parenting stores the parent's inverse so the child does not
    move; here every part is built in the same world frame at identity transforms,
    and the one parent that is *not* identity - the root's 0.001 scale to metres -
    is exactly what the children must inherit. A stored inverse would cancel it and
    the exporter would bake a x1000 into each child.
    """
    child.parent = to
    child.matrix_parent_inverse.identity()


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
    # The well is a recess with a floor, deeper than the wing's wall; the floor is
    # added back under it, and only the slot goes through.
    cut(shell, cylinder("lever_well", fx(lw[0]), fy(lw[1]), D["controls.lever.well_radius"], Z_WING - 4, Z_WING + 1))
    fuse(shell, cylinder("well_floor", fx(lw[0]), fy(lw[1]), D["controls.lever.well_radius"] + 1.0, Z_WING - 4 - WALL, Z_WING - 4 + 0.01, red))
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
    # Flat: a smoothed plate tilts its corner normals and the glass then carries a
    # highlight across its middle with a seam down the diagonal.
    extras(glass, "Smoked window: the dark filter over the tube, with the radar-scope silkscreen printed on its inner face. Its UVs cover the window's bounding box so the page can draw the silkscreen onto it.", "device-front-lit.jpg, screen-overlay-closeup.jpg", (0, 0, 40))
    parent(glass, shell)
    return glass


def build_scope_mask(shell: bpy.types.Object) -> bpy.types.Object:
    """A matte black plate under the window, open only over the tube's glass.

    Through the smoked filter the real unit shows nothing but the tube: no board, no
    resistors above it. Whether that is a printed mask on the filter's inner face or a
    black card behind it the photographs cannot say, so it is modelled as a plate and
    labelled as such.
    """
    gx, gy = D["tube.glass_x"], D["tube.glass_y"]
    z = Z_WINDOW - 1.5 - 0.6
    mask = window_cutter("scope_mask", z - 0.5, z, grow=1.0)
    mask.name = "scope_mask"
    cut(mask, box("mask_open", fx(gx[0] - 1), fx(gx[1] + 1), fy(gy[1] + 1), fy(gy[0] - 1), z - 1, z + 1))
    set_material(mask, material("mask_black", hexrgb("#08080a"), roughness=0.95))
    extras(mask, "Black mask behind the window, open over the tube. Whether it is printed on the filter or a separate card is not established.", "device-front-lit.jpg (nothing but the tube shows through the glass)", (0, 0, 30))
    parent(mask, shell)
    return mask


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
# Internals: the board and everything on it
# --------------------------------------------------------------------------------------


def text_mesh(name: str, body: str, size: float, x: float, y: float, z: float, mat, thickness: float = 0.15, rotation_z: float = 0.0) -> bpy.types.Object:
    """A short run of text as a thin mesh lying on the XY plane at z, left-aligned at (x, y)."""
    curve = bpy.data.curves.new(name, type="FONT")
    curve.body = body
    curve.size = size
    curve.extrude = thickness / 2
    curve.resolution_u = 4
    obj = bpy.data.objects.new(name, curve)
    COLLECTION.objects.link(obj)
    obj.location = (x, y, z)
    obj.rotation_euler = (0, 0, rotation_z)
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.convert(target="MESH")
    obj = bpy.data.objects[name]
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def lead_row(name: str, x0: float, x1: float, y: float, z0: float, z1: float, count: int, mat, r: float = 0.3) -> bpy.types.Object:
    """A row of thin vertical pins from x0 to x1 at y - the tube's grid pins and plate leads."""
    pins = []
    for k in range(count):
        x = x0 + (x1 - x0) * (k + 0.5) / count
        pins.append(cylinder(f"{name}{k}", x, y, r, z0, z1, mat, segments=8))
    return join(pins[0], *pins[1:])


def clamp_x(x: float, margin: float = WALL + 0.5) -> float:
    """Keep a board-plane read inside the case's cavity. The reads carry about 3% of
    uncertainty and the far corners of the frame lean outward; the case cannot."""
    return min(max(x, margin), W - margin)


def clamp_y(y: float, margin: float = WALL + 0.5) -> float:
    return min(max(y, WING_TOP + margin), WING_BOTTOM - margin)


def build_pcb() -> bpy.types.Object:
    pts = [(fx(clamp_x(x)), fy(clamp_y(y))) for x, y in D["pcb.outline"]]
    board = prism("pcb", pts, Z_BOARD_BOTTOM, Z_BOARD_TOP, MATERIALS["pcb_brown"])
    # Standoff holes.
    for cx, cy in D["standoffs.centres"]:
        cx, cy = clamp_x(cx, WALL + D["standoffs.radius"]), clamp_y(cy, WALL + D["standoffs.radius"])
        cut(board, cylinder("hole", fx(cx), fy(cy), 1.8, Z_BOARD_BOTTOM - 1, Z_BOARD_TOP + 1, segments=16))
    silk = material("silkscreen", hexrgb("#f2efe6"), roughness=0.8)
    jf = text_mesh("silk_jet_fighter", "JET FIGHTER", 6.0, fx(232), fy(140), Z_BOARD_TOP, silk)
    join(board, jf)
    extras(board, "The board: single-sided phenolic, everything the machine is soldered to. Its JET FIGHTER silkscreen is Gakken's, the CGL name being the importer's.", "board-L1001568.jpg", (0, 0, 0))
    return board


def build_tube(board: bpy.types.Object) -> list[bpy.types.Object]:
    sx, sy = D["tube.shroud_x"], D["tube.shroud_y"]
    gx, gy = D["tube.glass_x"], D["tube.glass_y"]
    fxr, fyr = D["tube.face_x"], D["tube.face_y"]
    thick = D["tube.thickness"]
    z_face = Z_BOARD_TOP + D["tube.face_above_board"]
    z_top = Z_BOARD_TOP + thick
    black = MATERIALS["tube_black"]
    out = []

    shroud = box("tube_shroud", fx(sx[0]), fx(sx[1]), fy(sy[1]), fy(sy[0]), Z_BOARD_TOP, z_top + 1.0, black)
    cut(shroud, box("shroud_in", fx(gx[0]), fx(gx[1]), fy(gy[1]), fy(gy[0]), Z_BOARD_TOP + 1.0, z_top + 2.0))
    extras(shroud, "The tube's black surround: the end caps that hold the envelope and the frame that masks its edges.", "board-L1001568.jpg", (0, 0, 55))
    parent(shroud, board)
    out.append(shroud)

    glass = box("tube_glass", fx(gx[0]), fx(gx[1]), fy(gy[1]), fy(gy[0]), Z_BOARD_TOP + 1.0, z_top, MATERIALS["glass_clear"])
    extras(glass, "The vacuum envelope: flat glass, front and back, with the getter and support wires at the ends.", "tube-unlit-full.jpg", (0, 0, 50))
    parent(glass, board)
    out.append(glass)

    face = box("tube_face", fx(fxr[0]), fx(fxr[1]), fy(fyr[1]), fy(fyr[0]), z_face - 0.2, z_face, MATERIALS["tube_face"])
    uv_project_top(face, fx(fxr[0]), fx(fxr[1]), fy(fyr[1]), fy(fyr[0]))
    extras(face, "The phosphor: seven playfield cells of three lanes, the SCORE label and two digit cells, in two phosphors, on the back glass. The page draws the machine's PWM state onto this face.", "tube-unlit-full.jpg, tube-teardown/README.md", (0, 0, 50))
    parent(face, board)
    out.append(face)

    steel = MATERIALS["steel"]
    grid_pins = lead_row("grid_pin", fx(gx[0]) + 2, fx(gx[1]) - 2, fy(sy[0]) + 1.0, Z_BOARD_TOP, z_top - 1.0, 44, steel)
    grid_pins.name = "tube_grid_pins"
    extras(grid_pins, "The grid connections along the tube's top edge, into the board's row of series resistors.", "board-L1001568.jpg", (0, 0, 50))
    parent(grid_pins, board)
    out.append(grid_pins)
    plate_leads = lead_row("plate_lead", fx(gx[0]) + 2, fx(gx[1]) - 2, fy(sy[1]) - 1.0, Z_BOARD_TOP, z_top - 2.0, 40, steel)
    plate_leads.name = "tube_plate_leads"
    extras(plate_leads, "The plate (anode) leads along the tube's bottom edge.", "tube-unlit-full.jpg", (0, 0, 50))
    parent(plate_leads, board)
    out.append(plate_leads)
    return out


def build_chip(board: bpy.types.Object) -> bpy.types.Object:
    px, by_ = D["chip.pins_x"], D["chip.body_y"]
    z0, z1 = Z_BOARD_TOP + 1.0, Z_BOARD_TOP + 5.0
    body = box("tms1370", fx(px[0]) - 1.5, fx(px[1]) + 1.5, fy(by_[1]), fy(by_[0]), z0, z1, MATERIALS["chip_black"])
    # Pin-1 dot and the marking.
    cut(body, cylinder("dot", fx(px[0]) + 3.5, fy(by_[1]) + 3.5, 1.2, z1 - 0.3, z1 + 1))
    mark = material("chip_mark", hexrgb("#d9d9d9"), roughness=0.6)
    t1 = text_mesh("mark_mp2110", "MP2110", 3.0, fx(px[0]) + 12, fy(by_[0]) - 12, z1, mark, thickness=0.1)
    t2 = text_mesh("mark_msh", "MSHL 8040", 2.4, fx(px[0]) + 12, fy(by_[0]) - 6, z1, mark, thickness=0.1)
    join(body, t1, t2)
    pins = []
    for k in range(20):
        x = fx(px[0]) + (fx(px[1]) - fx(px[0])) * k / 19
        for side, y in (("a", fy(by_[0]) + 0.2), ("b", fy(by_[1]) - 0.2)):
            pins.append(box(f"pin{k}{side}", x - 0.3, x + 0.3, y - 1.2, y + 1.2, Z_BOARD_TOP, z0 + 0.5, MATERIALS["steel"]))
    join(body, *pins)
    extras(body, "TMS1370, mask MP2110, week 40 of 1980: the whole game. 40 pins - 16 R outputs scan the grids and strobe the keys, 8 O outputs drive the plates through the output PLA, 4 K inputs read the controls.", "board-L1001567.jpg; docs/research/tms1370-io.md", (0, 0, 30))
    parent(body, board)
    return body


def build_passives(board: bpy.types.Object) -> list[bpy.types.Object]:
    out = []
    tan = MATERIALS["resistor_tan"]
    steel = MATERIALS["steel"]
    # The row of series resistors under the tube's grid pins, standing on end at a lean.
    rx, ry = D["resistor_row.x"], D["resistor_row.y"]
    n = int(D["resistor_row.count"])
    bodies = []
    for k in range(n):
        x = fx(rx[0]) + (fx(rx[1]) - fx(rx[0])) * (k + 0.5) / n
        yc = fy((ry[0] + ry[1]) / 2)
        bodies.append(cylinder(f"rr{k}", x, Z_BOARD_TOP + 1.6, 1.1, yc - 3.0, yc + 3.0, tan, segments=12, axis="Y"))
    row = join(bodies[0], *bodies[1:])
    row.name = "resistor_row"
    extras(row, f"The row of {n} series resistors between the chip and the tube's grids and plates - one per electrode, 9 grids and 12 plates less what shares.", "board-L1001568.jpg; docs/research/tms1370-io.md", (0, 0, 20))
    parent(row, board)
    out.append(row)

    # Electrolytic cans, lying along their long side.
    cans = []
    for k, (x0, y0, x1, y1) in enumerate(D["electrolytics.cans"]):
        horizontal = (x1 - x0) >= (y1 - y0)
        r = min(x1 - x0, y1 - y0) / 2
        mat = MATERIALS["cap_blue"] if k in (0, 3, 4) else MATERIALS["cap_grey"]
        if horizontal:
            c = cylinder(f"cap{k}", fy((y0 + y1) / 2), Z_BOARD_TOP + r, r, fx(x0), fx(x1), mat, segments=24, axis="X")
        else:
            c = cylinder(f"cap{k}", fx((x0 + x1) / 2), Z_BOARD_TOP + r, r, fy(y1), fy(y0), mat, segments=24, axis="Y")
        cans.append(c)
    caps = join(cans[0], *cans[1:])
    caps.name = "electrolytics"
    extras(caps, "Electrolytic capacitors: 1 uF, 47 uF, 10 uF 35 V and two more, lying on the board. The supply's filtering and the tube's bias.", "board-L1001568.jpg", (0, 0, 20))
    parent(caps, board)
    out.append(caps)

    # Discretes, each a short cylinder or box across its read box.
    parts = []
    for k, e in enumerate(D["discretes"]):
        x0, y0, x1, y1 = e["box"]
        horizontal = (x1 - x0) >= (y1 - y0)
        kind = e["kind"]
        if kind in ("resistor", "diode"):
            r = 1.1 if kind == "resistor" else 0.9
            mat = tan if kind == "resistor" else MATERIALS["chip_black"]
            length = (x1 - x0) if horizontal else (y1 - y0)
            body_len = min(length, 6.5)
            if horizontal:
                cx = fx((x0 + x1) / 2)
                c = cylinder(f"d{k}", fy((y0 + y1) / 2), Z_BOARD_TOP + 1.6, r, cx - body_len / 2, cx + body_len / 2, mat, segments=12, axis="X")
                lead = cylinder(f"dl{k}", fy((y0 + y1) / 2), Z_BOARD_TOP + 1.6, 0.3, fx(x0), fx(x1), steel, segments=6, axis="X")
            else:
                cy = fy((y0 + y1) / 2)
                c = cylinder(f"d{k}", fx((x0 + x1) / 2), Z_BOARD_TOP + 1.6, r, cy - body_len / 2, cy + body_len / 2, mat, segments=12, axis="Y")
                lead = cylinder(f"dl{k}", fx((x0 + x1) / 2), Z_BOARD_TOP + 1.6, 0.3, fy(y1), fy(y0), steel, segments=6, axis="Y")
            join(c, lead)
        elif kind == "transistor":
            c = cylinder(f"d{k}", fx((x0 + x1) / 2), fy((y0 + y1) / 2), 2.4, Z_BOARD_TOP + 1.5, Z_BOARD_TOP + 6.5, MATERIALS["chip_black"], segments=20)
            cut(c, box(f"flat{k}", fx(x0) - 1, fx(x1) + 1, fy((y0 + y1) / 2) + 1.6, fy((y0 + y1) / 2) + 5, Z_BOARD_TOP, Z_BOARD_TOP + 8))
        else:  # disc capacitor
            c = cylinder(f"d{k}", fx((x0 + x1) / 2), Z_BOARD_TOP + 3.0, 2.5, fy((y0 + y1) / 2) - 0.8, fy((y0 + y1) / 2) + 0.8, material("disc_cap", hexrgb("#a8743a"), roughness=0.7), segments=16, axis="Y")
        parts.append(c)
    disc = join(parts[0], *parts[1:])
    disc.name = "discretes"
    extras(disc, "The other resistors, diodes, the two transistors (2SC1815, 2SA/2SD2120 per the silkscreen) and a 47 pF disc: the oscillator's RC, the tube's drive and the supply.", "board-L1001568.jpg", (0, 0, 20))
    parent(disc, board)
    out.append(disc)

    lx, ly = D["lamp.x"], D["lamp.y"]
    lamp = cylinder("lamp", fy((ly[0] + ly[1]) / 2), Z_BOARD_TOP + 2.6, 2.4, fx(lx[0]), fx(lx[1]), MATERIALS["cream_lamp"], segments=20, axis="X")
    extras(lamp, "A small glass-bodied part beside the tube's right end - a lamp or a glass diode. Unidentified.", "board-L1001568.jpg", (0, 0, 20))
    parent(lamp, board)
    out.append(lamp)
    return out


def build_board_hardware(board: bpy.types.Object) -> list[bpy.types.Object]:
    out = []
    black = MATERIALS["black_plastic"]
    steel = MATERIALS["steel"]

    c = D["buzzer.centre"]
    disc = cylinder("toothed_disc", fx(c[0]), fy(c[1]), D["buzzer.radius"], Z_BOARD_TOP, Z_BOARD_TOP + 5.0, black, segments=48)
    for k in range(12):
        a = 2 * math.pi * k / 12
        cut(disc, box(f"tooth{k}", -1.2, 1.2, D["buzzer.radius"] - 2.0, D["buzzer.radius"] + 2.0, Z_BOARD_TOP - 1, Z_BOARD_TOP + 7).__setattr__("rotation_euler", (0, 0, a)) or bpy.data.objects[f"tooth{k}"].__setattr__("location", (fx(c[0]), fy(c[1]), 0)) or bpy.data.objects[f"tooth{k}"])
    hub = cylinder("disc_hub", fx(c[0]), fy(c[1]), 3.0, Z_BOARD_TOP + 5.0, Z_BOARD_TOP + 7.0, black, segments=24)
    join(disc, hub)
    extras(disc, "A toothed black disc with a centre hub, beside the 1815/2120 transistors. Unidentified - the speaker's magnet or a trimmer are the candidates; the piezo the emulation calls R15's load is not obviously here.", "board-L1001568.jpg", (0, 0, 20))
    parent(disc, board)
    out.append(disc)

    jx, jy = D["dc_jack.x"], D["dc_jack.y"]
    jack = box("dc_jack", fx(jx[0]), fx(jx[1]), fy(jy[1]), fy(jy[0]), Z_BOARD_TOP, Z_BOARD_TOP + 9.0, black)
    cut(jack, cylinder("jack_hole", fy((jy[0] + jy[1]) / 2), Z_BOARD_TOP + 5.0, 2.8, fx(jx[0]) - 1, fx(jx[0]) + 6, segments=20, axis="X"))
    extras(jack, "The external supply socket at the case's top edge, wired to the board with the red and black leads.", "board-L1001568.jpg", (0, 0, 20))
    parent(jack, board)
    out.append(jack)

    f = D["fire_button_body.centre"]
    fb = cylinder("fire_switch", fx(f[0]), fy(f[1]), 11.0, Z_BOARD_TOP, Z_WING - 8.0, black, segments=32)
    skirt = cylinder("fire_skirt", fx(f[0]), fy(f[1]), D["fire_button_body.radius"], Z_WING - 8.0, Z_WING - 3.5, MATERIALS["blue_control"], segments=48)
    join(fb, skirt)
    extras(fb, "The fire button's switch and the cap's blue skirt under the wing, seen from inside.", "board-L1001568.jpg", (0, 0, 25))
    parent(fb, board)
    out.append(fb)

    sx, sy = D["power_switch_body.x"], D["power_switch_body.y"]
    sw = box("power_switch", fx(sx[0]), fx(sx[1]), fy(sy[1]), fy(sy[0]), Z_BOARD_TOP, Z_WING - 4.5, black)
    extras(sw, "The power slide switch's body; the thumb through the case is the same part. Off cuts the supply - the only reset.", "board-L1001568.jpg", (0, 0, 25))
    parent(sw, board)
    out.append(sw)

    lc = D["lever_disc.centre"]
    # The disc's top is nearer the camera than the board, so its read radius leans
    # large; it cannot reach the wall.
    disc_r = min(D["lever_disc.radius"], W - WALL - 1.0 - lc[0], lc[1] - WING_TOP - WALL - 1.0)
    ld = cylinder("lever_disc", fx(lc[0]), fy(lc[1]), disc_r, Z_BOARD_TOP, Z_BOARD_TOP + 6.0, MATERIALS["grey_rubber"], segments=64)
    pin = D["lever_disc.pin"]
    lp = cylinder("lever_disc_pin", fy((pin["y"][0] + pin["y"][1]) / 2), Z_BOARD_TOP + 3.0, 1.6, fx(lc[0]), fx(pin["x"][1]), steel, segments=16, axis="X")
    join(ld, lp)
    extras(ld, "A grey disc with a steel pin, under the launcher lever's well. The lever's mechanism; how the pin's three positions reach the K matrix is not established.", "board-L1001568.jpg", (0, 0, 25))
    parent(ld, board)
    out.append(ld)

    sk = D["skill_hub.centre"]
    hub = cylinder("skill_hub", fx(sk[0]), fy(sk[1]), 5.0, Z_BOARD_TOP, Z_WING - 3.0, MATERIALS["yellow_plastic"], segments=32)
    arm = box("skill_arm", fx(sk[0]) - 12.0, fx(sk[0]) + 2.0, fy(sk[1]) - 3.0, fy(sk[1]) + 3.0, Z_BOARD_TOP, Z_BOARD_TOP + 4.0, MATERIALS["yellow_plastic"])
    join(hub, arm)
    extras(hub, "The skill lever's yellow hub and arm inside, turning with the flag on the face.", "board-L1001568.jpg", (0, 0, 25))
    parent(hub, board)
    out.append(hub)

    bx_, by_ = D["battery_box.x"], D["battery_box.y"]
    # On the back shell's floor, beside the board, not on it: the board's outline
    # starts to the box's right.
    z_floor = -Z_BACK + WALL
    bb = box("battery_box", fx(clamp_x(bx_[0])), fx(bx_[1]), fy(clamp_y(by_[1])), fy(by_[0]), z_floor, z_floor + D["battery_box.height"], MATERIALS["red_abs"])
    contacts = []
    for k, xo in enumerate((10.0, 30.0)):
        contacts.append(box(f"contact{k}", fx(bx_[0] + xo), fx(bx_[0] + xo + 6), fy(by_[0] + 6), fy(by_[0] + 1), z_floor + 4, z_floor + D["battery_box.height"] - 3, steel))
    join(bb, *contacts)
    extras(bb, "The battery box under the left wing, with its two contacts, loaded through the door in the back.", "board-L1001568.jpg", (0, 0, 30))
    parent(bb, board)
    out.append(bb)

    screws = []
    for k, (cx, cy) in enumerate(D["screws.centres"]):
        sc = cylinder(f"screw{k}", fx(cx), fy(cy), 2.4, Z_BOARD_TOP, Z_BOARD_TOP + 1.6, steel, segments=20)
        cut(sc, box(f"slot{k}", fx(cx) - 3, fx(cx) + 3, fy(cy) - 0.35, fy(cy) + 0.35, Z_BOARD_TOP + 1.0, Z_BOARD_TOP + 3))
        screws.append(sc)
    scr = join(screws[0], *screws[1:])
    scr.name = "board_screws"
    extras(scr, "The four screws that hold the board to the back shell's bosses.", "board-L1001568.jpg", (0, 0, 15))
    parent(scr, board)
    out.append(scr)
    return out


def build_internals() -> bpy.types.Object:
    board = build_pcb()
    build_tube(board)
    build_chip(board)
    build_passives(board)
    build_board_hardware(board)
    return board


def add_bosses(back: bpy.types.Object) -> None:
    """The back shell's standoff bosses, part of its moulding."""
    bosses = []
    for k, (cx, cy) in enumerate(D["standoffs.centres"]):
        cx, cy = clamp_x(cx, WALL + D["standoffs.radius"]), clamp_y(cy, WALL + D["standoffs.radius"])
        b = cylinder(f"boss{k}", fx(cx), fy(cy), D["standoffs.radius"], -Z_BACK + WALL - 0.5, Z_BOARD_BOTTOM, MATERIALS["red_abs"], segments=24)
        cut(b, cylinder(f"bossh{k}", fx(cx), fy(cy), 1.5, Z_BOARD_BOTTOM - 8, Z_BOARD_BOTTOM + 1, segments=12))
        bosses.append(b)
    join(back, *bosses)


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
    spans `frame_fraction` of the image width.

    Orthographic, deliberately: the photographs were read at the face and rim edges,
    and a perspective render would add the side walls' projection to every edge and
    call it disagreement. `focal_mm` only sets how far above the model the camera
    sits, for the sake of the clip range."""
    cam = bpy.data.cameras.new(name)
    cam.type = "ORTHO"
    cam.ortho_scale = target_width_mm / frame_fraction
    cam.sensor_fit = "HORIZONTAL"
    cam.clip_end = 5000.0
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
    build_scope_mask(front)
    build_sticker(front)
    build_controls(front)
    back = build_back_shell()
    add_bosses(back)
    build_battery_door(back)
    board = build_internals()

    for obj in (front, back, board):
        parent(obj, root)

    export_glb(args.out)
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend))

    if args.render:
        # The cameras below are placed in millimetres; the root's metre scale was for
        # the export and is undone here so the render sees the model at the size it
        # was built.
        root.scale = (1.0, 1.0, 1.0)
        setup_render(1422, 800)
        # device-front-lit.jpg: the case spans 1187 of 1422 px. A phone's main camera is
        # about a 26 mm equivalent; the exact value only changes perspective at the
        # edges, which the comparison tolerates.
        camera_matched("cam_front", W, 1187 / 1422, 1422, 800, 26.0, Z_MODULE)
        render_to(args.render / "console-model-front.png")
        # board-L1001568.jpg: the shell spans 3065 of 4000 px at 28 mm, front shell off.
        # Lit flat - the sun off, the world up - so the comparison's colour masks read
        # the board as one brown rather than as brown plus its own shadows.
        front.hide_render = True
        for child in front.children:
            child.hide_render = True
        bpy.data.objects["sun"].hide_render = True
        bpy.data.worlds["world"].node_tree.nodes["Background"].inputs["Strength"].default_value = 2.5
        bpy.context.scene.render.resolution_x = 2000
        bpy.context.scene.render.resolution_y = 1334
        camera_matched("cam_board", W, 3065 / 4000, 2000, 1334, 28.0, 0.0)
        render_to(args.render / "console-model-board.png")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    main(argv)
