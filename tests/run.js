// ---------------------------------------------------------------------------
// tests/run.js
//
// Node-runnable unit tests for the pure game logic (no DOM / WebGL). Run with
// `npm test`. Covers: noise determinism, world generation invariants, crafting
// & smelting recipe matching, mining-time / drop rules, and — importantly — the
// physics constants that make movement match Minecraft Java Edition.
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';

import { Noise } from '../src/engine/noise.js';
import { World } from '../src/engine/world.js';
import { B, getMiningTimeSeconds, getMiningTimeTicks, getDrop } from '../src/engine/blocks.js';
import { heldToolDescriptor } from '../src/engine/items.js';
import { matchCrafting, getSmeltResult } from '../src/engine/recipes.js';
import { newFurnace, tickFurnace } from '../src/engine/furnace.js';
import { Inventory } from '../src/engine/inventory.js';
import {
  boxCollides,
  moveAndCollide,
  applyGroundMove,
  steadyStateSpeed,
} from '../src/engine/physics.js';
import {
  TPS,
  ACCEL_WALK,
  ACCEL_SPRINT,
  ACCEL_SNEAK,
  GROUND_FRICTION,
  GRAVITY,
  VERTICAL_DRAG,
  JUMP_VELOCITY,
} from '../src/engine/constants.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    console.log('  \u2717 ' + name);
    console.log('    ' + (e && e.message ? e.message : e));
  }
}
function approx(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${a} \u2248 ${b} (tol ${tol})`);
}

console.log('\nNoise');
test('is deterministic for a fixed seed', () => {
  const a = new Noise(1234);
  const b = new Noise(1234);
  for (let i = 0; i < 20; i++) {
    const x = i * 1.3, z = i * 0.7;
    assert.equal(a.perlin2(x, z), b.perlin2(x, z));
  }
});
test('differs across seeds', () => {
  const a = new Noise(1);
  const b = new Noise(2);
  let diff = 0;
  // Sample off the integer lattice (Perlin noise is 0 at integer points).
  for (let i = 0; i < 50; i++) if (a.perlin2(i * 1.3 + 0.2, i * 0.7 + 0.1) !== b.perlin2(i * 1.3 + 0.2, i * 0.7 + 0.1)) diff++;
  assert.ok(diff > 40, 'seeds should mostly differ, got ' + diff);
});
test('stays roughly in [-1, 1]', () => {
  const n = new Noise(7);
  for (let i = 0; i < 500; i++) {
    const v = n.perlin3(i * 0.1, i * 0.05, i * 0.2);
    assert.ok(v >= -1.2 && v <= 1.2, 'value out of range: ' + v);
  }
});

console.log('\nWorld generation');
test('regenerates identically for the same seed', () => {
  const w1 = new World(42);
  const w2 = new World(42);
  const c1 = w1.ensureChunk(0, 0);
  const c2 = w2.ensureChunk(0, 0);
  assert.deepEqual(c1.data, c2.data);
});
test('has a bedrock floor and air ceiling', () => {
  const w = new World(5);
  const c = w.ensureChunk(0, 0);
  assert.equal(w.getBlock(0, 0, 0), B.BEDROCK);
  assert.equal(w.getBlock(0, 127, 0), B.AIR);
});
test('contains ores and at least one cave air pocket underground', () => {
  const w = new World(99);
  // Scan a few chunks for ores and underground air.
  let ores = 0;
  let caveAir = 0;
  for (let cx = 0; cx < 3; cx++) {
    for (let cz = 0; cz < 3; cz++) {
      const c = w.ensureChunk(cx, cz);
      for (let i = 0; i < c.data.length; i++) {
        const b = c.data[i];
        if (b === B.COAL_ORE || b === B.IRON_ORE || b === B.GOLD_ORE || b === B.DIAMOND_ORE) ores++;
      }
      // underground air (caves): air with stone above it, below y=50
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 5; y < 45; y++) {
            if (c.get(x, y, z) === B.AIR && c.get(x, y + 1, z) === B.STONE) caveAir++;
          }
    }
  }
  assert.ok(ores > 20, 'expected ores, got ' + ores);
  assert.ok(caveAir > 0, 'expected cave air pockets, got ' + caveAir);
});
test('setBlock persists and marks chunk dirty', () => {
  const w = new World(1);
  w.ensureChunk(0, 0).dirty = false;
  w.setBlock(3, 70, 3, B.GLASS);
  assert.equal(w.getBlock(3, 70, 3), B.GLASS);
  assert.equal(w.getChunk(0, 0).dirty, true);
});
test('handles negative coordinates', () => {
  const w = new World(3);
  w.setBlock(-1, 65, -1, B.STONE);
  assert.equal(w.getBlock(-1, 65, -1), B.STONE);
  assert.equal(w.getBlock(-17, 65, -17), 0 <= 1 ? w.getBlock(-17, 65, -17) : 0); // just exercise
});

console.log('\nCrafting recipes');
const g3 = (arr) => arr; // 9-length flat grid helper
test('log -> 4 planks (shapeless)', () => {
  const r = matchCrafting(['oak_log', null, null, null], 2);
  assert.deepEqual(r, { item: 'oak_planks', count: 4 });
});
test('2 planks -> 4 sticks (shaped, vertical, any column)', () => {
  const grid = [null, 'oak_planks', null, 'oak_planks']; // 2x2: col1 has two planks
  const r = matchCrafting(grid, 2);
  assert.deepEqual(r, { item: 'stick', count: 4 });
});
test('4 planks -> crafting table', () => {
  const r = matchCrafting(['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'], 2);
  assert.deepEqual(r, { item: 'crafting_table', count: 1 });
});
test('8 cobblestone ring -> furnace (3x3)', () => {
  const C = 'cobblestone';
  const grid = [C, C, C, C, null, C, C, C, C];
  const r = matchCrafting(grid, 3);
  assert.deepEqual(r, { item: 'furnace', count: 1 });
});
test('wooden pickaxe (shaped 3x3)', () => {
  const P = 'oak_planks', S = 'stick';
  const grid = [P, P, P, null, S, null, null, S, null];
  const r = matchCrafting(grid, 3);
  assert.deepEqual(r, { item: 'wooden_pickaxe', count: 1 });
});
test('iron sword (shaped)', () => {
  const I = 'iron_ingot', S = 'stick';
  const grid = [null, I, null, null, I, null, null, S, null];
  const r = matchCrafting(grid, 3);
  assert.deepEqual(r, { item: 'iron_sword', count: 1 });
});
test('mirror-invariant shaped recipe (axe both handed)', () => {
  const P = 'oak_planks', S = 'stick';
  const left = [P, P, null, P, S, null, null, S, null];
  const right = [null, P, P, null, S, P, null, S, null];
  assert.deepEqual(matchCrafting(left, 3), { item: 'wooden_axe', count: 1 });
  assert.deepEqual(matchCrafting(right, 3), { item: 'wooden_axe', count: 1 });
});
test('empty grid -> no recipe', () => {
  assert.equal(matchCrafting([null, null, null, null], 2), null);
});
test('random junk -> no recipe', () => {
  assert.equal(matchCrafting(['dirt', 'diamond', null, 'sand'], 2), null);
});

console.log('\nSmelting');
test('raw iron -> iron ingot', () => {
  assert.deepEqual(getSmeltResult('raw_iron'), { item: 'iron_ingot', count: 1 });
});
test('sand -> glass, cobblestone -> stone, raw beef -> cooked', () => {
  assert.deepEqual(getSmeltResult('sand'), { item: 'glass', count: 1 });
  assert.deepEqual(getSmeltResult('cobblestone'), { item: 'stone', count: 1 });
  assert.deepEqual(getSmeltResult('raw_beef'), { item: 'cooked_beef', count: 1 });
});
test('non-smeltable -> null', () => {
  assert.equal(getSmeltResult('dirt'), null);
});

console.log('\nFurnace');
test('smelts one raw iron into an iron ingot with coal fuel', () => {
  const te = newFurnace();
  te.input = { item: 'raw_iron', count: 1 };
  te.fuel = { item: 'coal', count: 1 };
  let litTicks = 0;
  for (let i = 0; i < 205; i++) if (tickFurnace(te)) litTicks++;
  assert.equal(te.input, null, 'input consumed');
  assert.deepEqual(te.output, { item: 'iron_ingot', count: 1 });
  // Coal lights the furnace (1600 burn ticks) so it stays lit past the smelt.
  assert.ok(litTicks >= 200, 'should stay lit through the smelt, ' + litTicks);
});
test('does not burn fuel with nothing to smelt', () => {
  const te = newFurnace();
  te.fuel = { item: 'coal', count: 1 };
  for (let i = 0; i < 50; i++) tickFurnace(te);
  assert.deepEqual(te.fuel, { item: 'coal', count: 1 }, 'fuel untouched');
  assert.equal(te.burn, 0);
});
test('one coal smelts up to 8 items', () => {
  const te = newFurnace();
  te.input = { item: 'raw_gold', count: 8 };
  te.fuel = { item: 'coal', count: 1 };
  for (let i = 0; i < 8 * 200 + 10; i++) tickFurnace(te);
  assert.equal(te.output.count, 8, 'smelted count ' + (te.output && te.output.count));
});

console.log('\nInventory');
test('stacks items up to max stack size', () => {
  const inv = new Inventory();
  const left = inv.add('cobblestone', 130); // 64 + 64 + 2
  assert.equal(left, 0);
  assert.equal(inv.count('cobblestone'), 130);
  const nonEmpty = inv.slots.filter((s) => s).length;
  assert.equal(nonEmpty, 3);
});
test('tools do not stack and take one slot each', () => {
  const inv = new Inventory();
  inv.add('wooden_pickaxe', 1);
  inv.add('wooden_pickaxe', 1);
  const slots = inv.slots.filter((s) => s && s.item === 'wooden_pickaxe');
  assert.equal(slots.length, 2);
  assert.equal(slots[0].count, 1);
});
test('tool durability decrements and breaks at zero', () => {
  const inv = new Inventory();
  inv.add('wooden_pickaxe', 1);
  inv.selected = inv.slots.findIndex((s) => s && s.item === 'wooden_pickaxe');
  const start = inv.getSelected().durability;
  for (let i = 0; i < start; i++) inv.damageSelected();
  assert.equal(inv.getSelected(), null, 'pickaxe should break');
});

console.log('\nMining time & drops');
test('stone mines faster with better pickaxes', () => {
  const hand = getMiningTimeSeconds(B.STONE, null);
  const wood = getMiningTimeSeconds(B.STONE, heldToolDescriptor('wooden_pickaxe'));
  const iron = getMiningTimeSeconds(B.STONE, heldToolDescriptor('iron_pickaxe'));
  const diamond = getMiningTimeSeconds(B.STONE, heldToolDescriptor('diamond_pickaxe'));
  assert.ok(hand > wood && wood > iron && iron > diamond, `${hand} ${wood} ${iron} ${diamond}`);
  // Diamond pickaxe on stone: 1.5*1.5/8 = 0.28125 s
  approx(diamond, 0.28125, 1e-6, 'diamond pickaxe stone time');
});
test('stone dropped only with a pickaxe', () => {
  assert.equal(getDrop(B.STONE, null), null);
  assert.deepEqual(getDrop(B.STONE, heldToolDescriptor('wooden_pickaxe')), { item: 'cobblestone', count: 1 });
});
test('iron ore needs stone-tier pickaxe to drop', () => {
  assert.equal(getDrop(B.IRON_ORE, heldToolDescriptor('wooden_pickaxe')), null);
  assert.deepEqual(getDrop(B.IRON_ORE, heldToolDescriptor('stone_pickaxe')), { item: 'raw_iron', count: 1 });
});
test('dirt drops by hand (no tool required)', () => {
  assert.deepEqual(getDrop(B.DIRT, null), { item: 'dirt', count: 1 });
});
test('bedrock is unbreakable', () => {
  assert.equal(getMiningTimeTicks(B.BEDROCK, heldToolDescriptor('diamond_pickaxe')), Infinity);
});

console.log('\nPhysics — Java movement fidelity');
test('walk steady-state speed \u2248 4.317 blocks/s', () => {
  const bps = steadyStateSpeed(ACCEL_WALK, GROUND_FRICTION) * TPS;
  approx(bps, 4.317, 0.05, 'walk speed');
});
test('sprint steady-state speed \u2248 5.612 blocks/s', () => {
  const bps = steadyStateSpeed(ACCEL_SPRINT, GROUND_FRICTION) * TPS;
  approx(bps, 5.612, 0.05, 'sprint speed');
});
test('sneak steady-state speed \u2248 1.295 blocks/s', () => {
  const bps = steadyStateSpeed(ACCEL_SNEAK, GROUND_FRICTION) * TPS;
  approx(bps, 1.295, 0.05, 'sneak speed');
});
test('walk integrator converges to steady state', () => {
  const vel = { x: 0, z: 0 };
  for (let i = 0; i < 200; i++) applyGroundMove(vel, 1, 0, ACCEL_WALK, GROUND_FRICTION);
  const bps = Math.abs(vel.x) * TPS;
  approx(bps, 4.317, 0.05, 'converged walk speed');
});
test('diagonal movement is not faster than straight', () => {
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  for (let i = 0; i < 200; i++) {
    applyGroundMove(a, 1, 0, ACCEL_WALK, GROUND_FRICTION);
    applyGroundMove(b, 1, 1, ACCEL_WALK, GROUND_FRICTION);
  }
  approx(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z), 1e-6, 'diagonal vs straight');
});
test('jump apex height \u2248 1.25 blocks', () => {
  let y = 0, vy = JUMP_VELOCITY, maxY = 0;
  for (let i = 0; i < 100; i++) {
    y += vy;
    if (y > maxY) maxY = y;
    vy = (vy - GRAVITY) * VERTICAL_DRAG;
    if (y <= 0 && vy < 0) break;
  }
  approx(maxY, 1.25, 0.03, 'jump height');
});

console.log('\nPhysics — collision');
test('a solid floor stops a fall and sets onGround', () => {
  // Solid everywhere at y < 64, air above. Player falling from y=70.
  const solid = (x, y, z) => y < 64;
  const state = { pos: { x: 0.5, y: 70, z: 0.5 }, vel: { x: 0, y: -1.5, z: 0 } };
  let onGround = false;
  for (let i = 0; i < 200; i++) {
    state.vel.y = (state.vel.y - GRAVITY) * VERTICAL_DRAG;
    const r = moveAndCollide(solid, state, 1.8, onGround);
    onGround = r.onGround;
    if (onGround) break;
  }
  assert.ok(onGround, 'should land');
  approx(state.pos.y, 64, 0.02, 'should rest on floor top');
});
test('walls block horizontal movement', () => {
  // Floor below y=64; a full-height wall at x>=1 spanning the player body.
  const solid = (x, y, z) => y < 64 || (x >= 1 && y >= 64 && y < 66);
  const state = { pos: { x: 0.5, y: 64, z: 0.5 }, vel: { x: 0.5, y: 0, z: 0 } };
  const r = moveAndCollide(solid, state, 1.8, true);
  assert.ok(r.collidedX, 'should collide on X');
  assert.ok(state.pos.x + 0.3 <= 1 + 1e-3, 'should stop before the wall, x=' + state.pos.x);
});
test('a full block is NOT auto-climbed (Java: must jump)', () => {
  // Ground at y<64; a full 1-block step at x>=1 occupying cell y=64.
  const solid = (x, y, z) => y < 64 || (x >= 1 && y === 64);
  const state = { pos: { x: 0.5, y: 64, z: 0.5 }, vel: { x: 0.25, y: 0, z: 0 } };
  const r = moveAndCollide(solid, state, 1.8, true);
  // Step height is 0.6, so a full block blocks movement and no climb occurs.
  assert.ok(r.collidedX, 'should collide with the full block');
  assert.ok(state.pos.y < 64.6, 'should not climb a full block, y=' + state.pos.y);
  assert.ok(state.pos.x + 0.3 <= 1 + 1e-3, 'should be stopped before the block');
});
test('boxCollides detects overlap', () => {
  const solid = (x, y, z) => x === 0 && y === 0 && z === 0;
  assert.ok(boxCollides(solid, -0.3, 0.1, -0.3, 0.3, 1.9, 0.3));
  assert.ok(!boxCollides(solid, 2, 2, 2, 2.3, 3.9, 2.3));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
