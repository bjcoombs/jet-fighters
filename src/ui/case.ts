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
 *                snaps between 3 positions; blue skill lever 1/2/3 (bottom).
 *
 * Dressing is held to what assets/reference/ actually shows. The real unit is a
 * single orange plastic moulding throughout - the centre module is NOT a darker
 * panel, the control recesses are body-colour countersinks rather than black
 * donuts, the wings carry a uniform fine stipple rather than diagonal ribs, and
 * the only printed white anywhere on the case is the JET FIGHTERS sticker.
 */
import './case.css';
import { clipPathMarkup, scopeWindowMarkup, screenBoxPercent } from './geometry.js';

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
  // After the screen: the tab is moulded plastic that OVERLAPS the glass, so it
  // has to paint above the canvas overlay, not inside the SVG body beneath it.
  root.appendChild(buildBezelTab());
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
  // Position/size derived from the shared scope geometry (single source of
  // truth) so the clipped canvas box exactly matches the SVG black window.
  const box = screenBoxPercent();
  screen.style.left = box.left;
  screen.style.top = box.top;
  screen.style.width = box.width;
  screen.style.height = box.height;

  const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
  canvas.id = 'vfd';
  canvas.className = 'jf-screen__canvas';
  // The renderer sizes the backing store to this element's CSS box x
  // devicePixelRatio (see main.ts). No fixed pixel dimensions here.
  screen.appendChild(canvas);
  return screen;
}

/**
 * The small moulded tab that hangs off the module's top edge at 12 o'clock and
 * overlaps the glass (assets/reference/screen-overlay-closeup.jpg). Positioned
 * in body units: x 520..546, y 38..78 of the 1000 x 460 viewBox. It stops at 78
 * so it clears the curved legend printed inside the scope at y 80..86 - see the
 * `.jf-tab` rule in case.css for why that bound is where it is.
 */
function buildBezelTab(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-tab';
  el.setAttribute('aria-hidden', 'true');
  return el;
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

/**
 * Skill selector: a blue flag-shaped lever pivoting on a screwed hub at the
 * right wing's bottom corner, with three faint moulded numerals on the arc above
 * it (assets/reference/device-front-gameplay.jpg, device-front-lit.jpg). The
 * handle hangs BELOW the pivot; the level it indicates is the direction opposite
 * the handle, which is why the marks sit above while the flag points down.
 */
function buildDial(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'jf-skill';
  el.dataset.control = 'skill';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Skill level');
  el.setAttribute('aria-valuemin', '1');
  el.setAttribute('aria-valuemax', '3');
  el.setAttribute('aria-valuenow', '1');
  el.innerHTML = [
    '<span class="jf-skill__mark jf-skill__mark--1" data-level="1">1</span>',
    '<span class="jf-skill__mark jf-skill__mark--2" data-level="2">2</span>',
    '<span class="jf-skill__mark jf-skill__mark--3" data-level="3">3</span>',
    '<span class="jf-skill__lever">',
    '<span class="jf-skill__flag"></span>',
    '<span class="jf-skill__hub"></span>',
    '<span class="jf-skill__screw"></span>',
    '</span>',
  ].join('');
  return el;
}

// SVG note: viewBox is 1000 x 460 (~24x11 cm, held-in-both-hands landscape).
// Only the static molded body (two lower wing blocks flanking a dominant, taller
// central bezel block), grip texture, label plate, and the scope rim live here.
// The scope window is a UNION of a large radar circle and a shorter rectangle
// extending to its left (where SCORE + the left playfield sit), matching the
// real console. Interactive controls + the screen canvas are HTML overlays.

/** Left wing outline; reused as its stipple clip so the texture cannot bleed. */
const LEFT_WING_PATH =
  'M44,54 H286 Q300,54 300,74 V418 Q300,438 280,438 H44 Q8,438 8,402 V90 Q8,54 44,54 Z';
/** Right wing outline; reused as its stipple clip. */
const RIGHT_WING_PATH =
  'M720,54 H956 Q992,54 992,90 V402 Q992,438 956,438 H720 Q700,438 700,418 V74 Q700,54 720,54 Z';

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
    <linearGradient id="jf-block-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2764f"/>
      <stop offset="0.5" stop-color="#cf4926"/>
      <stop offset="1" stop-color="#a52d14"/>
    </linearGradient>
    <!-- Sticker blue sampled from assets/reference/device-front-gameplay.jpg
         (the plate averages rgb(129,159,213) - a light cornflower, not navy). -->
    <linearGradient id="jf-label-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fabde"/>
      <stop offset="1" stop-color="#7290ca"/>
    </linearGradient>
    <linearGradient id="jf-tab-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e5794f"/>
      <stop offset="1" stop-color="#b8451f"/>
    </linearGradient>
    <!-- Moulded shadow line where the plastic steps down to the glass. The real
         unit has no dark frame around the scope, only this thin lip. -->
    <radialGradient id="jf-rim" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0.82" stop-color="#5d1d0c"/>
      <stop offset="0.92" stop-color="#8b2c14"/>
      <stop offset="1" stop-color="#c05a33"/>
    </radialGradient>
    <!-- Wing texture: the real wings carry a uniform fine stipple over the whole
         face (clearest on the right wing in device-front-gameplay.jpg), not the
         diagonal ribbing this case used to draw. fractalNoise gives grain that
         scales with the case instead of tiling into a visible grid. -->
    <filter id="jf-stipple-dark" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"
                    stitchTiles="stitch" result="n"/>
      <feColorMatrix in="n" type="matrix"
                     values="0 0 0 0 0.16  0 0 0 0 0.05  0 0 0 0 0.02  1.2 0 0 0 -0.62"/>
    </filter>
    <filter id="jf-stipple-light" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="29"
                    stitchTiles="stitch" result="n"/>
      <feColorMatrix in="n" type="matrix"
                     values="0 0 0 0 1  0 0 0 0 0.87  0 0 0 0 0.78  0 1.1 0 0 -0.60"/>
    </filter>
    <clipPath id="jf-left-wing-clip"><path d="${LEFT_WING_PATH}"/></clipPath>
    <clipPath id="jf-right-wing-clip"><path d="${RIGHT_WING_PATH}"/></clipPath>
    <filter id="jf-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/>
    </filter>
    <!-- Screen clip: radar circle UNIONed with the shorter left rectangle,
         generated from the shared scope geometry (objectBoundingBox units of the
         .jf-screen box; the ellipse rx/ry compensate for the box aspect so the
         circle renders truly round). -->
    ${clipPathMarkup('jf-screen-clip')}
  </defs>

  <!-- Body silhouette: two lower wings flanking a taller central bezel block,
       flat-bottomed with a small central dip (the moulding under the screen). -->
  <path filter="url(#jf-soft)" fill="url(#jf-body-red)" stroke="#6e1a09" stroke-width="2"
        d="M44,54 H298 Q300,54 300,44 Q300,32 316,32 H684 Q700,32 700,44
           Q700,54 702,54 H956 Q992,54 992,90 V402 Q992,438 956,438 H704
           Q702,438 702,446 Q702,454 686,454 H314 Q298,454 298,446
           Q298,438 296,438 H44 Q8,438 8,402 V90 Q8,54 44,54 Z"/>

  <!-- Left wing (raised control block) -->
  <path fill="url(#jf-wing-red)" stroke="#7c2010" stroke-width="1.5" d="${LEFT_WING_PATH}"/>
  <g clip-path="url(#jf-left-wing-clip)" opacity="0.5">
    <rect x="8" y="54" width="292" height="384" fill="#000" filter="url(#jf-stipple-dark)"/>
    <rect x="8" y="54" width="292" height="384" fill="#000" filter="url(#jf-stipple-light)"/>
  </g>
  <path fill="#ffffff" fill-opacity="0.14" d="M44,54 H286 Q300,54 300,74 V96 H8 V90 Q8,54 44,54 Z"/>

  <!-- Right wing (raised control block) -->
  <path fill="url(#jf-wing-red)" stroke="#7c2010" stroke-width="1.5" d="${RIGHT_WING_PATH}"/>
  <g clip-path="url(#jf-right-wing-clip)" opacity="0.5">
    <rect x="700" y="54" width="292" height="384" fill="#000" filter="url(#jf-stipple-dark)"/>
    <rect x="700" y="54" width="292" height="384" fill="#000" filter="url(#jf-stipple-light)"/>
  </g>
  <path fill="#ffffff" fill-opacity="0.14" d="M720,54 H956 Q992,54 992,90 V96 H700 V74 Q700,54 720,54 Z"/>

  <!-- Central bezel block (dominant, raised, taller than the wings). Same orange
       plastic as the wings: the real module is one moulding, framed only by the
       shadow lines where it steps up from them. -->
  <path fill="url(#jf-block-red)" stroke="#7c2010" stroke-width="1.5"
        d="M316,38 H684 Q702,38 702,56 V426 Q702,446 682,446 H318 Q298,446 298,426 V56 Q298,38 316,38 Z"/>
  <path fill="#ffffff" fill-opacity="0.14" d="M316,38 H684 Q702,38 702,56 V74 H298 V56 Q298,38 316,38 Z"/>
  <!-- Moulded shadow lines down the inner faces of the module, replacing the
       painted recessed panel that the real unit does not have. -->
  <path fill="none" stroke="#000" stroke-opacity="0.16" stroke-width="3"
        d="M303,60 V424 M697,60 V424"/>
  <path fill="none" stroke="#ffffff" stroke-opacity="0.13" stroke-width="2"
        d="M308,60 V424 M692,60 V424"/>

  <!-- Scope rim (bezel) + black window - circle + left rectangle union, drawn
       behind the canvas and generated from the shared scope geometry so the
       canvas paints precisely inside this shape. -->
  <g>${scopeWindowMarkup()}</g>

  <!-- JET FIGHTERS sticker (bottom-left). Near-square, wordmark over the CGL
       logo, proportions measured off device-front-gameplay.jpg. -->
  <g>
    <rect x="27" y="331" width="110" height="92" rx="4" fill="#000" fill-opacity="0.18"/>
    <rect x="30" y="334" width="104" height="86" rx="3" fill="url(#jf-label-blue)"
          stroke="#3f5590" stroke-width="1.5"/>
    <text x="82" y="366" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="700" font-size="24" fill="#f4f6fb">JET</text>
    <text x="82" y="390" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="700" font-size="24" textLength="92" lengthAdjust="spacingAndGlyphs"
          fill="#f4f6fb">FIGHTERS</text>
    <text x="82" y="412" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="700" font-size="15" letter-spacing="-2.5" fill="#f4f6fb">CGL</text>
  </g>
</svg>`;
