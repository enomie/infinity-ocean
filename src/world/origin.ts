/**
 * Floating origin. Everything rendered/simulated uses LOCAL coordinates
 * (absolute − ORIGIN) so float32 on the GPU stays precise no matter how far
 * the player travels. Absolute positions only exist in JS doubles.
 */
export const ORIGIN = { x: 0, z: 0 };

/** distance from origin (local) after which the world is re-centred */
export const SHIFT_THRESHOLD = 1500;
/** shifts are snapped to this grid */
export const SHIFT_SNAP = 512;
