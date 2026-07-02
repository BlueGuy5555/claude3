// ---------------------------------------------------------------------------
// screens.js
//
// The modal overlay screens: inventory (2x2 crafting), crafting table (3x3),
// furnace, and the creative item palette. Interaction follows Minecraft's
// cursor-stack model: left-click picks up / drops a whole stack, right-click
// picks up half / places one, and clicking a result slot harvests the craft.
//
// Uses the DOM. Talks to the pure engine models (Inventory, recipes, furnace).
// ---------------------------------------------------------------------------

import { ITEMS } from '../engine/items.js';
import { maxStack, makeStack } from '../engine/inventory.js';
import { matchCrafting } from '../engine/recipes.js';
import { SMELT_TICKS } from '../engine/constants.js';
import { makeIconCanvas } from './icons.js';

// Curated creative palette order: blocks, tools, then materials/food.
function creativePalette() {
  const blocks = [];
  const tools = [];
  const rest = [];
  for (const name of Object.keys(ITEMS)) {
    const it = ITEMS[name];
    if (it.kind === 'block') blocks.push(name);
    else if (it.kind === 'tool') tools.push(name);
    else rest.push(name);
  }
  return [...blocks, ...tools, ...rest];
}

export class Screens {
  constructor(player, world) {
    this.player = player;
    this.world = world;
    this.overlay = document.getElementById('overlay');
    this.panel = document.getElementById('overlay-panel');

    this.held = null;             // cursor stack
    this.open = null;             // null | 'inventory' | 'table' | 'furnace' | 'creative'
    this.craft = new Array(9).fill(null);
    this.craftSize = 2;
    this.craftResult = null;
    this.furnace = null;          // tile-entity ref
    this.furnacePos = null;
    this.palette = creativePalette();
    this._furnaceSig = '';

    // Floating held-stack element.
    this.heldEl = document.createElement('div');
    this.heldEl.id = 'held';
    document.body.appendChild(this.heldEl);

    this._onMove = (e) => this.moveHeld(e.clientX, e.clientY);
    document.addEventListener('mousemove', this._onMove);
    // Prevent the browser context menu inside the overlay (we use right-click).
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isOpen() {
    return this.open !== null;
  }

  openInventory() { this.craftSize = 2; this.craft.fill(null); this._show('inventory'); }
  openTable() { this.craftSize = 3; this.craft.fill(null); this._show('table'); }
  openCreative() { this._show('creative'); }
  openFurnace(x, y, z) {
    this.furnacePos = { x, y, z };
    this.furnace = this.world.getTileEntity(x, y, z);
    this._show('furnace');
  }

  _show(kind) {
    this.open = kind;
    this.overlay.classList.remove('hidden');
    this.render();
  }

  close() {
    // Return crafting-grid contents and the held stack to the inventory.
    for (let i = 0; i < this.craft.length; i++) {
      if (this.craft[i]) { this.player.inventory.add(this.craft[i].item, this.craft[i].count); this.craft[i] = null; }
    }
    if (this.held) {
      if (this.open !== 'creative') this.player.inventory.add(this.held.item, this.held.count);
      this.held = null;
    }
    this.craftResult = null;
    this.open = null;
    this.furnace = null;
    this.furnacePos = null;
    this.overlay.classList.add('hidden');
    this.renderHeld();
  }

  // --- Slot data access -----------------------------------------------------
  getSlot(container, index) {
    switch (container) {
      case 'inv': return this.player.inventory.slots[index];
      case 'craft': return this.craft[index];
      case 'craftOut': return this.craftResult;
      case 'fin': return this.furnace ? this.furnace.input : null;
      case 'ffuel': return this.furnace ? this.furnace.fuel : null;
      case 'fout': return this.furnace ? this.furnace.output : null;
      case 'creative': return { item: this.palette[index], count: maxStack(this.palette[index]) };
      default: return null;
    }
  }
  setSlot(container, index, stack) {
    switch (container) {
      case 'inv': this.player.inventory.slots[index] = stack; break;
      case 'craft': this.craft[index] = stack; break;
      case 'fin': if (this.furnace) this.furnace.input = stack; break;
      case 'ffuel': if (this.furnace) this.furnace.fuel = stack; break;
      case 'fout': if (this.furnace) this.furnace.output = stack; break;
    }
  }

  // --- Interaction ----------------------------------------------------------
  click(container, index, button) {
    if (container === 'creative') return this.clickCreative(button, index);
    if (container === 'craftOut' || container === 'fout') return this.clickOutput(container, index, button);
    return this.clickNormal(container, index, button);
  }

  clickNormal(container, index, button) {
    const cur = this.getSlot(container, index);
    if (!this.held) {
      if (!cur) return;
      if (button === 2) {
        // pick up half
        const half = Math.ceil(cur.count / 2);
        this.held = { ...cur, count: half };
        cur.count -= half;
        if (cur.count <= 0) this.setSlot(container, index, null);
      } else {
        this.held = cur;
        this.setSlot(container, index, null);
      }
    } else {
      const cap = maxStack(this.held.item);
      if (!cur) {
        if (button === 2) {
          // place one
          this.setSlot(container, index, makeStackLike(this.held, 1));
          this.held.count--;
          if (this.held.count <= 0) this.held = null;
        } else {
          this.setSlot(container, index, this.held);
          this.held = null;
        }
      } else if (cur.item === this.held.item && !isTool(cur.item)) {
        // merge into existing stack
        if (button === 2) {
          if (cur.count < cap) { cur.count++; this.held.count--; if (this.held.count <= 0) this.held = null; }
        } else {
          const room = cap - cur.count;
          const move = Math.min(room, this.held.count);
          cur.count += move;
          this.held.count -= move;
          if (this.held.count <= 0) this.held = null;
        }
      } else {
        // swap
        this.setSlot(container, index, this.held);
        this.held = cur;
      }
    }
    this.afterChange(container);
  }

  clickOutput(container, index, button) {
    const result = this.getSlot(container, index);
    if (!result) return;
    if (!this.held) {
      this.held = { item: result.item, count: result.count };
    } else if (this.held.item === result.item && !isTool(result.item)) {
      if (this.held.count + result.count <= maxStack(result.item)) this.held.count += result.count;
      else return; // no room
    } else {
      return; // can't take onto a different held item
    }
    if (container === 'craftOut') this.consumeCraft();
    else this.setSlot('fout', 0, null); // furnace output taken
    this.afterChange(container);
  }

  clickCreative(button, index) {
    const name = this.palette[index];
    if (this.held && this.held.item === name && !isTool(name)) {
      // stack more of the same (clamp to max)
      this.held.count = Math.min(maxStack(name), this.held.count + (button === 2 ? 1 : maxStack(name)));
    } else if (this.held && !this.getSlotIsSame(name)) {
      // Holding something else: clicking the palette deletes the held stack.
      this.held = null;
    } else {
      this.held = makeStack(name, button === 2 ? 1 : maxStack(name));
    }
    this.renderHeld();
  }
  getSlotIsSame(name) {
    return this.held && this.held.item === name;
  }

  consumeCraft() {
    for (let i = 0; i < this.craft.length; i++) {
      if (this.craft[i]) {
        this.craft[i].count--;
        if (this.craft[i].count <= 0) this.craft[i] = null;
      }
    }
    this.recomputeCraft();
  }

  recomputeCraft() {
    const size = this.craftSize;
    const flat = new Array(size * size).fill(null);
    for (let i = 0; i < size * size; i++) flat[i] = this.craft[i] ? this.craft[i].item : null;
    const r = matchCrafting(flat, size);
    this.craftResult = r ? { item: r.item, count: r.count } : null;
  }

  afterChange(container) {
    if (container === 'craft' || container === 'craftOut') this.recomputeCraft();
    this.render();
  }

  // --- Rendering ------------------------------------------------------------
  render() {
    if (!this.open) return;
    this.panel.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = {
      inventory: 'Inventory', table: 'Crafting Table', furnace: 'Furnace', creative: 'Creative Inventory',
    }[this.open];
    this.panel.appendChild(title);

    if (this.open === 'creative') {
      this.renderCreative();
    } else if (this.open === 'furnace') {
      this.renderFurnace();
    } else {
      this.renderCrafting();
    }

    if (this.open !== 'creative') {
      // Main storage + hotbar are shown on every non-creative screen.
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = 'Inventory';
      this.panel.appendChild(label);
    }
    // Main storage (indices 9..35) then hotbar (0..8) — shown on all screens.
    this.panel.appendChild(this.buildInvGrid());
    this.renderHeld();
  }

  renderCrafting() {
    const row = document.createElement('div');
    row.className = 'panel-row';
    const size = this.craftSize;
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.gridTemplateColumns = `repeat(${size}, 40px)`;
    for (let i = 0; i < size * size; i++) grid.appendChild(this.slotEl('craft', i));
    row.appendChild(grid);

    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    arrow.textContent = '\u2192';
    row.appendChild(arrow);

    const outWrap = document.createElement('div');
    outWrap.className = 'grid';
    outWrap.appendChild(this.slotEl('craftOut', 0));
    row.appendChild(outWrap);

    this.panel.appendChild(row);
  }

  renderFurnace() {
    const te = this.furnace;
    const row = document.createElement('div');
    row.className = 'panel-row';

    const left = document.createElement('div');
    left.className = 'grid';
    left.style.gridTemplateColumns = '40px';
    left.appendChild(this.slotEl('fin', 0));
    const flame = document.createElement('div');
    flame.className = 'flame';
    left.appendChild(flame);
    left.appendChild(this.slotEl('ffuel', 0));
    row.appendChild(left);

    const prog = document.createElement('div');
    prog.className = 'progress';
    const fill = document.createElement('div');
    prog.appendChild(fill);
    row.appendChild(prog);

    const outWrap = document.createElement('div');
    outWrap.className = 'grid';
    outWrap.appendChild(this.slotEl('fout', 0));
    row.appendChild(outWrap);

    this.panel.appendChild(row);
    this._furnaceEls = { flame, fill };
    this.updateFurnaceView();
  }

  renderCreative() {
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.gridTemplateColumns = 'repeat(9, 40px)';
    grid.style.maxHeight = '300px';
    grid.style.overflow = 'auto';
    for (let i = 0; i < this.palette.length; i++) grid.appendChild(this.slotEl('creative', i));
    this.panel.appendChild(grid);
    const note = document.createElement('div');
    note.className = 'section-label';
    note.textContent = 'Click an item to grab a stack. Hold a stack and click the palette to delete it.';
    this.panel.appendChild(note);
  }

  buildInvGrid() {
    const wrap = document.createElement('div');
    const main = document.createElement('div');
    main.className = 'grid';
    main.style.gridTemplateColumns = 'repeat(9, 40px)';
    for (let i = 9; i < 36; i++) main.appendChild(this.slotEl('inv', i));
    wrap.appendChild(main);
    const hot = document.createElement('div');
    hot.className = 'grid';
    hot.style.gridTemplateColumns = 'repeat(9, 40px)';
    hot.style.marginTop = '6px';
    for (let i = 0; i < 9; i++) hot.appendChild(this.slotEl('inv', i));
    wrap.appendChild(hot);
    return wrap;
  }

  slotEl(container, index) {
    const el = document.createElement('div');
    el.className = 'slot';
    const stack = this.getSlot(container, index);
    fillSlot(el, stack);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.click(container, index, e.button);
    });
    return el;
  }

  moveHeld(x, y) {
    this.heldEl.style.left = x - 18 + 'px';
    this.heldEl.style.top = y - 18 + 'px';
  }
  renderHeld() {
    this.heldEl.innerHTML = '';
    if (!this.held) { this.heldEl.style.display = 'none'; return; }
    this.heldEl.style.display = 'block';
    this.heldEl.appendChild(makeIconCanvas(this.held.item, 36));
    if (this.held.count > 1) {
      const c = document.createElement('div');
      c.className = 'count';
      c.textContent = this.held.count;
      this.heldEl.appendChild(c);
    }
  }

  // Live furnace animation (called each frame while open, without rebuild).
  animate() {
    if (this.open !== 'furnace' || !this.furnace) return;
    const te = this.furnace;
    const sig = stackSig(te.input) + '|' + stackSig(te.fuel) + '|' + stackSig(te.output);
    if (sig !== this._furnaceSig) {
      this._furnaceSig = sig;
      this.render();
    } else {
      this.updateFurnaceView();
    }
  }
  updateFurnaceView() {
    if (!this._furnaceEls || !this.furnace) return;
    const te = this.furnace;
    this._furnaceEls.fill.style.width = Math.min(100, (te.progress / SMELT_TICKS) * 100) + '%';
    this._furnaceEls.flame.classList.toggle('lit', te.burn > 0);
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMove);
  }
}

// --- helpers ----------------------------------------------------------------
function isTool(name) {
  const it = ITEMS[name];
  return it && it.kind === 'tool';
}
function makeStackLike(src, count) {
  const s = { item: src.item, count };
  if (src.durability != null) s.durability = src.durability;
  return s;
}
function stackSig(s) {
  return s ? s.item + ':' + s.count : '-';
}
function fillSlot(el, stack) {
  el.innerHTML = '';
  if (!stack) return;
  el.appendChild(makeIconCanvas(stack.item, 32));
  if (stack.count > 1) {
    const c = document.createElement('div');
    c.className = 'count';
    c.textContent = stack.count;
    el.appendChild(c);
  }
  const def = ITEMS[stack.item];
  if (def && def.kind === 'tool' && def.durability && stack.durability != null && stack.durability < def.durability) {
    const bar = document.createElement('div');
    bar.className = 'dura';
    const frac = stack.durability / def.durability;
    const fill = document.createElement('div');
    fill.style.width = frac * 100 + '%';
    fill.style.background = `hsl(${frac * 120}, 90%, 45%)`;
    bar.appendChild(fill);
    el.appendChild(bar);
  }
}
