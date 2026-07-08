import { buildCase } from './ui/case.js';
import { setupControls } from './ui/controls.js';

// Layout only. The game/render/audio/input subsystems are wired to these
// controls by the integration task (task 8); here we just build the case,
// mount the canvas, and register no-op handlers so the controls are live.
const app = document.querySelector<HTMLElement>('#app');
if (app) {
  const { root } = buildCase(app);
  setupControls(root, {
    onFire: () => {},
    onLaneChange: () => {},
    onSkillChange: () => {},
    onPowerToggle: () => {},
  });
}
