// ---------------------------------------------------------------------------
// constants.js
//
// Physics and world constants. The movement/physics values are chosen to match
// Minecraft: Java Edition. Minecraft runs its physics on a fixed 20 ticks-per-
// second simulation where "one block" == "one metre" and velocities are stored
// in blocks-per-tick. We reproduce that here so movement *feels* identical.
//
// A note on units: everything physics-related below is expressed in
// blocks-per-tick or blocks-per-tick^2 (the native Minecraft units), and the
// simulation steps at a fixed 50 ms per tick. Multiply a blocks/tick value by
// TPS (20) to get blocks/second.
// ---------------------------------------------------------------------------

export const TPS = 20;                 // ticks per second (fixed simulation step)
export const TICK_SECONDS = 1 / TPS;   // 0.05 s == 50 ms

// --- World dimensions -------------------------------------------------------
export const CHUNK_SIZE = 16;          // blocks along X and Z of one chunk
export const WORLD_HEIGHT = 128;       // total build height in blocks
export const SEA_LEVEL = 62;           // water surface height (Java uses 62/63)

// --- Player body (Java exact) ----------------------------------------------
export const PLAYER_WIDTH = 0.6;       // AABB footprint (0.6 x 0.6)
export const PLAYER_HEIGHT = 1.8;      // standing collision box height
export const PLAYER_EYE_HEIGHT = 1.62; // camera height while standing
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const PLAYER_SNEAK_EYE_HEIGHT = 1.27; // camera height while sneaking

// --- Vertical motion (Java exact) ------------------------------------------
// Each tick while airborne: vy = (vy - GRAVITY) * VERTICAL_DRAG
export const GRAVITY = 0.08;           // blocks/tick^2
export const VERTICAL_DRAG = 0.98;     // per-tick multiplier
export const JUMP_VELOCITY = 0.42;     // initial upward vy on jump (reaches ~1.252 blocks)
export const SPRINT_JUMP_BOOST = 0.2;  // extra forward velocity on a sprint-jump

// --- Horizontal motion ------------------------------------------------------
// Minecraft applies a friction multiplier to horizontal velocity each tick and
// then adds an acceleration in the wished direction. The steady-state speed is
// accel / (1 - friction). The default block slipperiness is 0.6 and the base
// air/ground drag is 0.91, so ground friction = 0.6 * 0.91 = 0.546.
export const GROUND_SLIPPERINESS = 0.6;
export const BASE_DRAG = 0.91;
export const GROUND_FRICTION = GROUND_SLIPPERINESS * BASE_DRAG; // 0.546
export const AIR_FRICTION = BASE_DRAG;                          // 0.91

// Ground accelerations tuned so steady-state horizontal speed matches Java:
//   walk   = 4.317 blocks/s  ->  0.215850 blocks/tick
//   sprint = 5.612 blocks/s  ->  0.280600 blocks/tick
//   sneak  = 1.295 blocks/s  ->  0.064750 blocks/tick
// accel = targetPerTick * (1 - GROUND_FRICTION)
export const ACCEL_WALK = 0.09800;    // -> ~4.317 b/s
export const ACCEL_SPRINT = 0.12739;  // -> ~5.612 b/s
export const ACCEL_SNEAK = 0.02940;   // -> ~1.295 b/s

// Air control is much weaker (friction 0.91). Steady state ~ accel / 0.09.
export const ACCEL_AIR = 0.02;
export const ACCEL_AIR_SPRINT = 0.026;

// --- Creative flight --------------------------------------------------------
// Creative flight ignores gravity. Default fly speed is ~10.92 b/s and doubles
// while sprinting. Friction while flying is 0.91 on all axes.
export const FLY_FRICTION = 0.91;
export const ACCEL_FLY = 0.049;        // -> ~10.9 b/s
export const ACCEL_FLY_SPRINT = 0.098; // -> ~21.8 b/s
export const DOUBLE_TAP_MS = 300;      // window to double-tap space to toggle fly

// --- Collision / step -------------------------------------------------------
export const STEP_HEIGHT = 0.6;        // auto-step height (Java auto-steps 0.6)
export const FALL_DAMAGE_THRESHOLD = 3;// blocks fallen before damage begins

// --- Survival stats ---------------------------------------------------------
export const MAX_HEALTH = 20;          // 10 hearts
export const MAX_HUNGER = 20;          // 10 drumsticks
export const MAX_AIR = 300;            // ticks of breath underwater (15 s)

// --- Interaction ------------------------------------------------------------
export const REACH_SURVIVAL = 4.5;     // block reach in survival
export const REACH_CREATIVE = 5.0;     // block reach in creative

// --- Day/night cycle --------------------------------------------------------
export const DAY_LENGTH_TICKS = 24000; // Minecraft day is 24000 ticks (20 min)

// --- Furnace ----------------------------------------------------------------
export const SMELT_TICKS = 200;        // 10 s to smelt one item (Java)
