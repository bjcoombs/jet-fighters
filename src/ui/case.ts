/**
 * Renders the Jet Fighters tabletop unit: a warm-red landscape case with a
 * blue JET FIGHTERS label, a round black scope window (holding the VFD canvas),
 * and the on-case controls. The molded body is drawn as scalable SVG; the
 * interactive controls and the screen are HTML overlays positioned as
 * percentages of a fixed-aspect stage so a circular window stays circular at
 * every size.
 *
 * The white silkscreen INSIDE the window (zone labels, ruler, arc text) is the
 * VFD canvas renderer's job (task 4), not this module's - we provide the
 * window and bezel only.
 */
import './case.css';

export interface CaseElements {
  /** Root case element - pass this to `setupControls`. */
  root: HTMLElement;
  /** The VFD canvas (`id="vfd"`), mounted clipped inside the scope window. */
  canvas: HTMLCanvasElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build the case into `mount` (replacing its contents) and return handles to
 * the case root and the VFD canvas.
 */
export function buildCase(mount: HTMLElement): CaseElements {
  mount.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'jf-stage';

  const root = document.createElement('div');
  root.className = 'jf-case';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Jet Fighters tabletop unit');
  root.innerHTML = CASE_SVG;

  root.appendChild(buildScreen());
  root.appendChild(buildFireButton());
  root.appendChild(buildPowerSwitch());
  root.appendChild(buildLever());
  root.appendChild(buildDial());

  stage.appendChild(root);
  mount.appendChild(stage);

  const canvas = root.querySelector<HTMLCanvasElement>('#vfd');
  if (!canvas) throw new Error('buildCase: VFD canvas failed to mount');

  return { root, canvas };
}

function buildScreen(): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'jf-screen';
  const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
  canvas.id = 'vfd';
  canvas.width = 480;
  canvas.height = 360;
  canvas.className = 'jf-screen__canvas';
  // Placeholder fill so the scope reads as "off" until the renderer (task 3)
  // takes over. Kept minimal - the real screen is not this module's concern.
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  screen.appendChild(canvas);
  return screen;
}

function buildFireButton(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-fire';
  el.dataset.control = 'fire';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Fire missile');
  el.innerHTML = '<span class="jf-fire__ring"></span><span class="jf-fire__cap"></span>';
  return el;
}

function buildPowerSwitch(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-switch';
  el.dataset.control = 'power';
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-label', 'Power');
  el.innerHTML = [
    '<span class="jf-switch__label jf-switch__label--off">OFF</span>',
    '<span class="jf-switch__track"><span class="jf-switch__thumb"></span></span>',
    '<span class="jf-switch__label jf-switch__label--on">ON</span>',
  ].join('');
  return el;
}

function buildLever(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-lever';
  el.dataset.control = 'lever';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Launcher lane');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '2');
  el.setAttribute('aria-valuenow', '1');
  el.innerHTML = [
    '<span class="jf-lever__slot"></span>',
    '<span class="jf-lever__arm"><span class="jf-lever__knob"></span></span>',
  ].join('');
  return el;
}

function buildDial(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-dial';
  el.dataset.control = 'skill';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Skill level');
  el.setAttribute('aria-valuemin', '1');
  el.setAttribute('aria-valuemax', '3');
  el.setAttribute('aria-valuenow', '1');
  el.innerHTML = [
    '<span class="jf-dial__mark jf-dial__mark--1" data-level="1">1</span>',
    '<span class="jf-dial__mark jf-dial__mark--2" data-level="2">2</span>',
    '<span class="jf-dial__mark jf-dial__mark--3" data-level="3">3</span>',
    '<span class="jf-dial__face"><span class="jf-dial__pointer"></span><span class="jf-dial__grip"></span></span>',
  ].join('');
  return el;
}

// SVG note: viewBox is 1000 x 460 (~24x11 cm, held-in-both-hands landscape).
// Only the static molded body, decks, grip texture, label plate, and the scope
// rim live here. Interactive controls + the screen are HTML overlays.
const CASE_SVG = `
<svg class="jf-body" viewBox="0 0 1000 460" preserveAspectRatio="xMidYMid meet"
     xmlns="${SVG_NS}" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="jf-body-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e15535"/>
      <stop offset="0.45" stop-color="#c53d20"/>
      <stop offset="1" stop-color="#951f0d"/>
    </linearGradient>
    <linearGradient id="jf-deck-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ef6a45"/>
      <stop offset="1" stop-color="#bd3a1e"/>
    </linearGradient>
    <radialGradient id="jf-panel-red" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="#a02c15"/>
      <stop offset="1" stop-color="#701c0a"/>
    </radialGradient>
    <linearGradient id="jf-label-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a5bb0"/>
      <stop offset="1" stop-color="#213c86"/>
    </linearGradient>
    <radialGradient id="jf-rim" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0.82" stop-color="#2a0f06"/>
      <stop offset="0.9" stop-color="#5a1a0b"/>
      <stop offset="1" stop-color="#932c15"/>
    </radialGradient>
    <pattern id="jf-ribs" width="14" height="14" patternTransform="rotate(35)"
             patternUnits="userSpaceOnUse">
      <rect width="14" height="14" fill="none"/>
      <line x1="0" y1="0" x2="0" y2="14" stroke="#000" stroke-opacity="0.14" stroke-width="4"/>
      <line x1="7" y1="0" x2="7" y2="14" stroke="#fff" stroke-opacity="0.06" stroke-width="3"/>
    </pattern>
    <filter id="jf-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Body silhouette: rounded landscape slab pinched at the sides (hand grips) -->
  <path filter="url(#jf-soft)" fill="url(#jf-body-red)" stroke="#6e1a09" stroke-width="2"
        d="M40,10 H960 Q990,10 990,44 V170
           C948,202 948,258 990,290 V416 Q990,450 956,450 H44
           Q10,450 10,416 V290 C52,258 52,202 10,170 V44 Q10,10 40,10 Z"/>

  <!-- Top highlight to suggest molded gloss -->
  <path fill="#ffffff" fill-opacity="0.12"
        d="M40,10 H960 Q990,10 990,44 V60 H10 V44 Q10,10 40,10 Z"/>

  <!-- Top control deck (raised) -->
  <path fill="url(#jf-deck-red)" stroke="#7c2010" stroke-width="1.5"
        d="M60,26 H940 Q958,26 958,44 V150 Q958,168 940,168 H60 Q42,168 42,150 V44 Q42,26 60,26 Z"/>
  <!-- Bottom control deck (raised, ribbed grip) -->
  <path fill="url(#jf-deck-red)" stroke="#7c2010" stroke-width="1.5"
        d="M60,300 H940 Q958,300 958,318 V424 Q958,434 940,434 H60 Q42,434 42,424 V318 Q42,300 60,300 Z"/>
  <path fill="url(#jf-ribs)"
        d="M60,300 H340 V434 H60 Q42,434 42,424 V318 Q42,300 60,300 Z"/>
  <path fill="url(#jf-ribs)"
        d="M660,300 H940 Q958,300 958,318 V424 Q958,434 940,434 H660 Z"/>

  <!-- Central recessed panel behind the scope -->
  <rect x="300" y="52" width="400" height="356" rx="26" fill="url(#jf-panel-red)"
        stroke="#5c1808" stroke-width="2"/>
  <!-- Scope rim (bezel) - HTML screen sits just inside this -->
  <circle cx="500" cy="235" r="182" fill="url(#jf-rim)"/>
  <circle cx="500" cy="235" r="170" fill="#050505"/>

  <!-- JET FIGHTERS label plate (top-left) -->
  <g>
    <rect x="58" y="44" width="196" height="104" rx="12" fill="url(#jf-label-blue)"
          stroke="#16265c" stroke-width="2"/>
    <rect x="66" y="52" width="180" height="88" rx="8" fill="none"
          stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/>
    <text x="156" y="94" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="34" letter-spacing="1" fill="#ffffff">JET</text>
    <text x="156" y="128" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="30" letter-spacing="1" fill="#ffffff">FIGHTERS</text>
  </g>
</svg>`;
