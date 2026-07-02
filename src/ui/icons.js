// ---------------------------------------------------------------------------
// icons.js — draw item/block icons into slot canvases from the texture atlas.
// ---------------------------------------------------------------------------

import { ITEMS } from '../engine/items.js';
import { BLOCKS } from '../engine/blocks.js';
import { getAtlasCanvas, tilePixelRect } from '../engine/textures.js';

// Resolve the atlas tile that best represents an item's icon.
export function iconTileFor(itemName) {
  const it = ITEMS[itemName];
  if (!it) return 'missing';
  if (it.kind === 'block' && it.place != null) {
    const b = BLOCKS[it.place];
    // Prefer a side texture; grass/furnace/logs read better from the side.
    return b.tiles.side || b.tiles.top || 'missing';
  }
  return it.icon || itemName;
}

// Draw an item icon onto a 2D canvas context at (dx, dy) with the given size.
export function drawItemIcon(ctx, itemName, dx, dy, size) {
  const atlas = getAtlasCanvas();
  const rect = tilePixelRect(iconTileFor(itemName));
  if (!rect) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, rect.sx, rect.sy, rect.size, rect.size, dx, dy, size, size);
}

// Create a <canvas> element rendering a single item icon at the given size.
export function makeIconCanvas(itemName, size = 32) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  drawItemIcon(ctx, itemName, 0, 0, size);
  return c;
}
