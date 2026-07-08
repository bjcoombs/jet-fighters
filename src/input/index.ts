// Public surface of the input intent layer (PRD R5).
//
// Every input path - keyboard, on-case controls, mobile screen taps - is
// translated here into the pure game reducer's GameInput intents. Task 8 wires
// these to the DOM; this module never auto-mounts anything.

export type {
  InputCallback,
  InputSystem,
  InputOptions,
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
