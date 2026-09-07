/**
 * Adaptive stepping (plan: capture/planner/adaptiveStep.ts).
 * Shared timeout + step helpers.
 */
import { CaptureError } from "@/types/capture";

export const MAX_POSITIONS = 300;
export const MIN_STEP_PX = 10;
export const MIN_OVERLAP_PX = 20;

/** Resolve a safe scroll step given viewport + occlusions. */
export function resolveStep(viewportHeight: number, occludedTop: number, occludedBottom: number): number {
  if (viewportHeight <= 0) throw new CaptureError("CAPTURE_FAILED", "Invalid viewport height.");
  return Math.max(MIN_STEP_PX, viewportHeight - occludedTop - occludedBottom);
}

/** Largest step that still keeps >= 20px overlap between viewports. */
export function maxSafeStep(viewportHeight: number): number {
  return Math.max(MIN_STEP_PX, viewportHeight - MIN_OVERLAP_PX);
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
