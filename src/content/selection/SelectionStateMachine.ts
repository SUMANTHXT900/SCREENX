/**
 * Selection state machine — IDLE -> DRAWING -> READY -> EXTENDING -> REVIEW
 * -> CAPTURING -> COMPLETED (plan: content/selection/SelectionStateMachine.ts).
 * Pure state; DOM lives in selectionOverlay.ts / mouseTracker.ts.
 *
 * The box is viewport-relative (a fixed window on the screen); the capture
 * range derives from live scroll readings, never from stored document
 * coordinates — so layout shifts between gestures cannot corrupt it.
 */
import type { ScrollController } from "../scroll/ScrollController";

export type SelectionModeState =
  | "IDLE"
  | "DRAWING"
  | "READY"
  | "EXTENDING"
  | "REVIEW"
  | "CAPTURING"
  | "COMPLETED";

export interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectionInternalState {
  state: SelectionModeState;
  box: SelectionBox | null;
  /** Scroll container behind the box, resolved once per selection. */
  scrollTarget: ScrollController | null;
  startScrollTop: number;
  endScrollTop: number;
  keyHandler: ((e: KeyboardEvent) => void) | null;
  /** Cancels the in-flight draw/extend gesture listeners. */
  gestureCancel: (() => void) | null;
  /** rAF id of the auto-scroll loop, if running. */
  animationFrame: number | null;
}

export const selectionState: SelectionInternalState = {
  state: "IDLE",
  box: null,
  scrollTarget: null,
  startScrollTop: 0,
  endScrollTop: 0,
  keyHandler: null,
  gestureCancel: null,
  animationFrame: null,
};

/** Reset logical state without touching the DOM (manager removes nodes). */
export function resetSelectionState(): void {
  selectionState.state = "IDLE";
  selectionState.box = null;
  selectionState.scrollTarget = null;
  selectionState.startScrollTop = 0;
  selectionState.endScrollTop = 0;
  selectionState.keyHandler = null;
  selectionState.gestureCancel = null;
  selectionState.animationFrame = null;
}
