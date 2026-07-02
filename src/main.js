// ---------------------------------------------------------------------------
// main.js — bootstraps the game and runs the animation loop.
// ---------------------------------------------------------------------------

import { Game } from './game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

// Expose for debugging in the browser console.
window.game = game;

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); // clamp big frame gaps
  last = now;
  try {
    game.frame(dt);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
