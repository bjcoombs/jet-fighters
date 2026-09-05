// The page: the unit as a model that can be turned in the hand, with the
// machine running behind its glass. It opens on the front view, which is the
// unit as the flat drawing used to show it; the drawing was a rendering of
// this and is gone.
//
// Builds a canvas for the scene and two offscreen ones for the tube, hands the
// driver a renderer bound to the first of those, and runs a render loop. That
// loop draws the scene and uploads the tube's canvas; it does not step the
// machine. The machine's clock is src/app/driver.ts.

import { highestAddress, opla, ramHighWater, rom, symbols } from '../../asm/jetfighter.asm';
import { createDriver } from '../app/driver.js';
import { buildMuteToggle } from '../app/mute-toggle.js';
import { createHelpOverlay, createInputSystem } from '../input/index.js';
import { CONTROL_UNDER, PIN_REST_LOCAL_Z, SKILL_HUB_LOCAL, controlAtFacePoint, inputForPress, isControl, laneFromSlotOffset, poseFor, type ControlName, type ControlState } from './controls3d.js';
import { buildDock, titleOf } from './dock.js';
import { createExploder } from './explode.js';
import { buildTooltip } from './panel.js';
import { createPicker } from './picking.js';
import { createConsoleScene, type Part, type ViewName } from './scene.js';
import { injectStyles } from './styles.js';
import { TOUCH_BAR_HEIGHT_PX, buildTouchBar, isCoarsePointer } from './touch-bar.js';
import { createTubeTextures } from './tube-texture.js';
import { createVisibility } from './visibility.js';
import { Box3, Mesh, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';

const MODEL_URL = `${import.meta.env.BASE_URL}models/console.glb`;

/** How fast a modelled control settles into its new place: a press, not a jump. */
const CONTROL_EASE_MS = 90;

const HINT_KEY = 'jf3d-hint-seen';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void start(app);
}

async function start(mount: HTMLElement): Promise<void> {
  injectStyles();
  const canvas = document.createElement('canvas');
  mount.appendChild(canvas);

  // The machine, dark, painting an offscreen canvas the model will wear.
  const textures = createTubeTextures();
  const driver = createDriver({ image: { rom, opla }, renderer: textures.renderer });
  createInputSystem(driver.apply);
  mount.appendChild(buildMuteToggle(driver));
  mount.appendChild(
    createHelpOverlay(document, {
      extraRows: [
        ['F / B / I', 'Front, back, inside views'],
        ['E', 'Take apart, step by step'],
        ['H', 'Hide the focused part'],
        ['Esc', 'Clear the focus'],
      ],
    }),
  );
  driver.start();

  const status = buildStatus('Loading the model\u2026');
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
  mount.style.setProperty('--jf-bottom', `${coarse ? TOUCH_BAR_HEIGHT_PX + 8 : 12}px`);

  // Taking it apart, hiding what is in the way, and pointing at what is inside.
  const exploder = createExploder(scene.parts);
  const visibility = createVisibility(scene.parts);
  const picker = createPicker(canvas, scene.camera, scene.parts);
  const tooltip = buildTooltip();
  const dock = buildDock({
    parts: scene.parts,
    exploder,
    visibility,
    picker,
    // Folded until asked for: the page opens as the unit and nothing else.
    collapsed: true,
    onView: (view) => goToView(view),
    onFocus: (part) => {
      if (part) focusOn(part);
    },
  });
  mount.append(dock.el, tooltip.el);
  // The dock's keys, beside the machine's: the input system takes its own and
  // leaves the rest, and these do not overlap (dock.test.ts).
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (dock.key(e.key)) e.preventDefault();
  });
  // With the case off the board is the thing to look at; bring the camera to it.
  visibility.onChange(() => {
    const pcb = scene.parts.get('pcb');
    if (pcb && visibility.hidden.length > 0 && visibility.isHidden('front_shell')) focusOn(pcb);
  });
  // A hand on the model unmarks the view.
  scene.controls.addEventListener('start', () => dock.setView(null));

  // One line for the first visit, gone at the first touch.
  const hint = buildHint();
  if (hint) mount.appendChild(hint);

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
    dock.focus(hit ? hit.part : null);
  });

  // Easing the camera: onto a part - target to its centre, distance to fit it,
  // direction kept - or to one of the named views.
  // The camera swings round the target rather than moving straight to the new
  // place: from the front to the back the straight line passes through the
  // unit, and the orbit controls lose their bearings at the middle of it.
  interface Flight {
    fromTarget: Vector3;
    toTarget: Vector3;
    fromDir: Vector3;
    turn: Quaternion;
    fromDist: number;
    toDist: number;
    start: number;
  }
  let focus: Flight | null = null;
  const flyTo = (position: Vector3, target: Vector3): void => {
    const fromDir = scene.camera.position.clone().sub(scene.controls.target);
    const fromDist = fromDir.length();
    fromDir.normalize();
    const toDir = position.clone().sub(target);
    const toDist = toDir.length();
    toDir.normalize();
    const turn = new Quaternion();
    // Straight over to the far side: tumble over the case's long axis.
    if (fromDir.dot(toDir) < -0.9999) turn.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    else turn.setFromUnitVectors(fromDir, toDir);
    focus = { fromTarget: scene.controls.target.clone(), toTarget: target, fromDir, turn, fromDist, toDist, start: -1 };
  };
  const focusOn = (part: Part): void => {
    const bounds = new Box3().setFromObject(part.object);
    const centre = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() / 2;
    const dir = scene.camera.position.clone().sub(scene.controls.target).normalize();
    const dist = Math.max(0.12, radius * 2.6);
    flyTo(centre.clone().add(dir.multiplyScalar(dist)), centre);
  };
  const goToView = (view: ViewName): void => {
    // Inside is the board seen with the lid lifted off it.
    if (view === 'inside' && exploder.amount < 0.5) exploder.setPreset('lid-off');
    const pose = scene.poseFor(view);
    flyTo(pose.position, pose.target);
    dock.setView(view);
  };
  dock.setView('front');

  // The controls' pose is the board's own reading of them, so the keyboard
  // moves the modelled parts as much as the pointer does. Each eases to its
  // place over a few frames: the cap sinks, the slide travels, the flag turns.
  const eased = new Map<ControlName, { offset: Vector3; rotationY: number }>();
  let lastFrame = 0;
  const frame = (now: number): void => {
    textures.upload(now, driver.board.power.state === 'on');
    const dt = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    const k = Math.min(1, dt / CONTROL_EASE_MS);
    const pose = poseFor(stateOf());
    for (const name of Object.keys(pose) as ControlName[]) {
      const part = scene.parts.get(name);
      if (!part) continue;
      let cur = eased.get(name);
      if (!cur) {
        cur = { offset: pose[name].offset.clone(), rotationY: pose[name].rotationY };
        eased.set(name, cur);
      }
      cur.offset.lerp(pose[name].offset, k);
      cur.rotationY += (pose[name].rotationY - cur.rotationY) * k;
      exploder.setOffset(name, cur.offset.lengthSq() > 1e-9 ? cur.offset : null);
      part.object.rotation.y = cur.rotationY;
    }
    exploder.update(now);
    if (focus) {
      if (focus.start < 0) focus.start = now;
      const t = Math.min(1, (now - focus.start) / 500);
      const k = 1 - (1 - t) ** 3;
      scene.controls.target.lerpVectors(focus.fromTarget, focus.toTarget, k);
      const dir = focus.fromDir.clone().applyQuaternion(new Quaternion().slerp(focus.turn, k));
      scene.camera.position.copy(scene.controls.target).addScaledVector(dir, focus.fromDist + (focus.toDist - focus.fromDist) * k);
      if (t >= 1) focus = null;
    }
    scene.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // A console handle on the machine: step it, read its RAM, name an address
    // from the assembler's symbol table. The debugging surface a contributor
    // editing the ROM needs, and dev-only so it is not part of the product.
    (globalThis as { jetFighters?: unknown }).jetFighters = {
      board: driver.board,
      renderer: textures.renderer,
      // Null until the first input builds it. `speaker.stats` is how a silent
      // machine is told apart from a silenced one: edges consumed says the ROM
      // is toggling the pin, realignments and underruns say what the transport
      // then did with them.
      get speaker() {
        return driver.speaker;
      },
      rom: { words: rom.length, highestAddress, ramHighWater, symbols },
      scene,
      driver,
      textures,
      exploder,
      picker,
    };
  }
}

/**
 * One line for a first visit, gone at the first pointer or key. Remembered in
 * the browser so it is not shown again; where storage is unavailable it shows
 * each time, which is the lesser harm.
 */
function buildHint(): HTMLElement | null {
  try {
    if (localStorage.getItem(HINT_KEY)) return null;
  } catch {
    // Storage blocked: show it.
  }
  const el = document.createElement('div');
  el.className = 'jf-hint';
  el.textContent = 'Drag to orbit \u00b7 P for power \u00b7 click the controls';
  const dismiss = (): void => {
    // Faded by the stylesheet's transition; removed when it has faded.
    el.addEventListener('transitionend', () => el.remove());
    el.style.opacity = '0';
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Storage blocked: nothing to remember it in.
    }
    window.removeEventListener('pointerdown', dismiss);
    window.removeEventListener('keydown', dismiss);
  };
  window.addEventListener('pointerdown', dismiss);
  window.addEventListener('keydown', dismiss);
  return el;
}

function buildStatus(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-panel jf-status';
  el.textContent = text;
  return el;
}
