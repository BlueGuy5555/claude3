// ---------------------------------------------------------------------------
// world.js
//
// Chunk storage and block access. A chunk is a Uint8Array of block ids. Chunks
// are generated lazily and cached in a Map keyed by "cx,cz". Setting a block
// marks its chunk (and, on a border, the neighbour) dirty so the renderer can
// rebuild only the affected meshes.
//
// Tile-entity state (furnace contents/progress) lives in a separate map keyed
// by "x,y,z".
//
// Pure (no DOM / Three.js) so world logic is unit-testable.
// ---------------------------------------------------------------------------

import { CHUNK_SIZE, WORLD_HEIGHT } from './constants.js';
import { B } from './blocks.js';
import { chunkIndex, chunkKey, floorDiv, mod, CHUNK_VOLUME } from './util.js';
import { makeNoises, generateChunkData, columnHeight } from './worldgen.js';

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_VOLUME);
    this.dirty = true;       // needs a mesh rebuild
    this.generated = false;
  }
  get(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return B.AIR;
    return this.data[chunkIndex(x, y, z)];
  }
  set(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.data[chunkIndex(x, y, z)] = id;
    this.dirty = true;
  }
}

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.noises = makeNoises(seed);
    this.chunks = new Map();
    this.tileEntities = new Map(); // "x,y,z" -> furnace state, etc.
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    if (!chunk.generated) {
      generateChunkData(chunk.data, cx, cz, this.noises);
      chunk.generated = true;
      chunk.dirty = true;
    }
    return chunk;
  }

  // World-coordinate block get. Returns AIR outside the vertical range.
  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return B.AIR;
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.generated) return B.AIR;
    return chunk.get(mod(x, CHUNK_SIZE), y, mod(z, CHUNK_SIZE));
  }

  // Like getBlock but generates the chunk on demand (used by physics near the
  // player where chunks are guaranteed loaded anyway).
  getBlockGen(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return B.AIR;
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    return chunk.get(mod(x, CHUNK_SIZE), y, mod(z, CHUNK_SIZE));
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const lx = mod(x, CHUNK_SIZE);
    const lz = mod(z, CHUNK_SIZE);
    chunk.set(lx, y, lz, id);
    // Mark neighbouring chunks dirty if we touched a border column.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    // Clear stale tile entity when the block changes away from a container.
    if (id !== B.FURNACE) this.tileEntities.delete(chunkKey(x, y) + ',' + z);
  }

  markDirty(cx, cz) {
    const chunk = this.getChunk(cx, cz);
    if (chunk) chunk.dirty = true;
  }

  // --- Tile entities --------------------------------------------------------
  tileKey(x, y, z) {
    return x + ',' + y + ',' + z;
  }
  getTileEntity(x, y, z) {
    return this.tileEntities.get(this.tileKey(x, y, z)) || null;
  }
  setTileEntity(x, y, z, state) {
    this.tileEntities.set(this.tileKey(x, y, z), state);
  }

  // --- Spawn helper ---------------------------------------------------------
  // Find a safe standing Y at a world column (top solid + 1).
  surfaceY(x, z) {
    const h = columnHeight(this.noises, x, z);
    return h + 1;
  }
}
