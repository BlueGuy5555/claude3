// ---------------------------------------------------------------------------
// items.js
//
// The item registry. Items are what live in inventory slots. Three kinds:
//   - block items: placeable, carry a `place` block id.
//   - materials  : sticks, ingots, coal, gems, raw drops.
//   - tools      : carry tool type/tier/material/durability/attack.
//   - food       : carry a hunger + saturation value.
//
// Fuels carry `burnTicks` (how long they keep a furnace lit). Smeltable inputs
// are described in recipes.js.
//
// Pure data (no DOM / Three.js) so it is unit-testable.
// ---------------------------------------------------------------------------

import { B, BLOCKS } from './blocks.js';

export const ITEMS = {}; // name -> descriptor

function item(name, props) {
  ITEMS[name] = {
    name,
    display: props.display ?? titleCase(name),
    kind: props.kind ?? 'material',
    maxStack: props.maxStack ?? 64,
    place: props.place ?? null,     // block id this item places (block items)
    icon: props.icon ?? name,       // atlas key for the item icon
    // tool fields
    tool: props.tool ?? null,       // 'pickaxe'|'axe'|'shovel'|'sword'
    tier: props.tier ?? 0,
    material: props.material ?? null,
    durability: props.durability ?? 0,
    attack: props.attack ?? 1,
    // food
    food: props.food ?? 0,          // hunger points restored
    saturation: props.saturation ?? 0,
    // fuel
    burnTicks: props.burnTicks ?? 0,
  };
  return ITEMS[name];
}

function titleCase(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Block items ------------------------------------------------------------
// Every solid/placeable block (except air/water and non-item blocks) gets a
// matching item that places it. The item icon reuses the block's own tiles.
const NON_ITEM_BLOCKS = new Set([B.AIR, B.WATER]);
for (const b of BLOCKS) {
  if (!b || NON_ITEM_BLOCKS.has(b.id)) continue;
  // Grass block placed from inventory becomes... grass. Keep 1:1 for simplicity.
  item(b.name, {
    kind: 'block',
    place: b.id,
    icon: 'block:' + b.name, // rendered from the block's tiles by the atlas
    maxStack: 64,
  });
}

// Fuels: give the relevant block items a burn time.
if (ITEMS.oak_planks) ITEMS.oak_planks.burnTicks = 300;
if (ITEMS.oak_log) ITEMS.oak_log.burnTicks = 300;
if (ITEMS.crafting_table) ITEMS.crafting_table.burnTicks = 300;

// --- Materials --------------------------------------------------------------
item('stick', { burnTicks: 100 });
item('coal', { burnTicks: 1600 });
item('charcoal', { burnTicks: 1600 });
item('raw_iron', {});
item('raw_gold', {});
item('iron_ingot', {});
item('gold_ingot', {});
item('diamond', {});

// --- Food -------------------------------------------------------------------
item('apple', { kind: 'food', food: 4, saturation: 2.4 });
item('raw_porkchop', { kind: 'food', food: 3, saturation: 1.8 });
item('cooked_porkchop', { kind: 'food', food: 8, saturation: 12.8 });
item('raw_beef', { kind: 'food', food: 3, saturation: 1.8 });
item('cooked_beef', { kind: 'food', food: 8, saturation: 12.8 });
item('bread', { kind: 'food', food: 5, saturation: 6 });

// --- Tools ------------------------------------------------------------------
// Durability and attack by material, following Java values.
const TOOL_MATS = {
  wooden: { tier: 1, material: 'wood', durability: 59 },
  stone: { tier: 2, material: 'stone', durability: 131 },
  iron: { tier: 3, material: 'iron', durability: 250 },
  golden: { tier: 1, material: 'gold', durability: 32 },
  diamond: { tier: 4, material: 'diamond', durability: 1561 },
};

// Base attack damage per tool type per material (approx Java).
const ATTACK = {
  sword: { wood: 4, stone: 5, iron: 6, gold: 4, diamond: 7 },
  axe: { wood: 7, stone: 9, iron: 9, gold: 7, diamond: 9 },
  pickaxe: { wood: 2, stone: 3, iron: 4, gold: 2, diamond: 5 },
  shovel: { wood: 2.5, stone: 3.5, iron: 4.5, gold: 2.5, diamond: 5.5 },
};

for (const [prefix, m] of Object.entries(TOOL_MATS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
    const name = `${prefix}_${type}`;
    item(name, {
      kind: 'tool',
      maxStack: 1,
      tool: type,
      tier: m.tier,
      material: m.material,
      durability: m.durability,
      attack: ATTACK[type][m.material],
      icon: name,
    });
  }
}

// Shears (for future leaf harvesting) — kept minimal.
item('shears', { kind: 'tool', maxStack: 1, tool: 'shears', tier: 0, durability: 238, icon: 'shears' });

// --- Helpers ----------------------------------------------------------------
export function getItem(name) {
  return ITEMS[name] || null;
}

// A lightweight descriptor for mining calculations (blocks.js.harvestInfo).
export function heldToolDescriptor(itemName) {
  const it = ITEMS[itemName];
  if (!it || it.kind !== 'tool') return null;
  return { tool: it.tool, tier: it.tier, material: it.material };
}

export function isFood(itemName) {
  const it = ITEMS[itemName];
  return !!(it && it.kind === 'food');
}

export function isFuel(itemName) {
  const it = ITEMS[itemName];
  return !!(it && it.burnTicks > 0);
}
