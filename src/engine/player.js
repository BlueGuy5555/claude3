// ---------------------------------------------------------------------------
// player.js
//
// The player: state, the fixed-timestep physics tick, survival stats, and the
// camera. Movement reproduces Minecraft Java Edition: friction/acceleration
// horizontal integration, gravity 0.08 * drag 0.98 vertical, jump 0.42, eye
// height 1.62 (1.27 sneaking), 0.6 x 1.8 collision box, creative flight, and a
// simple swimming model.
//
// Uses Three.js for the camera + vectors. Physics math lives in physics.js so
// it can be unit tested; here we orchestrate it against the live world.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_SNEAK_HEIGHT,
  PLAYER_EYE_HEIGHT, PLAYER_SNEAK_EYE_HEIGHT,
  GRAVITY, VERTICAL_DRAG, JUMP_VELOCITY, SPRINT_JUMP_BOOST,
  GROUND_FRICTION, AIR_FRICTION, FLY_FRICTION,
  ACCEL_WALK, ACCEL_SPRINT, ACCEL_SNEAK, ACCEL_AIR, ACCEL_AIR_SPRINT,
  ACCEL_FLY, ACCEL_FLY_SPRINT,
  TICK_SECONDS, MAX_HEALTH, MAX_HUNGER, MAX_AIR,
  FALL_DAMAGE_THRESHOLD, REACH_SURVIVAL, REACH_CREATIVE,
} from './constants.js';
import { isSolid, isLiquid, B } from './blocks.js';
import { moveAndCollide, applyGroundMove } from './physics.js';
import { Inventory } from './inventory.js';

const FLY_VERTICAL = 0.5;      // blocks/tick when flying up/down (~10 b/s)
const SWIM_UP = 0.04;
const WATER_FRICTION = 0.8;
const WATER_ACCEL = 0.02;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0.5, y: 80, z: 0.5 };  // feet centre
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;    // radians, around Y
    this.pitch = 0;  // radians, around X (clamped +-89 deg)

    this.onGround = false;
    this.inWater = false;
    this.mode = 'survival';
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;

    // Survival stats
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.air = MAX_AIR;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.fallDistance = 0;
    this.dead = false;

    this.inventory = new Inventory();
    this.spawn = { ...this.pos };

    // Input intent, set by the input handler each frame.
    this.input = { forward: 0, right: 0, jump: false, sneak: false, sprint: false, up: 0 };

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    this.thirdPerson = false; // toggled by F5

    // Solid predicate for collision.
    this.solid = (x, y, z) => isSolid(this.world.getBlockGen(x, y, z));

    // Tick accumulator for the fixed-timestep simulation.
    this._acc = 0;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'survival') this.flying = false;
  }

  get reach() {
    return this.mode === 'creative' ? REACH_CREATIVE : REACH_SURVIVAL;
  }

  get eyeHeight() {
    return this.sneaking ? PLAYER_SNEAK_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
  }
  get height() {
    return this.sneaking ? PLAYER_SNEAK_HEIGHT : PLAYER_HEIGHT;
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  lookDirection(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    return out.normalize();
  }

  addLook(dx, dy, sensitivity = 0.0025) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  // Advance the simulation by real dt seconds, running whole ticks.
  update(dt) {
    this._acc += dt;
    let ticks = 0;
    while (this._acc >= TICK_SECONDS && ticks < 5) {
      this.tick();
      this._acc -= TICK_SECONDS;
      ticks++;
    }
    if (this._acc > TICK_SECONDS) this._acc = 0; // avoid spiral of death
    this.updateCamera();
  }

  tick() {
    if (this.dead) return;
    const inp = this.input;
    this.sneaking = inp.sneak && !this.flying && this.mode !== 'creative-fly';

    // --- Water state ---
    this.inWater = this.isBodyInWater();

    // --- Wish direction (world space) ---
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const fwdX = -sinY, fwdZ = -cosY;   // forward
    const rgtX = cosY, rgtZ = -sinY;    // right
    const wishX = fwdX * inp.forward + rgtX * inp.right;
    const wishZ = fwdZ * inp.forward + rgtZ * inp.right;

    // Sprint only while moving forward and (survival) not starving.
    this.sprinting = inp.sprint && inp.forward > 0 && (this.mode === 'creative' || this.hunger > 6);

    if (this.flying) {
      this.tickFly(wishX, wishZ, inp);
    } else if (this.inWater) {
      this.tickWater(wishX, wishZ, inp);
    } else {
      this.tickGround(wishX, wishZ, inp);
    }

    // Move + collide.
    const wasOnGround = this.onGround;
    const preY = this.pos.y;
    const result = moveAndCollide(this.solid, this, this.height, wasOnGround);
    this.onGround = result.onGround;

    // Fall damage accounting (survival only).
    if (!this.flying && !this.inWater) {
      if (this.vel.y < 0 && !this.onGround) {
        this.fallDistance += preY - this.pos.y;
      }
      if (this.onGround) {
        this.applyFallDamage();
        this.fallDistance = 0;
      }
    } else {
      this.fallDistance = 0;
    }

    if (this.mode === 'survival') this.tickStats(wishX, wishZ);
    // Void death.
    if (this.pos.y < -20) this.die();
  }

  // Ground / air locomotion (the canonical Java model).
  tickGround(wishX, wishZ, inp) {
    const friction = this.onGround ? GROUND_FRICTION : AIR_FRICTION;
    let accel;
    if (this.onGround) {
      accel = this.sneaking ? ACCEL_SNEAK : this.sprinting ? ACCEL_SPRINT : ACCEL_WALK;
    } else {
      accel = this.sprinting ? ACCEL_AIR_SPRINT : ACCEL_AIR;
    }
    applyGroundMove(this.vel, wishX, wishZ, accel, friction);

    // Sneak edge protection: don't walk off a ledge while sneaking.
    if (this.sneaking && this.onGround) this.applyEdgeProtection();

    // Jump.
    if (inp.jump && this.onGround) {
      this.vel.y = JUMP_VELOCITY;
      if (this.sprinting) {
        // Sprint-jump forward boost in the facing direction.
        const len = Math.hypot(wishX, wishZ) || 1;
        this.vel.x += (wishX / len) * SPRINT_JUMP_BOOST;
        this.vel.z += (wishZ / len) * SPRINT_JUMP_BOOST;
      }
      this.onGround = false;
    }

    // Gravity for next tick.
    this.vel.y = (this.vel.y - GRAVITY) * VERTICAL_DRAG;
  }

  tickWater(wishX, wishZ, inp) {
    applyGroundMove(this.vel, wishX, wishZ, WATER_ACCEL, WATER_FRICTION);
    // Buoyant sink + swim up on jump.
    this.vel.y *= WATER_FRICTION;
    this.vel.y -= 0.02; // gentle sink
    if (inp.jump) this.vel.y += SWIM_UP + 0.02;
    if (this.vel.y < -0.3) this.vel.y = -0.3; // slow fall in water
  }

  tickFly(wishX, wishZ, inp) {
    const sprintFly = this.sprinting || inp.sprint;
    const accel = sprintFly ? ACCEL_FLY_SPRINT : ACCEL_FLY;
    applyGroundMove(this.vel, wishX, wishZ, accel, FLY_FRICTION);
    // Vertical: space up, sneak down.
    const up = (inp.jump ? 1 : 0) - (inp.sneak ? 1 : 0);
    this.vel.y = up * FLY_VERTICAL * (sprintFly ? 2 : 1);
    // Landing on the ground while flying near the floor cancels flight.
    if (this.onGround && up <= 0) this.flying = false;
  }

  applyEdgeProtection() {
    // If moving would put the feet over a cell with no ground below, cancel
    // that horizontal velocity component (Minecraft's sneak ledge stop).
    const test = (dx, dz) => {
      const fx = this.pos.x + dx;
      const fz = this.pos.z + dz;
      const half = PLAYER_WIDTH / 2;
      // Check the ground one block below the projected footprint corners.
      const y = Math.floor(this.pos.y - 0.05);
      const corners = [
        [fx - half, fz - half], [fx + half, fz - half],
        [fx - half, fz + half], [fx + half, fz + half],
      ];
      for (const [cx, cz] of corners) {
        if (this.solid(Math.floor(cx), y, Math.floor(cz))) return true; // ground somewhere
      }
      return false;
    };
    if (this.vel.x !== 0 && !test(Math.sign(this.vel.x) * 0.35, 0)) this.vel.x = 0;
    if (this.vel.z !== 0 && !test(0, Math.sign(this.vel.z) * 0.35)) this.vel.z = 0;
  }

  applyFallDamage() {
    if (this.mode !== 'survival') return;
    const dmg = Math.floor(this.fallDistance - FALL_DAMAGE_THRESHOLD);
    if (dmg > 0) this.hurt(dmg);
  }

  // Is a solid-ish part of the body in water (used for swim physics)?
  isBodyInWater() {
    const y = Math.floor(this.pos.y + 0.4);
    return isLiquid(this.world.getBlock(Math.floor(this.pos.x), y, Math.floor(this.pos.z)));
  }
  isHeadInWater() {
    const y = Math.floor(this.pos.y + this.eyeHeight);
    return isLiquid(this.world.getBlock(Math.floor(this.pos.x), y, Math.floor(this.pos.z)));
  }

  tickStats(wishX, wishZ) {
    // Exhaustion from movement.
    const moving = (Math.abs(this.vel.x) + Math.abs(this.vel.z)) > 0.02 && this.onGround;
    if (moving) this.exhaustion += this.sprinting ? 0.1 : 0.01;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    // Drowning.
    if (this.isHeadInWater()) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2); }
    } else if (this.air < MAX_AIR) {
      this.air = Math.min(MAX_AIR, this.air + 4);
    }

    // Natural regen when well-fed.
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      if (++this.regenTimer >= 80) { this.regenTimer = 0; this.health = Math.min(MAX_HEALTH, this.health + 1); }
    } else this.regenTimer = 0;

    // Starvation.
    if (this.hunger <= 0) {
      if (++this.starveTimer >= 80) { this.starveTimer = 0; this.hurt(1); }
    } else this.starveTimer = 0;
  }

  hurt(amount) {
    if (this.mode === 'creative') return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.die();
  }

  heal(amount) {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  eat(itemDef) {
    if (this.hunger >= MAX_HUNGER && this.mode === 'survival') return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + itemDef.food);
    this.saturation = Math.min(this.hunger, this.saturation + itemDef.saturation);
    return true;
  }

  die() {
    this.dead = true;
  }

  respawn() {
    this.dead = false;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.air = MAX_AIR;
    this.fallDistance = 0;
    this.vel = { x: 0, y: 0, z: 0 };
    this.pos = { ...this.spawn };
  }

  updateCamera() {
    const eye = this.eyePosition();
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (!this.thirdPerson) {
      this.camera.position.copy(eye);
    } else {
      // Pull the camera back along the view direction, but not through walls.
      const dir = this.lookDirection(new THREE.Vector3());
      let dist = 3.5;
      for (let d = 0.2; d <= dist; d += 0.2) {
        const x = Math.floor(eye.x - dir.x * d);
        const y = Math.floor(eye.y - dir.y * d);
        const z = Math.floor(eye.z - dir.z * d);
        if (this.solid(x, y, z)) { dist = d - 0.2; break; }
      }
      this.camera.position.copy(eye).addScaledVector(dir, -dist);
    }
  }
}
