// The page's chrome, in one place: the tokens every panel and button draws
// from, and the classes that use them. Injected once; the panels carry classes
// rather than their own inline styles, so a size or a translucency is changed
// here and nowhere else.

const STYLE_ID = 'jf3d-style';

const CSS = `
#app3d {
  --jf-font: system-ui, sans-serif;
  --jf-fs-s: 11px;
  --jf-fs: 12px;
  --jf-fs-l: 13px;
  --jf-r: 6px;
  --jf-r-l: 10px;
  --jf-fg: #eee;
  --jf-dim: 0.7;
  --jf-line: rgba(255, 255, 255, 0.3);
  --jf-bg: rgba(0, 0, 0, 0.65);
  --jf-bg-strong: rgba(0, 0, 0, 0.8);
  --jf-btn: rgba(255, 255, 255, 0.08);
  --jf-btn-hover: rgba(255, 255, 255, 0.16);
  --jf-on: rgba(159, 227, 255, 0.25);
  --jf-bottom: 12px;
}
#app3d .jf-panel {
  background: var(--jf-bg);
  color: var(--jf-fg);
  border-radius: var(--jf-r-l);
  font: var(--jf-fs) var(--jf-font);
  line-height: 1.45;
}
#app3d .jf-btn {
  padding: 5px 8px;
  border-radius: var(--jf-r);
  border: 1px solid var(--jf-line);
  background: var(--jf-btn);
  color: var(--jf-fg);
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
#app3d .jf-btn:hover { background: var(--jf-btn-hover); }
#app3d .jf-btn.on { background: var(--jf-on); }
#app3d .jf-row { display: flex; gap: 6px; }
#app3d .jf-row > .jf-btn { flex: 1; padding-left: 0; padding-right: 0; }
#app3d .jf-dim { opacity: var(--jf-dim); }
#app3d .jf-small { font-size: var(--jf-fs-s); }

#app3d .jf-dock {
  position: absolute;
  left: 12px;
  top: 44px;
  bottom: var(--jf-bottom);
  z-index: 10;
  width: 260px;
  max-width: calc(100vw - 24px);
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
#app3d .jf-dock > * { pointer-events: auto; }
#app3d .jf-dock-tab {
  align-self: flex-start;
  margin-bottom: 6px;
}
#app3d .jf-dock-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
#app3d .jf-dock[data-collapsed] .jf-dock-body { display: none; }
#app3d .jf-section {
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
}
#app3d .jf-section:first-child { border-top: 0; }
#app3d .jf-section.jf-parts { flex: 1 1 auto; min-height: 0; overflow: auto; gap: 2px; }
#app3d .jf-h { font-weight: 600; font-size: var(--jf-fs-l); display: flex; justify-content: space-between; align-items: baseline; }
#app3d .jf-h .jf-keys { font-weight: 400; }
#app3d .jf-slider { width: 100%; margin: 0; }
#app3d .jf-group { margin-top: 6px; font-weight: 600; font-size: var(--jf-fs-s); letter-spacing: 0.04em; text-transform: uppercase; opacity: var(--jf-dim); }
#app3d .jf-part {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: var(--jf-r);
  cursor: pointer;
}
#app3d .jf-part:hover { background: var(--jf-btn-hover); }
#app3d .jf-part.on { background: var(--jf-on); }
#app3d .jf-part input { margin: 0; }
#app3d .jf-part.hidden-part span { opacity: 0.45; }
#app3d .jf-detail {
  margin: 2px 4px 6px 24px;
  padding: 6px 8px;
  border-radius: var(--jf-r);
  background: rgba(255, 255, 255, 0.06);
  font-size: var(--jf-fs-s);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#app3d .jf-detail[hidden], #app3d .jf-tooltip[hidden] { display: none; }
#app3d kbd {
  display: inline-block;
  min-width: 1.1em;
  padding: 0 4px;
  border: 1px solid var(--jf-line);
  border-radius: 4px;
  font: var(--jf-fs-s) var(--jf-font);
  text-align: center;
  opacity: 0.85;
}
#app3d .jf-tooltip {
  position: absolute;
  z-index: 11;
  pointer-events: none;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--jf-bg-strong);
  color: #fff;
  font: var(--jf-fs) var(--jf-font);
  white-space: nowrap;
}
#app3d .jf-hint {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  z-index: 10;
  padding: 6px 12px;
  border-radius: 14px;
  background: var(--jf-bg);
  color: var(--jf-fg);
  font: var(--jf-fs) var(--jf-font);
  white-space: nowrap;
  pointer-events: none;
  transition: opacity 0.4s;
}
#app3d .jf-status {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  padding: 8px 12px;
}
#app3d .jf-touch-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 12;
  display: flex;
  gap: 8px;
  align-items: stretch;
  padding: 8px 10px;
  box-sizing: border-box;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.35));
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  font-family: var(--jf-font);
}
#app3d .jf-touch-bar .jf-btn {
  border-radius: var(--jf-r-l);
  font-size: 16px;
  font-weight: 600;
  touch-action: none;
}
`;

/** Put the page's stylesheet in the document, once. */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** A button that does not take focus: the space bar stays the fire button. */
export function button(label: string, onClick: () => void, aria?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'jf-btn';
  b.textContent = label;
  if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

/** `<kbd>` for a key name. */
export function kbd(key: string): HTMLElement {
  const el = document.createElement('kbd');
  el.textContent = key;
  return el;
}
