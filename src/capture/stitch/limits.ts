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
 * Legacy top-strip reserve for the progress HUD (CSS px). Kept for backward
 * compatibility; the capture loop now hides the HUD for EVERY exposure, so
 * new captures plan with a 0 reserve and never trim live rows to remove the
 * HUD. Trimming a fixed 120px band was the #1 seam-breakage source: whenever
 * the HUD rendered shorter than the reserve, 120−actual rows of real content
 * were deleted at every seam (cut sentences, white bands).
 * @deprecated Do not use for new planning — pass measured occlusion only.
 */
export const HUD_RESERVE_PX = 0;
