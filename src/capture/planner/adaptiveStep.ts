/**
 * Adaptive stepping (plan: capture/planner/adaptiveStep.ts).
 * Shared timeout + step helpers.
 */
import { CaptureError } from "@/types/capture";

export const MAX_POSITIONS = 300;
export const MIN_STEP_PX = 10;
/** Minimum overlap retained between consecutive viewport exposures. */
export const MIN_OVERLAP_PX = 150;
/** Keep a larger overlap on tall viewports so pixel alignment has texture. */
export const OVERLAP_RATIO = 0.2;

/** Resolve a safe scroll step while deliberately retaining overlap for stitching. */
export function resolveStep(viewportHeight: number, occludedTop: number, occludedBottom: number): number {
  if (viewportHeight <= 0) throw new CaptureError("CAPTURE_FAILED", "Invalid viewport height.");
  if (!Number.isFinite(occludedTop) || !Number.isFinite(occludedBottom) || occludedTop < 0 || occludedBottom < 0) {
    throw new CaptureError("CAPTURE_FAILED", "Invalid capture occlusion geometry.");
  }
  if (occludedTop + occludedBottom >= viewportHeight) {
    throw new CaptureError("CAPTURE_FAILED", "Capture overlays consume the entire viewport.");
  }
  const preferredOverlap = Math.max(MIN_OVERLAP_PX, Math.ceil(viewportHeight * OVERLAP_RATIO));
  const occlusionSafeOverlap = occludedTop + occludedBottom + 20;
  // On very short viewports, retain as much overlap as possible without
  // reducing the step below MIN_STEP_PX.
  const overlap = Math.min(viewportHeight - MIN_STEP_PX, Math.max(preferredOverlap, occlusionSafeOverlap));
  return Math.max(MIN_STEP_PX, viewportHeight - overlap);
}

/** Largest step that keeps the default alignment overlap on a viewport. */
export function maxSafeStep(viewportHeight: number): number {
  if (viewportHeight <= 0) return MIN_STEP_PX;
  const overlap = Math.min(viewportHeight - MIN_STEP_PX, Math.max(MIN_OVERLAP_PX, Math.ceil(viewportHeight * OVERLAP_RATIO)));
  return Math.max(MIN_STEP_PX, viewportHeight - overlap);
}

export function calculateTotalTimeout(
  numChunks: number,
  stabilizeMs = 160,
  captureIntervalMs = 600,
  overheadMs = 2000
): number {
  const perChunk = 3500 + stabilizeMs + captureIntervalMs;
  const estimated = numChunks * perChunk + overheadMs;
  return Math.max(15000, Math.min(600000, estimated + 5000));
}
