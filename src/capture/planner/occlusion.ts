/**
 * Occlusion helpers (plan: capture/planner).
 * Single source for fixed/sticky header-footer overlap math.
 * Previously duplicated in fullPage.ts:186-204 and selectedArea.ts:284-303.
 */
import type { FixedElementBox } from "@/messaging/events";

export interface Occlusion {
  top: number;
  bottom: number;
}

const MIN_WIDTH_RATIO = 0.35;
const MAX_OCCLUSION_RATIO = 0.25;

function isTopBar(rect: FixedElementBox, viewportHeight: number): boolean {
  return rect.top <= 0 && rect.bottom > 0 && rect.bottom < viewportHeight / 2;
}

function isBottomBar(rect: FixedElementBox, viewportHeight: number): boolean {
  return rect.bottom >= viewportHeight && rect.top > viewportHeight / 2 && rect.top < viewportHeight;
}

/** Full-page occlusion: element must span >= 35% of viewport width. */
export function computeFullPageOcclusion(
  fixedElements: FixedElementBox[] | undefined,
  viewportWidth: number,
  viewportHeight: number
): Occlusion {
  let top = 0;
  let bottom = 0;
  if (fixedElements) {
    for (const rect of fixedElements) {
      const elWidth = rect.right - rect.left;
      if (elWidth < viewportWidth * MIN_WIDTH_RATIO) continue;
      if (isTopBar(rect, viewportHeight)) top = Math.max(top, rect.bottom);
      if (isBottomBar(rect, viewportHeight)) bottom = Math.max(bottom, viewportHeight - rect.top);
    }
  }
  return {
    top: Math.min(top, viewportHeight * MAX_OCCLUSION_RATIO),
    bottom: Math.min(bottom, viewportHeight * MAX_OCCLUSION_RATIO),
  };
}

/** Selected-area occlusion: only elements overlapping the selection X-range count. */
export function computeRangeOcclusion(
  fixedElements: FixedElementBox[] | undefined,
  viewportHeight: number,
  selLeft: number,
  selRight: number
): Occlusion {
  let top = 0;
  let bottom = 0;
  if (fixedElements) {
    for (const rect of fixedElements) {
      if (rect.right <= selLeft || rect.left >= selRight) continue;
      if (isTopBar(rect, viewportHeight)) top = Math.max(top, rect.bottom);
      if (isBottomBar(rect, viewportHeight)) bottom = Math.max(bottom, viewportHeight - rect.top);
    }
  }
  return {
    top: Math.min(top, viewportHeight * MAX_OCCLUSION_RATIO),
    bottom: Math.min(bottom, viewportHeight * MAX_OCCLUSION_RATIO),
  };
}
