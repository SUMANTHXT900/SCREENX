/**
 * Pure box geometry for selection interactions (plan: content/selection).
 * DOM-free so it is unit-testable (see tests/boxMath.test.ts). The capture
 * path keeps its own defensive clamp in selectionManager.triggerCapture.
 */
import type { SelectionBox } from "./SelectionStateMachine";

export const MIN_BOX_SIZE = 12;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Keep a box inside the viewport (position only; size untouched). */
export function clampBoxToViewport(box: SelectionBox, vw: number, vh: number): SelectionBox {
  return {
    left: clamp(box.left, 0, Math.max(0, vw - 1)),
    top: clamp(box.top, 0, Math.max(0, vh - 1)),
    width: Math.max(1, Math.min(box.width, vw - Math.max(0, Math.min(box.left, vw - 1)))),
    height: Math.max(1, Math.min(box.height, vh - Math.max(0, Math.min(box.top, vh - 1)))),
  };
}

/** Move a box by a delta, keeping it inside the viewport. */
export function moveBox(box: SelectionBox, dx: number, dy: number, vw: number, vh: number): SelectionBox {
  return clampBoxToViewport(
    { left: box.left + dx, top: box.top + dy, width: box.width, height: box.height },
    vw,
    vh
  );
}

/** Resize the bottom-right corner by a delta (min size enforced). */
export function resizeBoxBR(box: SelectionBox, dx: number, dy: number, vw: number, vh: number): SelectionBox {
  return {
    left: box.left,
    top: box.top,
    width: clamp(Math.round(box.width + dx), MIN_BOX_SIZE, Math.max(MIN_BOX_SIZE, vw - box.left)),
    height: clamp(Math.round(box.height + dy), MIN_BOX_SIZE, Math.max(MIN_BOX_SIZE, vh - box.top)),
  };
}

/** Snap a box to full content width, keeping its vertical span. */
export function fullWidthBox(box: SelectionBox, vw: number): SelectionBox {
  return { left: 0, top: box.top, width: Math.max(MIN_BOX_SIZE, vw), height: box.height };
}
