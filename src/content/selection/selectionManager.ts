/**
 * Selection manager — thin orchestrator for drag-rectangle region selection
 * (plan: content/selection).
 * State → SelectionStateMachine.ts · overlay → selectionOverlay.ts ·
 * gestures → mouseTracker.ts.
 *
 * The box is viewport-relative; the range derives from live scroll readings
 * (startScrollTop at draw end, endScrollTop at handle release), so layout
 * shifts between gestures cannot corrupt it.
 */
import { findScrollContainerAt } from "../scroll/ScrollController.js";
import { waitForStableScroll } from "../scroll/scrollSettler.js";
import {
  resetSelectionState,
  selectionState,
  type SelectionBox,
} from "./SelectionStateMachine.js";
import {
  destroyOverlay,
  getOverlay,
  hideReviewBar,
  mountOverlay,
  moveReviewBar,
  paintBox,
  paintLabel,
  peekThrough,
  setGuides,
  setHandleExhausted,
  setHandlePulse,
  setHandleVisible,
  setOverlayBusy,
  setOverlayHintError,
  setOverlayStage,
  showMiniHint,
  showReviewBar,
  type OverlayRefs,
} from "./selectionOverlay.js";
import { trackDrawDrag, trackExtendDrag } from "./mouseTracker.js";
import { fullWidthBox, moveBox, resizeBoxBR } from "./boxMath.js";
import { loadLastBoxRange, saveLastBoxRange } from "./lastBox.js";

/** Resolves once the draw-end scroll readings are settled (see acceptDrawnBox). */
let resolvePending: Promise<void> | null = null;

function currentRefs(): OverlayRefs | null {
  return getOverlay();
}

function removeSelectionUI(): void {
  const cancel = selectionState.gestureCancel;
  selectionState.gestureCancel = null;
  try {
    cancel?.();
  } catch {
    // ignore
  }
  cancelExtends();
  try {
    dblCancel?.();
  } catch {
    // ignore
  }
  dblCancel = null;
  resolvePending = null;
  if (selectionState.keyHandler) {
    document.removeEventListener("keydown", selectionState.keyHandler, true);
    selectionState.keyHandler = null;
  }
  hideReviewBar();
  destroyOverlay();
  resetSelectionState();
  document.documentElement.style.removeProperty("cursor");
}

/** Cancels the extend trackers; the draw tracker stays armed for redraws. */
let extendCancel: (() => void) | null = null;
let extendTopCancel: (() => void) | null = null;
let dblCancel: (() => void) | null = null;

function cancelExtends(): void {
  for (const cancel of [extendCancel, extendTopCancel]) {
    try {
      cancel?.();
    } catch {
      // ignore
    }
  }
  extendCancel = null;
  extendTopCancel = null;
}

function paintCurrent(extra?: string): void {
  const refs = currentRefs();
  if (!refs) return;
  paintBox(refs, selectionState.box);
  paintLabel(refs, selectionState.box, extra);
}

async function resolveScrollTarget(): Promise<void> {
  const box = selectionState.box;
  if (!box) return;
  const restore = peekThrough();
  try {
    selectionState.scrollTarget = findScrollContainerAt(
      box.left + box.width / 2,
      Math.min(box.top + box.height / 2, window.innerHeight - 1)
    );
  } catch {
    selectionState.scrollTarget = null;
  } finally {
    restore();
  }
  // Never trust a mid-glide reading: the container often still drifts from
  // the user's own wheel scroll when the draw ends. A stale startScrollTop
  // shifts the ENTIRE captured range (same height, wrong place).
  try {
    const t = selectionState.scrollTarget;
    if (t) await withTimeoutGuard(waitForStableScroll(t), 600);
    selectionState.startScrollTop = t ? t.getScrollTop() : window.scrollY;
    selectionState.endScrollTop = selectionState.startScrollTop;
  } catch {
    try {
      const t = selectionState.scrollTarget;
      selectionState.startScrollTop = t ? t.getScrollTop() : window.scrollY;
      selectionState.endScrollTop = selectionState.startScrollTop;
    } catch {
      selectionState.startScrollTop = 0;
      selectionState.endScrollTop = 0;
    }
  }
}

/** Await with a hard cap so a restless page can never hang selection. */
function withTimeoutGuard(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

function scrollApi() {
  return {
    getTop: () => {
      try {
        return selectionState.scrollTarget?.getScrollTop() ?? window.scrollY;
      } catch {
        return window.scrollY;
      }
    },
    setTop: (y: number) => {
      try {
        if (selectionState.scrollTarget) selectionState.scrollTarget.setScrollTop(y);
        else window.scrollTo(0, y);
      } catch {
        // ignore — capture side verifies per strip
      }
    },
    maxTop: () => {
      try {
        return selectionState.scrollTarget?.getMaxScrollY() ?? 0;
      } catch {
        return 0;
      }
    },
    getLeft: () => {
      try {
        return selectionState.scrollTarget?.getScrollLeft() ?? window.scrollX;
      } catch {
        return window.scrollX;
      }
    },
  };
}

function describeTarget(): string {
  try {
    return selectionState.scrollTarget?.describe() ?? "window";
  } catch {
    return "window";
  }
}

/** Handle released — the full range is known, so capture starts now (never mid-drag). */
export async function triggerCapture(): Promise<void> {
  if (selectionState.state === "CAPTURING" || selectionState.state === "COMPLETED") return;
  const box0 = selectionState.box;
  const refs0 = currentRefs();
  if (!box0 || !refs0) return;

  // Defensive clamp into the viewport; the drag logic already keeps it inside.
  const clamped: SelectionBox = {
    left: Math.max(0, Math.min(box0.left, window.innerWidth - 1)),
    top: Math.max(0, Math.min(box0.top, window.innerHeight - 1)),
    width: Math.max(1, Math.min(box0.width, window.innerWidth - Math.max(0, box0.left))),
    height: Math.max(1, Math.min(box0.height, window.innerHeight - Math.max(0, box0.top))),
  };
  if (clamped.width < 12 || clamped.height < 12) {
    setOverlayHintError(refs0, "Selection too small — drag a bigger box");
    setTimeout(() => {
      const r = currentRefs();
      if (r && selectionState.state === "READY") setOverlayStage(r, 1, "That was just a click — drag a rectangle");
    }, 1200);
    return;
  }

  selectionState.state = "CAPTURING";
  hideReviewBar();
  setHandlePulse(refs0, false);
  setOverlayBusy(refs0, "Locking in selection…");

  // Wait for any in-flight draw-end resolve so readings are settled.
  try {
    await resolvePending;
  } catch {
    // ignore — readings fall back below
  }
  // The overlay may have been torn down while waiting (external cancel).
  const refs = currentRefs();
  const box = selectionState.box;
  if (selectionState.state !== "CAPTURING" || !refs || !box) {
    if (selectionState.state === "CAPTURING") selectionState.state = "IDLE";
    return;
  }

  try {
    // Settle-then-read, same as draw end: a container still gliding from
    // extend auto-scroll (or a stray wheel tick) would otherwise anchor the
    // range to a stale position.
    const t = selectionState.scrollTarget;
    if (t) await withTimeoutGuard(waitForStableScroll(t), 400);
    selectionState.endScrollTop = scrollApi().getTop();
  } catch {
    // keep last reading
  }
  const api = scrollApi();
  const selection = {
    boxLeft: Math.round(clamped.left),
    boxTop: Math.round(clamped.top),
    boxWidth: Math.round(clamped.width),
    boxHeight: Math.round(clamped.height),
    startScrollTop: Math.round(selectionState.startScrollTop),
    endScrollTop: Math.round(selectionState.endScrollTop),
    // Document X: the loop pins horizontal scroll to 0 every strip, and the
    // stitcher samples bitmap column (targetX − 0) showing container column
    // (targetX − Rl); wanting release column (scrollLeft + boxLeft − Rl) gives
    // targetX = boxLeft + scrollLeft. No rect term (see selectionRangeToTargets).
    x: Math.round(clamped.left + api.getLeft()),
    width: Math.round(clamped.width),
  };

  console.debug(
    "[ScreenX] region selected",
    JSON.stringify({ ...selection, scrollTarget: describeTarget() })
  );

  // Remember the horizontal span for next time (best-effort).
  saveLastBoxRange(clamped.left, clamped.width);

  selectionState.state = "CAPTURING";
  removeSelectionUI();
  selectionState.state = "COMPLETED";

  try {
    chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_COMPLETE", selection });
  } catch (e) {
    console.error("[ScreenX] failed to send selection complete", e);
  }
}

function armExtend(refs: OverlayRefs): void {
  cancelExtends();
  setHandleExhausted(refs, false);
  const api = scrollApi();
  const shared = {
    onBox: (b: SelectionBox) => {
      selectionState.box = b;
      if (selectionState.state === "READY") selectionState.state = "EXTENDING";
      setHandlePulse(refs, false);
      paintCurrent();
    },
  };
  extendCancel = trackExtendDrag(
    refs,
    selectionState.box ?? { left: 0, top: 0, width: 0, height: 0 },
    api,
    {
      ...shared,
      onScroll: (scrolled) => {
        // Computed live: startScrollTop may still be resolving when armed early.
        let total = 0;
        try {
          total =
            Math.max(0, Math.round(api.maxTop() - selectionState.startScrollTop)) +
            Math.round(selectionState.box?.height ?? 0);
        } catch {
          total = scrolled;
        }
        paintCurrent(`scrolled ${scrolled} / ${total} px`);
      },
      onExhausted: () => onExhausted(refs, api),
      onDone: () => {
        extendCancel = null;
        setHandleExhausted(refs, false);
        enterReview();
      },
    }
  );
  extendTopCancel = trackExtendDrag(
    refs,
    selectionState.box ?? { left: 0, top: 0, width: 0, height: 0 },
    api,
    {
      ...shared,
      onScroll: (scrolled) => {
        paintCurrent(`scrolled ${scrolled} px`);
      },
      onExhausted: () => onExhausted(refs, api),
      onDone: () => {
        extendTopCancel = null;
        setHandleExhausted(refs, false);
        enterReview();
      },
    },
    { upward: true }
  );
}

function onExhausted(
  refs: OverlayRefs,
  api: { maxTop: () => number }
): void {
  // Genuine end of scrollable content (not an unscrollable page): say
  // so instead of letting the user drag against a dead handle.
  try {
    if (api.maxTop() - selectionState.startScrollTop <= 0) return;
  } catch {
    return;
  }
  setHandleExhausted(refs, true);
  paintCurrent("end reached — release to capture");
}

/** Review beat: explicit Capture / Adjust instead of instant fire on release. */
function enterReview(): void {
  if (selectionState.state !== "EXTENDING" && selectionState.state !== "READY") return;
  selectionState.state = "REVIEW";
  const refs = currentRefs();
  const box = selectionState.box;
  if (!refs || !box) {
    selectionState.state = "IDLE";
    return;
  }
  setHandlePulse(refs, false);
  showMiniHint(refs, "Review — Enter ↵ to capture · drag to adjust");
  showReviewBar(refs, box, {
    onCapture: () => void triggerCapture(),
    onAdjust: () => backToReady(),
    onCancel: () => cancelSelectionMode(),
  });
  paintCurrent();
}

function backToReady(): void {
  if (selectionState.state !== "REVIEW") return;
  selectionState.state = "READY";
  const refs = currentRefs();
  hideReviewBar();
  if (!refs || !selectionState.box) return;
  setHandleExhausted(refs, false);
  showMiniHint(refs, "Box set — drag a handle ↕ to extend · Enter ↵ to capture");
  paintCurrent();
  armExtend(refs);
}

async function acceptDrawnBox(refs: OverlayRefs, drawn: SelectionBox): Promise<void> {
  selectionState.box = drawn;
  selectionState.state = "READY";
  hideReviewBar();
  setHandleVisible(refs, true);
  setHandlePulse(refs, true);
  setHandleExhausted(refs, false);
  setGuides(refs, null, null);
  showMiniHint(refs, "Box set — drag the handle ↓ to extend · Enter ↵ to capture");
  paintCurrent();
  // Arm the handle immediately so it never feels dead; the scroll-target
  // resolve below only fills in readings.
  armExtend(refs);
  resolvePending = (async () => {
    await resolveScrollTarget();
  })();
  try {
    await resolvePending;
  } catch {
    // ignore — readings fall back
  }
  // The user may have cancelled, redrawn, or fired capture during the wait —
  // only the latest committed box may proceed.
  if (currentRefs() !== refs) return;
  if (selectionState.state !== "READY") return;
  if (selectionState.box !== drawn) return;
  try {
    console.debug(
      "[ScreenX] selection drawn",
      JSON.stringify({
        box: {
          left: Math.round(drawn.left),
          top: Math.round(drawn.top),
          width: Math.round(drawn.width),
          height: Math.round(drawn.height),
        },
        scrollTarget: describeTarget(),
        startScrollTop: Math.round(selectionState.startScrollTop),
      })
    );
  } catch {
    // ignore
  }
  // Intentionally NOT re-armed: armExtend() already ran synchronously above,
  // and its scrollApi()/onScroll getters read selectionState live, so the
  // resolved container is already visible to the existing trackers.
  // Re-arming here calls cancelExtends() → finish(), which detaches the live
  // mousemove/mouseup listeners of a drag the user started during the
  // resolveScrollTarget() await above — silently killing the gesture
  // (mouse still down, no handlers attached, mousedown won't refire until
  // release + re-click). The guards above already return early whenever the
  // user interacted, so a re-arm could only ever fire when nothing changed.
}

export function enterSelectionMode(): void {
  if (selectionState.state !== "IDLE") removeSelectionUI();
  selectionState.state = "DRAWING";

  const refs = mountOverlay(() => cancelSelectionMode());
  setOverlayStage(refs, 1, "Drag a rectangle over the area to capture");
  document.documentElement.style.cursor = "crosshair";

  const keyHandler = (e: KeyboardEvent) => {
    if (selectionState.state === "IDLE" || selectionState.state === "CAPTURING" || selectionState.state === "COMPLETED") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelSelectionMode();
      return;
    }
    // Enter commits without extending: READY captures the drawn box as-is,
    // REVIEW confirms the reviewed box.
    if (e.key === "Enter") {
      if (selectionState.state === "READY" || selectionState.state === "REVIEW") {
        e.preventDefault();
        e.stopPropagation();
        void triggerCapture();
      }
      return;
    }
    // Arrow keys nudge the box (Shift = 10px); with Alt they resize the
    // bottom-right corner instead. Only when a box exists to adjust.
    if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") &&
      (selectionState.state === "READY" || selectionState.state === "REVIEW")
    ) {
      const box = selectionState.box;
      const refs = currentRefs();
      if (!box || !refs) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      selectionState.box = e.altKey ? resizeBoxBR(box, dx, dy, vw, vh) : moveBox(box, dx, dy, vw, vh);
      paintCurrent();
      moveReviewBar(refs, selectionState.box);
      return;
    }
    // W reuses the last capture's horizontal span (best-effort memory).
    if ((e.key === "w" || e.key === "W") && selectionState.state === "DRAWING" && !selectionState.box) {
      const refs = currentRefs();
      if (!refs) return;
      e.preventDefault();
      void loadLastBoxRange().then((saved) => {
        const r = currentRefs();
        if (!saved || !r || selectionState.state !== "DRAWING" || selectionState.box) return;
        const width = Math.max(12, Math.min(saved.width, window.innerWidth));
        const left = Math.max(0, Math.min(saved.left, window.innerWidth - width));
        const height = Math.round(window.innerHeight * 0.4);
        void acceptDrawnBox(r, {
          left,
          top: Math.round((window.innerHeight - height) / 2),
          width,
          height,
        });
      });
    }
  };
  document.addEventListener("keydown", keyHandler, true);
  selectionState.keyHandler = keyHandler;

  const drawCancel = trackDrawDrag(refs, {
    onBox: (b) => {
      // Live redraw preview; committed on release.
      if (selectionState.state !== "DRAWING" && selectionState.state !== "READY") return;
      selectionState.box = b;
      paintCurrent();
    },
    onCursor: (x, y) => {
      if (selectionState.state !== "DRAWING") return;
      setGuides(refs, x, y);
    },
    onDone: (drawn) => {
      // A fresh drag while READY means redraw: drop the old extend tracker.
      if (selectionState.state !== "DRAWING" && selectionState.state !== "READY") return;
      setGuides(refs, null, null);
      if (!drawn) {
        if (selectionState.state === "DRAWING") {
          selectionState.box = null;
          paintCurrent();
          const r = currentRefs();
          if (r) setOverlayStage(r, 1, "That was just a click — drag a rectangle");
        }
        return;
      }
      void acceptDrawnBox(refs, drawn);
    },
  });
  selectionState.gestureCancel = drawCancel;

  // Double-click snaps to full content width (keeps the vertical span).
  const onDblClick = () => {
    snapFullWidth();
  };
  refs.dim.addEventListener("dblclick", onDblClick);
  dblCancel = () => refs.dim.removeEventListener("dblclick", onDblClick);

  // Advertise width memory while the user is still drawing.
  void loadLastBoxRange().then((saved) => {
    const r = currentRefs();
    if (saved && r && selectionState.state === "DRAWING" && !selectionState.box) {
      setOverlayStage(r, 1, `Drag a rectangle · W for last width (${Math.round(saved.width)}px) · double-click for full width`);
    }
  });
}

/** Snap the current (or full-viewport) box to full content width. */
function snapFullWidth(): void {
  if (selectionState.state !== "DRAWING" && selectionState.state !== "READY") return;
  const refs = currentRefs();
  if (!refs) return;
  const base = selectionState.box ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  setGuides(refs, null, null);
  void acceptDrawnBox(refs, fullWidthBox(base, window.innerWidth));
}

export function cancelSelectionMode(): void {
  removeSelectionUI();
  try {
    chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_CANCEL" });
  } catch {
    // ignore
  }
}

/**
 * Silent teardown: removes the overlay WITHOUT messaging the worker. Used
 * when a newer trigger supersedes this run — the fresh START_SELECTION
 * replaces the UI, and a SELECTION_CANCEL reply could land in the NEW
 * waiter's listener and abort it instantly.
 */
export function dismissSelectionMode(): void {
  removeSelectionUI();
}
