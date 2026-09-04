// The page's controls: the explode slider and presets, the hover tooltip, and
// the panel that names a part when it is clicked.

import { PRESETS, type Exploder, type Preset } from './explode.js';
import type { Part } from './scene.js';

const PRESET_LABELS: Record<Preset, string> = {
  assembled: 'Assembled',
  'lid-off': 'Lid off',
  exploded: 'Exploded',
};

/** The slider and its three presets, bottom-left. */
export function buildExplodePanel(exploder: Exploder): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;left:12px;bottom:12px;z-index:10;display:flex;flex-direction:column;gap:8px;' +
    'padding:10px 12px;border-radius:10px;background:rgba(0,0,0,0.6);color:#eee;' +
    'font-size:12px;font-family:system-ui,sans-serif;min-width:220px;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;';
  const buttons = new Map<Preset, HTMLButtonElement>();
  for (const preset of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = PRESET_LABELS[preset];
    b.style.cssText =
      'flex:1;padding:5px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.3);' +
      'background:rgba(255,255,255,0.08);color:#eee;font-size:12px;cursor:pointer;';
    b.addEventListener('click', () => {
      exploder.setPreset(preset);
      sync();
    });
    buttons.set(preset, b);
    row.appendChild(b);
  }

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = '0';
  slider.setAttribute('aria-label', 'Take the unit apart');
  slider.style.cssText = 'width:100%;';
  slider.addEventListener('input', () => {
    exploder.setAmount(Number(slider.value));
    sync(false);
  });

  const sync = (fromPreset = true): void => {
    if (fromPreset) slider.value = String(exploder.amount);
    for (const [preset, b] of buttons) {
      const active = fromPreset && Math.abs(exploder.amount - presetAmount(preset)) < 1e-6 && presetMatches(preset, exploder);
      b.style.background = active ? 'rgba(159,227,255,0.25)' : 'rgba(255,255,255,0.08)';
    }
  };

  const title = document.createElement('div');
  title.textContent = 'Take it apart';
  title.style.cssText = 'font-weight:600;';

  box.append(title, row, slider);
  sync();
  return box;
}

function presetAmount(preset: Preset): number {
  return preset === 'assembled' ? 0 : preset === 'exploded' ? 1 : NaN;
}

function presetMatches(preset: Preset, exploder: Exploder): boolean {
  if (preset === 'lid-off') return exploder.amount > 0 && exploder.amount < 1;
  return true;
}

/** A small label that follows the pointer over a part. */
export function buildTooltip(): { el: HTMLElement; show(text: string, x: number, y: number): void; hide(): void } {
  const el = document.createElement('div');
  el.hidden = true;
  el.style.cssText =
    'position:absolute;z-index:11;pointer-events:none;padding:3px 7px;border-radius:5px;' +
    'background:rgba(0,0,0,0.8);color:#fff;font-size:12px;font-family:system-ui,sans-serif;white-space:nowrap;';
  return {
    el,
    show(text, x, y) {
      el.textContent = text;
      el.style.left = `${x + 14}px`;
      el.style.top = `${y + 14}px`;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

/** The panel that describes a clicked part, bottom-right. */
export function buildInfoPanel(): { el: HTMLElement; show(part: Part): void; hide(): void } {
  const el = document.createElement('div');
  el.hidden = true;
  el.style.cssText =
    'position:absolute;right:12px;bottom:12px;z-index:10;max-width:340px;padding:10px 12px;' +
    'border-radius:10px;background:rgba(0,0,0,0.7);color:#eee;font-size:12px;line-height:1.5;' +
    'font-family:system-ui,sans-serif;';
  const name = document.createElement('div');
  name.style.cssText = 'font-weight:600;margin-bottom:4px;';
  const label = document.createElement('div');
  const evidence = document.createElement('div');
  evidence.style.cssText = 'margin-top:6px;opacity:0.7;font-size:11px;';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.style.cssText =
    'position:absolute;top:4px;right:6px;border:0;background:none;color:#ccc;font-size:16px;cursor:pointer;';
  close.addEventListener('click', () => {
    el.hidden = true;
  });
  el.append(close, name, label, evidence);
  return {
    el,
    show(part) {
      name.textContent = titleOf(part.name);
      label.textContent = part.extras.label ?? '';
      evidence.textContent = part.extras.evidence ? `Evidence: ${part.extras.evidence}` : '';
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

/** `tube_grid_pins` -> `Tube grid pins`. */
export function titleOf(name: string): string {
  const words = name.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
