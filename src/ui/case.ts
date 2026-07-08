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
  // Vertical slide on the left-wing shoulder: ON at the top, OFF at the bottom.
  el.innerHTML = [
    '<span class="jf-switch__label jf-switch__label--on">ON</span>',
    '<span class="jf-switch__track"><span class="jf-switch__thumb"></span></span>',
    '<span class="jf-switch__label jf-switch__label--off">OFF</span>',
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

// SVG note: viewBox is 1100 x 500 (~24x11 cm, held-in-both-hands landscape).
// The silhouette is three stepped sections: two lower side wings flanking a
// taller central block that carries the dominant round scope. Only the static
// molded body, decks, grip texture, housings, label plate, and the scope rim
// live here. Interactive controls + the screen are HTML overlays.
const CASE_SVG = `
<svg class="jf-body" viewBox="0 0 1100 500" preserveAspectRatio="xMidYMid meet"
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
    <linearGradient id="jf-block-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0754f"/>
      <stop offset="0.5" stop-color="#cf4926"/>
      <stop offset="1" stop-color="#a12c13"/>
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
    <radialGradient id="jf-recess" cx="0.5" cy="0.4" r="0.6">
      <stop offset="0" stop-color="#6a1c0c"/>
      <stop offset="0.7" stop-color="#8a2712"/>
      <stop offset="1" stop-color="#b23c1f"/>
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

  <!-- Body silhouette: two lower wings stepping up to a taller centre block,
       with a small rounded tab where the scope bulges past the bottom edge. -->
  <path filter="url(#jf-soft)" fill="url(#jf-body-red)" stroke="#6e1a09" stroke-width="2"
        d="M44,140 Q44,104 80,104 H298 Q312,104 320,94 L372,34 Q380,24 398,24
           H702 Q720,24 728,34 L780,94 Q788,104 802,104 H1020 Q1056,104 1056,140
           V450 Q1056,482 1022,482 H636 Q628,498 612,498 H488 Q472,498 464,482
           H78 Q44,482 44,450 Z"/>

  <!-- Top gloss highlight following the stepped top edge -->
  <path fill="#ffffff" fill-opacity="0.12"
        d="M80,104 H298 Q312,104 320,94 L372,34 Q380,24 398,24 H702 Q720,24 728,34
           L780,94 Q788,104 802,104 H1020 Q1056,104 1056,140 V150 H44 V140 Q44,104 80,104 Z"/>

  <!-- Central raised block (tallest section, carries the scope) -->
  <path fill="url(#jf-block-red)" stroke="#7c2010" stroke-width="1.5"
        d="M366,44 Q374,36 388,36 H712 Q726,36 734,44 L748,66 V446 Q748,470 724,470
           H636 Q628,486 612,486 H488 Q472,486 464,470 H376 Q352,470 352,446 V66 Z"/>

  <!-- Left wing deck (raised, ribbed grip on the outer flank) -->
  <path fill="url(#jf-deck-red)" stroke="#7c2010" stroke-width="1.5"
        d="M82,124 H320 Q332,124 332,142 V444 Q332,462 314,462 H82 Q64,462 64,444 V142 Q64,124 82,124 Z"/>
  <path fill="url(#jf-ribs)"
        d="M82,124 H150 V462 H82 Q64,462 64,444 V142 Q64,124 82,124 Z"/>

  <!-- Right wing deck (raised, ribbed grip on the outer flank) -->
  <path fill="url(#jf-deck-red)" stroke="#7c2010" stroke-width="1.5"
        d="M786,124 H1018 Q1036,124 1036,142 V444 Q1036,462 1018,462 H786 Q768,462 768,444 V142 Q768,124 786,124 Z"/>
  <path fill="url(#jf-ribs)"
        d="M950,124 H1018 Q1036,124 1036,142 V444 Q1036,462 1018,462 H950 Z"/>

  <!-- Central recessed panel behind the scope -->
  <rect x="368" y="70" width="364" height="392" rx="24" fill="url(#jf-panel-red)"
        stroke="#5c1808" stroke-width="2"/>
  <!-- Scope rim (bezel) - HTML screen sits just inside this -->
  <circle cx="550" cy="250" r="196" fill="url(#jf-rim)"/>
  <circle cx="550" cy="250" r="184" fill="#050505"/>

  <!-- Shoulder ramp (left) that the ON/OFF slide switch sits on -->
  <path fill="url(#jf-block-red)" stroke="#7c2010" stroke-width="1.2"
        d="M336,116 H360 V246 H336 Q318,246 318,228 V134 Q318,116 336,116 Z"/>

  <!-- Lever housing (round recess, top of the right wing) -->
  <circle cx="865" cy="185" r="70" fill="url(#jf-recess)" stroke="#6a1c0c" stroke-width="2"/>
  <circle cx="865" cy="185" r="60" fill="#7c2413"/>

  <!-- Skill dial base (round recess, bottom-right) -->
  <circle cx="988" cy="380" r="62" fill="url(#jf-recess)" stroke="#6a1c0c" stroke-width="2"/>

  <!-- JET FIGHTERS label plate (bottom-left) -->
  <g>
    <rect x="86" y="356" width="196" height="96" rx="10" fill="url(#jf-label-blue)"
          stroke="#16265c" stroke-width="2"/>
    <rect x="94" y="364" width="180" height="80" rx="7" fill="none"
          stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/>
    <text x="184" y="398" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="30" letter-spacing="1" fill="#ffffff">JET</text>
    <text x="184" y="430" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="27" letter-spacing="1" fill="#ffffff">FIGHTERS</text>
  </g>
</svg>`;
