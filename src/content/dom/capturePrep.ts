/**
 * Capture session lifecycle for the content script (plan: content/dom session).
 * Owns scroll save/restore + animation-freeze stylesheet.
 * Extracted from content/index.ts so the entry stays a thin dispatcher.
 */
import { getScrollController, type ScrollController } from "./scrollController";
import { removeProgressHud } from "../ui/progressHud";

let originalX = 0;
let originalY = 0;
let prepared = false;
let styleEl: HTMLStyleElement | null = null;
let scrollController: ScrollController | null = null;

export function prepareCapture(): { ok: true } {
  if (prepared) return { ok: true as const };
  // Prefer a pre-resolved controller (pinned by RESOLVE_CONTAINER) so capture
  // scrolls the exact element the selection was measured against.
  if (!scrollController) scrollController = getScrollController();
  originalX = scrollController.getScrollLeft();
  originalY = scrollController.getScrollTop();

  styleEl = document.createElement("style");
  styleEl.id = "__screenx_capture_style";
  styleEl.textContent = `
    html, body {
      scroll-behavior: auto !important;
      scroll-padding: 0 !important;
    }
    * {
      scroll-behavior: auto !important;
    }
    html.__screenx_capturing * {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
    }
  `;
  (document.head || document.documentElement).appendChild(styleEl);
  document.documentElement.classList.add("__screenx_capturing");
  prepared = true;
  return { ok: true as const };
}

export function restoreCapture(): { ok: true } {
  removeProgressHud();
  document.documentElement.classList.remove("__screenx_capturing");

  try {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  } catch {
    // ignore
  }
  styleEl = null;

  if (prepared && scrollController) {
    try {
      scrollController.setScrollTop(originalY);
      scrollController.setScrollLeft(originalX);
    } catch {
      try {
        window.scrollTo(originalX, originalY);
      } catch {
        // ignore
      }
    }
  }
  prepared = false;
  scrollController = null;
  return { ok: true as const };
}

export function getActiveScrollController(): ScrollController | null {
  return scrollController;
}

/**
 * Force-clear stale state from a previous capture that never cleanly
 * restored (e.g. a dropped SCREENX_RESTORE_CAPTURE round trip left
 * `prepared=true`). Called at the start of every new top-level capture so a
 * leftover flag can never silently poison this run (stale scroll readings,
 * dropped RESOLVE_CONTAINER pins, skipped animation-freeze). Safe to call on
 * a clean slate — every step is idempotent.
 */
export function resetCaptureState(): { ok: true } {
  try {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  } catch {
    // ignore
  }
  styleEl = null;
  try {
    document.documentElement.classList.remove("__screenx_capturing");
  } catch {
    // ignore
  }
  prepared = false;
  scrollController = null;
  return { ok: true as const };
}

/** Pin the scroll target (e.g. resolved from the selection box center). */
export function setActiveScrollController(controller: ScrollController | null): void {
  if (!prepared) scrollController = controller;
}

export function isCapturePrepared(): boolean {
  return prepared;
}
