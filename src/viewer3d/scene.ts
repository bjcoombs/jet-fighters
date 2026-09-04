// The 3D scene: renderer, camera, lights, orbit, and the console model.
//
// This is the only layer of the program that imports `three`. It owns a render
// loop of its own - the scene has to be redrawn whenever the camera moves - but
// it never steps the machine; that is the driver's clock, and this module reads
// what the driver painted.

import {
  ACESFilmicToneMapping,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { attachCanvasSizing } from '../app/viewport.js';
import type { TubeTextures } from './tube-texture.js';

/** What the glTF carries on every part - see tools/model/README.md. */
export interface PartExtras {
  readonly label?: string;
  readonly evidence?: string;
  /** Metres, glTF frame: where the part goes when the unit is taken apart. */
  readonly explode?: readonly [number, number, number];
}

/** A named part of the model with its resting transform, for exploding and picking. */
export interface Part {
  readonly name: string;
  readonly object: Mesh | Group;
  readonly extras: PartExtras;
  /** Local position at rest, so the explode offset is applied from a fixed place. */
  readonly restPosition: Vector3;
  /**
   * The explode vector in the part's own local units. The extras are in metres;
   * every part sits under the root that scales millimetres to metres, so its
   * position is in millimetres, and the vector is divided by the parent's world
   * scale to match.
   */
  readonly explodeLocal: Vector3;
}

export interface ConsoleScene {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** The model's root, once loaded. */
  readonly model: Group;
  /** Every named part, by name. */
  readonly parts: ReadonlyMap<string, Part>;
  /** Draw one frame. The page's loop calls this. */
  render(): void;
  /** Put the camera where the front photograph was taken from. */
  frameFront(): void;
}

/**
 * The camera the front photograph was taken with, as far as it can be known:
 * a phone's main camera at about a 26 mm equivalent, straight above the unit,
 * framed so the case spans 1187 of 1422 px. tools/model/build_console.py
 * renders its comparison from the same place.
 */
const PHOTO_FOCAL_MM = 26;
const PHOTO_SENSOR_MM = 36;
const PHOTO_CASE_FRACTION = 1187 / 1422;

/**
 * Build the scene around `canvas` and load the model from `url`. With
 * `textures`, the tube face shows the renderer's canvas and the window carries
 * the silkscreen; without, both stay as the exporter left them.
 */
export async function createConsoleScene(canvas: HTMLCanvasElement, url: string, textures?: TubeTextures): Promise<ConsoleScene> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(new Color(0x0a0a0b), 1);

  const scene = new Scene();
  // A neutral room for the plastics' reflections; the glass needs something to
  // reflect or it reads as matte black.
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const key = new DirectionalLight(0xffffff, 1.4);
  // Off the vertical, so its reflection in the window is not under the camera's
  // first view straight down onto the glass.
  key.position.set(0.6, 0.5, -0.5);
  scene.add(key);
  const fill = new DirectionalLight(0xbfd0ff, 0.4);
  fill.position.set(-0.4, 0.3, -0.2);
  scene.add(fill);

  const camera = new PerspectiveCamera(40, 1, 0.01, 10);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.12;
  controls.maxDistance = 1.5;
  controls.target.set(0, 0, 0);

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  scene.add(model);
  // The root node carries the millimetre-to-metre scale; bounds and picking
  // read world matrices, so settle them before anything measures the model.
  model.updateMatrixWorld(true);

  const parts = new Map<string, Part>();
  model.traverse((obj) => {
    const extras = (obj.userData ?? {}) as PartExtras;
    if (!(obj instanceof Mesh || obj instanceof Group)) return;
    // A part is a node the exporter labelled. A mesh with several materials
    // arrives as a Group of unlabelled primitive meshes; those are not parts.
    if (!obj.name || typeof extras.label !== 'string') return;
    const parentScale = obj.parent ? obj.parent.getWorldScale(new Vector3()) : new Vector3(1, 1, 1);
    const [ex, ey, ez] = extras.explode ?? [0, 0, 0];
    const explodeLocal = new Vector3(ex / parentScale.x, ey / parentScale.y, ez / parentScale.z);
    parts.set(obj.name, { name: obj.name, object: obj, extras, restPosition: obj.position.clone(), explodeLocal });
  });
  tuneMaterials(model, textures);

  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3());
  controls.target.copy(centre);

  const frameFront = (): void => {
    const aspect = camera.aspect;
    // Horizontal field of the photograph's lens, then the vertical one three.js wants.
    const hfov = 2 * Math.atan(PHOTO_SENSOR_MM / (2 * PHOTO_FOCAL_MM));
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    camera.fov = (vfov * 180) / Math.PI;
    const half = size.x / 2 / PHOTO_CASE_FRACTION;
    const dist = half / Math.tan(hfov / 2);
    camera.position.set(centre.x, bounds.max.y + dist, centre.z + 1e-4);
    camera.up.set(0, 0, -1);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    controls.update();
  };

  attachCanvasSizing(canvas, {
    resize(cssWidth, cssHeight, dpr = 1) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssWidth, cssHeight, false);
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
    },
  });
  frameFront();

  return {
    renderer,
    scene,
    camera,
    controls,
    model,
    parts,
    render: () => {
      controls.update();
      renderer.render(scene, camera);
    },
    frameFront,
  };
}

/**
 * The exporter's materials are close; a few need what glTF cannot say. The
 * smoked window should transmit rather than merely be transparent, so the tube
 * reads through it; the tube face is the renderer's canvas, emitted as drawn
 * rather than lit by the room; and the silkscreen is a decal on the window.
 */
function tuneMaterials(model: Group, textures?: TubeTextures): void {
  model.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mat = obj.material;
    if (obj.name === 'tube_face' && textures) {
      // The canvas already carries the phosphor's colour, bloom and decay; it
      // is shown verbatim, outside tone mapping, as a light source would be.
      // Lifted above unity: the canvas is drawn for a screen, and here it is seen
      // through the smoked filter, which halves it.
      obj.material = new MeshBasicMaterial({ map: textures.phosphor, toneMapped: false, color: new Color(2.0, 2.0, 2.0) });
      return;
    }
    if (obj.name === 'window' && textures) {
      // The print, on the same geometry, pushed a hair toward the camera in
      // depth so it wins over the glass it is printed on. Seen from behind, the
      // text reads mirrored, as printed text does.
      const decal = new Mesh(
        upwardFaces(obj.geometry),
        new MeshBasicMaterial({
          map: textures.silkscreen,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      decal.name = 'silkscreen';
      decal.renderOrder = 2;
      obj.add(decal);
    }
    if (obj.name === 'window' && mat instanceof MeshPhysicalMaterial) {
      // Smoked acrylic as an unlit dark transparency. A lit material, however
      // it is set, carries the lights' broad highlight across the glass and the
      // tube reads through a grey blot; the filter on the unit is matt-dark and
      // what matters is that the phosphor behind it comes through darkened and
      // sharp, which plain opacity does.
      obj.material = new MeshBasicMaterial({
        color: 0x120c0e,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      return;
    }
    if (obj.name === 'tube_glass' && mat instanceof MeshPhysicalMaterial) {
      mat.transmission = 0;
      mat.transparent = true;
      mat.opacity = 0.18;
      mat.roughness = 0.05;
      mat.envMapIntensity = 0;
      mat.specularIntensity = 0.15;
      mat.color.set(0xdfe6ea);
      mat.depthWrite = false;
    }
  });
}

/**
 * The triangles of `geometry` that face +Y - the top of a box, in the model's
 * frame the face toward the player. The window is a thin box, and a decal on
 * both its faces would print the silkscreen twice, a glass-thickness apart.
 */
function upwardFaces(geometry: BufferGeometry): BufferGeometry {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.getAttribute('position');
  const nrm = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (nrm.getY(i) < 0.9) continue;
    for (let k = 0; k < 3; k += 1) {
      positions.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      uvs.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  return out;
}
