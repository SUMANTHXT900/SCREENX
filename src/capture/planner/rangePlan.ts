/**
 * Range position planner (plan: capture/planner/rangePlan.ts).
 */
import { CaptureError } from "@/types/capture";
import { MAX_POSITIONS, maxSafeStep, resolveStep } from "./adaptiveStep";

export function planRangePositions(
  startY: number,
  endY: number,
  viewportHeight: number,
  maxScrollY?: number,
  maxPositions = MAX_POSITIONS,
  occludedTopHeight = 0,
  occludedBottomHeight = 0
): number[] {
  const rangeTop = Math.min(startY, endY);
  const rangeBottom = Math.max(startY, endY);
  const rangeHeight = rangeBottom - rangeTop;
  if (rangeHeight <= 0) throw new CaptureError("INVALID_SELECTION", "Invalid selection height.");

  let step = resolveStep(viewportHeight, occludedTopHeight, occludedBottomHeight);

  const clampedMaxScrollY =
    typeof maxScrollY === "number" && Number.isFinite(maxScrollY)
      ? Math.max(0, maxScrollY)
      : Number.MAX_SAFE_INTEGER;

  const required = Math.ceil(rangeHeight / step) + 1;
  if (required > maxPositions) {
    const adaptiveStep = Math.ceil(rangeHeight / (maxPositions - 1));
    if (adaptiveStep <= maxSafeStep(viewportHeight)) {
      step = adaptiveStep;
    } else {
      throw new CaptureError(
        "PAGE_TOO_LARGE",
        `Selected range requires ${required} viewports — exceeds ${maxPositions} limit. Choose a smaller range.`
      );
    }
  }

  const positions: number[] = [];
  const startScrollY = Math.max(0, rangeTop - occludedTopHeight);
  let currentY = Math.min(startScrollY, clampedMaxScrollY);
  positions.push(currentY);

  while (currentY + occludedTopHeight + step < rangeBottom && positions.length < maxPositions) {
    const nextY = Math.min(currentY + step, clampedMaxScrollY);
    if (nextY === currentY) break;
    positions.push(nextY);
    currentY = nextY;
  }

  const lastY = positions[positions.length - 1]!;
  if (lastY + viewportHeight - occludedBottomHeight < rangeBottom && lastY < clampedMaxScrollY && positions.length < maxPositions) {
    const finalY = Math.min(rangeBottom - viewportHeight + occludedBottomHeight, clampedMaxScrollY);
    if (finalY > lastY) positions.push(finalY);
  }

  if (positions.length > maxPositions) {
    throw new CaptureError("PAGE_TOO_LARGE", `Selected range requires ${positions.length} viewports — exceeds ${maxPositions} limit.`);
  }

  return positions;
}


/**
 * Convert a viewport-relative selection box + per-gesture scroll readings
 * into stitch target rows.
 *
 * Frame invariant (do NOT "correct" with container rect offsets): the loop
 * scrolls the container to absolute s and each chunk bitmap row r shows
 * container row s + (r − Rt), where Rt is the container's viewport offset.
 * The stitcher samples bitmap row (T − s) for target T, i.e. it shows
 * container row (T − Rt). The selected content at box row b is container row
 * (S + b − Rt). Setting T = S + b makes those equal — the −Rt terms cancel
 * because selection and stitching share one frame. Subtracting rect offsets
 * here double-counts and shifts output by exactly that offset (left-extra /
 * right-cropped horizontally, shifted-up vertically on nested pages).
 */
export function selectionRangeToTargets(
  boxTop: number,
  boxHeight: number,
  startScrollTop: number,
  endScrollTop: number
): { startY: number; endY: number } {
  const top = Math.min(startScrollTop, endScrollTop) + boxTop;
  const bottom = Math.max(startScrollTop, endScrollTop) + boxTop + boxHeight;
  return { startY: top, endY: bottom };
}