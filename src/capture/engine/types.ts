/**
 * Capture engine types (plan: capture/engine/types.ts).
 * Single source for the unified capture loop contract.
 */
import type { StitchChunk } from "../stitch/canvasStitcher";
import type { RangeSelection } from "@/messaging/events";
import type { MeasureResponse } from "@/messaging/events";

export interface CapturePlan {
  mode: "full-page" | "selected-area";
  positions: number[];
  selection?: RangeSelection;
  metrics?: MeasureResponse;
}

export interface CaptureLoopOptions {
  tabId: number;
  windowId?: number;
  mode: "full-page" | "selected-area";
  positions: number[];
  totalTimeout: number;
  controllerType?: string;
  /**
   * Per-chunk callback (invoked alongside progress sends). Engines use it to
   * heartbeat the global lock so long legitimate captures never hit the TTL.
   * Must be synchronous/fire-and-forget — never awaited by the loop.
   */
  onChunk?: (index: number) => void;
}

export interface CaptureLoopResult {
  chunks: StitchChunk[];
  perfScroll: number;
  perfCapture: number;
  /** True when scrolling stopped advancing and the loop exited before all positions. */
  stoppedEarly: boolean;
}

/**
 * Pure advance-check for the capture loop (exported for unit tests).
 * Compares against the last PUSHED chunk — never the loop index, since
 * skipped iterations leave gaps between `i` and `chunks.length`.
 */
export function checkAdvance(
  actualY: number,
  prevY: number | undefined,
  streak: number
): { action: "ok" | "skip" | "stop"; streak: number } {
  if (prevY === undefined || actualY > prevY) return { action: "ok", streak: 0 };
  const next = streak + 1;
  if (next >= 2) return { action: "stop", streak: next };
  return { action: "skip", streak: next };
}
