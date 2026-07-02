// ---------------------------------------------------------------------------
// raycast.js
//
// Voxel ray casting via the Amanatides & Woo grid-traversal algorithm. Used to
// find which block the player is looking at (to break/use) and the empty cell
// in front of it (to place). Air and liquids are passed through.
//
// Pure (no DOM / Three.js).
// ---------------------------------------------------------------------------

import { B } from './blocks.js';
import { isLiquid } from './blocks.js';

// origin: {x,y,z}, dir: normalized {x,y,z}. Returns null or:
//   { x,y,z (hit block), nx,ny,nz (face normal), px,py,pz (place cell) }
export function raycastVoxel(world, origin, dir, maxDist = 5) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);

  // Avoid division by zero: infinite tDelta on axes with no movement.
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const distToBoundary = (o, s) => {
    if (s > 0) return Math.ceil(o) - o;
    if (s < 0) return o - Math.floor(o);
    return Infinity;
  };
  let tMaxX = dir.x !== 0 ? distToBoundary(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? distToBoundary(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? distToBoundary(origin.z, stepZ) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  // Check the starting cell too.
  for (let i = 0; i < 512; i++) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && !isLiquid(id)) {
      return {
        x, y, z,
        nx, ny, nz,
        px: x + nx, py: y + ny, pz: z + nz,
      };
    }
    // Advance to the next voxel boundary.
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) break;
  }
  return null;
}
