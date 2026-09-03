/**
 * Content Script — ScreenX capture engine
 * Supports visible, full-page, and cross-scroll selected-area (horizontal START/END)
 */

import { getScrollController, scrollToAndSettle, ScrollController } from "./dom/scrollController.js";
import { measurePage } from "./dom/occlusion.js";
import { updateProgressHud, hideProgressHud, showProgressHud, removeProgressHud, ProgressPayload } from "./ui/progressHud.js";
import { showToast, ToastOptions } from "./ui/toast.js";
import { enterSelectionMode, cancelSelectionMode } from "./selection/selectionManager.js";

console.debug("[ScreenX] content script loaded", {
  url: location.href,
  timestamp: Date.now(),
});

// Guard against double injection (for scripting fallback)
if ((window as unknown as { __screenXContentScriptLoaded?: boolean }).__screenXContentScriptLoaded) {
  console.debug("[ScreenX] content script already loaded, skipping");
} else {
  (window as unknown as { __screenXContentScriptLoaded: boolean }).__screenXContentScriptLoaded = true;

  let originalX = 0;
  let originalY = 0;
  let prepared = false;
  let styleEl: HTMLStyleElement | null = null;
  let scrollController: ScrollController | null = null;

  function prepareCapture(): { ok: true } {
    if (prepared) return { ok: true as const };
    scrollController = getScrollController();
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
    console.debug("[ScreenX] prepareCapture", JSON.stringify({ originalX, originalY, controller: scrollController.describe() }));
    return { ok: true as const };
  }

  function restoreCapture(): { ok: true } {
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
    console.debug("[ScreenX] restoreCapture", JSON.stringify({ originalX, originalY }));
    return { ok: true as const };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string })?.type;

    if (type === "PING_CONTENT") {
      sendResponse({ ok: true, url: location.href });
      return true;
    }

    (async () => {
      try {
        switch (type) {
          case "SCREENX_MEASURE_PAGE": {
            const m = measurePage();
            sendResponse(m);
            break;
          }
          case "SCREENX_PREPARE_CAPTURE": {
            const r = prepareCapture();
            sendResponse(r);
            break;
          }
          case "SCREENX_SCROLL_TO": {
            const { x, y } = message as { x: number; y: number };
            try {
              if (!prepared) prepareCapture();
              const r = await scrollToAndSettle(scrollController, Number(x) || 0, Number(y) || 0);
              sendResponse({ ok: true, ...r });
            } catch (e) {
              sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
            }
            break;
          }
          case "SCREENX_RESTORE_CAPTURE": {
            const r = restoreCapture();
            sendResponse(r);
            break;
          }
          case "SCREENX_START_SELECTION": {
            enterSelectionMode();
            sendResponse({ ok: true });
            break;
          }
          case "SCREENX_CANCEL_SELECTION": {
            cancelSelectionMode();
            try { chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_CANCEL" }); } catch {
            // ignore
          }
            sendResponse({ ok: true });
            break;
          }
          case "SCREENX_PROGRESS": {
            const p = (message as { progress?: ProgressPayload }).progress;
            if (p) {
              updateProgressHud(p);
            }
            sendResponse({ ok: true });
            break;
          }
          case "SCREENX_HIDE_PROGRESS": {
            hideProgressHud();
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  resolve();
                });
              });
            });
            sendResponse({ ok: true });
            break;
          }
          case "SCREENX_SHOW_PROGRESS": {
            showProgressHud();
            sendResponse({ ok: true });
            break;
          }
          case "SCREENX_TOAST": {
            const t = (message as { toast?: ToastOptions }).toast;
            if (t) {
              showToast(t);
            }
            sendResponse({ ok: true });
            break;
          }
          default:
            sendResponse({ error: `Unknown message type: ${type}` });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ScreenX] content handler error", JSON.stringify({ code: "CAPTURE_FAILED", message: msg }));
        try { sendResponse({ error: msg }); } catch {
            // ignore
          }
      }
    })();

    return true;
  });

} // end guard
export {};
