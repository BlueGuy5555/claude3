// ---------------------------------------------------------------------------
// chunkMesher.js
//
// Turns a chunk's block array into Three.js geometry. We do face culling: a
// cube face is emitted only when its neighbour is air or a different
// transparent block (see blocks.shouldDrawFace). Faces are baked with a
// directional "fake AO" shade (top brightest, bottom darkest) written into a
// vertex-colour attribute so terrain reads as 3D even under flat lighting.
//
// Three geometries are produced per chunk:
//   opaque      — normal terrain (stone, dirt, wood, ores, leaves...)
//   cutout      — alpha-tested blocks (glass) and the torch prop
//   water       — translucent water
//
// Uses Three.js (not unit-tested; validated via build + in-browser).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants.js';
import { B, BLOCKS, shouldDrawFace, isCube } from './blocks.js';
import { TILES } from './textures.js';

// Face table (verified winding for THREE.FrontSide). Maps to block tile keys.
const FACES = [
  { tileKey: 'west', dir: [-1, 0, 0], shade: 0.6, corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] } ] },
  { tileKey: 'east', dir: [1, 0, 0], shade: 0.6, corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] } ] },
  { tileKey: 'bottom', dir: [0, -1, 0], shade: 0.5, corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] } ] },
  { tileKey: 'top', dir: [0, 1, 0], shade: 1.0, corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] } ] },
  { tileKey: 'north', dir: [0, 0, -1], shade: 0.8, corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
    { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] } ] },
  { tileKey: 'south', dir: [0, 0, 1], shade: 0.8, corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
    { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] } ] },
];

const WATER_SET = new Set([B.WATER]);
const CUTOUT_SET = new Set([B.GLASS]);

// Accumulator for one geometry.
function newBuf() {
  return { pos: [], uv: [], col: [], idx: [], count: 0 };
}

function pushFace(buf, bx, by, bz, face, tile, shadeMul) {
  const { pos, uv, col, idx } = buf;
  const base = buf.count;
  const su = tile.u1 - tile.u0;
  const sv = tile.v1 - tile.v0;
  for (const c of face.corners) {
    pos.push(bx + c.pos[0], by + c.pos[1], bz + c.pos[2]);
    uv.push(tile.u0 + c.uv[0] * su, tile.v0 + c.uv[1] * sv);
    const s = face.shade * shadeMul;
    col.push(s, s, s);
  }
  idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  buf.count += 4;
}

function tileFor(block, tileKey) {
  const name = block.tiles[tileKey] || block.tiles.side || 'missing';
  return TILES[name] || TILES.missing;
}

function toGeometry(buf) {
  if (buf.count === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  g.setIndex(buf.idx);
  g.computeVertexNormals();
  return g;
}

// Build geometries for chunk (cx, cz). Requires neighbour chunks to exist for
// correct border culling — the caller ensures that.
export function buildChunkGeometries(world, cx, cz) {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return { opaque: null, cutout: null, water: null };
  // Ensure neighbours exist so border faces cull correctly.
  world.ensureChunk(cx - 1, cz);
  world.ensureChunk(cx + 1, cz);
  world.ensureChunk(cx, cz - 1);
  world.ensureChunk(cx, cz + 1);

  const opaque = newBuf();
  const cutout = newBuf();
  const water = newBuf();
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.get(x, y, z);
        if (id === B.AIR) continue;
        const block = BLOCKS[id];
        if (!block) continue;

        // Torch: small cross-less prop instead of a full cube.
        if (!isCube(id)) {
          pushTorch(cutout, x, y, z, block);
          continue;
        }

        const target = WATER_SET.has(id) ? water : CUTOUT_SET.has(id) ? cutout : opaque;
        for (const face of FACES) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          // Neighbour block (cross chunk boundaries via world lookup).
          const neighbour =
            nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE
              ? world.getBlock(ox + nx, ny, oz + nz)
              : chunk.get(nx, ny, nz);
          if (!shouldDrawFace(id, neighbour)) continue;
          // Water only renders its top surface + faces against air.
          pushFace(target, x, y, z, face, tileFor(block, face.tileKey), 1);
        }
      }
    }
  }

  return {
    opaque: toGeometry(opaque),
    cutout: toGeometry(cutout),
    water: toGeometry(water),
  };
}

// A torch: a slim 4-sided post standing on the block floor.
function pushTorch(buf, x, y, z, block) {
  const tile = TILES[block.tiles.top] || TILES.missing;
  const w = 0.125; // half-width 0.0625 -> actually width 0.125
  const hw = 0.0625;
  const h = 0.625;
  const cx = x + 0.5, cz = z + 0.5, by = y;
  const minX = cx - hw, maxX = cx + hw, minZ = cz - hw, maxZ = cz + hw, maxY = by + h;
  // Four side quads + top.
  const quads = [
    // +x
    [[maxX, maxY, minZ], [maxX, by, minZ], [maxX, maxY, maxZ], [maxX, by, maxZ]],
    // -x
    [[minX, maxY, maxZ], [minX, by, maxZ], [minX, maxY, minZ], [minX, by, minZ]],
    // +z
    [[minX, maxY, maxZ], [minX, by, maxZ], [maxX, maxY, maxZ], [maxX, by, maxZ]].reverse(),
    // -z
    [[minX, maxY, minZ], [minX, by, minZ], [maxX, maxY, minZ], [maxX, by, minZ]],
    // top
    [[minX, maxY, maxZ], [maxX, maxY, maxZ], [minX, maxY, minZ], [maxX, maxY, minZ]],
  ];
  const uvC = [[0, 1], [0, 0], [1, 1], [1, 0]];
  for (const q of quads) {
    const base = buf.count;
    const su = tile.u1 - tile.u0, sv = tile.v1 - tile.v0;
    for (let i = 0; i < 4; i++) {
      buf.pos.push(q[i][0], q[i][1], q[i][2]);
      buf.uv.push(tile.u0 + uvC[i][0] * su, tile.v0 + uvC[i][1] * sv);
      buf.col.push(1, 1, 1);
    }
    buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    buf.count += 4;
  }
}
