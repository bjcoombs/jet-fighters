// The 3D page: the unit as a model that can be turned in the hand.
//
// Builds a canvas, hands it to the scene, and runs a render loop. This loop
// draws the scene; it does not step the machine. The machine's clock is
// src/app/driver.ts, which a later change wires in here so the tube glows.

import { createConsoleScene } from './scene.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/console.glb`;

const app = document.querySelector<HTMLElement>('#app3d');
if (app) {
  void start(app);
}

async function start(mount: HTMLElement): Promise<void> {
  const canvas = document.createElement('canvas');
  mount.appendChild(canvas);
  mount.appendChild(buildChrome());

  const status = buildStatus('Loading the model…');
  mount.appendChild(status);
  let scene;
  try {
    scene = await createConsoleScene(canvas, MODEL_URL);
  } catch (err) {
    status.textContent = `Could not load ${MODEL_URL}: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  status.remove();

  const frame = (): void => {
    scene.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    (globalThis as { jetFighters3d?: unknown }).jetFighters3d = scene;
  }
}

/** The corner chrome: a way back to the flat page, and what this is. */
function buildChrome(): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:absolute;top:8px;left:8px;z-index:10;display:flex;gap:8px;align-items:center;' +
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
