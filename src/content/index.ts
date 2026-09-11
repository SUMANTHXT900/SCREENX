/**
 * Content Script — thin message dispatcher (Stage 2).
 * Lifecycle lives in ./dom/capturePrep.ts; scroll/occlusion/selection/HUD in submodules.
 */

import { getActiveScrollController, isCapturePrepared, prepareCapture, resetCaptureState, restoreCapture, setActiveScrollController } from "./dom/capturePrep.js";
import { findScrollContainerAt } from "./scroll/ScrollController.js";
import { scrollToAndSettle } from "./scroll/scrollSettler.js";
import { measurePage } from "./dom/metrics.js";
import { updateProgressHud, hideProgressHud, showProgressHud, type ProgressPayload } from "./ui/progressHud.js";
import { showToast, type ToastOptions } from "./ui/toast.js";
import { enterSelectionMode, cancelSelectionMode, dismissSelectionMode } from "./selection/selectionManager.js";
import { getOverlay } from "./selection/selectionOverlay.js";
import { claimCopySlot, dataUrlToBlob } from "./clipboardWrite.js";

/**
 * MUST stay in sync with CONTENT_PROTOCOL_VERSION in src/messaging/events.ts.
 * It is intentionally a local literal, NOT an import: content.js is injected
 * as a classic script, so any value import shared with other entries makes
 * Rollup emit a chunk + `import` statement that throws SyntaxError on load.
 * Guarded by tests/content-bundle.test.ts — do not "clean up".
 */
const CONTENT_PROTOCOL_VERSION = 5;

console.debug("[ScreenX] content script loaded", {
  url: location.href,
  timestamp: Date.now(),
  proto: CONTENT_PROTOCOL_VERSION,
});

// Guard against double injection (for scripting fallback)
if ((window as unknown as { __screenXContentScriptLoaded?: boolean }).__screenXContentScriptLoaded) {
  console.debug("[ScreenX] content script already loaded, skipping");
} else {
  (window as unknown as { __screenXContentScriptLoaded: boolean }).__screenXContentScriptLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string })?.type;

    if (type === "PING_CONTENT" || type === "PING") {
      sendResponse({ ok: true, url: location.href, proto: CONTENT_PROTOCOL_VERSION });
      return true;
    }

    (async () => {
      try {
        switch (type) {
          case "SCREENX_MEASURE_PAGE": {
            const m = measurePage(getActiveScrollController());
            sendResponse(m);
            break;
          }
          case "SCREENX_RESOLVE_CONTAINER": {
            // Pin the scroll target to the container behind the given viewport
            // point (usually the selection box center), so capture scrolls the
            // exact element the selection was measured against — not whatever
            // global-best guess prepareCapture would make on its own.
            const { x, y } = message as { x: number; y: number };
            try {
              const controller = findScrollContainerAt(
                Math.max(0, Number(x) || 0),
                Math.max(0, Number(y) || 0)
              );
              setActiveScrollController(controller);
              try {
                console.debug("[ScreenX] container resolved", controller.describe());
              } catch {
                // ignore
              }
              sendResponse({ ok: true });
            } catch (e) {
              sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
            }
            break;
          }
          case "SCREENX_PREPARE_CAPTURE": {
            const r = prepareCapture();
            sendResponse(r);
            break;
          }
          case "SCREENX_COPY_IMAGE": {
            // Clipboard writes need a focused document + transient activation,
            // which only exist here in the page — never in the worker. The
            // The blob is decoded SYNCHRONOUSLY (no fetch) and write() is
            // called with no await before it, so activation is captured now.
            const { dataUrl, seq } = message as { dataUrl?: unknown; seq?: number };
            const focused = document.hasFocus();
            let transient = false;
            try {
              transient = navigator.userActivation?.isActive === true;
            } catch {
              transient = false;
            }
            console.debug("[ScreenX] COPY_IMAGE received", {
              chars: typeof dataUrl === "string" ? dataUrl.length : -1,
              focused,
              transientActivation: transient,
              seq: typeof seq === "number" ? seq : "none",
            });
            try {
              if (typeof navigator.clipboard?.write !== "function") {
                sendResponse({ ok: false, error: "clipboard-unavailable", focused, transientActivation: transient });
                break;
              }
              // Synchronous base64 decode — no fetch(), which page CSP can
              // block on strict sites (a site-dependent intermittent failure).
              const blob = dataUrlToBlob(dataUrl as string);
              if (!claimCopySlot(seq)) {
                console.debug("[ScreenX] COPY_IMAGE superseded by a newer copy — skipping write");
                sendResponse({ ok: false, error: "superseded", focused, transientActivation: transient });
                break;
              }
              await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
              console.debug("[ScreenX] COPY_IMAGE clipboard write ok=true");
              sendResponse({ ok: true, focused, transientActivation: transient });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.debug("[ScreenX] COPY_IMAGE clipboard write ok=false:", msg, { focused });
              sendResponse({ ok: false, error: msg, focused, transientActivation: transient });
            }
            break;
          }
          case "SCREENX_SCROLL_TO": {
            const { x, y } = message as { x: number; y: number };
            if (!isCapturePrepared()) prepareCapture();
            // Always resolves: scrollToAndSettle reports the ACTUAL position
            // and the stitcher pixel-aligns seams (align-and-continue).
            const r = await scrollToAndSettle(getActiveScrollController(), Number(x) || 0, Number(y) || 0);
            sendResponse({ ok: true, ...r });
            break;
          }
          case "SCREENX_RESTORE_CAPTURE": {
            const r = restoreCapture();
            sendResponse(r);
            break;
          }
          case "SCREENX_RESET_CAPTURE_STATE": {
            // Self-heal entry: the worker sends this at the start of every
            // capture so a previous run's stuck `prepared` flag can never
            // silently poison this one (see resetCaptureState).
            const r = resetCaptureState();
            sendResponse(r);
            break;
          }
          case "SCREENX_START_SELECTION": {
            console.debug("[ScreenX] START_SELECTION received — entering selection mode");
            // Render acknowledgment: the worker must know the overlay REALLY
            // mounted — transport success alone left "no selection UI, silent
            // hang" undiagnosable. A stale content script (extension updated,
            // tab not reloaded) throws or mounts nothing → ok:false.
            try {
              enterSelectionMode();
              const refs = getOverlay();
              const rendered = !!refs && refs.dim.isConnected === true;
              if (!rendered) {
                console.debug("[ScreenX] START_SELECTION overlay failed to mount");
              }
              sendResponse({ ok: rendered, rendered, ...(!rendered ? { error: "overlay-mount-failed" } : {}) });
            } catch (e) {
              console.debug("[ScreenX] START_SELECTION enter failed:", e instanceof Error ? e.message : String(e));
              sendResponse({ ok: false, rendered: false, error: e instanceof Error ? e.message : String(e) });
            }
            break;
          }
          case "SCREENX_DISMISS_SELECTION": {
            // Silent teardown for a superseded run — no reply message, so it
            // can never be mistaken for the fresh run's cancel (see
            // dismissSelectionMode in selectionManager).
            try {
              dismissSelectionMode();
            } catch {
              // ignore
            }
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
            if (!t) {
              sendResponse({ ok: true });
              break;
            }
            console.debug("[ScreenX] TOAST received:", t.title ?? t.type, "| actions:", t.actions?.length ?? 0);
            try {
              showToast(t);
              // Report the honest render result: delivery must mean painted,
              // and focus tells the worker whether the user can even see it.
              sendResponse({ ok: true, rendered: true, focused: document.hasFocus() });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error("[ScreenX] TOAST render failed:", msg);
              sendResponse({ ok: false, error: msg });
            }
            break;
          }
          case "SCREENX_DOWNLOAD_BLOB": {
            // Fallback for large captures: chrome.downloads.download can't
            // handle data URLs beyond ~50MB. Create a Blob URL in the page
            // context and trigger a synthetic <a download> click.
            const { dataUrl: dlDataUrl, filename: dlFilename } = message as {
              dataUrl?: string;
              filename?: string;
            };
            if (typeof dlDataUrl !== "string" || !dlDataUrl.startsWith("data:")) {
              sendResponse({ ok: false, error: "bad-data-url" });
              break;
            }
            try {
              const res = await fetch(dlDataUrl);
              const blob = await res.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = dlFilename || "screenx-capture.png";
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
              sendResponse({ ok: true });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              sendResponse({ ok: false, error: msg });
            }
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
