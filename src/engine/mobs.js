// ---------------------------------------------------------------------------
// mobs.js
//
// Entities: passive animals (pig, cow) that wander and flee when hit, and a
// hostile zombie that chases the player at night and attacks in melee. Mobs
// reuse the same voxel AABB physics as the player (gravity + collision + a
// 1-block auto-jump so they can climb terrain).
//
// Models are built from a few coloured boxes. Uses Three.js.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GRAVITY, VERTICAL_DRAG, JUMP_VELOCITY } from './constants.js';
import { isSolid } from './blocks.js';
import { moveAndCollide } from './physics.js';

// Type config: size (box w/h), speed (blocks/tick), health, hostile, drop.
const TYPES = {
  pig: { w: 0.9, h: 0.9, speed: 0.06, health: 10, hostile: false, drop: 'raw_porkchop', dropN: 2 },
  cow: { w: 0.9, h: 1.4, speed: 0.06, health: 10, hostile: false, drop: 'raw_beef', dropN: 2 },
  zombie: { w: 0.6, h: 1.95, speed: 0.09, health: 20, hostile: true, drop: null, dropN: 0 },
};

let NEXT_ID = 1;

export class Mob {
  constructor(type, x, y, z) {
    this.id = NEXT_ID++;
    this.type = type;
    const cfg = TYPES[type];
    this.cfg = cfg;
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = Math.random() * Math.PI * 2;
    this.health = cfg.health;
    this.onGround = false;
    this.dead = false;
    this.wanderTimer = 0;
    this.attackCooldown = 0;
    this.wishX = 0;
    this.wishZ = 0;
    this.mesh = buildModel(type);
    this.mesh.position.set(x, y, z);
  }

  hurt(amount, knockDir) {
    this.health -= amount;
    if (knockDir) {
      this.vel.x += knockDir.x * 0.4;
      this.vel.z += knockDir.z * 0.4;
      this.vel.y = 0.36;
    }
    if (this.health <= 0) this.dead = true;
    else if (!this.cfg.hostile) {
      // Flee: run away from the hit direction for a bit.
      this.wanderTimer = 40;
      if (knockDir) this.yaw = Math.atan2(knockDir.x, knockDir.z);
    }
  }

  tick(world, player, isNight) {
    const solid = (x, y, z) => isSolid(world.getBlockGen(x, y, z));

    // --- AI ---
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const distSq = dx * dx + dz * dz;
    const chasing = this.cfg.hostile && isNight && distSq < 24 * 24;

    if (chasing) {
      const d = Math.sqrt(distSq) || 1;
      this.wishX = dx / d;
      this.wishZ = dz / d;
      this.yaw = Math.atan2(this.wishX, this.wishZ);
      // Attack when adjacent.
      if (distSq < 1.6 * 1.6 && Math.abs(player.pos.y - this.pos.y) < 2) {
        if (this.attackCooldown <= 0) {
          player.hurt(3);
          const kb = 1 / d;
          player.vel.x += dx * kb * 0.4;
          player.vel.z += dz * kb * 0.4;
          this.attackCooldown = 20; // ~1s
        }
      }
    } else {
      // Wander: occasionally pick a new heading (or stop).
      if (--this.wanderTimer <= 0) {
        this.wanderTimer = 40 + Math.floor(Math.random() * 80);
        if (Math.random() < 0.3) {
          this.wishX = this.wishZ = 0; // idle
        } else {
          this.yaw = Math.random() * Math.PI * 2;
          this.wishX = Math.sin(this.yaw);
          this.wishZ = Math.cos(this.yaw);
        }
      }
    }
    if (this.attackCooldown > 0) this.attackCooldown--;

    // --- Locomotion ---
    const speed = this.cfg.speed * (chasing ? 1.2 : 1);
    this.vel.x = this.vel.x * 0.6 + this.wishX * speed * 0.4;
    this.vel.z = this.vel.z * 0.6 + this.wishZ * speed * 0.4;

    // Auto-jump when walking into a wall on the ground.
    const wasOnGround = this.onGround;
    if (wasOnGround && (this.wishX || this.wishZ)) {
      const ahead = solid(
        Math.floor(this.pos.x + this.wishX * 0.6),
        Math.floor(this.pos.y),
        Math.floor(this.pos.z + this.wishZ * 0.6)
      );
      if (ahead) this.vel.y = JUMP_VELOCITY;
    }

    // Gravity.
    this.vel.y = (this.vel.y - GRAVITY) * VERTICAL_DRAG;

    const result = moveAndCollide(solid, this, this.cfg.h, wasOnGround);
    this.onGround = result.onGround;

    if (this.pos.y < -20) this.dead = true;
  }

  syncMesh() {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.yaw;
  }
}

// --- Simple box models ------------------------------------------------------
function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
  m.position.set(x, y, z);
  return m;
}

function buildModel(type) {
  const g = new THREE.Group();
  if (type === 'pig') {
    g.add(box(0.9, 0.7, 1.2, 0xef9aa8, 0, 0.45, 0));           // body
    g.add(box(0.6, 0.6, 0.6, 0xf0a5b2, 0, 0.6, 0.75));         // head
    g.add(box(0.28, 0.2, 0.1, 0xd77f8e, 0, 0.55, 1.05));       // snout
    for (const [sx, sz] of [[-0.3, 0.45], [0.3, 0.45], [-0.3, -0.45], [0.3, -0.45]])
      g.add(box(0.22, 0.45, 0.22, 0xd77f8e, sx, 0.22, sz));    // legs
  } else if (type === 'cow') {
    g.add(box(0.95, 0.9, 1.4, 0x4a3626, 0, 0.75, 0));
    g.add(box(0.6, 0.6, 0.6, 0x3a2a1c, 0, 1.1, 0.9));
    g.add(box(0.62, 0.3, 0.62, 0xf2efe6, 0, 0.85, 0.4));       // white patch
    for (const [sx, sz] of [[-0.32, 0.5], [0.32, 0.5], [-0.32, -0.5], [0.32, -0.5]])
      g.add(box(0.24, 0.6, 0.24, 0x2f2016, sx, 0.3, sz));
  } else { // zombie
    g.add(box(0.6, 0.9, 0.35, 0x3a6a4a, 0, 1.0, 0));           // torso
    g.add(box(0.5, 0.5, 0.5, 0x5aa06a, 0, 1.7, 0));            // head
    g.add(box(0.2, 0.9, 0.5, 0x4a7a5a, 0, 1.35, 0.35));        // outstretched arms
    for (const sx of [-0.18, 0.18]) g.add(box(0.28, 0.9, 0.3, 0x2a3a6a, sx, 0.45, 0)); // legs
  }
  return g;
}

// --- Manager ----------------------------------------------------------------
export class MobManager {
  constructor(world, scene, player) {
    this.world = world;
    this.scene = scene;
    this.player = player;
    this.mobs = [];
    this.spawnTimer = 0;
    this.maxPassive = 10;
    this.maxHostile = 12;
  }

  spawn(type, x, y, z) {
    const mob = new Mob(type, x, y, z);
    this.mobs.push(mob);
    this.scene.add(mob.mesh);
    return mob;
  }

  countHostile() { return this.mobs.filter((m) => m.cfg.hostile).length; }
  countPassive() { return this.mobs.filter((m) => !m.cfg.hostile).length; }

  // Called every simulation tick.
  tick(isNight) {
    for (const mob of this.mobs) mob.tick(this.world, this.player, isNight);

    // Handle deaths (drops go to the player inventory for simplicity).
    for (const mob of this.mobs) {
      if (mob.dead) {
        if (mob.cfg.drop) this.player.inventory.add(mob.cfg.drop, mob.cfg.dropN);
        this.scene.remove(mob.mesh);
        disposeGroup(mob.mesh);
      }
    }
    this.mobs = this.mobs.filter((m) => !m.dead);

    // Despawn far-away mobs and daytime zombies.
    this.mobs = this.mobs.filter((mob) => {
      const dx = mob.pos.x - this.player.pos.x;
      const dz = mob.pos.z - this.player.pos.z;
      const far = dx * dx + dz * dz > 80 * 80;
      const burns = mob.cfg.hostile && !isNight && Math.random() < 0.02;
      if (far || burns) { this.scene.remove(mob.mesh); disposeGroup(mob.mesh); return false; }
      return true;
    });

    // Periodic spawning near the player.
    if (--this.spawnTimer <= 0) {
      this.spawnTimer = 40;
      this.trySpawn(isNight);
    }
  }

  trySpawn(isNight) {
    const p = this.player.pos;
    const attempts = 4;
    for (let i = 0; i < attempts; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * 24;
      const x = Math.floor(p.x + Math.cos(angle) * r);
      const z = Math.floor(p.z + Math.sin(angle) * r);
      const y = this.world.surfaceY(x, z);
      if (y < 2) continue;
      // Ensure two blocks of headroom.
      if (isSolid(this.world.getBlockGen(x, y, z)) || isSolid(this.world.getBlockGen(x, y + 1, z))) continue;

      if (isNight && this.countHostile() < this.maxHostile && Math.random() < 0.6) {
        this.spawn('zombie', x + 0.5, y, z + 0.5);
      } else if (!isNight && this.countPassive() < this.maxPassive) {
        this.spawn(Math.random() < 0.5 ? 'pig' : 'cow', x + 0.5, y, z + 0.5);
      }
    }
  }

  syncMeshes() {
    for (const mob of this.mobs) mob.syncMesh();
  }

  // Ray/box intersection for melee: returns the closest mob the player is
  // looking at within reach, or null.
  pickLookedAt(origin, dir, reach) {
    let best = null;
    let bestT = reach;
    for (const mob of this.mobs) {
      const t = rayBox(origin, dir, mob.pos, mob.cfg.w, mob.cfg.h);
      if (t != null && t < bestT) { bestT = t; best = mob; }
    }
    return best;
  }
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// Ray vs axis-aligned mob box (feet-centre position). Returns hit distance.
function rayBox(o, d, pos, w, h) {
  const hw = w / 2;
  const minX = pos.x - hw, maxX = pos.x + hw;
  const minY = pos.y, maxY = pos.y + h;
  const minZ = pos.z - hw, maxZ = pos.z + hw;
  let tmin = -Infinity, tmax = Infinity;
  for (const [oi, di, lo, hi] of [
    [o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ],
  ]) {
    if (Math.abs(di) < 1e-8) {
      if (oi < lo || oi > hi) return null;
    } else {
      let t1 = (lo - oi) / di, t2 = (hi - oi) / di;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? tmax : null;
}
