// UI + interaction smoke test: open the creative palette, drive a crafting-table
// recipe, and open a furnace UI — screenshotting each and asserting no errors.
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.env.URL || 'http://127.0.0.1:4173/';
const errors = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(800);
await page.click('#menu button[data-mode="creative"]');
await sleep(1500);

// 1) Creative palette via the E key.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
await sleep(400);
const creativeOpen = await page.evaluate(() => window.game.screens.open);
await page.screenshot({ path: '/tmp/ui-creative.png' });

// 2) Crafting table: put a log in the grid, expect 4 planks; then take result.
const craft = await page.evaluate(() => {
  const g = window.game;
  g.screens.close();
  g.screens.openTable();
  g.screens.craft[0] = { item: 'oak_log', count: 1 };
  g.screens.recomputeCraft();
  g.screens.render();
  return g.screens.craftResult;
});
await page.screenshot({ path: '/tmp/ui-crafting.png' });

// 3) Furnace: place one, open it, load ore + coal, tick, expect an ingot.
const furnace = await page.evaluate(async () => {
  const g = window.game;
  g.screens.close();
  const x = Math.floor(g.player.pos.x) + 2;
  const y = Math.floor(g.player.pos.y);
  const z = Math.floor(g.player.pos.z);
  g.world.setBlock(x, y, z, 18 /* FURNACE */);
  g.world.setTileEntity(x, y, z, { input: { item: 'raw_iron', count: 3 }, fuel: { item: 'coal', count: 1 }, output: null, burn: 0, burnMax: 0, progress: 0 });
  g.screens.openFurnace(x, y, z);
  // Fast-forward ~11s of furnace ticks.
  const te = g.world.getTileEntity(x, y, z);
  for (let i = 0; i < 220; i++) {
    // tick furnace directly via the engine loop
    window.game.simTick();
  }
  return { input: te.input, output: te.output };
});
await sleep(300);
await page.screenshot({ path: '/tmp/ui-furnace.png' });

await browser.close();

console.log('creativeOpen =', creativeOpen);
console.log('craftResult  =', JSON.stringify(craft));
console.log('furnace      =', JSON.stringify(furnace));
console.log('ERROR COUNT  =', errors.length);
for (const e of errors.slice(0, 10)) console.log('  ERR:', e);

let ok = true;
if (creativeOpen !== 'creative') { console.log('FAIL: creative palette did not open'); ok = false; }
if (!craft || craft.item !== 'oak_planks' || craft.count !== 4) { console.log('FAIL: crafting result wrong'); ok = false; }
if (!furnace.output || furnace.output.item !== 'iron_ingot') { console.log('FAIL: furnace did not smelt'); ok = false; }
if (errors.length) ok = false;
console.log(ok ? 'UI OK' : 'UI FAILED');
process.exit(ok ? 0 : 1);
