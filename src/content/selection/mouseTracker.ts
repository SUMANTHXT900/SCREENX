/**
 * Mouse + touch tracker — rectangle draw drag + handle extend drag with ramped
 * edge auto-scroll (plan: content/selection/mouseTracker.ts).
 * The box never moves: only its bottom edge follows the cursor while content
 * scrolls beneath it.
 *
 * Pointer input is handled through parallel mouse and touch listeners sharing
 * one core per gesture. Touch handlers preventDefault (non-passive), which
 * also suppresses the compatibility mouse events Chrome would otherwise fire.
 */
import type { OverlayRefs } from "./selectionOverlay";
import type { SelectionBox } from "./SelectionStateMachine";

const EDGE_ZONE = 120; // px from viewport edge where auto-scroll kicks in
const SLOW_SPEED = 2; // px/frame at the zone edge
const FAST_SPEED = 35; // px/frame at the screen edge
const MIN_DRAG = 12; // smaller drags count as stray clicks
const MIN_BOX_HEIGHT = 40;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function firstTouch(e: TouchEvent): { x: number; y: number } | null {
  const t = e.touches[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}

export interface DrawCallbacks {
  onBox: (box: SelectionBox) => void;
  onCursor: (x: number, y: number) => void;
  onDone: (box: SelectionBox | null) => void;
}

/** Left-drag (or one-finger touch drag) draws a rectangle from anchor to cursor. */
export function trackDrawDrag(refs: OverlayRefs, cb: DrawCallbacks): () => void {
  let anchor: { x: number; y: number } | null = null;
  let box: SelectionBox | null = null;

  const moveTo = (x: number, y: number) => {
    if (!anchor) return;
    box = {
      left: Math.min(anchor.x, x),
      top: Math.min(anchor.y, y),
      width: Math.abs(x - anchor.x),
      height: Math.abs(y - anchor.y),
    };
    cb.onBox(box);
    cb.onCursor(x, y);
  };

  const finishUp = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("touchmove", onTouchMove, { capture: true } as AddEventListenerOptions);
    document.removeEventListener("touchend", onTouchEnd, true);
    document.removeEventListener("touchcancel", onTouchEnd, true);
    const done = box && box.width >= MIN_DRAG && box.height >= MIN_DRAG ? box : null;
    box = null;
    anchor = null;
    cb.onDone(done);
  };

  const onMove = (e: MouseEvent) => {
    moveTo(e.clientX, e.clientY);
  };
  const onUp = () => {
    finishUp();
  };
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    // Handle presses belong to the extend gestures (separate listeners, capture phase).
    const target = e.target as HTMLElement | null;
    if (target === refs.handle || target === refs.handleTop) return;
    e.preventDefault();
    anchor = { x: e.clientX, y: e.clientY };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (anchor) return;
    const target = e.target as HTMLElement | null;
    if (target === refs.handle || target === refs.handleTop) return;
    const p = firstTouch(e);
    if (!p) return;
    e.preventDefault();
    anchor = p;
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", onTouchEnd, true);
    document.addEventListener("touchcancel", onTouchEnd, true);
  };
  const onTouchMove = (e: TouchEvent) => {
    const p = firstTouch(e);
    if (!p) return;
    e.preventDefault();
    moveTo(p.x, p.y);
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length > 0) return;
    finishUp();
  };

  refs.dim.addEventListener("mousedown", onDown);
  refs.dim.addEventListener("touchstart", onTouchStart, { passive: false });
  return () => {
    refs.dim.removeEventListener("mousedown", onDown);
    refs.dim.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("touchmove", onTouchMove, true);
    document.removeEventListener("touchend", onTouchEnd, true);
    document.removeEventListener("touchcancel", onTouchEnd, true);
  };
}

export interface ExtendApi {
  getTop: () => number;
  setTop: (y: number) => void;
  maxTop: () => number;
}

export interface ExtendCallbacks {
  onBox: (box: SelectionBox) => void;
  onScroll: (scrolledPx: number, startTop: number) => void;
  onExhausted: () => void;
  onDone: () => void;
}

export interface ExtendOptions {
  /** Grow from the top edge (auto-scrolls upward near the viewport top). */
  upward?: boolean;
}

/**
 * Handle drag extends the box downward. Near the viewport bottom the scroll
 * target auto-scrolls under the fixed box (ramped 2→35px/frame). Capture
 * starts on release — never during the drag (rate limits would leave gaps).
 * With `{ upward: true }` the top edge moves instead (auto-scroll upward).
 */
export function trackExtendDrag(
  refs: OverlayRefs,
  initial: SelectionBox,
  api: ExtendApi,
  cb: ExtendCallbacks,
  opts: ExtendOptions = {}
): () => void {
  const upward = opts.upward === true;
  const handle = upward ? refs.handleTop : refs.handle;
  // The anchored edge never moves: bottom for downward, top for upward.
  const anchorEdge = upward ? initial.top + initial.height : initial.top;
  let box: SelectionBox = { ...initial };
  let pointerY = 0;
  let frame: number | null = null;
  let done = false;
  let exhaustedSignalled = false;
  const startTop = api.getTop();

  const step = () => {
    frame = null;
    if (done) return;
    if (upward) {
      if (pointerY < EDGE_ZONE) {
        const ramp = clamp((EDGE_ZONE - pointerY) / EDGE_ZONE, 0, 1);
        const speed = SLOW_SPEED + ramp * (FAST_SPEED - SLOW_SPEED);
        const current = api.getTop();
        const next = Math.max(current - speed, 0);
        if (next < current) {
          api.setTop(next);
          cb.onScroll(Math.round(next - startTop), startTop);
        } else if (!exhaustedSignalled) {
          exhaustedSignalled = true;
          cb.onExhausted();
        }
      }
    } else {
      const distanceToBottom = window.innerHeight - pointerY;
      if (distanceToBottom < EDGE_ZONE) {
        const ramp = clamp((EDGE_ZONE - distanceToBottom) / EDGE_ZONE, 0, 1);
        const speed = SLOW_SPEED + ramp * (FAST_SPEED - SLOW_SPEED);

        const current = api.getTop();
        const max = api.maxTop();
        if (max > 1 && current >= max && !exhaustedSignalled) {
          exhaustedSignalled = true;
          cb.onExhausted();
        }
        const next = Math.min(current + speed, max);
        if (next > current) {
          api.setTop(next);
          cb.onScroll(Math.round(next - startTop), startTop);
        }
      }
    }
    frame = requestAnimationFrame(step);
  };

  const moveTo = (clientY: number) => {
    pointerY = clientY;
    if (upward) {
      const top = clamp(clientY, 0, anchorEdge - MIN_BOX_HEIGHT);
      box = { ...box, top, height: anchorEdge - top };
    } else {
      const bottom = clamp(clientY, box.top + MIN_BOX_HEIGHT, window.innerHeight);
      box = { ...box, height: bottom - box.top };
    }
    cb.onBox(box);
  };

  const finish = () => {
    done = true;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("touchmove", onTouchMove, { capture: true } as AddEventListenerOptions);
    document.removeEventListener("touchend", onTouchEnd, true);
    document.removeEventListener("touchcancel", onTouchEnd, true);
  };

  const finishUp = () => {
    finish();
    cb.onDone();
  };

  const onMove = (e: MouseEvent) => {
    moveTo(e.clientY);
  };
  const onUp = () => {
    finishUp();
  };
  const onTouchMove = (e: TouchEvent) => {
    const p = firstTouch(e);
    if (!p) return;
    e.preventDefault();
    moveTo(p.y);
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length > 0) return;
    finishUp();
  };

  const begin = (clientY: number) => {
    pointerY = clientY;
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", onTouchEnd, true);
    document.addEventListener("touchcancel", onTouchEnd, true);
    frame = requestAnimationFrame(step);
  };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    begin(e.clientY);
  };
  const onTouchStart = (e: TouchEvent) => {
    const p = firstTouch(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    begin(p.y);
  };

  handle.addEventListener("mousedown", onDown, true);
  handle.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
  return () => {
    handle.removeEventListener("mousedown", onDown, true);
    handle.removeEventListener("touchstart", onTouchStart, true);
    finish();
  };
}

export { MIN_DRAG };
