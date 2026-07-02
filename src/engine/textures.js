// ---------------------------------------------------------------------------
// textures.js
//
// A procedurally generated texture atlas. Rather than ship binary PNGs, we draw
// every 16x16 block/item/tool tile onto a single canvas at load time and hand
// it to Three.js as one atlas texture. Blocks index into the atlas by UV rect;
// the UI reuses the same canvas to draw inventory icons.
//
// Uses the DOM canvas API + Three.js (not unit-tested; validated via build).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const TILE = 16;      // pixels per tile
const COLS = 8;       // atlas columns

// Ordered list of every tile we need to draw. Order defines atlas position.
const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'log_top', 'log_side', 'planks',
  'leaves', 'sand', 'gravel', 'bedrock', 'water', 'glass', 'coal_ore', 'iron_ore',
  'gold_ore', 'diamond_ore', 'crafting_table_top', 'crafting_table_side', 'furnace_top', 'furnace_side', 'furnace_front', 'torch',
  'glowstone', 'iron_block', 'gold_block', 'diamond_block', 'obsidian', 'snow', 'grass_snow_side', 'missing',
  // items
  'stick', 'coal', 'charcoal', 'raw_iron', 'raw_gold', 'iron_ingot', 'gold_ingot', 'diamond',
  'apple', 'raw_porkchop', 'cooked_porkchop', 'raw_beef', 'cooked_beef', 'bread', 'shears',
];

// Tool icons are generated for each (material, type) pair.
const TOOL_PREFIXES = ['wooden', 'stone', 'iron', 'golden', 'diamond'];
const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'sword'];
for (const p of TOOL_PREFIXES) for (const t of TOOL_TYPES) TILE_NAMES.push(`${p}_${t}`);

const ROWS = Math.ceil(TILE_NAMES.length / COLS);

// Material colours for tool heads.
const MAT_COLOR = {
  wooden: '#9c6b30', stone: '#8a8a8a', iron: '#d8d8d8', golden: '#fcee4b', diamond: '#4be0d3',
};

// --- Low-level pixel helpers ------------------------------------------------
function shade(hex, amt) {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}

function makeTileCtx() {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  return c.getContext('2d');
}

// Fill a tile with a base colour + per-pixel speckle for a Minecrafty look.
function noisy(ctx, base, spread, seed) {
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rand() < 0.5) {
        const amt = Math.floor((rand() - 0.5) * spread);
        ctx.fillStyle = shade(base, amt);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function speckles(ctx, color, count, seed, size = 1) {
  const rand = mulberry32(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * (TILE - size + 1));
    const y = Math.floor(rand() * (TILE - size + 1));
    ctx.fillRect(x, y, size, size);
  }
}

// --- Per-tile drawers -------------------------------------------------------
const DRAW = {
  grass_top: (c) => { noisy(c, '#5b8f38', 40, 1); speckles(c, '#6fae44', 40, 2); },
  grass_side: (c) => {
    noisy(c, '#7a5a3a', 30, 3); // dirt body
    // green top band
    c.fillStyle = '#5b8f38';
    c.fillRect(0, 0, TILE, 4);
    for (let x = 0; x < TILE; x++) { if ((x * 7) % 3 === 0) px(c, x, 4, '#4f8030'); }
  },
  dirt: (c) => { noisy(c, '#7a5a3a', 34, 5); speckles(c, '#6b4c30', 30, 6); },
  stone: (c) => { noisy(c, '#8f8f8f', 26, 7); speckles(c, '#7d7d7d', 26, 8); },
  cobblestone: (c) => {
    noisy(c, '#8a8a8a', 20, 9);
    // chunky stones
    const rand = mulberry32(11);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rand() * 12), y = Math.floor(rand() * 12);
      c.fillStyle = shade('#8a8a8a', -30);
      c.fillRect(x, y, 4, 4);
      c.fillStyle = shade('#8a8a8a', 20);
      c.fillRect(x, y, 3, 3);
    }
  },
  log_top: (c) => {
    noisy(c, '#b6905a', 18, 12);
    c.strokeStyle = '#7a5a34';
    for (let r = 2; r <= 7; r += 2) { c.beginPath(); c.arc(8, 8, r, 0, Math.PI * 2); c.stroke(); }
    px(c, 8, 8, '#6b4c2a');
  },
  log_side: (c) => {
    noisy(c, '#6b4a28', 20, 13);
    for (let x = 0; x < TILE; x += 4) { c.fillStyle = shade('#6b4a28', -22); c.fillRect(x, 0, 1, TILE); }
    speckles(c, shade('#6b4a28', 24), 20, 14);
  },
  planks: (c) => {
    noisy(c, '#a9824e', 18, 15);
    c.fillStyle = shade('#a9824e', -34);
    for (let y = 0; y < TILE; y += 4) c.fillRect(0, y, TILE, 1);
    for (let y = 0; y < TILE; y += 8) c.fillRect(8, y, 1, 4);
  },
  leaves: (c) => { noisy(c, '#3f7a2a', 46, 16); speckles(c, '#2f5f1e', 60, 17); speckles(c, '#579a3a', 30, 18); },
  sand: (c) => { noisy(c, '#e6d59f', 18, 19); speckles(c, '#d8c67f', 26, 20); },
  gravel: (c) => { noisy(c, '#8f8781', 30, 21); speckles(c, '#6f665f', 40, 22); speckles(c, '#a9a09a', 24, 23); },
  bedrock: (c) => { noisy(c, '#565656', 40, 24); speckles(c, '#2a2a2a', 40, 25); speckles(c, '#777', 20, 26); },
  water: (c) => { noisy(c, '#3a63c8', 16, 27); speckles(c, '#4f77d8', 30, 28); },
  glass: (c) => {
    c.clearRect(0, 0, TILE, TILE);
    c.strokeStyle = 'rgba(210,235,255,0.9)';
    c.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    c.fillStyle = 'rgba(200,230,255,0.15)';
    c.fillRect(1, 1, TILE - 2, TILE - 2);
    px(c, 3, 3, 'rgba(255,255,255,0.8)');
    px(c, 11, 6, 'rgba(255,255,255,0.5)');
  },
  coal_ore: (c) => { DRAW.stone(c); speckles(c, '#2a2a2a', 16, 31, 2); },
  iron_ore: (c) => { DRAW.stone(c); speckles(c, '#c9a487', 14, 32, 2); },
  gold_ore: (c) => { DRAW.stone(c); speckles(c, '#f2d13b', 14, 33, 2); },
  diamond_ore: (c) => { DRAW.stone(c); speckles(c, '#4be0d3', 14, 34, 2); },
  crafting_table_top: (c) => {
    DRAW.planks(c);
    c.fillStyle = '#6b4a28'; c.strokeRect(1.5, 1.5, TILE - 3, TILE - 3);
    c.fillRect(7, 1, 1, TILE); c.fillRect(1, 7, TILE, 1);
  },
  crafting_table_side: (c) => {
    DRAW.planks(c);
    c.fillStyle = '#6b4a28';
    c.fillRect(1, 1, 6, 6); c.fillRect(9, 1, 6, 6);
    c.fillStyle = shade('#6b4a28', 20); c.fillRect(2, 2, 4, 4); c.fillRect(10, 2, 4, 4);
  },
  furnace_top: (c) => { noisy(c, '#7d7d7d', 18, 40); c.fillStyle = '#5a5a5a'; c.fillRect(4, 4, 8, 8); c.fillStyle = '#8a8a8a'; c.fillRect(5, 5, 6, 6); },
  furnace_side: (c) => DRAW.stone(c),
  furnace_front: (c) => {
    DRAW.stone(c);
    c.fillStyle = '#3a3a3a'; c.fillRect(3, 6, 10, 8);       // furnace mouth
    c.fillStyle = '#1c1c1c'; c.fillRect(4, 8, 8, 5);
    c.fillStyle = '#d8892a'; c.fillRect(5, 11, 6, 2);        // embers
    c.fillStyle = '#f2c24b'; c.fillRect(6, 12, 3, 1);
  },
  torch: (c) => {
    c.clearRect(0, 0, TILE, TILE);
    c.fillStyle = '#6b4a28'; c.fillRect(7, 7, 2, 8);          // stick
    c.fillStyle = '#f2c24b'; c.fillRect(6, 4, 4, 3);          // flame
    c.fillStyle = '#fff2a8'; c.fillRect(7, 5, 2, 2);
  },
  glowstone: (c) => { noisy(c, '#c8a24a', 26, 44); speckles(c, '#f6e08a', 40, 45, 2); speckles(c, '#8a6a2a', 20, 46); },
  iron_block: (c) => { noisy(c, '#d8d8d8', 12, 47); c.strokeStyle = '#b8b8b8'; c.strokeRect(1.5, 1.5, 13, 13); },
  gold_block: (c) => { noisy(c, '#f2d13b', 12, 48); c.strokeStyle = '#d8b62a'; c.strokeRect(1.5, 1.5, 13, 13); },
  diamond_block: (c) => { noisy(c, '#4be0d3', 12, 49); speckles(c, '#bff7f1', 20, 50); },
  obsidian: (c) => { noisy(c, '#241f33', 22, 51); speckles(c, '#3a3352', 24, 52); speckles(c, '#5a4f7a', 8, 53); },
  snow: (c) => { noisy(c, '#f4f8fb', 8, 54); },
  grass_snow_side: (c) => { DRAW.dirt(c); c.fillStyle = '#f4f8fb'; c.fillRect(0, 0, TILE, 4); },
  missing: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, TILE, TILE); c.fillStyle = '#f0f'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8); },

  // --- items ---
  stick: (c) => { c.clearRect(0, 0, TILE, TILE); c.fillStyle = '#8a6a3a'; for (let i = 0; i < 8; i++) c.fillRect(5 + i, 11 - i, 2, 2); },
  coal: (c) => { c.clearRect(0, 0, TILE, TILE); blob(c, '#2a2a2a', 3); speckles(c, '#444', 8, 61); },
  charcoal: (c) => { c.clearRect(0, 0, TILE, TILE); blob(c, '#3a352f', 3); speckles(c, '#555', 8, 62); },
  raw_iron: (c) => { c.clearRect(0, 0, TILE, TILE); blob(c, '#c9a487', 3); speckles(c, '#a07f60', 8, 63); },
  raw_gold: (c) => { c.clearRect(0, 0, TILE, TILE); blob(c, '#e6c24a', 3); speckles(c, '#c69a2a', 8, 64); },
  iron_ingot: (c) => ingot(c, '#d8d8d8'),
  gold_ingot: (c) => ingot(c, '#f2d13b'),
  diamond: (c) => {
    c.clearRect(0, 0, TILE, TILE);
    c.fillStyle = '#4be0d3';
    c.beginPath(); c.moveTo(8, 2); c.lineTo(14, 8); c.lineTo(8, 14); c.lineTo(2, 8); c.closePath(); c.fill();
    c.fillStyle = '#bff7f1'; c.fillRect(6, 5, 2, 2);
  },
  apple: (c) => { c.clearRect(0, 0, TILE, TILE); c.fillStyle = '#d33'; c.beginPath(); c.arc(8, 9, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#6b4a28'; c.fillRect(8, 3, 1, 3); c.fillStyle = '#4a7a2a'; c.fillRect(9, 3, 3, 2); },
  raw_porkchop: (c) => meat(c, '#f0a0a0', '#d87a7a'),
  cooked_porkchop: (c) => meat(c, '#c98a5a', '#a86a3a'),
  raw_beef: (c) => meat(c, '#e06a6a', '#b84a4a'),
  cooked_beef: (c) => meat(c, '#8a5a34', '#6b422a'),
  bread: (c) => { c.clearRect(0, 0, TILE, TILE); c.fillStyle = '#c89a54'; c.beginPath(); c.ellipse(8, 8, 6, 4, 0, 0, Math.PI * 2); c.fill(); speckles(c, '#a87a34', 8, 70); },
  shears: (c) => { c.clearRect(0, 0, TILE, TILE); c.strokeStyle = '#d8d8d8'; c.lineWidth = 2; c.beginPath(); c.moveTo(3, 13); c.lineTo(12, 4); c.moveTo(3, 11); c.lineTo(12, 6); c.stroke(); c.lineWidth = 1; },
};

function blob(c, color, r) {
  c.fillStyle = color;
  c.beginPath(); c.arc(8, 8, 4, 0, Math.PI * 2); c.fill();
  c.fillRect(4, 6, 8, 5);
}
function ingot(c, color) {
  c.clearRect(0, 0, TILE, TILE);
  c.fillStyle = color;
  c.beginPath(); c.moveTo(3, 11); c.lineTo(5, 6); c.lineTo(13, 6); c.lineTo(11, 11); c.closePath(); c.fill();
  c.fillStyle = shade(color, 30); c.fillRect(6, 7, 5, 1);
}
function meat(c, light, dark) {
  c.clearRect(0, 0, TILE, TILE);
  c.fillStyle = dark; c.beginPath(); c.arc(8, 9, 5, 0, Math.PI * 2); c.fill();
  c.fillStyle = light; c.fillRect(6, 6, 5, 4);
  c.fillStyle = '#f4f4f4'; c.fillRect(10, 11, 3, 2); // bone
}

// Tool icon: brown handle + a material-coloured head shaped by type.
function drawTool(c, prefix, type) {
  c.clearRect(0, 0, TILE, TILE);
  const head = MAT_COLOR[prefix];
  const handle = '#8a6a3a';
  // handle: diagonal from bottom-left to centre
  for (let i = 0; i < 9; i++) { px(c, 4 + i, 13 - i, handle); px(c, 5 + i, 13 - i, shade(handle, -20)); }
  c.fillStyle = head;
  if (type === 'pickaxe') {
    c.fillRect(3, 3, 10, 2);
    px(c, 3, 5, head); px(c, 12, 5, head);
    px(c, 2, 4, head); px(c, 13, 4, head);
  } else if (type === 'axe') {
    c.fillRect(9, 2, 4, 6);
    c.fillRect(8, 3, 1, 4);
  } else if (type === 'shovel') {
    c.fillRect(10, 2, 4, 5);
    px(c, 10, 7, head); px(c, 13, 7, head);
  } else if (type === 'sword') {
    for (let i = 0; i < 9; i++) px(c, 4 + i, 12 - i, head);
    for (let i = 0; i < 9; i++) px(c, 5 + i, 12 - i, shade(head, 40));
    c.fillStyle = '#8a6a3a'; c.fillRect(3, 12, 4, 1); c.fillRect(4, 13, 3, 1);
  }
}

// --- Build the atlas --------------------------------------------------------
export const TILES = {}; // name -> { u0, v0, u1, v1 }
let atlasCanvas = null;
let atlasTexture = null;

export function buildAtlas() {
  if (atlasTexture) return atlasTexture;
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  TILE_NAMES.forEach((name, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const tctx = makeTileCtx();
    tctx.imageSmoothingEnabled = false;
    const drawer = DRAW[name] || (() => drawTool(tctx, name.split('_')[0], name.split('_')[1]));
    if (DRAW[name]) DRAW[name](tctx);
    else {
      const [prefix, type] = name.split('_');
      if (TOOL_PREFIXES.includes(prefix)) drawTool(tctx, prefix, type);
      else DRAW.missing(tctx);
    }
    ctx.drawImage(tctx.canvas, col * TILE, row * TILE);

    // UV rect (Three.js origin is bottom-left, canvas is top-left -> flip V).
    const inset = 0.02 / TILE; // guard against seam bleeding
    TILES[name] = {
      u0: (col * TILE) / canvas.width + inset,
      u1: ((col + 1) * TILE) / canvas.width - inset,
      v0: 1 - ((row + 1) * TILE) / canvas.height + inset,
      v1: 1 - (row * TILE) / canvas.height - inset,
    };
  });

  atlasCanvas = canvas;
  atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  return atlasTexture;
}

export function getAtlasTexture() {
  return atlasTexture || buildAtlas();
}
export function getAtlasCanvas() {
  if (!atlasCanvas) buildAtlas();
  return atlasCanvas;
}

// Draw an item/block icon into a 2D context (used by the inventory UI).
// Returns the source rect within the atlas canvas for the given tile name.
export function tilePixelRect(name) {
  const i = TILE_NAMES.indexOf(name);
  if (i < 0) return null;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return { sx: col * TILE, sy: row * TILE, size: TILE };
}

export const ATLAS_TILE_SIZE = TILE;
