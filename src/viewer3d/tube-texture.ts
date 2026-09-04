// The tube's light, and the print on the glass, as textures.
//
// There is one drawing of the segments in this program: the tube renderer's.
// The 3D page hands it an offscreen canvas instead of the one in the flat case,
// and that canvas is uploaded to the GPU as the tube face's texture, so a lit
// segment in three dimensions is the same pixels, with the same rise and decay,
// as on the flat page. The silkscreen is drawn once, onto a second canvas, and
// goes on the window, because that is where the unit prints it.

import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';

import { VIEWBOX } from '../machine/tube/layout.js';
import { createTubeRenderer, type TubeRenderer } from '../machine/tube/renderer.js';
import { drawSilkscreen } from '../machine/tube/silkscreen.js';
import { TUBE_FACE_TRANSFORM, WINDOW_TRANSFORM, type UvTransform } from './registration.js';

export interface TubeTextures {
  /** The renderer to hand the driver. It paints `phosphor`'s canvas. */
  readonly renderer: TubeRenderer;
  /** The segments, ghost matrix and mesh, on the tube's dark face. */
  readonly phosphor: CanvasTexture;
  /** The white print, on a transparent ground. Drawn once. */
  readonly silkscreen: CanvasTexture;
  /**
   * Upload the phosphor canvas if it may have changed. Called every rendered
   * frame with the frame's timestamp and whether the machine is powered. A
   * powered tube is uploaded every frame; an unpowered one for a moment after
   * the switch, while the phosphor's decay is still painting, and then not at
   * all: a unit on a shelf costs no GPU traffic.
   */
  upload(nowMs: number, powered: boolean): void;
}

/** How long after power-off the canvas is still uploaded, for the decay to finish. */
export const DECAY_UPLOAD_MS = 1500;

/**
 * Build the two canvases and their textures.
 *
 * @param scale backing pixels per renderer unit. Four gives 1452 x 1200, enough
 *              for the mesh to resolve when the camera is close.
 */
export function createTubeTextures(scale = 4): TubeTextures {
  const width = VIEWBOX.width * scale;
  const height = VIEWBOX.height * scale;

  const tubeCanvas = document.createElement('canvas');
  tubeCanvas.width = width;
  tubeCanvas.height = height;
  const renderer = createTubeRenderer(tubeCanvas, { silkscreen: false });
  // CSS size equal to the viewbox at a pixel ratio of `scale`: the projection
  // then fills the canvas edge to edge with no letterboxing, which is what the
  // UV transforms assume.
  renderer.resize(VIEWBOX.width, VIEWBOX.height, scale);

  const printCanvas = document.createElement('canvas');
  printCanvas.width = width;
  printCanvas.height = height;
  const ctx = printCanvas.getContext('2d');
  if (!ctx) throw new Error('createTubeTextures: 2D context unavailable');
  ctx.scale(scale, scale);
  drawSilkscreen(ctx);

  const phosphor = texture(tubeCanvas, TUBE_FACE_TRANSFORM);
  const silkscreen = texture(printCanvas, WINDOW_TRANSFORM);
  silkscreen.needsUpdate = true;

  let lastPowered = -Infinity;
  const upload = (nowMs: number, powered: boolean): void => {
    if (powered) lastPowered = nowMs;
    if (nowMs - lastPowered <= DECAY_UPLOAD_MS) {
      phosphor.needsUpdate = true;
    }
  };

  return { renderer, phosphor, silkscreen, upload };
}

function texture(canvas: HTMLCanvasElement, transform: UvTransform): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  // The mesh's UVs run top-down (glTF); so does the canvas. No flip.
  tex.flipY = false;
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.repeat.set(transform.repeat[0], transform.repeat[1]);
  tex.offset.set(transform.offset[0], transform.offset[1]);
  return tex;
}
