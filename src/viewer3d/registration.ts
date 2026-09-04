// Where the tube renderer's canvas lands on the model's glass.
//
// The renderer draws the scope in its own frame, `VIEWBOX` in
// src/machine/tube/layout.ts: 363 x 300 units with the radar circle at (213, 150),
// radius 150. The model's window and tube face are in millimetres from the
// measured dimensions (tools/model/dimensions.json, the same file the Blender
// script builds from). The circle is what registers the two: it is the one
// feature both frames draw, and the renderer's rectangle and the model's differ
// slightly at the left (docs/evidence/console-dimensions.md, the SVG cross-check),
// so the rectangle is not used.
//
// A mesh's UVs run 0..1 over its bounding box, u left to right, v top to bottom
// (glTF's convention). A texture transform maps that box onto the renderer's
// canvas: u' = u * repeat.x + offset.x, the same for v, in the canvas's own 0..1
// with v = 0 at its top row. Content outside the mesh is simply not drawn.

import dimensions from '../../tools/model/dimensions.json';
import { CIRCLE, VIEWBOX } from '../machine/tube/layout.js';

/** A 2D texture transform: uv' = uv * repeat + offset. */
export interface UvTransform {
  readonly repeat: readonly [number, number];
  readonly offset: readonly [number, number];
}

/** An axis-aligned box in face millimetres, y down from the module's top edge. */
export interface MmBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const D = dimensions.dimensions;

/** The scope circle on the face, mm. */
export const CIRCLE_MM = {
  cx: D['scope.circle_centre'].value[0],
  cy: D['scope.circle_centre'].value[1],
  r: D['scope.circle_radius'].value,
} as const;

/** Millimetres per renderer unit: the circle's radius in both frames. */
export const MM_PER_UNIT = CIRCLE_MM.r / CIRCLE.r;

/** The window's bounding box on the face: the rectangle's left edge to the circle's right, the circle's height. */
export const WINDOW_MM: MmBox = {
  left: D['scope.rect'].value.left,
  top: CIRCLE_MM.cy - CIRCLE_MM.r,
  right: CIRCLE_MM.cx + CIRCLE_MM.r,
  bottom: CIRCLE_MM.cy + CIRCLE_MM.r,
};

/** The tube's printed face, in plan, mm. Its mesh is `tube_face` in the model. */
export const TUBE_FACE_MM: MmBox = {
  left: D['tube.face_x'].value[0],
  right: D['tube.face_x'].value[1],
  top: D['tube.face_y'].value[0],
  bottom: D['tube.face_y'].value[1],
};

/** A face point in mm -> renderer units. */
export function toUnits(xMm: number, yMm: number): readonly [number, number] {
  return [CIRCLE.cx + (xMm - CIRCLE_MM.cx) / MM_PER_UNIT, CIRCLE.cy + (yMm - CIRCLE_MM.cy) / MM_PER_UNIT];
}

/** The texture transform that puts the renderer's canvas onto a mesh whose UVs span `box`. */
export function transformFor(box: MmBox): UvTransform {
  const [x0, y0] = toUnits(box.left, box.top);
  const [x1, y1] = toUnits(box.right, box.bottom);
  return {
    repeat: [(x1 - x0) / VIEWBOX.width, (y1 - y0) / VIEWBOX.height],
    offset: [x0 / VIEWBOX.width, y0 / VIEWBOX.height],
  };
}

/** Onto the smoked window: the silkscreen. */
export const WINDOW_TRANSFORM: UvTransform = transformFor(WINDOW_MM);

/** Onto the tube's face: the phosphor. */
export const TUBE_FACE_TRANSFORM: UvTransform = transformFor(TUBE_FACE_MM);
