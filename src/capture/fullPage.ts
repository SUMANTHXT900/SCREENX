import { CaptureError, type CaptureResult, type ToastOptions, type ProgressPayload } from "@/types";
import { storePendingCapture } from "@/storage/captureHandoff";
import { stitchImages } from "./stitch";
import { ensureContentScript } from "./ensureContent";
import { calculatePositions, calculateTotalTimeout, isRestrictedUrl, queryActiveTab, withTimeout } from "./captureUtils";
import { executeCaptureLoop } from "./engine/captureLoop";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONTENT_TIMEOUT_MS = 3500;
const SCROLL_STABILIZE_MS = 160;

// ---------------------------------------------------------------------------
// Concurrency lock
// ---------------------------------------------------------------------------

let fullPageLock = false;

function acquireLock(): void {
  if (fullPageLock) {
    throw new CaptureError("CAPTURE_FAILED", "A capture is already in progress. Please wait a moment and try again.");
  }
  fullPageLock = true;
}

function releaseLock(): void {
  fullPageLock = false;
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

type ContentMessage =
  | { type: "SCREENX_MEASURE_PAGE" }
  | { type: "SCREENX_PREPARE_CAPTURE" }
  | { type: "SCREENX_SCROLL_TO"; x: number; y: number }
  | { type: "SCREENX_SET_HIDE_FIXED"; hide: boolean }
  | { type: "SCREENX_RESTORE_CAPTURE" }
  | { type: "SCREENX_HIDE_PROGRESS" }
  | { type: "SCREENX_SHOW_PROGRESS" }
  | { type: "SCREENX_PROGRESS"; progress: ProgressPayload }
  | { type: "SCREENX_TOAST"; toast: ToastOptions };

interface MeasureResponse {
  totalWidth: number;
  totalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
  maxScrollY: number;
  maxScrollX: number;
  controllerType?: string;
  fixedElements?: { top: number; bottom: number; left: number; right: number }[];
}

function sendToContent<T>(tabId: number, message: ContentMessage, timeoutMs = CONTENT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(
        new CaptureError(
          "TIMEOUT",
          `Content script did not respond to ${message.type} within ${timeoutMs}ms. Try reloading the page.`
        )
      );
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (timedOut) return;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message ?? "Unknown messaging error";
          if (/Receiving end does not exist/i.test(msg)) {
            reject(
              new CaptureError(
                "CONTENT_SCRIPT_NOT_READY",
                "Content script not ready. Please reload the page and try again.",
                { cause: err }
              )
            );
          } else {
            reject(new CaptureError("CAPTURE_FAILED", msg, { cause: err }));
          }
          return;
        }
        if (response && typeof response === "object" && "error" in response) {
          const msg = (response as { error: string }).error;
          // Map scroll mismatch to structured error
          if (/SCROLL_POSITION_MISMATCH/i.test(msg) || /NESTED_SCROLL_CONTAINER/i.test(msg)) {
            reject(new CaptureError("CAPTURE_FAILED", msg));
          } else {
            reject(new CaptureError("CAPTURE_FAILED", msg));
          }
          return;
        }
        resolve(response as T);
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      reject(new CaptureError("CAPTURE_FAILED", msg, { cause: e as Error }));
    }
  });
}

function sendProgress(tabId: number, progress: ProgressPayload): void {
  try {
    chrome.tabs.sendMessage(tabId, { type: "SCREENX_PROGRESS", progress }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: "SCREENX_PROGRESS", progress }).catch(() => {});
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function captureFullPage(): Promise<CaptureResult> {
  acquireLock();
  const t0 = performance.now();
  let perfScroll = 0;
  let perfCapture = 0;
  let perfStitch = 0;
  let tab: chrome.tabs.Tab | null = null;
  let prepared = false;

  try {
    tab = await queryActiveTab();

    if (isRestrictedUrl(tab.url)) {
      throw new CaptureError(
        "RESTRICTED_PAGE",
        "Cannot capture this page — browser internal pages are protected. Open a normal website and try again."
      );
    }

    if (tab.id === undefined) throw new CaptureError("NO_ACTIVE_TAB", "No active tab.");

    await ensureContentScript(tab);

    const metrics = await withTimeout(
      sendToContent<MeasureResponse>(tab.id, { type: "SCREENX_MEASURE_PAGE" }),
      CONTENT_TIMEOUT_MS,
      "Measure page"
    );

    console.debug(
      "[ScreenX] fullPage measure",
      JSON.stringify({
        controller: metrics.controllerType,
        viewportWidth: metrics.viewportWidth,
        viewportHeight: metrics.viewportHeight,
        totalWidth: metrics.totalWidth,
        totalHeight: metrics.totalHeight,
        maxScrollY: metrics.maxScrollY,
        dpr: metrics.dpr,
      })
    );

    const { totalWidth, totalHeight, viewportWidth, viewportHeight, dpr } = metrics;

    if (!Number.isFinite(totalWidth) || !Number.isFinite(totalHeight) || totalWidth <= 0 || totalHeight <= 0) {
      throw new CaptureError("CAPTURE_FAILED", "Page measurement returned invalid dimensions.");
    }
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      throw new CaptureError("CAPTURE_FAILED", "Viewport measurement invalid.");
    }
    
    let occludedTopHeight = 0;
    let occludedBottomHeight = 0;
    if (metrics.fixedElements) {
      for (const rect of metrics.fixedElements) {
        // Only consider elements spanning at least 35% of viewport width
        const elWidth = rect.right - rect.left;
        if (elWidth < viewportWidth * 0.35) continue;

        if (rect.top <= 0 && rect.bottom > 0 && rect.bottom < viewportHeight / 2) {
          occludedTopHeight = Math.max(occludedTopHeight, rect.bottom);
        }
        if (rect.bottom >= viewportHeight && rect.top > viewportHeight / 2 && rect.top < viewportHeight) {
          occludedBottomHeight = Math.max(occludedBottomHeight, viewportHeight - rect.top);
        }
      }
    }
    // Limit occlusions so step is never starved
    occludedTopHeight = Math.min(occludedTopHeight, viewportHeight * 0.25);
    occludedBottomHeight = Math.min(occludedBottomHeight, viewportHeight * 0.25);

    // Check for nested scroll container that would make capture incorrect
    if (metrics.controllerType && metrics.controllerType !== "window") {
      console.warn("[ScreenX] nested scroll controller detected", JSON.stringify(metrics));
    }

    await withTimeout(
      sendToContent<{ ok: true }>(tab.id, { type: "SCREENX_PREPARE_CAPTURE" }),
      CONTENT_TIMEOUT_MS,
      "Prepare capture"
    );
    prepared = true;

    // For ultra-tall or infinite-scroll pages, clamp capture height to browser canvas maximum (65,000 CSS px)
    const effectiveTotalHeight = Math.min(totalHeight, 65000);
    const effectiveMaxScrollY = Math.min(metrics.maxScrollY ?? totalHeight - viewportHeight, Math.max(0, effectiveTotalHeight - viewportHeight));

    // Calculate positions using shared helper (allowing up to 300 viewports with adaptive stepping)
    const positions = calculatePositions(effectiveTotalHeight, viewportHeight, effectiveMaxScrollY, 300, occludedTopHeight, occludedBottomHeight);

    if (positions.length === 0) {
      throw new CaptureError("CAPTURE_FAILED", "No scroll positions calculated.");
    }

    const totalChunks = positions.length;

    sendProgress(tab.id, {
      mode: "full-page",
      stage: "Preparing...",
      percent: Math.round((0 / totalChunks) * 100),
      currentChunk: 0,
      totalChunks,
    });

    // Calculate dynamic total timeout based on chunks
    const totalTimeout = calculateTotalTimeout(positions.length, SCROLL_STABILIZE_MS, 600, 2000);
    console.debug("[ScreenX] fullPage positions", JSON.stringify({ count: positions.length, positions, totalTimeout, occlusions: { top: occludedTopHeight, bottom: occludedBottomHeight } }));

    const perfPlanning = performance.now() - t0;

    const loopResult = await executeCaptureLoop({
      tabId: tab.id,
      windowId: tab.windowId,
      mode: "full-page",
      positions,
      totalTimeout,
      controllerType: metrics.controllerType,
    });

    const chunks = loopResult.chunks;
    perfScroll = loopResult.perfScroll;
    perfCapture = loopResult.perfCapture;

    sendProgress(tab.id, {
      mode: "full-page",
      stage: "Stitching...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    const tStitchStart = performance.now();
    const stitchResult = await stitchImages({
      chunks,
      totalWidth,
      totalHeight: effectiveTotalHeight,
      viewportWidth,
      viewportHeight,
      dpr: dpr || 1,
      occludedTopHeight,
      occludedBottomHeight,
    });
    perfStitch = performance.now() - tStitchStart;

    const width = stitchResult.width;
    const height = stitchResult.height;

    const result: CaptureResult = {
      id: crypto.randomUUID(),
      type: "full-page",
      dataUrl: stitchResult.dataUrl || "",
      blob: stitchResult.blob,
      createdAt: Date.now(),
      sourceTabId: tab.id,
      sourceUrl: tab.url,
      sourceTitle: tab.title,
      width,
      height,
    };

    sendProgress(tab.id, {
      mode: "full-page",
      stage: "Finalizing...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    try {
      await storePendingCapture(result);
    } catch (e) {
      // Cleanup IDB if session pointer failed (avoid orphan)
      if (e instanceof CaptureError && e.code === "STORAGE_FAILED") {
        try {
          const { deleteCapture } = await import("@/storage/idb");
          await deleteCapture(result.id);
        } catch {
          // ignore cleanup failure
        }
      }
      if (e instanceof CaptureError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("STORAGE_FAILED", `Capture succeeded but handoff failed: ${msg}`, {
        cause: e instanceof Error ? e : undefined,
      });
    }

    console.debug("[ScreenX] full-page stitched", JSON.stringify({
      chunks: chunks.length,
      totalWidth,
      totalHeight: effectiveTotalHeight,
      viewportHeight,
      dpr,
      finalWidth: width,
      finalHeight: height,
      finalKB: Math.round(stitchResult.blob.size / 1024),
    }));

    if (tab?.id !== undefined) {
      try {
        const isClamped = totalHeight > 65000;
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "SCREENX_TOAST",
            toast: {
              type: "success",
              title: "Capture Complete",
              message: isClamped
                ? "Full page captured (captured first 65,000px due to browser limits)."
                : "Full page captured successfully.",
            },
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch {
        // ignore
      }
    }

    const totalTime = performance.now() - t0;
    const avgChunk = chunks.length > 0 ? (perfScroll + perfCapture) / chunks.length : 0;
    console.log(`[ScreenX][PERF] type=full-page chunks=${chunks.length} planning=${Math.round(perfPlanning)}ms scroll=${Math.round(perfScroll)}ms capture=${Math.round(perfCapture)}ms stitch=${Math.round(perfStitch)}ms total=${Math.round(totalTime)}ms avgChunk=${Math.round(avgChunk)}ms`);

    return result;
  } catch (e) {
    const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", e instanceof Error ? e.message : String(e), { cause: e instanceof Error ? e : undefined });
    if (tab?.id !== undefined && err.code !== "USER_CANCELLED") {
      try {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "SCREENX_TOAST",
            toast: {
              type: "error",
              title: "Capture Failed",
              message: err.message || "Failed to capture full page.",
            },
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    if (tab?.id !== undefined) {
      try {
        await sendToContent<{ ok: true }>(tab.id, { type: "SCREENX_HIDE_PROGRESS" });
      } catch {
        // ignore
      }
      if (prepared) {
        try {
          await sendToContent<{ ok: true }>(tab.id, { type: "SCREENX_RESTORE_CAPTURE" });
        } catch (e) {
          console.warn("[ScreenX] restore failed (non-fatal):", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
        }
      }
    }
    releaseLock();
  }
}
