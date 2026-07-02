// ---------------------------------------------------------------------------
// recipes.js
//
// Crafting (shaped + shapeless) and furnace smelting.
//
// Shaped recipes match Minecraft semantics: the pattern is matched against the
// tightest bounding box of the placed items, and horizontal mirrors are
// accepted (so tools can be crafted "either handed"). Shapeless recipes match
// on the multiset of ingredients regardless of position.
//
// Pure data + matching logic (no DOM / Three.js) so it is unit-testable.
// ---------------------------------------------------------------------------

// -- Recipe definitions ------------------------------------------------------

// Shorthand keys used across shaped recipes.
const shaped = (pattern, key, result) => ({ type: 'shaped', pattern, key, result });
const shapeless = (ingredients, result) => ({ type: 'shapeless', ingredients, result });

export const CRAFTING_RECIPES = [
  // Wood basics
  shapeless(['oak_log'], { item: 'oak_planks', count: 4 }),
  shaped(['P', 'P'], { P: 'oak_planks' }, { item: 'stick', count: 4 }),
  shaped(['PP', 'PP'], { P: 'oak_planks' }, { item: 'crafting_table', count: 1 }),

  // Furnace: cobblestone ring
  shaped(['CCC', 'C.C', 'CCC'], { C: 'cobblestone' }, { item: 'furnace', count: 1 }),

  // Torch: coal on a stick
  shaped(['C', 'S'], { C: 'coal', S: 'stick' }, { item: 'torch', count: 4 }),
  shaped(['C', 'S'], { C: 'charcoal', S: 'stick' }, { item: 'torch', count: 4 }),

  // Glass pane / glowstone left out; blocks compaction:
  shaped(['III', 'III', 'III'], { I: 'iron_ingot' }, { item: 'iron_block', count: 1 }),
  shaped(['GGG', 'GGG', 'GGG'], { G: 'gold_ingot' }, { item: 'gold_block', count: 1 }),
  shaped(['DDD', 'DDD', 'DDD'], { D: 'diamond' }, { item: 'diamond_block', count: 1 }),
  shapeless(['iron_block'], { item: 'iron_ingot', count: 9 }),
  shapeless(['gold_block'], { item: 'gold_ingot', count: 9 }),
  shapeless(['diamond_block'], { item: 'diamond', count: 9 }),
];

// Tools — generated for each material so we don't hand-write 20 recipes.
const TOOL_MATERIALS = [
  { prefix: 'wooden', mat: 'oak_planks' },
  { prefix: 'stone', mat: 'cobblestone' },
  { prefix: 'iron', mat: 'iron_ingot' },
  { prefix: 'golden', mat: 'gold_ingot' },
  { prefix: 'diamond', mat: 'diamond' },
];

for (const { prefix, mat } of TOOL_MATERIALS) {
  const key = { M: mat, S: 'stick' };
  CRAFTING_RECIPES.push(
    shaped(['MMM', '.S.', '.S.'], key, { item: `${prefix}_pickaxe`, count: 1 }),
    shaped(['MM', 'MS', '.S'], key, { item: `${prefix}_axe`, count: 1 }),
    shaped(['M', 'S', 'S'], key, { item: `${prefix}_shovel`, count: 1 }),
    shaped(['M', 'M', 'S'], key, { item: `${prefix}_sword`, count: 1 })
  );
}

// -- Furnace smelting --------------------------------------------------------
// input item name -> output { item, count }
export const SMELTING_RECIPES = {
  raw_iron: { item: 'iron_ingot', count: 1 },
  raw_gold: { item: 'gold_ingot', count: 1 },
  iron_ore: { item: 'iron_ingot', count: 1 },
  gold_ore: { item: 'gold_ingot', count: 1 },
  sand: { item: 'glass', count: 1 },
  cobblestone: { item: 'stone', count: 1 },
  raw_porkchop: { item: 'cooked_porkchop', count: 1 },
  raw_beef: { item: 'cooked_beef', count: 1 },
  oak_log: { item: 'charcoal', count: 1 },
};

export function getSmeltResult(inputName) {
  return SMELTING_RECIPES[inputName] || null;
}

// -- Grid matching -----------------------------------------------------------

// Convert a flat grid (array of names/null) of dimension `size` x `size`
// into a trimmed 2D subgrid plus its bounding-box dimensions.
function trimGrid(flat, size) {
  let minR = size, maxR = -1, minC = size, maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (flat[r * size + c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return null; // empty grid
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push(flat[(r + minR) * size + (c + minC)] || null);
    }
    grid.push(row);
  }
  return { grid, rows, cols };
}

// Expand a recipe pattern into a 2D array of item-name/null using its key map.
function patternToGrid(pattern, key) {
  return pattern.map((row) =>
    row.split('').map((ch) => (ch === '.' || ch === ' ' ? null : key[ch] ?? null))
  );
}

function gridsEqual(a, b) {
  if (a.length !== b.length || a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[0].length; c++) {
      if ((a[r][c] || null) !== (b[r][c] || null)) return false;
    }
  }
  return true;
}

function mirror(grid) {
  return grid.map((row) => [...row].reverse());
}

function matchShaped(recipe, trimmed) {
  const pg = patternToGrid(recipe.pattern, recipe.key);
  // Trim the pattern's own bounding box (patterns are already tight, but be safe).
  return gridsEqual(pg, trimmed.grid) || gridsEqual(mirror(pg), trimmed.grid);
}

function matchShapeless(recipe, flat) {
  const counts = {};
  let total = 0;
  for (const name of flat) {
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
    total++;
  }
  if (total !== recipe.ingredients.length) return false;
  const need = {};
  for (const name of recipe.ingredients) need[name] = (need[name] || 0) + 1;
  for (const k of Object.keys(need)) if (counts[k] !== need[k]) return false;
  for (const k of Object.keys(counts)) if (!need[k]) return false;
  return true;
}

// Match a crafting grid (flat array, size x size) against all recipes.
// Returns { item, count } or null.
export function matchCrafting(flat, size) {
  const trimmed = trimGrid(flat, size);
  if (!trimmed) return null;
  for (const recipe of CRAFTING_RECIPES) {
    if (recipe.type === 'shaped') {
      // Recipe must fit within the grid size.
      if (recipe.pattern.length > size) continue;
      if (Math.max(...recipe.pattern.map((r) => r.length)) > size) continue;
      if (matchShaped(recipe, trimmed)) return { ...recipe.result };
    } else {
      if (matchShapeless(recipe, flat)) return { ...recipe.result };
    }
  }
  return null;
}
