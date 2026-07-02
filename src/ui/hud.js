// ---------------------------------------------------------------------------
// hud.js — the always-on heads-up display: hotbar, health, hunger.
// ---------------------------------------------------------------------------

import { ITEMS } from '../engine/items.js';
import { MAX_HEALTH, MAX_HUNGER } from '../engine/constants.js';
import { makeIconCanvas } from './icons.js';

export class HUD {
  constructor(player) {
    this.player = player;
    this.hotbarEl = document.getElementById('hotbar');
    this.healthEl = document.getElementById('health');
    this.hungerEl = document.getElementById('hunger');
    this.barsEl = document.getElementById('bars');
    this.buildHotbar();
    this._lastKey = '';
  }

  buildHotbar() {
    this.hotbarEl.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      this.hotbarEl.appendChild(slot);
      this.slotEls.push(slot);
    }
  }

  render() {
    const p = this.player;
    // Hotbar contents + selection (only redraw when something changed).
    const key = p.inventory.slots.slice(0, 9).map((s) => s ? s.item + ':' + s.count + ':' + (s.durability ?? '') : '-').join('|') + '#' + p.inventory.selected;
    if (key !== this._lastKey) {
      this._lastKey = key;
      for (let i = 0; i < 9; i++) {
        const el = this.slotEls[i];
        el.classList.toggle('selected', i === p.inventory.selected);
        el.innerHTML = '';
        const s = p.inventory.slots[i];
        if (!s) continue;
        el.appendChild(makeIconCanvas(s.item, 32));
        if (s.count > 1) {
          const c = document.createElement('div');
          c.className = 'count';
          c.textContent = s.count;
          el.appendChild(c);
        }
        const def = ITEMS[s.item];
        if (def && def.kind === 'tool' && def.durability && s.durability != null && s.durability < def.durability) {
          const bar = document.createElement('div');
          bar.className = 'dura';
          const frac = s.durability / def.durability;
          const fill = document.createElement('div');
          fill.style.width = (frac * 100) + '%';
          fill.style.background = `hsl(${frac * 120}, 90%, 45%)`;
          bar.appendChild(fill);
          el.appendChild(bar);
        }
      }
    }

    // Health + hunger bars (hidden in creative).
    const survival = p.mode === 'survival';
    this.barsEl.style.display = survival ? 'flex' : 'none';
    if (survival) {
      this.renderBar(this.healthEl, p.health, MAX_HEALTH, '#e0453e', '#5a1c1a', '\u2665');
      this.renderBar(this.hungerEl, p.hunger, MAX_HUNGER, '#c78a3b', '#4a3316', '\uD83C\uDF56');
    }
  }

  renderBar(el, value, max, color, empty, glyph) {
    const units = max / 2; // 10 icons, each = 2 points
    // Rebuild lazily by caching a signature.
    const sig = value + '/' + max;
    if (el._sig === sig) return;
    el._sig = sig;
    el.innerHTML = '';
    for (let i = 0; i < units; i++) {
      const icon = document.createElement('div');
      icon.className = 'icon';
      const filled = value - i * 2;
      const ratio = filled >= 2 ? 1 : filled === 1 ? 0.5 : 0;
      icon.style.fontSize = '15px';
      icon.style.lineHeight = '16px';
      icon.style.textAlign = 'center';
      icon.textContent = glyph;
      icon.style.filter = ratio === 0 ? 'grayscale(1) brightness(0.5)' : ratio === 0.5 ? 'brightness(0.8)' : 'none';
      icon.style.opacity = ratio === 0 ? '0.5' : '1';
      el.appendChild(icon);
    }
  }
}
