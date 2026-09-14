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
import { hideStickyBars, restoreStickyBars } from "./dom/stickyHider.js";

/**
 * MUST stay in sync with CONTENT_PROTOCOL_VERSION in src/messaging/events.ts.
 * It is intentionally a local literal, NOT an import: content.js is injected
 * as a classic script, so any value import shared with other entries makes
 * Rollup emit a chunk + `import` statement that throws SyntaxError on load.
 * Guarded by tests/content-bundle.test.ts — do not "clean up".
 */
const CONTENT_PROTOCOL_VERSION = 6;


// Guard against double injection (for scripting fallback)
if ((window as unknown as { __screenXContentScriptLoaded?: boolean }).__screenXContentScriptLoaded) {
  // ignore
}
 else {
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
                              // ignore
              }
 catch {
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
            try {
              if (typeof navigator.clipboard?.write !== "function") {
                sendResponse({ ok: false, error: "clipboard-unavailable", focused, transientActivation: transient });
                break;
              }
              // Synchronous base64 decode — no fetch(), which page CSP can
              // block on strict sites (a site-dependent intermittent failure).
              const blob = dataUrlToBlob(dataUrl as string);
              if (!claimCopySlot(seq)) {
                sendResponse({ ok: false, error: "superseded", focused, transientActivation: transient });
                break;
              }
              await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
              sendResponse({ ok: true, focused, transientActivation: transient });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
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
            // Viewport-space frame: report the scroller's viewport rect measured
            // AFTER the settle (rects move as the page scrolls — the stitcher
            // needs this chunk's rect, never a cached one). Window → 0,0.
            let rectLeft = 0;
            let rectTop = 0;
            try {
              const active = getActiveScrollController();
              const el = active?.element;
              if (el && el !== window && el instanceof HTMLElement) {
                const rect = el.getBoundingClientRect();
                if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
                  rectLeft = rect.left;
                  rectTop = rect.top;
                }
              }
            } catch {
              // ignore — rect defaults (window frame) apply
            }
            sendResponse({ ok: true, ...r, rectLeft, rectTop, vw: window.innerWidth, vh: window.innerHeight });
            break;
          }
          case "SCREENX_RESTORE_CAPTURE": {
            const r = restoreCapture();
            sendResponse(r);
            break;
          }
          case "SCREENX_HIDE_STICKY": {
            // Multi-strip passes only: hide fixed/sticky bars overlapping the
            // capture band so no strip re-photographs them (hiding beats
            // trimming — trimmed rows can never be recovered, hidden bars
            // simply aren't in any strip). visibility:hidden causes no reflow.
            // Single-shot captures never send this (must look like the screen).
            if (!isCapturePrepared()) prepareCapture();
            try {
              const { bandLeft, bandRight } = message as { bandLeft?: unknown; bandRight?: unknown };
              const scroller = getActiveScrollController()?.element ?? null;
              const count = hideStickyBars(
                typeof bandLeft === "number" ? bandLeft : undefined,
                typeof bandRight === "number" ? bandRight : undefined,
                scroller
              );
              sendResponse({ ok: true, hidden: count });
            } catch (e) {
              sendResponse({ ok: false, hidden: 0, error: e instanceof Error ? e.message : String(e) });
            }
            break;
          }
          case "SCREENX_RESTORE_STICKY": {
            try {
              const restored = restoreStickyBars();
              sendResponse({ ok: true, restored });
            } catch (e) {
              sendResponse({ ok: false, restored: 0, error: e instanceof Error ? e.message : String(e) });
            }
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
            // Render acknowledgment: the worker must know the overlay REALLY
            // mounted — transport success alone left "no selection UI, silent
            // hang" undiagnosable. A stale content script (extension updated,
            // tab not reloaded) throws or mounts nothing → ok:false.
            try {
              enterSelectionMode();
              const refs = getOverlay();
              const rendered = !!refs && refs.dim.isConnected === true;
              if (!rendered) {
                              // ignore
              }
              sendResponse({ ok: rendered, rendered, ...(!rendered ? { error: "overlay-mount-failed" } : {}) });
            } catch (e) {
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
            // Sync base64 decode (NOT fetch): fetch(data:) is subject to the
            // page CSP (connect-src without data: rejects), the same reason
            // the clipboard path decodes synchronously.
            const { dataUrl: dlDataUrl, filename: dlFilename } = message as {
              dataUrl?: string;
              filename?: string;
            };
            if (typeof dlDataUrl !== "string" || !dlDataUrl.startsWith("data:")) {
              sendResponse({ ok: false, error: "bad-data-url" });
              break;
            }
            try {
             // Sync base64 decode (dataUrlToBlob) — never fetch(dataUrl):
             // strict connect-src CSP blocks fetch on sites like GitHub.
              const blob = dataUrlToBlob(dlDataUrl);
              const blobUrl = URL.createObjectURL(blob);
              if (!document.body) {
                URL.revokeObjectURL(blobUrl);
                sendResponse({ ok: false, error: "no-document-body" });
                break;
              }
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
