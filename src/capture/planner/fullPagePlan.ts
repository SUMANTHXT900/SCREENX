/**
 * Full-page position planner (plan: capture/planner/fullPagePlan.ts).
 */
import { CaptureError } from "@/types/capture";
import { MAX_POSITIONS, resolveStep } from "./adaptiveStep";

export function planFullPagePositions(
  totalHeight: number,
  viewportHeight: number,
  maxScrollY: number,
  maxPositions = MAX_POSITIONS,
  occludedTopHeight = 0,
  occludedBottomHeight = 0
): number[] {
  let step = resolveStep(viewportHeight, occludedTopHeight, occludedBottomHeight);

  const required = Math.ceil(totalHeight / step);
  if (required > maxPositions) {
    const adaptiveStep = Math.ceil(totalHeight / maxPositions);
    // The adaptive step must ALSO respect occlusions: a step larger than the
    // occlusion-safe step silently drops (top + bottom − overlap) rows per
    // seam. If even the safe step needs more chunks, fail loudly — a gappy
    // stitch must never pass as success.
    if (adaptiveStep <= resolveStep(viewportHeight, occludedTopHeight, occludedBottomHeight)) {
      step = adaptiveStep;
    } else {
      throw new CaptureError(
        "PAGE_TOO_LARGE",
        `Page requires ${required} viewports — exceeds ${maxPositions} limit. Try a shorter page or selected range.`
      );
    }
  }

  const positions: number[] = [];
  for (let y = 0; y < totalHeight; y += step) {
    const clamped = Math.min(y, maxScrollY);
    if (positions.length === 0 || positions[positions.length - 1] !== clamped) {
      positions.push(clamped);
    }
    if (positions.length >= maxPositions) break;
  }
  if (positions.length > 0 && positions[positions.length - 1] !== maxScrollY && totalHeight > viewportHeight) {
    if (positions.length < maxPositions) {
      const last = positions[positions.length - 1];
      if (last !== maxScrollY) positions.push(maxScrollY);
    }
  }
  if (positions.length > maxPositions) {
    throw new CaptureError("PAGE_TOO_LARGE", `Page requires ${positions.length} viewports — exceeds ${maxPositions} limit.`);
  }
  return positions;
}
