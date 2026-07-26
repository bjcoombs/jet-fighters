// Public surface of the input layer.
//
// Every input path - keyboard, on-case controls, mobile screen taps - is
// translated here into a movement of one of the machine's four case controls.
// main.ts applies those movements to the board's input matrix; this module
// never auto-mounts anything and never touches machine state itself.

export type {
  InputCallback,
  InputSystem,
  InputOptions,
  MachineInput,
  ScreenTouchOptions,
  KeyAction,
  LaneDirection,
} from './input.js';

export {
  createInputSystem,
  createControlsAdapter,
  attachScreenTouch,
  createHelpOverlay,
  classifyKey,
  resolveLane,
  pushDirection,
  removeDirection,
  laneFromThirds,
  powerInput,
} from './input.js';
