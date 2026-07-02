// ---------------------------------------------------------------------------
// furnace.js
//
// Furnace tick logic, matching Java timing: an item takes 200 ticks (10 s) to
// smelt, and each fuel provides a fixed number of burn ticks (coal 1600 = 8
// items, planks 300 = 1.5, stick 100). A furnace only consumes fuel when there
// is something smeltable and room in the output.
//
// Pure (no DOM / Three.js) so it is unit-testable.
// ---------------------------------------------------------------------------

import { SMELT_TICKS } from './constants.js';
import { getSmeltResult } from './recipes.js';
import { ITEMS } from './items.js';
import { maxStack } from './inventory.js';

export function newFurnace() {
  return { input: null, fuel: null, output: null, burn: 0, burnMax: 0, progress: 0 };
}

// Can the current input be smelted into the current output right now?
function canSmelt(te) {
  if (!te.input || te.input.count <= 0) return false;
  const result = getSmeltResult(te.input.item);
  if (!result) return false;
  if (!te.output) return true;
  if (te.output.item !== result.item) return false;
  return te.output.count + result.count <= maxStack(result.item);
}

// Advance the furnace by one simulation tick. Returns true if it is lit.
export function tickFurnace(te) {
  const smeltable = canSmelt(te);

  // Keep burning if already lit.
  if (te.burn > 0) te.burn--;

  // Light the furnace if we can smelt and have fuel but no active burn.
  if (te.burn <= 0 && smeltable && te.fuel && te.fuel.count > 0) {
    const def = ITEMS[te.fuel.item];
    if (def && def.burnTicks > 0) {
      te.burnMax = def.burnTicks;
      te.burn = def.burnTicks;
      te.fuel.count--;
      if (te.fuel.count <= 0) te.fuel = null;
    }
  }

  const lit = te.burn > 0;

  if (lit && smeltable) {
    te.progress++;
    if (te.progress >= SMELT_TICKS) {
      te.progress = 0;
      const result = getSmeltResult(te.input.item);
      if (te.output) te.output.count += result.count;
      else te.output = { item: result.item, count: result.count };
      te.input.count--;
      if (te.input.count <= 0) te.input = null;
    }
  } else {
    // Cool down progress when not actively smelting.
    if (te.progress > 0) te.progress = Math.max(0, te.progress - 2);
  }

  return lit;
}
