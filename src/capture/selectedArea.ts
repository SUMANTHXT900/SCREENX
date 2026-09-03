import { CaptureError, type CaptureResult, type ProgressPayload } from "@/types";
import { storePendingCapture } from "@/storage/captureHandoff";
import { calculateRangePositions, calculateTotalTimeout, withTimeout } from "./captureUtils";
import { ensureContentScript } from "./ensureContent";
import { executeCaptureLoop } from "./engine/captureLoop";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RangeSelection {
  x: number;
  width: number;
  startY: number;
  endY: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONTENT_TIMEOUT_MS = 3500;
const SCROLL_STABILIZE_MS = 160;
const SELECTION_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

let selectedAreaLock = false;

function acquireLock(): void {
  if (selectedAreaLock) {
    throw new CaptureError("CAPTURE_FAILED", "A capture is already in progress. Please wait.");
  }
  selectedAreaLock = true;
}

function releaseLock(): void {
  selectedAreaLock = false;
}

// ---------------------------------------------------------------------------
// Helpers: tab + capture (shared via captureUtils)
// ---------------------------------------------------------------------------

import { isRestrictedUrl, queryActiveTab } from "./captureUtils";

function sendToContent<T>(tabId: number, message: unknown, timeoutMs = CONTENT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new CaptureError("TIMEOUT", `Content script did not respond to ${(message as { type?: string })?.type} within ${timeoutMs}ms. Try reloading the page.`));
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (timedOut) return;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message ?? "Unknown messaging error";
          if (/Receiving end does not exist/i.test(msg)) {
            reject(new CaptureError("CONTENT_SCRIPT_NOT_READY", "Content script not ready. Please reload the page and try again.", { cause: err }));
          } else {
            reject(new CaptureError("CAPTURE_FAILED", msg, { cause: err }));
          }
          return;
        }
        if (response && typeof response === "object" && "error" in response) {
          const msg = (response as { error: string }).error;
          if (/SCROLL_POSITION_MISMATCH/i.test(msg)) {
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
// Selection via content script
// ---------------------------------------------------------------------------

function waitForSelection(tabId: number): Promise<RangeSelection> {
  return new Promise<RangeSelection>((resolve, reject) => {
    // eslint-disable-next-line prefer-const
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const handler = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return false as unknown as void;

      const msg = message as { type?: string; selection?: RangeSelection };
      if (msg.type === "SCREENX_SELECTION_COMPLETE") {
        cleanup();
        if (!msg.selection) {
          reject(new CaptureError("CAPTURE_FAILED", "Selection completed but no data received."));
          return true;
        }
        // Validate selection
        const sel = msg.selection;
        if (typeof sel.startY !== "number" || typeof sel.endY !== "number" || typeof sel.x !== "number" || typeof sel.width !== "number") {
          reject(new CaptureError("INVALID_SELECTION", "Invalid selection data."));
          return true;
        }
        resolve(sel);
        return true;
      }
      if (msg.type === "SCREENX_SELECTION_CANCEL") {
        cleanup();
        reject(new CaptureError("USER_CANCELLED", "Selection cancelled by user."));
        return true;
      }
      return false as unknown as void;
    };

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      try {
        chrome.runtime.onMessage.removeListener(handler as unknown as () => void);
      } catch {
        // ignore
      }
    };

    chrome.runtime.onMessage.addListener(handler as unknown as (m: unknown, s: chrome.runtime.MessageSender, r: (x: unknown) => void) => boolean | void);

    timeoutId = setTimeout(() => {
      cleanup();
      try {
        chrome.tabs.sendMessage(tabId, { type: "SCREENX_CANCEL_SELECTION" }, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        // ignore
      }
      reject(new CaptureError("TIMEOUT", "Selection timed out. Please try again and press End when ready."));
    }, SELECTION_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, { type: "SCREENX_START_SELECTION" }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        cleanup();
        const msg = err.message ?? "Unknown error";
        if (/Receiving end does not exist/i.test(msg)) {
          reject(new CaptureError("CONTENT_SCRIPT_NOT_READY", "Content script not ready. Please reload the page and try again.", { cause: err }));
        } else {
          reject(new CaptureError("CAPTURE_FAILED", msg, { cause: err }));
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Targeted stitch for selected range
// ---------------------------------------------------------------------------

interface StitchChunk {
  dataUrl: string;
  x: number;
  y: number;
}

export interface StitchOutput {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
}

import { CanvasStitcher } from "./stitch/canvasStitcher";

export async function stitchSelectedRange(
  chunks: StitchChunk[],
  selection: RangeSelection,
  metrics: { viewportWidth: number; viewportHeight: number; dpr: number; occludedTopHeight?: number; occludedBottomHeight?: number }
): Promise<StitchOutput> {
  const stitcher = new CanvasStitcher({
    chunks,
    selection,
    viewportWidth: metrics.viewportWidth,
    viewportHeight: metrics.viewportHeight,
    dpr: metrics.dpr,
    occludedTopHeight: metrics.occludedTopHeight,
    occludedBottomHeight: metrics.occludedBottomHeight,
  });

  return await stitcher.stitch();
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function captureSelectedArea(): Promise<CaptureResult> {
  acquireLock();
  let tab: chrome.tabs.Tab | null = null;
  let prepared = false;

  try {
    tab = await queryActiveTab();
    if (isRestrictedUrl(tab.url)) {
      throw new CaptureError("RESTRICTED_PAGE", "Cannot capture this page — browser internal pages are protected.");
    }
    if (tab.id === undefined) throw new CaptureError("NO_ACTIVE_TAB", "No active tab.");

    await ensureContentScript(tab);

    const selection = await waitForSelection(tab.id);
    const t0 = performance.now();
    let perfScroll = 0;
    let perfCapture = 0;
    let perfStitch = 0;

    const startY = Math.min(selection.startY, selection.endY);
    const endY = Math.max(selection.startY, selection.endY);
    let x = selection.x;
    let width = selection.width;

    if (width <= 0 || endY - startY <= 0) {
      throw new CaptureError("INVALID_SELECTION", "Invalid selection. Please try again.");
    }

    if (width < 10) throw new CaptureError("INVALID_SELECTION", "Selection too narrow.");
    if (endY - startY < 10) throw new CaptureError("INVALID_SELECTION", "Selection too short. Scroll further before pressing End.");
    if (width > 10000 || endY - startY > 65000) {
      throw new CaptureError("PAGE_TOO_LARGE", "Selected range exceeds 65,000px limit. Try a smaller region.");
    }

    if (x < 0) {
      width += x;
      x = 0;
    }

    const normalizedSelection: RangeSelection = { x, width, startY, endY };

    console.debug("[ScreenX][SelectedArea]", JSON.stringify({
      phase: "selection_received",
      startY,
      endY,
      width,
      x,
    }));

    const metrics = await withTimeout(
      sendToContent<{ viewportWidth: number; viewportHeight: number; dpr: number; maxScrollY: number; totalHeight: number; totalWidth: number; controllerType?: string; fixedElements?: { top: number; bottom: number; left: number; right: number }[] }>(
        tab.id,
        { type: "SCREENX_MEASURE_PAGE" }
      ),
      CONTENT_TIMEOUT_MS,
      "Measure for selected area"
    );

    const viewportWidth = metrics.viewportWidth;
    const viewportHeight = metrics.viewportHeight;
    const dpr = metrics.dpr || 1;
    
    let occludedTopHeight = 0;
    let occludedBottomHeight = 0;
    if (metrics.fixedElements) {
      const selLeft = normalizedSelection.x;
      const selRight = normalizedSelection.x + normalizedSelection.width;
      
      for (const rect of metrics.fixedElements) {
        // Horizontally disjoint elements do not occlude the capture region
        if (rect.right <= selLeft || rect.left >= selRight) continue;
        
        if (rect.top <= 0 && rect.bottom > 0 && rect.bottom < viewportHeight / 2) {
          occludedTopHeight = Math.max(occludedTopHeight, rect.bottom);
        }
        if (rect.bottom >= viewportHeight && rect.top > viewportHeight / 2 && rect.top < viewportHeight) {
          occludedBottomHeight = Math.max(occludedBottomHeight, viewportHeight - rect.top);
        }
      }
    }
    occludedTopHeight = Math.min(occludedTopHeight, viewportHeight * 0.25);
    occludedBottomHeight = Math.min(occludedBottomHeight, viewportHeight * 0.25);

    if (metrics.controllerType && metrics.controllerType !== "window") {
      console.warn("[ScreenX][SelectedArea] nested controller detected", JSON.stringify(metrics));
    }

    await withTimeout(sendToContent<{ ok: true }>(tab.id, { type: "SCREENX_PREPARE_CAPTURE" }), CONTENT_TIMEOUT_MS, "Prepare");
    prepared = true;

    const positions = calculateRangePositions(startY, endY, viewportHeight, metrics.maxScrollY, 300, occludedTopHeight, occludedBottomHeight);

    if (positions.length === 0) throw new CaptureError("CAPTURE_FAILED", "No positions to capture.");

    const totalChunks = positions.length;

    sendProgress(tab.id, {
      mode: "selected-area",
      stage: "Preparing...",
      percent: Math.round((0 / totalChunks) * 100),
      currentChunk: 0,
      totalChunks,
    });

    const capturePlan = {
      phase: "capture_plan",
      selection: { startY, endY, height: endY - startY, width, x },
      viewport: { width: viewportWidth, height: viewportHeight, dpr },
      totalHeight: metrics.totalHeight,
      maxScrollY: metrics.maxScrollY,
      occlusions: { top: occludedTopHeight, bottom: occludedBottomHeight },
      controller: metrics.controllerType,
      chunkCount: positions.length,
      chunks: positions.map((pos, idx) => ({
        index: idx,
        requestedY: pos,
        expectedViewportRange: `${pos} - ${pos + viewportHeight}`,
      })),
    };
    console.debug("[ScreenX][SelectedArea][Plan]", JSON.stringify(capturePlan));

    const totalTimeout = calculateTotalTimeout(positions.length, SCROLL_STABILIZE_MS, 600, 2000);

    const chunks = [];
    const perfPlanning = performance.now() - t0;

    const loopResult = await executeCaptureLoop({
      tabId: tab.id,
      windowId: tab.windowId,
      mode: "selected-area",
      positions,
      totalTimeout,
      controllerType: metrics.controllerType,
    });

    chunks.push(...loopResult.chunks);
    perfScroll = loopResult.perfScroll;
    perfCapture = loopResult.perfCapture;

    sendProgress(tab.id, {
      mode: "selected-area",
      stage: "Stitching...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    const tStitchStart = performance.now();
    const stitchResult = await stitchSelectedRange(chunks, normalizedSelection, { viewportWidth, viewportHeight, dpr });
    perfStitch = performance.now() - tStitchStart;

    const widthPx = stitchResult.width;
    const heightPx = stitchResult.height;

    console.debug("[ScreenX][SelectedArea]", JSON.stringify({
      phase: "complete",
      width: widthPx,
      height: heightPx,
      chunkCount: chunks.length,
    }));

    const result: CaptureResult = {
      id: crypto.randomUUID(),
      type: "selected-area",
      dataUrl: stitchResult.dataUrl || "",
      blob: stitchResult.blob,
      createdAt: Date.now(),
      sourceTabId: tab.id,
      sourceUrl: tab.url,
      sourceTitle: tab.title,
      width: widthPx,
      height: heightPx,
    };

    sendProgress(tab.id, {
      mode: "selected-area",
      stage: "Finalizing...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    try {
      await storePendingCapture(result);
    } catch (e) {
      if (e instanceof CaptureError && e.code === "STORAGE_FAILED") {
        try {
          const { deleteCapture } = await import("@/storage/idb");
          await deleteCapture(result.id);
        } catch {
          // ignore
        }
      }
      if (e instanceof CaptureError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("STORAGE_FAILED", `Capture succeeded but handoff failed: ${msg}`, {
        cause: e instanceof Error ? e : undefined,
      });
    }

    if (tab?.id !== undefined) {
      try {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "SCREENX_TOAST",
            toast: {
              type: "success",
              title: "Capture Complete",
              message: "Selected area captured successfully.",
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
    console.log(`[ScreenX][PERF] type=selected-area chunks=${chunks.length} planning=${Math.round(perfPlanning)}ms scroll=${Math.round(perfScroll)}ms capture=${Math.round(perfCapture)}ms stitch=${Math.round(perfStitch)}ms total=${Math.round(totalTime)}ms avgChunk=${Math.round(avgChunk)}ms`);

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
              message: err.message || "Failed to capture selected area.",
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
        await sendToContent(tab.id, { type: "SCREENX_HIDE_PROGRESS" });
      } catch {
        // ignore
      }
      if (prepared) {
        try {
          await sendToContent(tab.id, { type: "SCREENX_RESTORE_CAPTURE" });
        } catch {
          // ignore
        }
      }
    }
    releaseLock();
  }
}

