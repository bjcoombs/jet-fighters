// The flat page: the drawn case, its controls, and the machine running behind
// the glass.
//
// The clock lives in `src/app/driver.ts`, not here. This file builds the case,
// hands the driver a renderer bound to the case's canvas, and wires the three
// input paths - the drawn controls, the keyboard, and a tap on the scope glass -
// to the driver's `apply`. There is no game state here and nothing that steps
// the machine.

// The machine image: the program ROM and the mask's output PLA, both assembled
// from `asm/jetfighter.asm` on import. The PLA is a separate export because it
// is mask-programmed data rather than executed words - see src/asm.d.ts.
import { highestAddress, opla, ramHighWater, rom, symbols } from '../asm/jetfighter.asm';
import { createDriver } from './app/driver.js';
import { buildMuteToggle } from './app/mute-toggle.js';
import { attachCanvasSizing } from './app/viewport.js';
import { createTubeRenderer } from './machine/tube/renderer.js';
import {
  attachScreenTouch,
  createControlsAdapter,
  createHelpOverlay,
  createInputSystem,
} from './input/index.js';
import { buildCase } from './ui/case.js';
import { setupControls } from './ui/controls.js';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  start(app);
}

function start(mount: HTMLElement): void {
  const { root, canvas } = buildCase(mount);
  const renderer = createTubeRenderer(canvas);
  attachCanvasSizing(canvas, renderer);

  const driver = createDriver({ image: { rom, opla }, renderer });
  const { apply } = driver;

  // Three paths to the same four contacts: the drawn case controls, the
  // keyboard, and a tap on the scope glass for touch devices.
  setupControls(root, createControlsAdapter(apply));
  createInputSystem(apply, { screenElement: canvas });
  attachScreenTouch(canvas, apply);

  root.appendChild(createHelpOverlay());
  root.appendChild(buildMuteToggle(driver));

  driver.start();

  if (import.meta.env.DEV) {
    // A console handle on the machine: step it, read its RAM, name an address
    // from the assembler's symbol table. The debugging surface a contributor
    // editing the ROM needs, and dev-only so it is not part of the product.
    (globalThis as { jetFighters?: unknown }).jetFighters = {
      board: driver.board,
      renderer,
      // Null until the first input builds it. `speaker.stats` is how a silent
      // machine is told apart from a silenced one: edges consumed says the ROM
      // is toggling the pin, realignments and underruns say what the transport
      // then did with them.
      get speaker() {
        return driver.speaker;
      },
      rom: { words: rom.length, highestAddress, ramHighWater, symbols },
    };
  }
}
