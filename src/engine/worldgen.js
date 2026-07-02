// ---------------------------------------------------------------------------
// worldgen.js
//
// Deterministic terrain generation. Given a seed, every chunk regenerates
// identically. We use:
//   - a 2D fractal heightmap for rolling terrain,
//   - a low-frequency "mountain" ridge added on top,
//   - 3D Perlin noise to carve caves,
//   - hashed per-block ore placement by depth,
//   - hashed tree placement on grassy surfaces.
//
// Pure (no DOM / Three.js) so it can be unit-tested under Node.
// ---------------------------------------------------------------------------

import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from './constants.js';
import { B } from './blocks.js';
import { Noise, hashSeed } from './noise.js';
import { chunkIndex, hash3, clamp } from './util.js';

// Build the set of noise generators for a world seed. Each generator uses a
// different derived seed so their patterns are independent.
export function makeNoises(seed) {
  const s = hashSeed(seed);
  return {
    seed: s,
    height: new Noise(s ^ 0x1a2b3c4d),
    ridge: new Noise(s ^ 0x51ed270b),
    cave: new Noise(s ^ 0x27d4eb2f),
    caveB: new Noise(s ^ 0x165667b1),
  };
}

// Surface height (top solid block y) for a world column. Exposed so spawn code
// can find the ground quickly without generating a whole chunk.
export function columnHeight(noises, wx, wz) {
  const e = noises.height.fbm2(wx * 0.0075, wz * 0.0075, 4, 2, 0.5); // rolling hills, -1..1
  const ridge = noises.ridge.fbm2(wx * 0.0035, wz * 0.0035, 3, 2, 0.5); // broad mountains
  const mountain = Math.max(0, ridge) ** 1.4 * 40;
  const h = SEA_LEVEL + Math.round(e * 14 + mountain);
  return clamp(h, 5, WORLD_HEIGHT - 20);
}

// Fill `data` (a Uint8Array of one chunk) for chunk (cx, cz).
export function generateChunkData(data, cx, cz, noises) {
  const seed = noises.seed;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = columnHeight(noises, wx, wz);
      const beach = h <= SEA_LEVEL + 1;
      const snowy = h > SEA_LEVEL + 34;

      for (let y = 0; y < WORLD_HEIGHT; y++) {
        let block = B.AIR;

        if (y === 0) {
          block = B.BEDROCK;
        } else if (y <= 3 && hash3(wx, y, wz, seed ^ 0xbed40c) < (4 - y) / 4) {
          block = B.BEDROCK; // ragged bedrock layer
        } else if (y < h - 4) {
          block = B.STONE;
        } else if (y < h) {
          block = beach ? B.SAND : B.DIRT;
        } else if (y === h) {
          block = beach ? B.SAND : snowy ? B.SNOW_GRASS : B.GRASS;
        }

        // Fill water above solid ground up to sea level.
        if (block === B.AIR && y <= SEA_LEVEL) block = B.WATER;

        // Carve caves out of stone/dirt (not bedrock, not underwater fill).
        if ((block === B.STONE || block === B.DIRT) && y > 2 && y < h - 1) {
          const c1 = noises.cave.perlin3(wx * 0.055, y * 0.09, wz * 0.055);
          const c2 = noises.caveB.perlin3(wx * 0.055 + 100, y * 0.09, wz * 0.055 + 100);
          // Intersection of two tunnels -> "spaghetti" caves.
          if (Math.abs(c1) < 0.07 && Math.abs(c2) < 0.09) block = B.AIR;
          // Larger cheese caverns deep down.
          else if (y < 40 && noises.cave.fbm3(wx * 0.03, y * 0.04, wz * 0.03, 3) > 0.68) block = B.AIR;
        }

        // Ore placement (only in stone).
        if (block === B.STONE) {
          const r = hash3(wx, y, wz, seed ^ 0x0defabc);
          if (y < 15 && r < 0.0016) block = B.DIAMOND_ORE;
          else if (y < 32 && r < 0.004) block = B.GOLD_ORE;
          else if (y < 64 && r < 0.012) block = B.IRON_ORE;
          else if (y < 128 && r < 0.02) block = B.COAL_ORE;
        }

        data[chunkIndex(x, y, z)] = block;
      }
    }
  }

  // Trees — restricted to the chunk interior so canopies never spill across a
  // not-yet-generated chunk boundary.
  for (let x = 2; x < CHUNK_SIZE - 2; x++) {
    for (let z = 2; z < CHUNK_SIZE - 2; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = columnHeight(noises, wx, wz);
      if (h <= SEA_LEVEL + 1) continue; // no beach trees
      if (data[chunkIndex(x, h, z)] !== B.GRASS) continue;
      if (hash3(wx, 7, wz, seed ^ 0x77ee5) > 0.018) continue;
      placeTree(data, x, h + 1, z, seed, wx, wz);
    }
  }
}

function placeTree(data, x, baseY, z, seed, wx, wz) {
  const trunk = 4 + Math.floor(hash3(wx, 1, wz, seed ^ 0xabc) * 3); // 4..6
  const topY = baseY + trunk;
  if (topY + 1 >= WORLD_HEIGHT) return;

  // Leaves: two full 5x5 layers, then a 3x3, then a plus on top.
  for (let ly = topY - 2; ly <= topY; ly++) {
    const radius = ly >= topY ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        // Trim the corners of the widest layers for a rounded look.
        if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if (hash3(wx + dx, ly, wz + dz, seed) < 0.4) continue;
        }
        const lx = x + dx;
        const lz = z + dz;
        if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) continue;
        const idx = chunkIndex(lx, ly, lz);
        if (data[idx] === B.AIR) data[idx] = B.LEAVES;
      }
    }
  }
  // Trunk (overwrites leaves in the centre).
  for (let y = baseY; y < topY; y++) {
    data[chunkIndex(x, y, z)] = B.LOG;
  }
}
