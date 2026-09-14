import { CaptureError } from "@/types";
import { captureVisibleTabThrottled, waitThrottle } from "../client/tabCaptureClient";
import { withTimeout } from "../captureUtils";
import { sendProgress, sendToContent } from "../client/contentBridge";
import type { StitchChunk } from "../stitch/canvasStitcher";

export type { CaptureLoopOptions, CaptureLoopResult } from "./types";

import { checkAdvance, type CaptureLoopOptions, type CaptureLoopResult } from "./types";

const CONTENT_TIMEOUT_MS = 3500;
const CAPTURE_TIMEOUT_MS = 6000;
/** Settle tolerance (CSS px): readings this close to a requested origin count as the origin. */
export const ORIGIN_SNAP_PX = 4;

/**
 * Snap near-origin readings to the origin. The stitcher keeps the top rows
 * of a top-anchored (y≈0) chunk, so a reading of a few px would both trim
 * real top content AND skip the keep-top path — snapping keeps it exact
 * while the pixel aligner absorbs the ≤4px residue.
 */
export function snapChunkCoord(requested: number, actual: number): number {
  return requested === 0 && actual >= 0 && actual <= ORIGIN_SNAP_PX ? 0 : actual;
}

/**
 * Abort the capture if the user left the captured tab mid-run.
 * captureVisibleTab always snaps the ACTIVE tab of the window, so tab
 * switches silently corrupt the stitch — fail fast with a clear message
 * instead. Permission failures degrade to "skip check", never to abort.
 */
async function assertStillOnTab(tabId: number, windowId: number | undefined): Promise<void> {
  let tab: chrome.tabs.Tab | null = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!tab) return;
  const win = windowId ?? tab.windowId;
  if (tab.windowId === win && !tab.active) {
    throw new CaptureError(
      "TAB_SWITCHED",
      "Capture stopped because you switched tabs. Please stay on the page until the capture finishes, then try again."
    );
  }
}

export async function executeCaptureLoop(options: CaptureLoopOptions): Promise<CaptureLoopResult> {
  const { tabId, windowId, mode, positions, totalTimeout, controllerType, onChunk } = options;
  const chunks: StitchChunk[] = [];
  let perfScroll = 0;
  let perfCapture = 0;
  const start = Date.now();
  const totalChunks = positions.length;
  // Consecutive non-advancing scrolls: the page end moved under us (lazy
  // collapse). Break and stitch the partial run instead of throwing — the
  // stitcher dedupes overlap and warns about real gaps.
  let stuckStreak = 0;
  let stoppedEarly = false;
  // Viewport geometry anchor (first chunk wins; later chunks must match).
  let baseVw: number | undefined;
  let baseVh: number | undefined;

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

    await assertStillOnTab(tabId, windowId);

    sendProgress(tabId, {
      mode,
      stage: "Scrolling...",
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: i + 1,
      totalChunks,
      currentY: requestedY,
    });
    // Lock heartbeat: each chunk proves the owner is alive and extends the
    // claim, so only a dead owner ever lets the TTL expire. Fire-and-forget
    // by contract — a slow/failed heartbeat must never stall the loop.
    try {
      onChunk?.(i);
    } catch {
      // ignore — heartbeat is best-effort
    }

    const tScrollStart = performance.now();
    // Rate-limit wait happens BEFORE the scroll, not between the position
    // read and the shot: the capture then fires immediately after measuring,
    // so the page has no idle gap in which to drift (the number we stitch on
    // is the freshest possible one).
    await waitThrottle();
    const scrollRes = await withTimeout(
      sendToContent<{
        ok: boolean;
        actualX?: number;
        actualY?: number;
        /** Scroller viewport offset post-settle (0,0 for window). */
        rectLeft?: number;
        rectTop?: number;
        /** Viewport dims post-settle (mid-run change detection). */
        vw?: number;
        vh?: number;
        error?: string;
      }>(
        tabId,
        { type: "SCREENX_SCROLL_TO", x: 0, y: requestedY },
        CONTENT_TIMEOUT_MS
      ),
      mode === "selected-area" ? CONTENT_TIMEOUT_MS + 1000 : CONTENT_TIMEOUT_MS,
      mode === "selected-area" ? `Scroll to y=${requestedY} (chunk ${i + 1}/${positions.length})` : `Scroll to y=${requestedY}`
    );
    perfScroll += performance.now() - tScrollStart;

    // Align-and-continue: the content script always reports where it actually
    // is (ok:true). Legacy not-ok responses are tolerated the same way when
    // they carry actuals; only a response with no position at all still throws.
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
      } else if (scrollRes.actualY === undefined) {
        throw new CaptureError("SCROLL_POSITION_UNSTABLE", scrollRes.error || "Scroll failed");
      } else {
        console.warn(`[ScreenX] Scroll to ${requestedY} unsettled (${scrollRes.error ?? "unknown"}). Continuing with actual y=${scrollRes.actualY}.`);
      }
    }

    const actualY = scrollRes.actualY ?? requestedY;
    const actualX = scrollRes.actualX ?? 0;
    // Viewport-geometry change mid-run (resize, monitor move, zoom) shifts
    // every later strip's scale — fail loudly instead of seaming garbage.
    // First chunk anchors the geometry every other chunk must match.
    const vw = scrollRes.vw;
    const vh = scrollRes.vh;
    if (typeof vw === "number" && typeof vh === "number" && vw > 0 && vh > 0) {
      if (baseVw === undefined || baseVh === undefined) {
        baseVw = vw;
        baseVh = vh;
      } else if (vw !== baseVw || vh !== baseVh) {
        throw new CaptureError(
          "CAPTURE_FAILED",
          `Viewport changed mid-capture (${baseVw}x${baseVh} -> ${vw}x${vh}). Keep the window still and try again.`
        );
      }
    }
    // Scroller viewport offset for this chunk (stitcher frame mapping).
    const rectLeft = typeof scrollRes.rectLeft === "number" ? scrollRes.rectLeft : 0;
    const rectTop = typeof scrollRes.rectTop === "number" ? scrollRes.rectTop : 0;
    // Snap near-origin readings so a top-anchored chunk hits the stitcher's
    // keep-top path exactly (see snapChunkCoord).
    const recordY = snapChunkCoord(requestedY, actualY);
    const recordX = snapChunkCoord(0, actualX);

    // Compare against the last PUSHED chunk (not chunks[i-1]): skipped
    // iterations leave gaps, and indexing by loop counter crashes on undefined.
    const prevY = chunks.length > 0 ? chunks[chunks.length - 1]!.y : undefined;
    const advance = checkAdvance(actualY, prevY, stuckStreak);
    stuckStreak = advance.streak;
    if (advance.action !== "ok") {
      console.warn(
        `[ScreenX] scroll did not advance past y=${prevY} (streak ${stuckStreak}); stitching will dedupe overlap.`,
        JSON.stringify({ chunkIndex: i, requestedY, actualY, controller: controllerType })
      );
      if (advance.action === "stop") {
        console.warn(
          `[ScreenX] stopping capture early at chunk ${i + 1}/${positions.length} — page end moved under us; stitching partial run.`
        );
        stoppedEarly = true;
        break;
      }
      continue;
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
    // Per-exposure HUD hide: the bar stays visible between shots (so progress
    // is always readable) and hides only for the instant of each exposure —
    // that brief hide/show is the blink, kept deliberately per user request.
    // No trim is needed because the HUD is in NO exposure. The content-side
    // hide awaits 2 rAFs so the pixels are really gone before the shot fires.
    // Toolbar badge mirrors % throughout as a second indicator.
    const dataUrl = await withTimeout(
      captureVisibleTabThrottled(
        windowId,
        2,
        async () => {
          try {
            await sendToContent(tabId, { type: "SCREENX_HIDE_PROGRESS" });
          } catch {
            // ignore
          }
        },
        async () => {
          try {
            await sendToContent(tabId, { type: "SCREENX_SHOW_PROGRESS" });
          } catch {
            // ignore
          }
        }
      ),
      CAPTURE_TIMEOUT_MS,
      mode === "selected-area" ? `captureVisibleTab for chunk ${i + 1}/${positions.length} (y=${actualY})` : `captureVisibleTab y=${actualY}`
    );
    perfCapture += performance.now() - tCaptureStart;

    chunks.push({ dataUrl, x: recordX, y: recordY, rx: rectLeft, ry: rectTop });

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
    perfCapture,
    stoppedEarly,
  };
}
