// ---------------------------------------------------------------------------
// blocks.js
//
// The block registry. Every voxel in the world is a single byte: an index into
// this table. Each entry describes how the block looks (which atlas tiles cover
// which faces), how it behaves physically (solid / transparent / liquid), and
// how it responds to mining (hardness, required tool, drops).
//
// Mining time follows the Java Edition formula:
//   time_seconds = (canHarvest ? 1.5 : 5.0) * hardness / toolSpeed
// where toolSpeed is 1 for the wrong tool / bare hand, and higher for the right
// tool tier (wood 2, stone 4, iron 6, diamond 8, gold 12).
//
// This module is pure data + math (no DOM / Three.js) so it is unit-testable.
// ---------------------------------------------------------------------------

import { TPS } from './constants.js';

// Tool material harvest tiers. A block with minTier = N only yields its drop
// when mined with a tool of that tier or higher.
export const TIER = { HAND: 0, WOOD: 1, STONE: 2, IRON: 3, DIAMOND: 4 };

// Numeric block ids (kept stable — worlds serialize these).
export const B = {
  AIR: 0,
  STONE: 1,
  GRASS: 2,
  DIRT: 3,
  COBBLESTONE: 4,
  LOG: 5,
  PLANKS: 6,
  LEAVES: 7,
  SAND: 8,
  GRAVEL: 9,
  BEDROCK: 10,
  WATER: 11,
  GLASS: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
  DIAMOND_ORE: 16,
  CRAFTING_TABLE: 17,
  FURNACE: 18,
  TORCH: 19,
  GLOWSTONE: 20,
  IRON_BLOCK: 21,
  GOLD_BLOCK: 22,
  DIAMOND_BLOCK: 23,
  OBSIDIAN: 24,
  SNOW_GRASS: 25,
};

// Helper to build a face->tile map. Accepts a single tile name (all faces),
// or an object with { top, bottom, side } / explicit faces.
function faces(spec) {
  if (typeof spec === 'string') {
    return { top: spec, bottom: spec, north: spec, south: spec, east: spec, west: spec };
  }
  const side = spec.side;
  return {
    top: spec.top ?? side,
    bottom: spec.bottom ?? side,
    north: spec.north ?? side,
    south: spec.south ?? side,
    east: spec.east ?? side,
    west: spec.west ?? side,
  };
}

// The registry, indexed by block id.
export const BLOCKS = [];

function def(id, props) {
  BLOCKS[id] = {
    id,
    name: props.name,
    solid: props.solid ?? true,
    transparent: props.transparent ?? false,
    liquid: props.liquid ?? false,
    gravity: props.gravity ?? false, // falls like sand/gravel
    hardness: props.hardness ?? 0,   // seconds-ish base; Infinity == unbreakable
    tool: props.tool ?? null,        // preferred tool: 'pickaxe' | 'axe' | 'shovel' | 'sword'
    requiresTool: props.requiresTool ?? false, // must use correct tool+tier to get a drop
    minTier: props.minTier ?? TIER.HAND,
    light: props.light ?? 0,         // 0..15 light emission
    tiles: faces(props.tiles ?? props.name),
    drop: props.drop ?? props.name,  // item name string, or null, or array of {item,count}
    dropCount: props.dropCount ?? 1,
    isCube: props.isCube ?? true,    // torches render as a small non-cube prop
    interactive: props.interactive ?? false, // opens a UI on right-click
  };
}

def(B.AIR, { name: 'air', solid: false, transparent: true, tiles: 'air', drop: null });
def(B.STONE, { name: 'stone', hardness: 1.5, tool: 'pickaxe', requiresTool: true, minTier: TIER.WOOD, tiles: 'stone', drop: 'cobblestone' });
def(B.GRASS, { name: 'grass', hardness: 0.6, tool: 'shovel', tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, drop: 'dirt' });
def(B.DIRT, { name: 'dirt', hardness: 0.5, tool: 'shovel', tiles: 'dirt' });
def(B.COBBLESTONE, { name: 'cobblestone', hardness: 2.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.WOOD, tiles: 'cobblestone' });
def(B.LOG, { name: 'oak_log', hardness: 2.0, tool: 'axe', tiles: { top: 'log_top', bottom: 'log_top', side: 'log_side' } });
def(B.PLANKS, { name: 'oak_planks', hardness: 2.0, tool: 'axe', tiles: 'planks' });
def(B.LEAVES, { name: 'oak_leaves', hardness: 0.2, tool: 'shears', transparent: true, tiles: 'leaves', drop: null });
def(B.SAND, { name: 'sand', hardness: 0.5, tool: 'shovel', gravity: true, tiles: 'sand' });
def(B.GRAVEL, { name: 'gravel', hardness: 0.6, tool: 'shovel', gravity: true, tiles: 'gravel' });
def(B.BEDROCK, { name: 'bedrock', hardness: Infinity, tiles: 'bedrock', drop: null });
def(B.WATER, { name: 'water', solid: false, transparent: true, liquid: true, hardness: Infinity, tiles: 'water', drop: null });
def(B.GLASS, { name: 'glass', hardness: 0.3, transparent: true, tiles: 'glass', drop: null });
def(B.COAL_ORE, { name: 'coal_ore', hardness: 3.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.WOOD, tiles: 'coal_ore', drop: 'coal' });
def(B.IRON_ORE, { name: 'iron_ore', hardness: 3.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.STONE, tiles: 'iron_ore', drop: 'raw_iron' });
def(B.GOLD_ORE, { name: 'gold_ore', hardness: 3.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.IRON, tiles: 'gold_ore', drop: 'raw_gold' });
def(B.DIAMOND_ORE, { name: 'diamond_ore', hardness: 3.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.IRON, tiles: 'diamond_ore', drop: 'diamond' });
def(B.CRAFTING_TABLE, { name: 'crafting_table', hardness: 2.5, tool: 'axe', interactive: true, tiles: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side' } });
def(B.FURNACE, { name: 'furnace', hardness: 3.5, tool: 'pickaxe', requiresTool: true, minTier: TIER.WOOD, interactive: true, tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', north: 'furnace_front' } });
def(B.TORCH, { name: 'torch', solid: false, transparent: true, isCube: false, hardness: 0, light: 14, tiles: 'torch' });
def(B.GLOWSTONE, { name: 'glowstone', hardness: 0.3, light: 15, tiles: 'glowstone' });
def(B.IRON_BLOCK, { name: 'iron_block', hardness: 5.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.STONE, tiles: 'iron_block' });
def(B.GOLD_BLOCK, { name: 'gold_block', hardness: 3.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.IRON, tiles: 'gold_block' });
def(B.DIAMOND_BLOCK, { name: 'diamond_block', hardness: 5.0, tool: 'pickaxe', requiresTool: true, minTier: TIER.IRON, tiles: 'diamond_block' });
def(B.OBSIDIAN, { name: 'obsidian', hardness: 50, tool: 'pickaxe', requiresTool: true, minTier: TIER.DIAMOND, tiles: 'obsidian' });
def(B.SNOW_GRASS, { name: 'snowy_grass', hardness: 0.6, tool: 'shovel', tiles: { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, drop: 'dirt' });

// Name -> id lookup.
export const BLOCK_BY_NAME = {};
for (const b of BLOCKS) if (b) BLOCK_BY_NAME[b.name] = b.id;

// --- Queries ----------------------------------------------------------------
export function isSolid(id) {
  const b = BLOCKS[id];
  return b ? b.solid : false;
}
export function isTransparent(id) {
  const b = BLOCKS[id];
  return b ? b.transparent : true;
}
export function isLiquid(id) {
  const b = BLOCKS[id];
  return b ? b.liquid : false;
}
export function isCube(id) {
  const b = BLOCKS[id];
  return b ? b.isCube : true;
}
export function lightEmission(id) {
  const b = BLOCKS[id];
  return b ? b.light : 0;
}

// Whether a face of block `self` should be drawn given the neighbour `other`.
export function shouldDrawFace(self, other) {
  if (other === B.AIR) return true;
  const ob = BLOCKS[other];
  if (!ob) return true;
  if (!ob.transparent) return false;      // opaque neighbour hides the face
  if (other === self) return false;        // merge like-with-like (glass/water/leaves)
  return true;
}

// --- Mining -----------------------------------------------------------------
// toolSpeed for a given tool material tier. Gold is fast but low harvest tier.
const MATERIAL_SPEED = { 0: 1, wood: 2, gold: 12, stone: 4, iron: 6, diamond: 8 };

// Given the currently held item descriptor { tool, tier, material } (or null),
// return whether the block yields its drop and the tool speed multiplier.
//
//  - `rightTool`  : held tool type matches the block's preferred tool.
//  - `tierOk`     : held tool tier is high enough to harvest the block.
//  - `canHarvest` : the block will drop its item (needs rightTool+tierOk only
//                   when the block `requiresTool`; otherwise always true).
//  - `speed`      : mining speed multiplier (material speed when rightTool).
export function harvestInfo(blockId, held) {
  const b = BLOCKS[blockId];
  if (!b) return { canHarvest: true, speed: 1, rightTool: false };
  const rightTool = !!(held && b.tool && held.tool === b.tool);
  const tierOk = held ? held.tier >= b.minTier : b.minTier === TIER.HAND;
  const canHarvest = b.requiresTool ? rightTool && tierOk : true;
  const speed = rightTool && held.material != null ? MATERIAL_SPEED[held.material] ?? 1 : 1;
  return { canHarvest, speed, rightTool };
}

// Break time in seconds for a block given the held item.
export function getMiningTimeSeconds(blockId, held) {
  const b = BLOCKS[blockId];
  if (!b) return 0;
  if (!isFinite(b.hardness)) return Infinity; // bedrock / water
  if (b.hardness === 0) return 0;
  const { canHarvest, speed } = harvestInfo(blockId, held);
  const factor = canHarvest ? 1.5 : 5.0;
  return (factor * b.hardness) / speed;
}

// Break time in whole simulation ticks (min 1 tick if breakable at all).
export function getMiningTimeTicks(blockId, held) {
  const secs = getMiningTimeSeconds(blockId, held);
  if (!isFinite(secs)) return Infinity;
  return Math.max(1, Math.ceil(secs * TPS));
}

// What (if anything) a block drops when broken with the held item.
export function getDrop(blockId, held) {
  const b = BLOCKS[blockId];
  if (!b || b.drop == null) return null;
  const { canHarvest } = harvestInfo(blockId, held);
  if (!canHarvest) return null; // wrong tool/tier -> no drop
  return { item: b.drop, count: b.dropCount };
}
