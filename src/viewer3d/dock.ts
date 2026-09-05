// The dock: the one panel on the page.
//
// Three sections. View puts the camera somewhere known; Take apart is the
// explode slider and its detents with the case-off buttons; Parts lists every
// labelled part in four groups with a checkbox for its visibility, a hover to
// light it up, and a click to focus on it, its label and evidence opening under
// its row. The pure half - which key means what, which group a part is in,
// which detent the slider is on - is tested headlessly; the DOM half only
// reflects state that lives in the exploder, the visibility and the scene.
//
// The keys are chosen clear of the machine's: P, 1-3, W/S, the arrows, space,
// Enter and M are the unit's and the mute's, and dock.test.ts checks the two
// sets stay apart.

import { PRESETS, PRESET_AMOUNT, type Exploder, type Preset, nextPreset, presetAt } from './explode.js';
import type { Picker } from './picking.js';
import { VIEWS, type Part, type ViewName } from './scene.js';
import { button, kbd } from './styles.js';
import type { Visibility } from './visibility.js';

/** What a key asks the dock to do. */
export type DockAction =
  | { readonly type: 'view'; readonly view: ViewName }
  | { readonly type: 'cycle' }
  | { readonly type: 'hide' }
  | { readonly type: 'clear' };

/** The dock's keys. Letters are case-insensitive. */
export function dockKey(key: string): DockAction | null {
  switch (key) {
    case 'f':
    case 'F':
      return { type: 'view', view: 'front' };
    case 'b':
    case 'B':
      return { type: 'view', view: 'back' };
    case 'i':
    case 'I':
      return { type: 'view', view: 'inside' };
    case 'e':
    case 'E':
      return { type: 'cycle' };
    case 'h':
    case 'H':
      return { type: 'hide' };
    case 'Escape':
      return { type: 'clear' };
    default:
      return null;
  }
}

/** Every key the dock answers to, for the collision check and the help. */
export const DOCK_KEYS: readonly string[] = ['f', 'b', 'i', 'e', 'h', 'Escape'];

export type PartGroup = 'Case' | 'Board' | 'Tube' | 'Controls';

export const GROUPS: readonly PartGroup[] = ['Case', 'Board', 'Tube', 'Controls'];

const CASE = new Set(['front_shell', 'back_shell', 'battery_door', 'scope_mask', 'sticker']);
const CONTROLS = new Set(['fire_cap', 'power_thumb', 'lever_pin', 'skill_flag', 'fire_switch', 'power_switch', 'lever_disc', 'skill_hub', 'toothed_disc']);

/** The group a part is listed under: the tube and its window, the case, the controls inside and out, and the board for the rest. */
export function groupOf(name: string): PartGroup {
  if (name.startsWith('tube_') || name === 'window') return 'Tube';
  if (CASE.has(name)) return 'Case';
  if (CONTROLS.has(name)) return 'Controls';
  return 'Board';
}

/** The parts by group, groups in their fixed order and parts in the order given. The model's root is not a part to list. */
export function grouped(names: Iterable<string>): ReadonlyMap<PartGroup, readonly string[]> {
  const out = new Map<PartGroup, string[]>(GROUPS.map((g) => [g, []]));
  for (const name of names) {
    if (name === 'console') continue;
    out.get(groupOf(name))?.push(name);
  }
  return out;
}

/** `tube_grid_pins` -> `Tube grid pins`. */
export function titleOf(name: string): string {
  const words = name.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PRESET_LABELS: Record<Preset, string> = { assembled: 'Assembled', 'lid-off': 'Lid off', exploded: 'Exploded' };
const VIEW_LABELS: Record<ViewName, string> = { front: 'Front', back: 'Back', inside: 'Inside' };
const VIEW_KEYS: Record<ViewName, string> = { front: 'F', back: 'B', inside: 'I' };

export interface DockOptions {
  readonly parts: ReadonlyMap<string, Part>;
  readonly exploder: Exploder;
  readonly visibility: Visibility;
  readonly picker: Picker;
  /** Ease the camera to a view. The dock marks it until the camera is moved by hand. */
  readonly onView: (view: ViewName) => void;
  /** Ease the camera onto a part, or clear the focus. */
  readonly onFocus: (part: Part | null) => void;
  /** Start folded to its tab: phones. */
  readonly collapsed?: boolean;
}

export interface Dock {
  readonly el: HTMLElement;
  /** Mark a view as current, or none: the page calls this when the camera moves by hand. */
  setView(view: ViewName | null): void;
  /** Focus a part from outside (a click on the model): its row opens and scrolls into view. */
  focus(part: Part | null): void;
  readonly focused: Part | null;
  /** The key handler, for the page's window listener. True if the key was the dock's. */
  key(key: string): boolean;
}

export function buildDock(o: DockOptions): Dock {
  const el = document.createElement('div');
  el.className = 'jf-dock';
  if (o.collapsed) el.dataset.collapsed = '';

  const tab = button('', () => {
    if ('collapsed' in el.dataset) delete el.dataset.collapsed;
    else el.dataset.collapsed = '';
    syncTab();
  });
  tab.classList.add('jf-dock-tab');
  const syncTab = (): void => {
    const open = !('collapsed' in el.dataset);
    tab.textContent = open ? '‹ Hide panel' : '☰ Views, parts';
    tab.setAttribute('aria-expanded', String(open));
  };
  syncTab();

  const body = document.createElement('div');
  body.className = 'jf-panel jf-dock-body';

  // View.
  const view = section('View');
  const viewRow = document.createElement('div');
  viewRow.className = 'jf-row';
  const viewButtons = new Map<ViewName, HTMLButtonElement>();
  for (const v of VIEWS) {
    const b = button(VIEW_LABELS[v], () => o.onView(v), `${VIEW_LABELS[v]} view (${VIEW_KEYS[v]})`);
    viewButtons.set(v, b);
    viewRow.appendChild(b);
  }
  view.append(viewRow, note('Drag to orbit, scroll to zoom, right-drag to pan.'));

  // Take apart.
  const apart = section('Take apart', ['E']);
  const presetRow = document.createElement('div');
  presetRow.className = 'jf-row';
  const presetButtons = new Map<Preset, HTMLButtonElement>();
  for (const p of PRESETS) {
    const b = button(PRESET_LABELS[p], () => o.exploder.setPreset(p));
    presetButtons.set(p, b);
    presetRow.appendChild(b);
  }
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'jf-slider';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = '0';
  slider.setAttribute('aria-label', 'Take the unit apart');
  slider.addEventListener('input', () => {
    o.exploder.setAmount(Number(slider.value));
    // The arrows are the launcher's; a slider left focused would take them.
    slider.blur();
  });
  const caseRow = document.createElement('div');
  caseRow.className = 'jf-row';
  const bare = button('Bare board', () => o.visibility.bare());
  const all = button('Show all', () => o.visibility.showAll());
  caseRow.append(bare, all);
  const hiddenNote = note('');
  apart.append(presetRow, slider, caseRow, hiddenNote);

  // Parts.
  const partsSection = section('Parts', ['H', 'Esc']);
  partsSection.classList.add('jf-parts');
  const rows = new Map<string, { row: HTMLElement; box: HTMLInputElement; detail: HTMLElement }>();
  for (const [group, names] of grouped(o.parts.keys())) {
    if (names.length === 0) continue;
    const h = document.createElement('div');
    h.className = 'jf-group';
    h.textContent = group;
    partsSection.appendChild(h);
    for (const name of names) {
      const part = o.parts.get(name);
      if (!part) continue;
      const row = document.createElement('label');
      row.className = 'jf-part';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', `Show ${titleOf(name)}`);
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => (box.checked ? o.visibility.show(name) : o.visibility.hide(name)));
      const text = document.createElement('span');
      text.textContent = titleOf(name);
      row.append(box, text);
      row.addEventListener('pointerenter', () => o.picker.highlight(part));
      row.addEventListener('pointerleave', () => {
        if (o.picker.highlighted === part) o.picker.highlight(null);
      });
      row.addEventListener('click', (e) => {
        if (e.target === box) return;
        e.preventDefault();
        setFocus(focused === part ? null : part, true);
      });
      const detail = document.createElement('div');
      detail.className = 'jf-detail';
      detail.hidden = true;
      partsSection.append(row, detail);
      rows.set(name, { row, box, detail });
    }
  }

  body.append(view, apart, partsSection);
  el.append(tab, body);

  // State, reflected.
  let currentView: ViewName | null = null;
  let focused: Part | null = null;

  const syncView = (): void => {
    for (const [v, b] of viewButtons) b.classList.toggle('on', v === currentView);
  };
  const syncExplode = (): void => {
    const amount = o.exploder.amount;
    slider.value = String(amount);
    const at = presetAt(amount);
    for (const [p, b] of presetButtons) b.classList.toggle('on', p === at);
  };
  const syncHidden = (): void => {
    const hidden = o.visibility.hidden;
    for (const [name, r] of rows) {
      const shown = !o.visibility.isHidden(name);
      r.box.checked = shown;
      r.row.classList.toggle('hidden-part', !shown);
    }
    const n = hidden.length;
    hiddenNote.textContent = n === 0 ? 'Every part shown.' : `${n} part${n === 1 ? '' : 's'} hidden.`;
    all.classList.toggle('on', n > 0);
  };
  const setFocus = (part: Part | null, fromDock = false): void => {
    if (focused) {
      const r = rows.get(focused.name);
      if (r) {
        r.row.classList.remove('on');
        r.detail.hidden = true;
        r.detail.replaceChildren();
      }
    }
    focused = part;
    if (part) {
      const r = rows.get(part.name);
      if (r) {
        r.row.classList.add('on');
        const label = document.createElement('div');
        label.textContent = part.extras.label ?? '';
        r.detail.appendChild(label);
        if (part.extras.evidence) {
          const ev = document.createElement('div');
          ev.className = 'jf-dim';
          ev.textContent = `Evidence: ${part.extras.evidence}`;
          r.detail.appendChild(ev);
        }
        const hide = button('Hide this part', () => {
          o.visibility.hide(part.name);
          setFocus(null);
        });
        hide.classList.add('jf-small');
        r.detail.appendChild(hide);
        r.detail.hidden = false;
        if (!fromDock) r.row.scrollIntoView({ block: 'nearest' });
      }
    }
    o.onFocus(part);
  };

  o.exploder.onChange(syncExplode);
  o.visibility.onChange(syncHidden);
  syncView();
  syncExplode();
  syncHidden();

  return {
    el,
    setView(v) {
      currentView = v;
      syncView();
    },
    focus: (part) => setFocus(part),
    get focused() {
      return focused;
    },
    key(key) {
      const action = dockKey(key);
      if (!action) return false;
      switch (action.type) {
        case 'view':
          o.onView(action.view);
          break;
        case 'cycle':
          o.exploder.setPreset(nextPreset(o.exploder.amount));
          break;
        case 'hide':
          if (focused) {
            o.visibility.hide(focused.name);
            setFocus(null);
          }
          break;
        case 'clear':
          setFocus(null);
          break;
      }
      return true;
    },
  };
}

function section(title: string, keys: readonly string[] = []): HTMLElement {
  const s = document.createElement('div');
  s.className = 'jf-section';
  const h = document.createElement('div');
  h.className = 'jf-h';
  const t = document.createElement('span');
  t.textContent = title;
  h.appendChild(t);
  if (keys.length) {
    const k = document.createElement('span');
    k.className = 'jf-keys';
    for (const key of keys) k.append(kbd(key), ' ');
    h.appendChild(k);
  }
  s.appendChild(h);
  return s;
}

function note(text: string): HTMLElement {
  const n = document.createElement('div');
  n.className = 'jf-dim jf-small';
  n.textContent = text;
  return n;
}

/** Referenced so the detent table stays the slider's: a preset button lands exactly where `presetAt` reads it. */
export const DETENTS = PRESET_AMOUNT;
