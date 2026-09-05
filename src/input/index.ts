// Public surface of the input layer.
//
// The keyboard is translated here into a movement of one of the machine's four
// case controls; the modelled controls and the touch bar in src/viewer3d/
// produce the same movements. The driver applies them to the board's input
// matrix; this module never auto-mounts anything and never touches machine
// state itself.

export type {
  InputCallback,
  InputSystem,
  InputOptions,
  MachineInput,
  KeyAction,
  Lane,
  LaneDirection,
  SkillLevel,
} from './input.js';

export {
  createInputSystem,
  createHelpOverlay,
  classifyKey,
  resolveLane,
  pushDirection,
  removeDirection,
  powerInput,
} from './input.js';
