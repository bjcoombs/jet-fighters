// The 3D page: the unit as a model that can be turned in the hand, with the
// machine running behind its glass.
//
// Builds a canvas for the scene and two offscreen ones for the tube, hands the
// driver a renderer bound to the first of those, and runs a render loop. That
// loop draws the scene and uploads the tube's canvas; it does not step the
// machine. The machine's clock is src/app/driver.ts, here as on the flat page.

import { opla, rom } from '../../asm/jetfighter.asm';
import { createDriver } from '../app/driver.js';
import { buildMuteToggle } from '../app/mute-toggle.js';
import { createHelpOverlay, createInputSystem } from '../input/index.js';
import { createExploder } from './explode.js';
import { buildExplodePanel, buildInfoPanel, buildTooltip, titleOf } from './panel.js';
import { createPicker } from './picking.js';
import { createConsoleScene, type Part } from './scene.js';
import { createTubeTextures } from './tube-texture.js';
import { Box3, Vector3 } from 'three';

const MODEL_URL = `${import.meta.env.BASE_URL}models/console.glb`;

const app = document.querySelector<HTMLElement>('#app3d');
if (app) {
  void start(app);
}

async function start(mount: HTMLElement): Promise<void> {
  const canvas = document.createElement('canvas');
  mount.appendChild(canvas);
  mount.appendChild(buildChrome());

  // The machine, dark, painting an offscreen canvas the model will wear.
  const textures = createTubeTextures();
  const driver = createDriver({ image: { rom, opla }, renderer: textures.renderer });
  createInputSystem(driver.apply, { screenElement: canvas });
  mount.appendChild(buildMuteToggle(driver));
  mount.appendChild(createHelpOverlay());
  driver.start();

  const status = buildStatus('Loading the model…');
  mount.appendChild(status);
  let scene;
  try {
    scene = await createConsoleScene(canvas, MODEL_URL, textures);
  } catch (err) {
    status.textContent = `Could not load ${MODEL_URL}: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  status.remove();

  // Taking it apart, and pointing at what is inside.
  const exploder = createExploder(scene.parts);
  const picker = createPicker(canvas, scene.camera, scene.parts);
  const tooltip = buildTooltip();
  const info = buildInfoPanel();
  mount.append(buildExplodePanel(exploder), tooltip.el, info.el);

  // A click is a press and release without much travel; anything longer is
  // the orbit, and orbiting over a part must not select it.
  let pressAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    pressAt = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    const hit = picker.pick(e.clientX, e.clientY);
    picker.highlight(hit?.part ?? null);
    if (hit) {
      tooltip.show(titleOf(hit.part.name), e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.hide();
      canvas.style.cursor = '';
    }
  });
  canvas.addEventListener('pointerleave', () => {
    picker.highlight(null);
    tooltip.hide();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!pressAt) return;
    const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
    pressAt = null;
    if (moved > 6) return;
    const hit = picker.pick(e.clientX, e.clientY);
    if (hit) {
      info.show(hit.part);
      focusOn(hit.part);
    } else {
      info.hide();
    }
  });

  // Easing the camera onto a part: target to its centre, distance to fit it,
  // direction kept.
  let focus: { fromPos: Vector3; toPos: Vector3; fromTarget: Vector3; toTarget: Vector3; start: number } | null = null;
  const focusOn = (part: Part): void => {
    const bounds = new Box3().setFromObject(part.object);
    const centre = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() / 2;
    const dir = scene.camera.position.clone().sub(scene.controls.target).normalize();
    const dist = Math.max(0.12, radius * 2.6);
    focus = {
      fromPos: scene.camera.position.clone(),
      toPos: centre.clone().add(dir.multiplyScalar(dist)),
      fromTarget: scene.controls.target.clone(),
      toTarget: centre,
      start: -1,
    };
  };

  const frame = (now: number): void => {
    textures.upload(now, driver.board.power.state === 'on');
    exploder.update(now);
    if (focus) {
      if (focus.start < 0) focus.start = now;
      const t = Math.min(1, (now - focus.start) / 500);
      const k = 1 - (1 - t) ** 3;
      scene.camera.position.lerpVectors(focus.fromPos, focus.toPos, k);
      scene.controls.target.lerpVectors(focus.fromTarget, focus.toTarget, k);
      if (t >= 1) focus = null;
    }
    scene.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    (globalThis as { jetFighters3d?: unknown }).jetFighters3d = { scene, driver, textures, exploder, picker };
  }
}

/** The corner chrome: a way back to the flat page, and what this is. */
function buildChrome(): HTMLElement {
  const bar = document.createElement('div');
  // Right of the mute toggle, which takes the corner on both pages.
  bar.style.cssText =
    'position:absolute;top:8px;left:44px;z-index:10;display:flex;gap:8px;align-items:center;' +
    'font-size:12px;color:#ddd;';
  const back = document.createElement('a');
  back.href = './';
  back.textContent = '← Flat page';
  back.style.cssText =
    'padding:5px 9px;border-radius:14px;border:1px solid rgba(255,255,255,0.35);' +
    'background:rgba(0,0,0,0.55);color:#eee;text-decoration:none;';
  const hint = document.createElement('span');
  hint.textContent = 'Drag to orbit, scroll to zoom, right-drag to pan';
  hint.style.cssText = 'opacity:0.7;';
  bar.append(back, hint);
  return bar;
}

function buildStatus(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10;' +
    'padding:8px 12px;border-radius:8px;background:rgba(0,0,0,0.7);color:#eee;font-size:13px;';
  return el;
}
