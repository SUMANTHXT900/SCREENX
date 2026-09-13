/**
 * Stitch hardware limits (plan: capture/stitch/limits.ts).
 * Single source for canvas + chunk constraints.
 */
export const MAX_TOTAL_HEIGHT = 65000;
export const MAX_CANVAS_PIXELS = 268_435_456;
export const MAX_CHUNKS = 300;
export const MAX_CANVAS_WIDTH = 32767;
/** Chrome's real max canvas dimension is 32767 (not 65535): planning taller
 *  parts passes limits then dies in convertToBlob/drawImage. Cap it here. */
export const MAX_CANVAS_HEIGHT = 32767;

/**
 * Top-strip rows reserved for the progress HUD (CSS px). The HUD stays
 * visible for the whole capture loop (constant, live-updating — never
 * blinking per exposure), and the stitcher discards exactly this band from
 * every strip except a top-anchored first chunk (whose single exposure hides
 * the HUD once). Keep the HUD's rendered height under this (currently ~64px;
 * 120 covers page zoom up to ~175%). Raising it costs ~1 extra chunk per
 * ~800px of page height.
 */
export const HUD_RESERVE_PX = 120;
