import { GAME_MODULE } from './game/index.js';
import { RENDER_MODULE } from './render/index.js';
import { AUDIO_MODULE } from './audio/index.js';
import { INPUT_MODULE } from './input/index.js';

// Placeholder wiring. Real subsystems land in later tasks; referencing the
// markers here keeps them from being tree-shaken away and proves the modules
// resolve and compile together.
void [GAME_MODULE, RENDER_MODULE, AUDIO_MODULE, INPUT_MODULE];

const canvas = document.querySelector<HTMLCanvasElement>('#vfd');
if (canvas) {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}
