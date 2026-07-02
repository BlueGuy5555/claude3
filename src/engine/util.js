// ---------------------------------------------------------------------------
// util.js — tiny shared helpers used by world storage and generation.
// Pure (no DOM / Three.js).
// ---------------------------------------------------------------------------

import { CHUNK_SIZE, WORLD_HEIGHT } from './constants.js';

// Flat index into a chunk's Uint8Array. Layout is column-major in Y so that a
// vertical scan (common for physics/lighting) is cache friendly.
export function chunkIndex(x, y, z) {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Cheap, deterministic 3D hash returning a float in [0, 1). Used for ore and
// tree placement so a world regenerates identically from its seed.
export function hash3(x, y, z, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Chunk key for maps.
export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

// Floor division / modulo that work for negative coordinates.
export function floorDiv(a, b) {
  return Math.floor(a / b);
}
export function mod(a, b) {
  return ((a % b) + b) % b;
}
