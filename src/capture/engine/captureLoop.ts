import { CaptureError, type ProgressPayload } from "@/types";
import { captureVisibleTabThrottled } from "../captureVisibleTab";
import { withTimeout } from "../captureUtils";
import type { StitchChunk } from "../stitch";

export interface CaptureLoopOptions {
  tabId: number;
  windowId?: number;
  mode: "full-page" | "selected-area";
  positions: number[];
  totalTimeout: number;
  controllerType?: string;
}

export interface CaptureLoopResult {
  chunks: StitchChunk[];
  perfScroll: number;
  perfCapture: number;
}

const CONTENT_TIMEOUT_MS = 3500;
const CAPTURE_TIMEOUT_MS = 6000;

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
          reject(new CaptureError("CAPTURE_FAILED", msg));
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

export async function executeCaptureLoop(options: CaptureLoopOptions): Promise<CaptureLoopResult> {
  const { tabId, windowId, mode, positions, totalTimeout, controllerType } = options;
  const chunks: StitchChunk[] = [];
  let perfScroll = 0;
  let perfCapture = 0;
  const start = Date.now();
  const totalChunks = positions.length;

  for (let i = 0; i < positions.length; i++) {
    const requestedY = positions[i]!;
    const completedChunks = i;

    if (Date.now() - start > totalTimeout) {
      const timeoutInfo = { stage: "OVERALL_TIMEOUT", chunkIndex: i, totalChunks: positions.length, requestedY };
      if (mode === "selected-area") {
        console.error(`[ScreenX][SelectedArea] capture timeout`, JSON.stringify(timeoutInfo));
        throw new CaptureError("TIMEOUT", `Selected area capture exceeded ${Math.round(totalTimeout / 1000)}s at chunk ${i + 1}/${positions.length} (requestedY=${requestedY}).`);
      } else {
        throw new CaptureError("TIMEOUT", `Full-page capture exceeded ${Math.round(totalTimeout / 1000)}s at chunk ${i + 1}/${positions.length} (requestedY=${requestedY}). Page may be too large.`);
      }
    }

    sendProgress(tabId, {
      mode,
      stage: "Scrolling...",
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: i + 1,
      totalChunks,
      currentY: requestedY,
    });

    const tScrollStart = performance.now();
    const scrollRes = await withTimeout(
      sendToContent<{ ok: boolean; actualX?: number; actualY?: number; error?: string }>(
        tabId,
        { type: "SCREENX_SCROLL_TO", x: 0, y: requestedY },
        CONTENT_TIMEOUT_MS
      ),
      mode === "selected-area" ? CONTENT_TIMEOUT_MS + 1000 : CONTENT_TIMEOUT_MS,
      mode === "selected-area" ? `Scroll to y=${requestedY} (chunk ${i + 1}/${positions.length})` : `Scroll to y=${requestedY}`
    );
    perfScroll += performance.now() - tScrollStart;

    if (!scrollRes.ok) {
      let errJson: { code?: string; actualX?: number; actualY?: number } | null = null;
      try {
        errJson = JSON.parse(scrollRes.error || "{}");
      } catch {
        errJson = null;
      }
      
      if (errJson && errJson.code === "SCROLL_POSITION_UNSTABLE") {
        console.warn(`[ScreenX] Scroll to ${requestedY} repeatedly failed. Settled at ${errJson.actualY}. Continuing with actual position.`);
        scrollRes.actualY = errJson.actualY;
        scrollRes.actualX = errJson.actualX;
      } else {
        throw new CaptureError("SCROLL_POSITION_UNSTABLE", scrollRes.error || "Scroll failed");
      }
    }

    const actualY = scrollRes.actualY ?? requestedY;
    const actualX = scrollRes.actualX ?? 0;

    if (i > 0 && actualY <= chunks[i - 1]!.y) {
      const duplicateInfo = {
        stage: "DUPLICATE_SCROLL_POSITION",
        chunkIndex: i,
        previousActualY: chunks[i - 1]!.y,
        currentActualY: actualY,
        requestedY,
        controller: controllerType,
      };
      if (mode === "selected-area") {
        console.error("[ScreenX][SelectedArea] duplicate scroll position", JSON.stringify(duplicateInfo));
      } else {
        console.error("[ScreenX] duplicate scroll position in fullPage", JSON.stringify(duplicateInfo));
      }
      throw new CaptureError(
        "CAPTURE_FAILED",
        `Duplicate scroll position detected: chunk ${i + 1} at y=${actualY} did not advance past previous y=${chunks[i - 1]!.y}.`,
        { cause: new Error(JSON.stringify(duplicateInfo)) }
      );
    }

    if (mode === "selected-area") {
      console.debug("[ScreenX][SelectedArea]", JSON.stringify({
        phase: "scroll_settled",
        index: i,
        requestedY,
        actualY,
        controller: controllerType,
        viewportHeight: 0, // Mocked out to fit previous shape
      }));
    }

    sendProgress(tabId, {
      mode,
      stage: "Capturing...",
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: i + 1,
      totalChunks,
      currentY: actualY,
    });

    const tCaptureStart = performance.now();
    const dataUrl = await withTimeout(
      captureVisibleTabThrottled(
        windowId,
        2,
        async () => {
          if (tabId) {
            try {
              await sendToContent(tabId, { type: "SCREENX_HIDE_PROGRESS" });
            } catch {
              // ignore
            }
          }
        },
        async () => {
          if (tabId) {
            try {
              await sendToContent(tabId, { type: "SCREENX_SHOW_PROGRESS" });
            } catch {
              // ignore
            }
          }
        }
      ),
      CAPTURE_TIMEOUT_MS,
      mode === "selected-area" ? `captureVisibleTab for chunk ${i + 1}/${positions.length} (y=${actualY})` : `captureVisibleTab y=${actualY}`
    );
    perfCapture += performance.now() - tCaptureStart;

    if (mode === "selected-area") {
      console.debug("[ScreenX][SelectedArea]", JSON.stringify({
        phase: "captured_chunk",
        index: i,
        actualY,
        dataLength: dataUrl.length,
      }));
    } else {
      console.debug(`[ScreenX] full-page chunk ${chunks.length + 1}/${positions.length} y=${actualY} (requested ${requestedY}) captured ${Math.round(dataUrl.length / 1024)}KB`);
    }

    chunks.push({ dataUrl, x: actualX, y: actualY });

    sendProgress(tabId, {
      mode,
      stage: "Processing...",
      percent: Math.round((chunks.length / totalChunks) * 100),
      currentChunk: i + 1,
      totalChunks,
      currentY: actualY,
    });
  }

  return {
    chunks,
    perfScroll,
    perfCapture
  };
}
