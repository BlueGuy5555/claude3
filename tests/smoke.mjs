// Smoke test: load the built game in headless Chromium, start a world, and
// verify it initialises without console errors or thrown exceptions. Captures
// screenshots for manual review.
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.env.URL || 'http://127.0.0.1:4173/';
const mode = process.env.MODE || 'creative';

const errors = [];
const logs = [];

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => {
  logs.push(`[${msg.type()}] ${msg.text()}`);
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(1000);

// Click the requested play button.
const label = mode === 'survival' ? 'Play — Survival' : 'Play — Creative';
await page.click(`#menu button[data-mode="${mode}"]`);
await sleep(2500);

// Poll some in-page state through the exposed `game` object.
const state = await page.evaluate(() => {
  const g = window.game;
  return {
    hasGame: !!g,
    chunks: g ? g.chunkMeshes.size : 0,
    mode: g ? g.player.mode : null,
    pos: g ? { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z } : null,
    sceneChildren: g ? g.scene.children.length : 0,
    drawCalls: g ? g.renderer.info.render.calls : 0,
    triangles: g ? g.renderer.info.render.triangles : 0,
  };
});

await page.screenshot({ path: `/tmp/shot-${mode}.png` });

// Simulate a little movement + a look to exercise the tick loop.
await page.evaluate(() => {
  const g = window.game;
  g.player.addLook(200, 40);
  g.keys.add('KeyW');
});
await sleep(1200);
await page.evaluate(() => window.game.keys.delete('KeyW'));
const after = await page.evaluate(() => ({
  pos: { x: window.game.player.pos.x, y: window.game.player.pos.y, z: window.game.player.pos.z },
  triangles: window.game.renderer.info.render.triangles,
}));
await page.screenshot({ path: `/tmp/shot-${mode}-moved.png` });

await browser.close();

console.log('STATE', JSON.stringify(state, null, 2));
console.log('AFTER', JSON.stringify(after, null, 2));
console.log('ERROR COUNT', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ERR:', e);
console.log('--- last logs ---');
for (const l of logs.slice(-10)) console.log(l);

if (errors.length) process.exit(1);
if (!state.hasGame || state.chunks === 0 || state.triangles === 0) {
  console.log('FAIL: game did not initialise a visible world');
  process.exit(2);
}
console.log('SMOKE OK');
