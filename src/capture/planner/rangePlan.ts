/**
 * Range position planner (plan: capture/planner/rangePlan.ts).
 */
import { CaptureError } from "@/types/capture";
import { MAX_POSITIONS, resolveStep } from "./adaptiveStep";

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
    // Same occlusion-safe rule as full-page: oversized steps drop seam rows.
    if (adaptiveStep <= resolveStep(viewportHeight, occludedTopHeight, occludedBottomHeight)) {
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
 * Frame model (explicit, no cancellation tricks): targets are TRUE scroller-
 * content rows. Viewport row b at scroll S shows content row S + (b − Rt),
 * where Rt is the scroller's viewport offset at selection time — so pass it
 * in and it is subtracted here. The stitcher maps targets back through the
 * PER-CHUNK rect (see projectSlice), which stays correct even if the page
 * scrolled between selection and capture. rectTopAtSelection defaults to 0
 * (window scroller) for backward compatibility.
 */
export function selectionRangeToTargets(
  boxTop: number,
  boxHeight: number,
  startScrollTop: number,
  endScrollTop: number,
  rectTopAtSelection = 0
): { startY: number; endY: number } {
  const top = Math.min(startScrollTop, endScrollTop) + boxTop - rectTopAtSelection;
  const bottom = Math.max(startScrollTop, endScrollTop) + boxTop + boxHeight - rectTopAtSelection;
  return { startY: top, endY: bottom };
}