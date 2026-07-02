// ---------------------------------------------------------------------------
// game.js
//
// The orchestrator: owns the renderer, scene, lighting/day-night, chunk mesh
// management, the player, mobs, block interaction (break/place/use), the HUD
// and overlay screens, and the fixed-timestep simulation loop.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

import {
  CHUNK_SIZE, WORLD_HEIGHT, TICK_SECONDS, DAY_LENGTH_TICKS,
} from './engine/constants.js';
import { B, BLOCKS, getMiningTimeTicks, getDrop } from './engine/blocks.js';
import { ITEMS, heldToolDescriptor } from './engine/items.js';
import { World } from './engine/world.js';
import { Player } from './engine/player.js';
import { MobManager } from './engine/mobs.js';
import { raycastVoxel } from './engine/raycast.js';
import { buildChunkGeometries } from './engine/chunkMesher.js';
import { getAtlasTexture, buildAtlas } from './engine/textures.js';
import { newFurnace, tickFurnace } from './engine/furnace.js';
import { chunkKey, floorDiv } from './engine/util.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';

const RENDER_DISTANCE = 6;   // chunks
const GEN_DISTANCE = RENDER_DISTANCE + 1;
const DOUBLE_TAP_MS = 300;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();

    buildAtlas();
    this.setupMaterials();

    this.world = new World(Math.floor(Math.random() * 1e9));
    this.player = new Player(this.world);
    this.mobs = new MobManager(this.world, this.scene, this.player);
    this.hud = new HUD(this.player);
    this.screens = new Screens(this.player, this.world);

    this.chunkMeshes = new Map(); // key -> { group, opaque, cutout, water }
    this.meshQueue = [];

    this.time = 6000; // start mid-morning
    this.keys = new Set();
    this.mouseDown = { left: false, right: false };
    this.miningTarget = null;
    this.miningProgress = 0;
    this.attackCooldown = 0;
    this._lastSpace = 0;
    this._lastW = 0;
    this._acc = 0;
    this._paused = false;

    this.setupLighting();
    this.setupSelectionHighlight();
    this.setupInput();

    addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  setupMaterials() {
    const map = getAtlasTexture();
    this.matOpaque = new THREE.MeshLambertMaterial({ map, vertexColors: true });
    this.matCutout = new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    this.matWater = new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false });
  }

  setupLighting() {
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a6a4a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.9);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);
    this.scene.fog = new THREE.Fog(0x9fc7ff, RENDER_DISTANCE * CHUNK_SIZE * 0.6, RENDER_DISTANCE * CHUNK_SIZE);
  }

  setupSelectionHighlight() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  // --- Spawn ----------------------------------------------------------------
  start(mode) {
    this.player.setMode(mode);
    // Find a safe spawn at world origin.
    const sx = 0, sz = 0;
    const y = this.world.surfaceY(sx, sz);
    this.player.pos = { x: sx + 0.5, y: y + 0.5, z: sz + 0.5 };
    this.player.spawn = { ...this.player.pos };
    if (mode === 'creative') this.giveCreativeStarter();
    else this.giveSurvivalStarter();
    // Eagerly build the chunks around spawn so the player doesn't fall.
    this.updateChunks(true);
    this.flushMeshQueue(9999);
  }

  giveSurvivalStarter() {
    // Empty-handed survival start (authentic). Nothing to add.
  }
  giveCreativeStarter() {
    const inv = this.player.inventory;
    const picks = ['grass', 'dirt', 'stone', 'cobblestone', 'oak_log', 'oak_planks', 'glass', 'torch', 'crafting_table', 'furnace', 'diamond_pickaxe', 'iron_sword'];
    picks.forEach((p, i) => { if (ITEMS[p]) inv.slots[i] = { item: p, count: ITEMS[p].kind === 'tool' ? 1 : 64, ...(ITEMS[p].kind === 'tool' ? { durability: ITEMS[p].durability } : {}) }; });
  }

  // --- Input ----------------------------------------------------------------
  setupInput() {
    this.canvas.addEventListener('click', () => {
      if (!this.screens.isOpen() && !this._paused) this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked && !this.screens.isOpen()) this.player.addLook(e.movementX, e.movementY);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.screens.isOpen() || !this.locked) return;
      if (e.button === 0) { this.mouseDown.left = true; this.onLeftClick(); }
      if (e.button === 2) { this.mouseDown.right = true; this.onRightClick(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouseDown.left = false; this.resetMining(); }
      if (e.button === 2) this.mouseDown.right = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      if (this.screens.isOpen()) return;
      const dir = Math.sign(e.deltaY);
      this.player.inventory.selected = (this.player.inventory.selected + dir + 9) % 9;
    });

    addEventListener('keydown', (e) => this.onKeyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Menu buttons.
    document.querySelectorAll('#menu button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('menu').classList.add('hidden');
        this._paused = false;
        this.start(btn.dataset.mode);
        this.canvas.requestPointerLock();
      });
    });
  }

  onKeyDown(e) {
    // Number keys select hotbar.
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= 9) this.player.inventory.selected = n - 1;
    }
    switch (e.code) {
      case 'KeyE':
        if (this.screens.isOpen()) { this.screens.close(); this.canvas.requestPointerLock(); }
        else { document.exitPointerLock(); this.player.mode === 'creative' ? this.screens.openCreative() : this.screens.openInventory(); }
        break;
      case 'Escape':
        if (this.screens.isOpen()) { this.screens.close(); this.canvas.requestPointerLock(); }
        break;
      case 'KeyF':
        this.player.thirdPerson = false; // reserved
        break;
      case 'F3':
        e.preventDefault();
        document.getElementById('debug').classList.toggle('show');
        break;
      case 'F5':
        this.player.thirdPerson = !this.player.thirdPerson;
        break;
      case 'KeyQ':
        this.dropSelected();
        break;
      case 'Space': {
        const now = performance.now();
        if (this.player.mode === 'creative' && now - this._lastSpace < DOUBLE_TAP_MS) {
          this.player.flying = !this.player.flying;
          this.player.vel.y = 0;
        }
        this._lastSpace = now;
        break;
      }
      case 'KeyW': {
        const now = performance.now();
        if (now - this._lastW < DOUBLE_TAP_MS) this._sprintLatch = true;
        this._lastW = now;
        break;
      }
    }
    this.keys.add(e.code);
  }

  readInput() {
    const k = this.keys;
    const inp = this.player.input;
    inp.forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    inp.right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    inp.jump = k.has('Space');
    inp.sneak = k.has('ShiftLeft') || k.has('ShiftRight');
    if (!k.has('KeyW')) this._sprintLatch = false;
    inp.sprint = k.has('ControlLeft') || k.has('ControlRight') || this._sprintLatch;
  }

  dropSelected() {
    const s = this.player.inventory.getSelected();
    if (s) this.player.inventory.removeSelected(1);
  }

  // --- Interaction ----------------------------------------------------------
  targetBlock() {
    const origin = this.player.eyePosition(new THREE.Vector3());
    const dir = this.player.lookDirection(new THREE.Vector3());
    return raycastVoxel(this.world, origin, dir, this.player.reach);
  }

  onLeftClick() {
    // Prefer attacking a mob if one is in the way and closer than any block.
    const origin = this.player.eyePosition(new THREE.Vector3());
    const dir = this.player.lookDirection(new THREE.Vector3());
    const mob = this.mobs.pickLookedAt(origin, dir, this.player.reach);
    if (mob) { this.attackMob(mob, dir); return; }

    if (this.player.mode === 'creative') {
      const hit = this.targetBlock();
      if (hit) this.breakBlock(hit.x, hit.y, hit.z, true);
    }
    // Survival mining is continuous — handled in the sim tick.
  }

  attackMob(mob, dir) {
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 8;
    const held = this.player.inventory.getSelected();
    const def = held ? ITEMS[held.item] : null;
    const dmg = def ? def.attack : 1;
    mob.hurt(dmg, { x: dir.x, z: dir.z });
    if (def && def.kind === 'tool') this.player.inventory.damageSelected();
  }

  onRightClick() {
    const hit = this.targetBlock();
    const held = this.player.inventory.getSelected();

    // Use an interactive block (crafting table / furnace).
    if (hit) {
      const id = this.world.getBlock(hit.x, hit.y, hit.z);
      const block = BLOCKS[id];
      if (block && block.interactive && !(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))) {
        document.exitPointerLock();
        if (id === B.CRAFTING_TABLE) this.screens.openTable();
        else if (id === B.FURNACE) {
          if (!this.world.getTileEntity(hit.x, hit.y, hit.z)) this.world.setTileEntity(hit.x, hit.y, hit.z, newFurnace());
          this.screens.openFurnace(hit.x, hit.y, hit.z);
        }
        return;
      }
    }

    if (!held) return;
    const def = ITEMS[held.item];

    // Eat food.
    if (def.kind === 'food') {
      if (this.player.eat(def)) {
        if (this.player.mode === 'survival') this.player.inventory.removeSelected(1);
        this.toast('Ate ' + def.display);
      }
      return;
    }

    // Place a block.
    if (def.place != null && hit) {
      this.placeBlock(hit.px, hit.py, hit.pz, def.place);
    }
  }

  placeBlock(x, y, z, blockId) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    if (this.world.getBlock(x, y, z) !== B.AIR && this.world.getBlock(x, y, z) !== B.WATER) return;
    // Don't place inside the player's own AABB.
    if (this.intersectsPlayer(x, y, z) && BLOCKS[blockId].solid) return;
    this.world.setBlock(x, y, z, blockId);
    if (blockId === B.FURNACE) this.world.setTileEntity(x, y, z, newFurnace());
    if (this.player.mode === 'survival') this.player.inventory.removeSelected(1);
    this.remeshAround(x, y, z);
  }

  intersectsPlayer(x, y, z) {
    const p = this.player.pos;
    const half = 0.3;
    const minX = p.x - half, maxX = p.x + half, minZ = p.z - half, maxZ = p.z + half;
    const minY = p.y, maxY = p.y + this.player.height;
    return x + 1 > minX && x < maxX && z + 1 > minZ && z < maxZ && y + 1 > minY && y < maxY;
  }

  breakBlock(x, y, z, instant) {
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR || id === B.BEDROCK) return;
    if (this.player.mode === 'survival') {
      const held = this.player.inventory.getSelected();
      const tool = held ? heldToolDescriptor(held.item) : null;
      const drop = getDrop(id, tool);
      if (drop) this.player.inventory.add(drop.item, drop.count);
      if (held && ITEMS[held.item] && ITEMS[held.item].kind === 'tool') this.player.inventory.damageSelected();
    }
    if (id === B.FURNACE) this.world.tileEntities.delete(this.world.tileKey(x, y, z));
    this.world.setBlock(x, y, z, B.AIR);
    this.remeshAround(x, y, z);
  }

  resetMining() {
    this.miningTarget = null;
    this.miningProgress = 0;
  }

  // Continuous survival mining, advanced once per simulation tick.
  tickMining() {
    if (this.player.mode === 'creative') return;
    if (!this.mouseDown.left || this.screens.isOpen()) { this.resetMining(); return; }
    const hit = this.targetBlock();
    if (!hit) { this.resetMining(); return; }
    const key = hit.x + ',' + hit.y + ',' + hit.z;
    if (!this.miningTarget || this.miningTarget.key !== key) {
      this.miningTarget = { key, x: hit.x, y: hit.y, z: hit.z };
      this.miningProgress = 0;
    }
    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    if (id === B.AIR || id === B.BEDROCK) { this.resetMining(); return; }
    const held = this.player.inventory.getSelected();
    const tool = held ? heldToolDescriptor(held.item) : null;
    const need = getMiningTimeTicks(id, tool);
    if (!isFinite(need)) return;
    this.miningProgress++;
    // Visualise progress by shrinking the highlight box a touch.
    const frac = Math.min(1, this.miningProgress / need);
    this.highlight.scale.setScalar(1 - frac * 0.25);
    if (this.miningProgress >= need) {
      this.breakBlock(hit.x, hit.y, hit.z, false);
      this.resetMining();
    }
  }

  // --- Chunk mesh management ------------------------------------------------
  updateChunks(eager = false) {
    const pcx = floorDiv(Math.floor(this.player.pos.x), CHUNK_SIZE);
    const pcz = floorDiv(Math.floor(this.player.pos.z), CHUNK_SIZE);

    // Generate + enqueue meshing within distance.
    for (let dz = -GEN_DISTANCE; dz <= GEN_DISTANCE; dz++) {
      for (let dx = -GEN_DISTANCE; dx <= GEN_DISTANCE; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        this.world.ensureChunk(cx, cz);
      }
    }
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (dx * dx + dz * dz > (RENDER_DISTANCE + 0.5) ** 2) continue;
        const key = chunkKey(cx, cz);
        const chunk = this.world.getChunk(cx, cz);
        if (chunk && (chunk.dirty || !this.chunkMeshes.has(key))) {
          if (!this.meshQueue.includes(key)) this.meshQueue.push(key);
        }
      }
    }

    // Unload far chunks' meshes.
    for (const [key, entry] of this.chunkMeshes) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) > RENDER_DISTANCE + 1 || Math.abs(cz - pcz) > RENDER_DISTANCE + 1) {
        this.disposeChunkMesh(key, entry);
      }
    }

    // Sort mesh queue by distance to player (nearest first).
    this.meshQueue.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number);
      const [bx, bz] = b.split(',').map(Number);
      return ((ax - pcx) ** 2 + (az - pcz) ** 2) - ((bx - pcx) ** 2 + (bz - pcz) ** 2);
    });
  }

  flushMeshQueue(budget = 2) {
    let built = 0;
    while (this.meshQueue.length && built < budget) {
      const key = this.meshQueue.shift();
      const [cx, cz] = key.split(',').map(Number);
      const chunk = this.world.getChunk(cx, cz);
      if (!chunk) continue;
      chunk.dirty = false;
      this.buildChunkMesh(cx, cz, key);
      built++;
    }
  }

  buildChunkMesh(cx, cz, key) {
    const geos = buildChunkGeometries(this.world, cx, cz);
    let entry = this.chunkMeshes.get(key);
    if (entry) {
      this.scene.remove(entry.group);
      entry.group.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    if (geos.opaque) group.add(new THREE.Mesh(geos.opaque, this.matOpaque));
    if (geos.cutout) group.add(new THREE.Mesh(geos.cutout, this.matCutout));
    if (geos.water) group.add(new THREE.Mesh(geos.water, this.matWater));
    this.scene.add(group);
    this.chunkMeshes.set(key, { group });
  }

  remeshAround(x, y, z) {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = chunkKey(cx + dx, cz + dz);
      const chunk = this.world.getChunk(cx + dx, cz + dz);
      if (chunk) { chunk.dirty = true; if (!this.meshQueue.includes(key)) this.meshQueue.push(key); }
    }
    // Rebuild the touched chunks immediately so edits feel instant.
    this.flushMeshQueue(6);
  }

  disposeChunkMesh(key, entry) {
    this.scene.remove(entry.group);
    entry.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.chunkMeshes.delete(key);
  }

  // --- Day / night ----------------------------------------------------------
  updateSky() {
    const t = this.time / DAY_LENGTH_TICKS; // 0..1
    const angle = t * Math.PI * 2 - Math.PI / 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle);
    const dist = 100;
    const p = this.player.pos;
    this.sun.position.set(p.x + sunX * dist, p.y + sunY * dist, p.z + 30);
    this.sun.target.position.set(p.x, p.y, p.z);
    const day = Math.max(0, sunY);
    this.sun.intensity = 0.15 + day * 0.85;
    this.hemi.intensity = 0.35 + day * 0.55;
    this.ambient.intensity = 0.18 + day * 0.12;

    const dayCol = new THREE.Color(0x9fc7ff);
    const nightCol = new THREE.Color(0x0a1030);
    const sky = nightCol.clone().lerp(dayCol, Math.max(0, Math.min(1, day * 1.5 + 0.15)));
    this.scene.background = sky;
    this.scene.fog.color = sky;
    if (this.player.isHeadInWater()) {
      this.scene.background = new THREE.Color(0x2a4a8a);
      this.scene.fog.color = new THREE.Color(0x2a4a8a);
    }
  }

  isNight() {
    const t = this.time / DAY_LENGTH_TICKS;
    const sunY = Math.sin(t * Math.PI * 2 - Math.PI / 2);
    return sunY < -0.1;
  }

  // --- Main loop ------------------------------------------------------------
  frame(dt) {
    if (this._paused) { this.render(); return; }
    this.readInput();

    // Fixed-timestep simulation.
    this._acc += dt;
    let ticks = 0;
    while (this._acc >= TICK_SECONDS && ticks < 5) {
      this.simTick();
      this._acc -= TICK_SECONDS;
      ticks++;
    }
    if (this._acc > 0.5) this._acc = 0;

    this.player.updateCamera();
    this.mobs.syncMeshes();
    this.updateChunks();
    this.flushMeshQueue(2);
    this.updateSky();
    this.updateHighlight();
    this.screens.animate();
    this.hud.render();
    this.updateDebug();
    this.render();
  }

  simTick() {
    this.time = (this.time + 1) % DAY_LENGTH_TICKS;
    if (this.attackCooldown > 0) this.attackCooldown--;
    this.player.tick();
    this.tickMining();
    this.mobs.tick(this.isNight());
    // Tick all furnaces.
    for (const te of this.world.tileEntities.values()) tickFurnace(te);
    if (this.player.dead) this.onDeath();
  }

  onDeath() {
    this.toast('You died! Respawning…');
    this.player.respawn();
    const y = this.world.surfaceY(Math.floor(this.player.spawn.x), Math.floor(this.player.spawn.z));
    this.player.pos = { x: this.player.spawn.x, y: y + 0.5, z: this.player.spawn.z };
  }

  updateHighlight() {
    if (this.screens.isOpen()) { this.highlight.visible = false; return; }
    const hit = this.targetBlock();
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      if (!this.mouseDown.left) this.highlight.scale.setScalar(1);
    } else {
      this.highlight.visible = false;
    }
  }

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 1500);
  }

  updateDebug() {
    const el = document.getElementById('debug');
    if (!el.classList.contains('show')) return;
    const p = this.player;
    const speed = Math.hypot(p.vel.x, p.vel.z) * 20;
    const held = p.inventory.getSelected();
    el.textContent =
      `ThreeCraft (Three.js)\n` +
      `xyz: ${p.pos.x.toFixed(2)} ${p.pos.y.toFixed(2)} ${p.pos.z.toFixed(2)}\n` +
      `vel: ${(p.vel.x).toFixed(3)} ${(p.vel.y).toFixed(3)} ${(p.vel.z).toFixed(3)} (${speed.toFixed(2)} b/s)\n` +
      `onGround: ${p.onGround}  flying: ${p.flying}  inWater: ${p.inWater}\n` +
      `mode: ${p.mode}  sprint: ${p.sprinting}  sneak: ${p.sneaking}\n` +
      `hp: ${p.health.toFixed(0)}  hunger: ${p.hunger.toFixed(0)}  time: ${this.time} ${this.isNight() ? '(night)' : '(day)'}\n` +
      `chunks: ${this.chunkMeshes.size}  mobs: ${this.mobs.mobs.length}\n` +
      `held: ${held ? held.item + ' x' + held.count : '(empty)'}`;
  }

  onResize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.player.camera);
  }
}
