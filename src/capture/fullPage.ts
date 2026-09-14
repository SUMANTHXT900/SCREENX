import { CaptureError, type CaptureResult } from "@/types";
import type { MeasureResponse } from "@/messaging/events";
import { stitchImages } from "./stitch";
import { createStitcher } from "./stitch/canvasStitcher";
import { MAX_TOTAL_HEIGHT } from "./stitch/limits";
import { ensureContentScript } from "./client/ensureContent";
import { sendProgress, sendToContent } from "./client/contentBridge";
import { isRestrictedUrl, queryActiveTab, withTimeout } from "./captureUtils";
import { calculateTotalTimeout } from "./planner/adaptiveStep";
import { planFullPagePositions } from "./planner/fullPagePlan";
import { computeFullPageOcclusion } from "./planner/occlusion";
import { MAX_PARTS, planSegments } from "./planner/segments";
import { executeCaptureLoop } from "./engine/captureLoop";
import { hideStickyBarsForCapture } from "./client/stickyBars";
import { globalSession } from "./engine/CaptureSession";
import { acquireGlobalLock, heartbeatGlobalLock, releaseGlobalLock } from "./engine/globalLock";
import {
  finalizeCapture,
  notifyFailure,
  persistCapture,
  toCaptureError,
} from "./engine/finalize";
import { deleteCapture, deleteGroup } from "@/storage/idb";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONTENT_TIMEOUT_MS = 3500;
const SCROLL_STABILIZE_MS = 160;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function captureFullPage(): Promise<CaptureResult> {
  globalSession.acquire();
  let tab: chrome.tabs.Tab | null = null;
  let prepared = false;
  let stickyHidden = false;
  let lockToken: string | null = null;

  try {
    tab = await queryActiveTab();

    if (isRestrictedUrl(tab.url)) {
      throw new CaptureError(
        "RESTRICTED_PAGE",
        "Cannot capture this page — browser internal pages are protected. Open a normal website and try again."
      );
    }

    if (tab.id === undefined) throw new CaptureError("NO_ACTIVE_TAB", "No active tab.");

    lockToken = await acquireGlobalLock("full-page", tab.id);

    await ensureContentScript(tab);

    const metrics = await withTimeout(
      sendToContent<MeasureResponse>(tab.id, { type: "SCREENX_MEASURE_PAGE" }),
      CONTENT_TIMEOUT_MS,
      "Measure page"
    );


    const { totalWidth, totalHeight, dpr } = metrics;
    // Bitmap frame is ALWAYS the window viewport (captureVisibleTab photographs
    // the whole tab): planning steps, occlusion bands, and stitch scale must
    // use window dims, never the (possibly narrower/shorter) scroll-container
    // dims — otherwise every strip mis-scales on nested pages. The `??`
    // fallbacks tolerate stale pre-update content scripts.
    const viewportWidth = metrics.winViewportWidth ?? metrics.viewportWidth;
    const viewportHeight = metrics.winViewportHeight ?? metrics.viewportHeight;

    if (!Number.isFinite(totalWidth) || !Number.isFinite(totalHeight) || totalWidth <= 0 || totalHeight <= 0) {
      throw new CaptureError("CAPTURE_FAILED", "Page measurement returned invalid dimensions.");
    }
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      throw new CaptureError("CAPTURE_FAILED", "Viewport measurement invalid.");
    }
    if (totalHeight > MAX_TOTAL_HEIGHT * MAX_PARTS) {
      throw new CaptureError(
        "PAGE_TOO_LARGE",
        "This page is extremely long — even split capture can't cover it. Try a selected-area range instead."
      );
    }

    const occlusion = computeFullPageOcclusion(metrics.fixedElements, viewportWidth, viewportHeight);
    // Robust-HUD contract: the capture loop hides the progress HUD for EVERY
    // exposure, so no reserve band is trimmed. Trimming a fixed band deletes
    // live rows whenever the HUD renders shorter than the reserve — the
    // classic cut-text seam. Only real measured bars are trimmed.
    const occludedTopHeight = occlusion.top;
    const occludedBottomHeight = occlusion.bottom;

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

    // Multi-strip passes hide tiny floating widgets (chat bubbles, FABs)
    // that would otherwise repeat in every strip. Bars/headers/sections are
    // NEVER hidden (capture-as-is: hiding a sticky ancestor deletes its whole
    // subtree from every strip). Measured fixed top/bottom bars are still
    // removed via occlusion TRIMS regardless of hiding — the hider only ever
    // takes unmeasurable widgets now, so trims must stand. Single-shot
    // captures skip hiding so the shot looks exactly like the screen.
    if (totalHeight > viewportHeight) {
      const hide = await hideStickyBarsForCapture(tab.id);
      stickyHidden = hide.active;
    }

    // Calculate positions using shared planner (allowing up to 300 viewports with adaptive stepping)
    const positions = planFullPagePositions(totalHeight, viewportHeight, metrics.maxScrollY, 300, occludedTopHeight, occludedBottomHeight);

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

    const loopResult = await executeCaptureLoop({
      tabId: tab.id,
      windowId: tab.windowId,
      mode: "full-page",
      positions,
      totalTimeout,
      controllerType: metrics.controllerType,
      // Prove liveness per chunk: extends our lock claim so a long capture
      // never expires its own TTL (expiry then means "owner died").
      onChunk: () => {
        if (lockToken) void heartbeatGlobalLock(lockToken);
      },
    });

    const chunks = loopResult.chunks;
    // If scrolling stalled because the page collapsed or its real end moved,
    // don't export a canvas padded with white rows up to the stale measurement.
    // The last settled viewport is the only trustworthy end bound available.
    const capturedHeight =
      loopResult.stoppedEarly && chunks.length > 0
        ? Math.min(totalHeight, Math.max(viewportHeight, chunks[chunks.length - 1]!.y + viewportHeight))
        : totalHeight;
    if (loopResult.stoppedEarly) {
      console.warn("[ScreenX] exporting the settled partial page extent", JSON.stringify({ measuredHeight: totalHeight, capturedHeight }));
    }

    // Unscrollable-but-tall trap: maxScrollY 0 with content taller than the
    // viewport (overflow-hidden containers) collapses to one chunk that the
    // stitcher would silently return as a "full page". Fail honestly instead.
    if (chunks.length === 1 && totalHeight > viewportHeight + 2 && metrics.maxScrollY === 0) {
      throw new CaptureError(
        "CAPTURE_FAILED",
        "This page's content doesn't scroll normally (fixed-height container). Try a selected-area capture instead."
      );
    }

    sendProgress(tab.id, {
      mode: "full-page",
      stage: "Stitching...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    // Oversized pages auto-split into canvas-safe parts stitched from the same chunks.
    const segments = planSegments(totalWidth, 0, capturedHeight, dpr || 1);
    const groupId = segments.length > 1 ? crypto.randomUUID() : undefined;

    const parts: CaptureResult[] = [];
    for (const seg of segments) {
      let stitched;
      if (segments.length === 1) {
        stitched = await stitchImages({
          chunks,
          totalWidth,
          totalHeight: capturedHeight,
          viewportWidth,
          viewportHeight,
          dpr: dpr || 1,
          occludedTopHeight,
          occludedBottomHeight,
        });
      } else {
        sendProgress(tab.id, {
          mode: "full-page",
          stage: `Stitching part ${seg.index}/${seg.total}...`,
          percent: Math.round((totalChunks / totalChunks) * 100),
          currentChunk: totalChunks,
          totalChunks,
        });
        stitched = await createStitcher({
          chunks,
          selection: { x: 0, width: totalWidth, startY: seg.startY, endY: seg.endY },
          viewportWidth,
          viewportHeight,
          dpr: dpr || 1,
          occludedTopHeight,
          occludedBottomHeight,
        }).stitch();
      }
      parts.push({
        id: crypto.randomUUID(),
        type: "full-page",
        dataUrl: stitched.dataUrl || "",
        blob: stitched.blob,
        createdAt: Date.now(),
        sourceTabId: tab.id,
        sourceUrl: tab.url,
        sourceTitle: tab.title,
        width: stitched.width,
        height: stitched.height,
        ...(groupId ? { groupId, partIndex: seg.index, partTotal: seg.total } : {}),
      });
    }
    const first = parts[0]!;
    first.stoppedEarly = loopResult.stoppedEarly || undefined;

    sendProgress(tab.id, {
      mode: "full-page",
      stage: "Finalizing...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    // Atomic-ish group persist: a quota failure mid-loop must not leave a
    // partial stack behind (editor/history would render it as complete).
    const persisted: string[] = [];
    try {
      for (const part of parts) {
        await persistCapture(part);
        persisted.push(part.id);
      }
    } catch (e) {
      // Best-effort compensation for already-stored siblings, then rethrow.
      try {
        if (groupId) await deleteGroup(groupId);
        else for (const id of persisted) await deleteCapture(id);
      } catch {
        // ignore compensation failure
      }
      throw e;
    }


    // No success toast here: the background handler shows the sticky
    // copy → editor/download choice toast after capture returns (it knows
    // the clipboard result, which engines cannot see).

    return first;
  } catch (e) {
    const err = toCaptureError(e);
    void notifyFailure(tab?.id, err, "Failed to capture full page.");
    throw err;
  } finally {
    // Restore WHILE holding the locks, release after (see visible.ts): a
    // successor must not PREPARE while our retried RESTORE is still in flight.
    // Releases are finally-nested + individually guarded against leaks.
    try {
      await finalizeCapture(tab?.id, prepared, stickyHidden);
    } finally {
      try {
        if (lockToken) await releaseGlobalLock(lockToken);
      } catch {
        // ignore — TTL expires it anyway
      }
      globalSession.release();
    }
  }
}
