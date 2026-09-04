// The 3D scene: renderer, camera, lights, orbit, and the console model.
//
// This is the only layer of the program that imports `three`. It owns a render
// loop of its own - the scene has to be redrawn whenever the camera moves - but
// it never steps the machine; that is the driver's clock, and this module reads
// what the driver painted.

import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
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

/** Build the scene around `canvas` and load the model from `url`. */
export async function createConsoleScene(canvas: HTMLCanvasElement, url: string): Promise<ConsoleScene> {
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
    parts.set(obj.name, { name: obj.name, object: obj, extras, restPosition: obj.position.clone() });
  });
  tuneMaterials(model);

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
 * The exporter's materials are close; two need what glTF cannot say. The
 * smoked window should transmit rather than merely be transparent, so the tube
 * reads through it; and the tube face is drawn by the page, so it must not
 * take the room's lighting.
 */
function tuneMaterials(model: Group): void {
  model.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mat = obj.material;
    if (obj.name === 'window' && mat instanceof MeshPhysicalMaterial) {
      // Smoked acrylic: what is behind it shows through darkened, and the room
      // reflects in it faintly. Transmission blurs with roughness, so this stays
      // near-polished; the environment is what would otherwise wash it out.
      mat.transmission = 0.7;
      mat.thickness = 0.001;
      mat.roughness = 0.06;
      mat.envMapIntensity = 0.12;
      mat.specularIntensity = 0.35;
      mat.transparent = false;
      mat.opacity = 1;
      mat.color.set(0x3a2a28);
    }
    if (obj.name === 'tube_glass' && mat instanceof MeshPhysicalMaterial) {
      mat.transmission = 0.9;
      mat.roughness = 0.05;
      mat.envMapIntensity = 0.2;
      mat.transparent = false;
      mat.opacity = 1;
    }
    if (obj.name === 'tube_face' && mat instanceof MeshStandardMaterial) {
      mat.envMapIntensity = 0;
    }
  });
}
