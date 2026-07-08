/**
 * Renders the Jet Fighters tabletop unit: a warm-red landscape case with two
 * raised control wings flanking a central round black scope window (holding the
 * VFD canvas). The molded body is drawn as scalable SVG; the interactive
 * controls and the screen are HTML overlays positioned as percentages of a
 * fixed-aspect stage so the circular window stays circular at every size.
 *
 * Layout (true landscape orientation, verified against the reference photos):
 *   LEFT wing  - blue fire button (top), black ON/OFF slide switch (right of
 *                it), blue JET FIGHTERS label plate (bottom).
 *   CENTER     - round scope window; the white silkscreen INSIDE it (arc text
 *                across the top, zone labels along the bottom, 10/3/2/1/G ruler)
 *                is the VFD canvas renderer's job (task 4), not this module's.
 *   RIGHT wing - launcher lever (top): a vertical slide with a light knob that
 *                snaps between 3 positions; blue rotary skill dial 1/2/3 (bottom).
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
    '<span class="jf-lever__housing"></span>',
    '<span class="jf-lever__slot"></span>',
    '<span class="jf-lever__knob"></span>',
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
// Only the static molded body (two wings + central scope housing with the
// bottom grip scallop), grip texture, label plate, and scope rim live here.
// Interactive controls + the screen are HTML overlays.
const CASE_SVG = `
<svg class="jf-body" viewBox="0 0 1000 460" preserveAspectRatio="xMidYMid meet"
     xmlns="${SVG_NS}" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="jf-body-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e15535"/>
      <stop offset="0.45" stop-color="#c53d20"/>
      <stop offset="1" stop-color="#951f0d"/>
    </linearGradient>
    <linearGradient id="jf-wing-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f06c46"/>
      <stop offset="1" stop-color="#bb391d"/>
    </linearGradient>
    <radialGradient id="jf-panel-red" cx="0.5" cy="0.4" r="0.8">
      <stop offset="0" stop-color="#a82f16"/>
      <stop offset="1" stop-color="#6f1c0a"/>
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
    <pattern id="jf-ribs" width="13" height="13" patternTransform="rotate(38)"
             patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="13" stroke="#000" stroke-opacity="0.13" stroke-width="4"/>
      <line x1="6.5" y1="0" x2="6.5" y2="13" stroke="#fff" stroke-opacity="0.06" stroke-width="3"/>
    </pattern>
    <filter id="jf-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Unified body silhouette: two wing blocks + a central scope housing whose
       bottom edge scallops upward (the hand-grip notch under the screen). -->
  <path filter="url(#jf-soft)" fill="url(#jf-body-red)" stroke="#6e1a09" stroke-width="2"
        d="M44,54 H300 Q322,54 336,44 Q360,24 430,24 H570 Q640,24 664,44
           Q678,54 700,54 H956 Q992,54 992,90 V402 Q992,438 956,438 H700
           C640,438 600,410 500,410 C400,410 360,438 300,438 H44
           Q8,438 8,402 V90 Q8,54 44,54 Z"/>

  <!-- Central recessed scope housing -->
  <path fill="url(#jf-panel-red)" stroke="#5c1808" stroke-width="1.5"
        d="M330,44 Q360,20 430,20 H570 Q640,20 670,44 Q690,62 690,120 V340
           C690,378 640,404 500,404 C360,404 310,378 310,340 V120
           Q310,62 330,44 Z"/>

  <!-- Left wing (raised control block) -->
  <path fill="url(#jf-wing-red)" stroke="#7c2010" stroke-width="1.5"
        d="M44,54 H286 Q300,54 300,74 V418 Q300,438 280,438 H44 Q8,438 8,402 V90 Q8,54 44,54 Z"/>
  <path fill="#ffffff" fill-opacity="0.14" d="M44,54 H286 Q300,54 300,74 V96 H8 V90 Q8,54 44,54 Z"/>
  <path fill="url(#jf-ribs)" d="M20,300 H300 V438 H44 Q8,438 8,402 V320 Q8,300 20,300 Z"/>

  <!-- Right wing (raised control block) -->
  <path fill="url(#jf-wing-red)" stroke="#7c2010" stroke-width="1.5"
        d="M720,54 H956 Q992,54 992,90 V402 Q992,438 956,438 H720 Q700,438 700,418 V74 Q700,54 720,54 Z"/>
  <path fill="#ffffff" fill-opacity="0.14" d="M720,54 H956 Q992,54 992,90 V96 H700 V74 Q700,54 720,54 Z"/>
  <path fill="url(#jf-ribs)" d="M700,300 H992 V402 Q992,438 956,438 H700 Z"/>

  <!-- Scope rim (bezel) - the HTML screen sits just inside this -->
  <circle cx="500" cy="222" r="180" fill="url(#jf-rim)"/>
  <circle cx="500" cy="222" r="169" fill="#050505"/>

  <!-- JET FIGHTERS label plate (bottom-left) -->
  <g>
    <rect x="40" y="316" width="188" height="96" rx="10" fill="url(#jf-label-blue)"
          stroke="#16265c" stroke-width="2"/>
    <rect x="47" y="323" width="174" height="82" rx="6" fill="none"
          stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/>
    <text x="134" y="360" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="30" letter-spacing="1" fill="#ffffff">JET</text>
    <text x="134" y="390" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="26" letter-spacing="1" fill="#ffffff">FIGHTERS</text>
  </g>
</svg>`;
