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
import { CONTROL_UNDER, PIN_REST_LOCAL_Z, SKILL_HUB_LOCAL, controlAtFacePoint, inputForPress, isControl, laneFromSlotOffset, poseFor, type ControlName, type ControlState } from './controls3d.js';
import { createExploder } from './explode.js';
import { buildExplodePanel, buildInfoPanel, buildTooltip, titleOf } from './panel.js';
import { createPicker } from './picking.js';
import { createConsoleScene, type Part } from './scene.js';
import { TOUCH_BAR_HEIGHT_PX, buildTouchBar, isCoarsePointer } from './touch-bar.js';
import { createTubeTextures } from './tube-texture.js';
import { createVisibility } from './visibility.js';
import { Box3, Mesh, Plane, Raycaster, Vector2, Vector3 } from 'three';

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

  // Fingers: a control bar along the bottom, and wider targets on the model.
  // `#touch` in the URL shows the bar on any device, for trying it.
  const coarse = isCoarsePointer() || window.location.hash.includes('touch');
  const slackMm = coarse ? 6 : 0;
  const panelBottom = coarse ? TOUCH_BAR_HEIGHT_PX + 8 : 12;

  // Taking it apart, hiding what is in the way, and pointing at what is inside.
  const exploder = createExploder(scene.parts);
  const visibility = createVisibility(scene.parts);
  const picker = createPicker(canvas, scene.camera, scene.parts);
  const tooltip = buildTooltip();
  const info = buildInfoPanel((part) => visibility.hide(part.name), panelBottom);
  mount.append(buildExplodePanel(exploder, visibility, panelBottom), tooltip.el, info.el);
  // With the case off the board is the thing to look at; bring the camera to it.
  visibility.onChange(() => {
    const pcb = scene.parts.get('pcb');
    if (pcb && visibility.hidden.length > 0 && visibility.isHidden('front_shell')) focusOn(pcb);
  });

  // The flag pivots on its hub: move the geometry so the part's origin is there.
  const flag = scene.parts.get('skill_flag');
  if (flag && flag.object instanceof Mesh) {
    flag.object.geometry.translate(-SKILL_HUB_LOCAL[0], 0, -SKILL_HUB_LOCAL[1]);
    flag.object.position.set(SKILL_HUB_LOCAL[0], 0, SKILL_HUB_LOCAL[1]);
    flag.restPosition.copy(flag.object.position);
  }

  // The modelled controls. A press that lands on one operates it instead of
  // orbiting: fire is held until the pointer is released anywhere, the lever
  // follows a drag down its slot, the switch and the flag act on release.
  const stateOf = (): ControlState => ({
    fire: driver.board.input.fire,
    power: driver.board.power.state === 'on',
    lever: driver.board.input.lever,
    skill: driver.board.input.skill,
  });
  if (coarse) {
    mount.appendChild(buildTouchBar({ apply: driver.apply, state: stateOf }));
  }
  const controlUnderPointer = (x: number, y: number): ControlName | null => {
    const hit = picker.pick(x, y);
    if (!hit) return null;
    if (isControl(hit.part.name)) return hit.part.name;
    if (hit.part.name in CONTROL_UNDER) return CONTROL_UNDER[hit.part.name];
    if (hit.part.name === 'front_shell') {
      const local = hit.part.object.worldToLocal(hit.point.clone());
      return controlAtFacePoint(local.x, local.z, slackMm);
    }
    return null;
  };
  // Where the pointer's ray meets the face the lever slides in, in the front
  // shell's local frame - the shell may be lifted off, and the slot goes with it.
  const slotRay = new Raycaster();
  const slotNdc = new Vector2();
  const slotOffsetAt = (x: number, y: number): number | null => {
    const shell = scene.parts.get('front_shell');
    if (!shell) return null;
    const rect = canvas.getBoundingClientRect();
    slotNdc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    slotRay.setFromCamera(slotNdc, scene.camera);
    const origin = shell.object.localToWorld(new Vector3(0, 0, 0));
    const normal = new Vector3(0, 1, 0).transformDirection(shell.object.matrixWorld);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const point = slotRay.ray.intersectPlane(plane, new Vector3());
    if (!point) return null;
    return shell.object.worldToLocal(point).z - PIN_REST_LOCAL_Z;
  };
  let active: ControlName | null = null;

  // A click is a press and release without much travel; anything longer is
  // the orbit, and orbiting over a part must not select it.
  let pressAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    pressAt = { x: e.clientX, y: e.clientY };
    active = controlUnderPointer(e.clientX, e.clientY);
    if (!active) return;
    // OrbitControls listens on the same canvas; it checks this flag first.
    scene.controls.enabled = false;
    const input = inputForPress(active, stateOf());
    if (active === 'fire_cap' && input) driver.apply(input);
    if (active === 'lever_pin') {
      const offset = slotOffsetAt(e.clientX, e.clientY);
      if (offset !== null) driver.apply({ type: 'LANE', lane: laneFromSlotOffset(offset) });
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!active) return;
    const was = active;
    active = null;
    scene.controls.enabled = true;
    if (was === 'fire_cap') driver.apply({ type: 'FIRE', pressed: false });
    if (was === 'power_thumb' || was === 'skill_flag') {
      const still = controlUnderPointer(e.clientX, e.clientY);
      const input = still === was ? inputForPress(was, stateOf()) : null;
      if (input) driver.apply(input);
    }
    pressAt = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (active === 'lever_pin') {
      const offset = slotOffsetAt(e.clientX, e.clientY);
      if (offset !== null) {
        const lane = laneFromSlotOffset(offset);
        if (lane !== driver.board.input.lever) driver.apply({ type: 'LANE', lane });
      }
      return;
    }
    if (active) return;
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
    // The controls' pose is the board's own reading of them, so the keyboard
    // moves the modelled parts as much as the pointer does.
    const pose = poseFor(stateOf());
    for (const name of Object.keys(pose) as ControlName[]) {
      const part = scene.parts.get(name);
      if (!part) continue;
      exploder.setOffset(name, pose[name].offset.lengthSq() > 0 ? pose[name].offset : null);
      part.object.rotation.y = pose[name].rotationY;
    }
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
