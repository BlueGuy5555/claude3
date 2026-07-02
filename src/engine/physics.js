// ---------------------------------------------------------------------------
// physics.js
//
// Voxel collision + the Minecraft movement model. All quantities are in
// blocks and blocks-per-tick, matching Java Edition. The two public pieces:
//
//   moveAndCollide()  — sweeps the player AABB through the voxel grid one tick,
//                       resolving collisions axis-by-axis with a 0.6-block
//                       auto-step, returning collision flags.
//   applyGroundMove() — the horizontal friction+acceleration integrator that
//                       reproduces walk/sprint/sneak speeds exactly.
//
// A `solid(x,y,z)` predicate is injected so this stays pure and testable.
// ---------------------------------------------------------------------------

import { PLAYER_WIDTH, PLAYER_HEIGHT, STEP_HEIGHT } from './constants.js';

const HALF = PLAYER_WIDTH / 2;
const EPS = 1e-7;

// Does any solid block overlap the given world-space AABB?
export function boxCollides(solid, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let xi = Math.floor(minX + EPS); xi <= Math.floor(maxX - EPS); xi++) {
    for (let yi = Math.floor(minY + EPS); yi <= Math.floor(maxY - EPS); yi++) {
      for (let zi = Math.floor(minZ + EPS); zi <= Math.floor(maxZ - EPS); zi++) {
        if (solid(xi, yi, zi)) return true;
      }
    }
  }
  return false;
}

// Is a player box centred at (x, z) with feet at y free of collisions?
function boxFree(solid, x, y, z, half, height) {
  return !boxCollides(
    solid,
    x - half, y, z - half,
    x + half, y + height, z + half
  );
}

// Sweep a single axis of the player centre by `amount`, stopping at the first
// contact (binary-searched to ~1e-3 precision). Returns { value, collided }.
function sweepAxis(solid, pos, axis, amount, half, height) {
  const dir = Math.sign(amount);
  let dist = Math.abs(amount);
  let collided = false;
  const at = (v) => {
    const p = { ...pos };
    p[axis] = v;
    return boxFree(solid, p.x, p.y, p.z, half, height);
  };
  const STEP = 0.2; // sub-step small enough to never tunnel through a block
  while (dist > 1e-4) {
    const s = Math.min(STEP, dist);
    const target = pos[axis] + dir * s;
    if (at(target)) {
      pos[axis] = target;
      dist -= s;
    } else {
      // Binary search the largest free advance within this sub-step.
      let lo = 0, hi = s;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (at(pos[axis] + dir * mid)) lo = mid;
        else hi = mid;
      }
      pos[axis] += dir * lo;
      collided = true;
      break;
    }
  }
  return collided;
}

// Move the player one tick. `state` = { pos:{x,y,z feet-centre}, vel:{x,y,z} }.
// `height` lets us shrink the box while sneaking. Resolves Y, then X, then Z,
// with a 0.6-block auto-step when a horizontal move is blocked on the ground.
export function moveAndCollide(solid, state, height, wasOnGround) {
  const { pos, vel } = state;
  const half = HALF;

  // --- Vertical ---
  const collidedY = sweepAxis(solid, pos, 'y', vel.y, half, height);
  const onGround = collidedY && vel.y <= 0;
  if (collidedY) vel.y = 0;

  // --- Horizontal with auto-step ---
  const startX = pos.x;
  const startZ = pos.z;
  const collidedX = sweepAxis(solid, pos, 'x', vel.x, half, height);
  const collidedZ = sweepAxis(solid, pos, 'z', vel.z, half, height);

  let stepped = false;
  if ((collidedX || collidedZ) && (onGround || wasOnGround)) {
    // Try the same horizontal move but raised by up to STEP_HEIGHT, then settle
    // back down. If it clears the obstacle, keep it (this is Minecraft's step
    // assist that lets you walk up single blocks and slabs without jumping).
    const stepState = { x: startX, y: pos.y + STEP_HEIGHT, z: startZ };
    if (boxFree(solid, stepState.x, stepState.y, stepState.z, half, height)) {
      sweepAxis(solid, stepState, 'x', vel.x, half, height);
      sweepAxis(solid, stepState, 'z', vel.z, half, height);
      // Drop back onto the step.
      sweepAxis(solid, stepState, 'y', -STEP_HEIGHT, half, height);
      const gained =
        Math.abs(stepState.x - startX) + Math.abs(stepState.z - startZ);
      const current = Math.abs(pos.x - startX) + Math.abs(pos.z - startZ);
      if (gained > current + 1e-4) {
        pos.x = stepState.x;
        pos.y = stepState.y;
        pos.z = stepState.z;
        stepped = true;
      }
    }
  }

  return {
    onGround: onGround || stepped,
    collidedX,
    collidedY,
    collidedZ,
  };
}

// Horizontal friction + acceleration integrator (one tick).
//   vel'  = vel * friction + wish * accel
// The steady-state speed is accel / (1 - friction), which we tuned in
// constants.js to hit Java's 4.317 / 5.612 / 1.295 blocks-per-second.
export function applyGroundMove(vel, wishX, wishZ, accel, friction) {
  // Normalise the wish direction so diagonal movement isn't faster.
  const len = Math.hypot(wishX, wishZ);
  let nx = 0, nz = 0;
  if (len > 1e-6) {
    nx = wishX / len;
    nz = wishZ / len;
  }
  vel.x = vel.x * friction + nx * accel;
  vel.z = vel.z * friction + nz * accel;
}

// Steady-state horizontal speed (blocks/tick) for an accel/friction pair.
// Exposed for tests that verify our constants reproduce Java speeds.
export function steadyStateSpeed(accel, friction) {
  return accel / (1 - friction);
}
