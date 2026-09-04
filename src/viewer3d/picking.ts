// Pointing at parts: which one is under the pointer, and lighting it up.
//
// A raycast from the pointer finds a mesh; the part is the nearest ancestor
// the model labelled (the silkscreen decal, for instance, belongs to the
// window). The hovered part is tinted through its material's emissive term;
// the unlit ones - the tube face, the glass, the print - are left alone, since
// a tint on the phosphor would be a lie about the machine.

import {
  Color,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  Vector2,
  type Vector3,
} from 'three';

import type { Part } from './scene.js';

export interface Hit {
  readonly part: Part;
  /** The hit point in world space. */
  readonly point: Vector3;
}

export interface Picker {
  /** The part under a pointer position in client pixels, or null. */
  pick(clientX: number, clientY: number): Hit | null;
  /** Outline `part`, or nothing. */
  highlight(part: Part | null): void;
  readonly highlighted: Part | null;
}

export function createPicker(canvas: HTMLCanvasElement, camera: PerspectiveCamera, parts: ReadonlyMap<string, Part>): Picker {
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  // Every mesh under a part, and the part it belongs to.
  const owner = new Map<Object3D, Part>();
  const meshes: Mesh[] = [];
  for (const part of parts.values()) {
    part.object.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      // A mesh under a labelled child belongs to that child, not the ancestor:
      // resolve by walking up to the nearest part.
      let node: Object3D | null = obj;
      let found: Part | undefined;
      while (node && !found) {
        for (const candidate of parts.values()) {
          if (candidate.object === node) found = candidate;
        }
        node = node.parent;
      }
      if (found && !owner.has(obj)) {
        owner.set(obj, found);
        meshes.push(obj);
      }
    });
  }

  const pick = (clientX: number, clientY: number): Hit | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      const mat = (hit.object as Mesh).material;
      // The silkscreen decal is transparent and mostly empty; a pointer over
      // its blank area is over the window beneath, which is the same part.
      if (Array.isArray(mat)) continue;
      const part = owner.get(hit.object);
      if (part) return { part, point: hit.point };
    }
    return null;
  };

  let highlighted: Part | null = null;
  const tinted: { material: MeshStandardMaterial; emissive: Color; intensity: number }[] = [];
  const TINT = new Color(0x1f3d4a);

  const highlight = (part: Part | null): void => {
    if (part === highlighted) return;
    for (const t of tinted) {
      t.material.emissive.copy(t.emissive);
      t.material.emissiveIntensity = t.intensity;
    }
    tinted.length = 0;
    highlighted = part;
    if (!part) return;
    part.object.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of mats) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        tinted.push({ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity });
        material.emissive.copy(TINT);
        material.emissiveIntensity = 1;
      }
    });
  };

  return {
    pick,
    highlight,
    get highlighted() {
      return highlighted;
    },
  };
}
