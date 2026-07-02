// ---------------------------------------------------------------------------
// inventory.js
//
// The player inventory model: 36 slots (0-8 = hotbar, 9-35 = main storage),
// plus the currently selected hotbar index. A slot is either null or
// { item, count, durability }. Stacking respects each item's maxStack.
//
// Pure (no DOM / Three.js) so stacking logic is testable.
// ---------------------------------------------------------------------------

import { ITEMS } from './items.js';

export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const TOTAL_SLOTS = HOTBAR_SIZE + MAIN_SIZE;

export function maxStack(itemName) {
  const it = ITEMS[itemName];
  return it ? it.maxStack : 64;
}

export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selected = 0; // hotbar index 0..8
  }

  getSelected() {
    return this.slots[this.selected];
  }

  // Try to add `count` of item; returns the number that did NOT fit.
  add(itemName, count = 1) {
    const cap = maxStack(itemName);
    // First, top up existing stacks.
    for (let i = 0; i < TOTAL_SLOTS && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === itemName && s.count < cap) {
        const room = cap - s.count;
        const put = Math.min(room, count);
        s.count += put;
        count -= put;
      }
    }
    // Then fill empty slots (hotbar first for convenience).
    for (let i = 0; i < TOTAL_SLOTS && count > 0; i++) {
      if (!this.slots[i]) {
        const put = Math.min(cap, count);
        this.slots[i] = makeStack(itemName, put);
        count -= put;
      }
    }
    return count;
  }

  // Remove `count` from a specific slot; returns how many were removed.
  removeFromSlot(index, count = 1) {
    const s = this.slots[index];
    if (!s) return 0;
    const removed = Math.min(s.count, count);
    s.count -= removed;
    if (s.count <= 0) this.slots[index] = null;
    return removed;
  }

  removeSelected(count = 1) {
    return this.removeFromSlot(this.selected, count);
  }

  count(itemName) {
    let n = 0;
    for (const s of this.slots) if (s && s.item === itemName) n += s.count;
    return n;
  }

  // Total available to spend across all slots.
  has(itemName, n = 1) {
    return this.count(itemName) >= n;
  }

  // Damage the selected tool by 1 point of durability; break it at 0.
  damageSelected() {
    const s = this.getSelected();
    if (!s) return;
    const it = ITEMS[s.item];
    if (!it || it.kind !== 'tool' || !it.durability) return;
    s.durability = (s.durability ?? it.durability) - 1;
    if (s.durability <= 0) this.slots[this.selected] = null; // tool breaks
  }
}

export function makeStack(itemName, count = 1) {
  const it = ITEMS[itemName];
  const stack = { item: itemName, count };
  if (it && it.kind === 'tool' && it.durability) stack.durability = it.durability;
  return stack;
}
