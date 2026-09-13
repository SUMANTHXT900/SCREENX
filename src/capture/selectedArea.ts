import { CaptureError, type CaptureResult } from "@/types";
import type { MeasureResponse, RangeSelection, RegionSelection } from "@/messaging/events";
import { isRestrictedUrl, queryActiveTab, withTimeout } from "./captureUtils";
import { calculateTotalTimeout } from "./planner/adaptiveStep";
import { planRangePositions, selectionRangeToTargets } from "./planner/rangePlan";
import { computeRangeOcclusion } from "./planner/occlusion";
import { HUD_RESERVE_PX } from "./stitch/limits";
import { planSegments } from "./planner/segments";
import { ensureContentScript } from "./client/ensureContent";
import { sendProgress, sendToContent } from "./client/contentBridge";
import { sendToast } from "@/messaging/client";
import { executeCaptureLoop } from "./engine/captureLoop";
import { hideStickyBarsForCapture } from "./client/stickyBars";
import { globalSession } from "./engine/CaptureSession";
import { acquireGlobalLock, heartbeatGlobalLock, releaseGlobalLock } from "./engine/globalLock";
import {
  clearPendingSelection,
  registerPendingSelection,
  takePendingSelection,
  type PendingSelection,
} from "./selectionPending";
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
const SELECTION_TIMEOUT_MS = 120_000;

/** Survives worker restarts so an orphaned selection wait can be closed loudly. */
const SELECTION_WAIT_KEY = "screenx:selection-wait";

interface SelectionWaitMarker {
  tabId: number;
  ts: number;
}

async function saveSelectionWait(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.set({ [SELECTION_WAIT_KEY]: { tabId, ts: Date.now() } satisfies SelectionWaitMarker });
  } catch {
    // ignore — recovery is best-effort
  }
}

async function clearSelectionWait(): Promise<void> {
  try {
    await chrome.storage.session.remove([SELECTION_WAIT_KEY]);
  } catch {
    // ignore
  }
}

/**
 * SW-startup recovery: if a previous worker died mid-selection-wait, its
 * overlay (if any) belongs to a dead run and its completion event has no
 * listener. Tear the overlay down and say so — an explicit retry beats a
 * silent loss. Stale markers clear quietly (overlay long gone).
 */
export async function recoverInterruptedSelection(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(SELECTION_WAIT_KEY);
    const marker = (stored as Record<string, unknown>)[SELECTION_WAIT_KEY] as SelectionWaitMarker | undefined;
    await clearSelectionWait();
    if (!marker || typeof marker.tabId !== "number") return;
    if (Date.now() - marker.ts > SELECTION_TIMEOUT_MS) return;
    try {
      chrome.tabs.sendMessage(marker.tabId, { type: "SCREENX_CANCEL_SELECTION" }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // ignore
    }
    try {
      sendToast(marker.tabId, {
        type: "error",
        title: "Selection interrupted",
        message: "The capture worker restarted — please select the area again.",
      });
    } catch {
      // ignore
    }
  } catch {
    // ignore — recovery is best-effort
  }
}

// ---------------------------------------------------------------------------
// Selection via content script
// ---------------------------------------------------------------------------

function waitForSelection(tabId: number): Promise<RegionSelection> {
  return new Promise<RegionSelection>((resolve, reject) => {
    // eslint-disable-next-line prefer-const
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const record: PendingSelection = {
      tabId,
      onSuperseded: () => {
        settle();
        reject(new CaptureError("USER_CANCELLED", "Selection superseded by a newer capture request."));
      },
    };

    const handler = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return false as unknown as void;

      const msg = message as { type?: string; selection?: RegionSelection };
      if (msg.type === "SCREENX_SELECTION_COMPLETE") {
        settle();
        if (!msg.selection) {
          reject(new CaptureError("CAPTURE_FAILED", "Selection completed but no data received."));
          return true;
        }
        const sel = msg.selection;
        if (
          typeof sel.boxLeft !== "number" ||
          typeof sel.boxTop !== "number" ||
          typeof sel.boxWidth !== "number" ||
          typeof sel.boxHeight !== "number" ||
          typeof sel.startScrollTop !== "number" ||
          typeof sel.endScrollTop !== "number" ||
          typeof sel.x !== "number" ||
          typeof sel.width !== "number" ||
          !Number.isFinite(sel.boxLeft) ||
          !Number.isFinite(sel.boxTop) ||
          !Number.isFinite(sel.boxWidth) ||
          !Number.isFinite(sel.boxHeight) ||
          !Number.isFinite(sel.startScrollTop) ||
          !Number.isFinite(sel.endScrollTop) ||
          !Number.isFinite(sel.x) ||
          !Number.isFinite(sel.width)
        ) {
          reject(new CaptureError("INVALID_SELECTION", "Invalid selection data."));
          return true;
        }
        resolve(sel);
        return true;
      }
      if (msg.type === "SCREENX_SELECTION_CANCEL") {
        settle();
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

    /** Settle once: drop the listener AND unregister (complete/cancel/timeout/supersede). */
    const settle = () => {
      cleanup();
      clearPendingSelection(record);
      void clearSelectionWait();
    };

    chrome.runtime.onMessage.addListener(handler as unknown as (m: unknown, s: chrome.runtime.MessageSender, r: (x: unknown) => void) => boolean | void);
    // Persist the wait so a worker restart can close it loudly instead of
    // losing the user's completed drag silently (see recoverInterruptedSelection).
    void saveSelectionWait(tabId);

    // Register synchronously (no await before this): a same-tick second
    // trigger supersedes us immediately instead of both waits surviving.
    const prev = registerPendingSelection(record);
    if (prev) {
      try {
        prev.onSuperseded();
      } catch {
        // ignore
      }
    }

    timeoutId = setTimeout(() => {
      settle();
      try {
        chrome.tabs.sendMessage(tabId, { type: "SCREENX_CANCEL_SELECTION" }, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        // ignore
      }
      reject(new CaptureError("TIMEOUT", "Selection timed out. Please try again."));
    }, SELECTION_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, { type: "SCREENX_START_SELECTION" }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        settle();
        const msg = err.message ?? "Unknown error";
        if (/Receiving end does not exist/i.test(msg)) {
          reject(new CaptureError("CONTENT_SCRIPT_NOT_READY", "Content script not ready. Please reload the page and try again.", { cause: err }));
        } else {
          reject(new CaptureError("CAPTURE_FAILED", msg, { cause: err }));
        }
        return;
      }
      // Render acknowledgment: transport success only means the message
      // arrived — the overlay must ALSO have mounted. A stale content script
      // (extension updated, tab not reloaded) answers {ok:true} with no
      // render flag; anything but rendered:true is a loud, actionable error
      // instead of a 120s silent hang with no selection UI.
      const ack = res as { ok?: boolean; rendered?: boolean; error?: string } | undefined;
      if (!ack || ack.ok !== true || ack.rendered !== true) {
        settle();
        reject(
          new CaptureError(
            "CONTENT_SCRIPT_NOT_READY",
            ack?.error ?? "Selection UI didn't open on this page. Reload the tab and try again."
          )
        );
      }
      // else: overlay is up — keep waiting for COMPLETE / CANCEL / timeout.
    });
  });
}

/**
 * Cancel a pending selection wait from OUTSIDE the engine (a newer trigger in
 * handleCapture). Rejects the stale waiter so its run unwinds quietly, and
 * tells the tab to tear the overlay down — silently (DISMISS, not CANCEL, so
 * no SELECTION_CANCEL message can land in a fresh waiter's listener).
 */
export function cancelPendingSelection(): void {
  const pending = takePendingSelection();
  if (!pending) return;
  try {
    pending.onSuperseded();
  } catch {
    // ignore
  }
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.sendMessage) {
      chrome.tabs.sendMessage(pending.tabId, { type: "SCREENX_DISMISS_SELECTION" }, () => {
        void chrome.runtime?.lastError;
      });
    }
  } catch {
    // ignore — overlay teardown is best-effort; a fresh START resets it anyway
  }
}

// ---------------------------------------------------------------------------
// Targeted stitch for selected range (thin wrapper over CanvasStitcher)
// ---------------------------------------------------------------------------

import type { StitchChunk, StitchOutput } from "./stitch/canvasStitcher";
import { createStitcher } from "./stitch/canvasStitcher";

export type { StitchChunk, StitchOutput };

export async function stitchSelectedRange(
  chunks: StitchChunk[],
  selection: RangeSelection,
  metrics: { viewportWidth: number; viewportHeight: number; dpr: number; occludedTopHeight?: number; occludedBottomHeight?: number }
): Promise<StitchOutput> {
  const stitcher = createStitcher({
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
  let tab: chrome.tabs.Tab | null = null;
  let prepared = false;
  let stickyHidden = false;
  let lockToken: string | null = null;
  // Ownership flag: the selection wait below holds NO locks, so a superseded
  // run unwinds through finally without touching a successor's locks.
  let sessionHeld = false;

  try {
    tab = await queryActiveTab();
    if (isRestrictedUrl(tab.url)) {
      throw new CaptureError("RESTRICTED_PAGE", "Cannot capture this page — browser internal pages are protected.");
    }
    if (tab.id === undefined) throw new CaptureError("NO_ACTIVE_TAB", "No active tab.");

    await ensureContentScript(tab);

    // NO locks held here: selection is pure tab UI and unbounded (the user
    // may take up to 120s to drag). Holding the capture lock across it is
    // what produced the phantom CAPTURE_IN_PROGRESS on any re-trigger —
    // a newer trigger supersedes this wait via the pending registry instead.
    const selection = await waitForSelection(tab.id);

    // Locks from here on: the bounded, interleaving-unsafe capture phase.
    globalSession.acquire();
    sessionHeld = true;
    lockToken = await acquireGlobalLock("selected-area", tab.id);

    // Pin the scroll target to the container behind the selection box center
    // BEFORE measuring: selection and capture must scroll the same element,
    // otherwise the range maps onto the wrong scroller (nested pages).
    // Best-effort — failure falls back to the prepare-time guess.
    try {
      await sendToContent<{ ok: boolean }>(
        tab.id,
        {
          type: "SCREENX_RESOLVE_CONTAINER",
          x: selection.boxLeft + selection.boxWidth / 2,
          y: selection.boxTop + selection.boxHeight / 2,
        },
        CONTENT_TIMEOUT_MS
      );
    } catch {
      // ignore — prepareCapture resolves on its own
    }

    // Range targets are TRUE content rows: box + scroll − container rect at
    // selection time (explicit frame; the stitcher maps back through the
    // per-chunk rect, so window scroll between selection and capture is fine).
    const converted = selectionRangeToTargets(
      selection.boxTop,
      selection.boxHeight,
      selection.startScrollTop,
      selection.endScrollTop,
      selection.containerRectTop ?? 0
    );
    const startY = Math.max(0, converted.startY);
    const endY = converted.endY;
    let x = selection.x;
    let width = selection.width;

    // NOTE: no post-release scroll adjustment is applied. Scroll coordinates
    // are absolute and the loop re-scrolls to absolute positions, so any
    // movement between release and capture is inherently irrelevant — the
    // only readings that matter are the settle-then-read values in the
    // payload. (A drift-chasing re-anchor here double-counts and shifts the
    // range; virtualized lists even compensate scrollTop to keep the view
    // stable, which would turn into pure error.)

    if (width <= 0 || endY - startY <= 0) {
      throw new CaptureError("INVALID_SELECTION", "Invalid selection. Please try again.");
    }

    if (width < 10) throw new CaptureError("INVALID_SELECTION", "Selection too narrow.");
    if (endY - startY < 10) throw new CaptureError("INVALID_SELECTION", "Selection too short. Drag a taller box.");
    if (width > 10000) {
      throw new CaptureError("PAGE_TOO_LARGE", "Selected area is too wide. Zoom out or pick a narrower region.");
    }
    // NOTE: over-tall ranges no longer throw here — they auto-split into
    // canvas-safe parts below (planSegments throws only past the part cap).

    if (x < 0) {
      width += x;
      x = 0;
    }

    const normalizedSelection: RangeSelection = { x, width, startY, endY };


    const metrics = await withTimeout(
      sendToContent<MeasureResponse>(
        tab.id,
        { type: "SCREENX_MEASURE_PAGE" }
      ),
      CONTENT_TIMEOUT_MS,
      "Measure for selected area"
    );

    const dpr = metrics.dpr || 1;
    // Bitmap frame is ALWAYS the window viewport (captureVisibleTab photographs
    // the whole tab): planning steps, occlusion bands, and stitch scale must
    // use window dims, never the (possibly narrower/shorter) scroll-container
    // dims — otherwise every strip mis-scales on nested pages. The `??`
    // fallbacks tolerate stale pre-update content scripts.
    const viewportWidth = metrics.winViewportWidth ?? metrics.viewportWidth;
    const viewportHeight = metrics.winViewportHeight ?? metrics.viewportHeight;

    // Stale-coordinate guard: the page may have shifted between the user's
    // clicks and this measurement (lazy content, virtualized lists). A range
    // far outside the measured document means the coordinates no longer map
    // to what the user saw — reselect instead of capturing garbage.
    const margin = viewportHeight * 2;
    if (
      Number.isFinite(metrics.totalHeight) &&
      (startY < -margin || endY > metrics.totalHeight + margin)
    ) {
      throw new CaptureError(
        "INVALID_SELECTION",
        "The page shifted while you were selecting (lazy-loaded content moved things around). Please reselect the range and try again."
      );
    }

    const occlusion = computeRangeOcclusion(
      metrics.fixedElements,
      viewportHeight,
      normalizedSelection.x,
      normalizedSelection.x + normalizedSelection.width
    );
    // Constant-HUD contract: see fullPage.ts — surviving trim is whichever is
    // larger (real bars or the always-visible HUD).
    let occludedTopHeight = Math.max(occlusion.top, HUD_RESERVE_PX);
    let occludedBottomHeight = occlusion.bottom;

    if (metrics.controllerType && metrics.controllerType !== "window") {
      console.warn("[ScreenX][SelectedArea] nested controller detected", JSON.stringify(metrics));
    }

    await withTimeout(sendToContent<{ ok: true }>(tab.id, { type: "SCREENX_PREPARE_CAPTURE" }), CONTENT_TIMEOUT_MS, "Prepare");
    prepared = true;

    // Multi-strip passes hide fixed/sticky bars overlapping the selection
    // band instead of trimming them (see fullPage.ts — same rationale).
    // Single-shot captures skip hiding so the shot looks like the screen.
    if (endY - startY > viewportHeight) {
      const hide = await hideStickyBarsForCapture(
        tab.id,
        normalizedSelection.x,
        normalizedSelection.x + normalizedSelection.width
      );
      stickyHidden = hide.active;
      if (hide.active) {
        occludedTopHeight = HUD_RESERVE_PX;
        occludedBottomHeight = 0;
      }
    }

    const positions = planRangePositions(startY, endY, viewportHeight, metrics.maxScrollY, 300, occludedTopHeight, occludedBottomHeight);

    if (positions.length === 0) throw new CaptureError("CAPTURE_FAILED", "No positions to capture.");

    const totalChunks = positions.length;

    sendProgress(tab.id, {
      mode: "selected-area",
      stage: "Preparing...",
      percent: Math.round((0 / totalChunks) * 100),
      currentChunk: 0,
      totalChunks,
    });

    const totalTimeout = calculateTotalTimeout(positions.length, SCROLL_STABILIZE_MS, 600, 2000);

    const chunks: StitchChunk[] = [];

    const loopResult = await executeCaptureLoop({
      tabId: tab.id,
      windowId: tab.windowId,
      mode: "selected-area",
      positions,
      totalTimeout,
      controllerType: metrics.controllerType,
      // Liveness heartbeat — see fullPage.ts (same contract).
      onChunk: () => {
        if (lockToken) void heartbeatGlobalLock(lockToken);
      },
    });

    chunks.push(...loopResult.chunks);
    let captureEndY = endY;
    if (loopResult.stoppedEarly && chunks.length > 0) {
      // Avoid a white tail when a virtualized/collapsing scroller stops before
      // the stale selection end. The final settled viewport bounds the usable
      // target; preserve at least one pixel of the selected range.
      captureEndY = Math.min(endY, Math.max(startY + 1, chunks[chunks.length - 1]!.y + viewportHeight));
      console.warn("[ScreenX][SelectedArea] exporting settled partial range", JSON.stringify({ requestedEndY: endY, captureEndY }));
    }

    sendProgress(tab.id, {
      mode: "selected-area",
      stage: "Stitching...",
      percent: Math.round((totalChunks / totalChunks) * 100),
      currentChunk: totalChunks,
      totalChunks,
    });

    // Over-tall ranges auto-split into canvas-safe parts stitched from the same chunks.
    const segments = planSegments(normalizedSelection.width, startY, captureEndY, dpr);
    const groupId = segments.length > 1 ? crypto.randomUUID() : undefined;

    const parts: CaptureResult[] = [];
    for (const seg of segments) {
      if (segments.length > 1) {
        sendProgress(tab.id, {
          mode: "selected-area",
          stage: `Stitching part ${seg.index}/${seg.total}...`,
          percent: Math.round((totalChunks / totalChunks) * 100),
          currentChunk: totalChunks,
          totalChunks,
        });
      }
      const stitched = await stitchSelectedRange(
        chunks,
        { x: normalizedSelection.x, width: normalizedSelection.width, startY: seg.startY, endY: seg.endY },
        {
          viewportWidth,
          viewportHeight,
          dpr,
          occludedTopHeight,
          occludedBottomHeight,
        }
      );
      parts.push({
        id: crypto.randomUUID(),
        type: "selected-area",
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
      mode: "selected-area",
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
    // copy → editor/download choice toast after capture returns.

    return first;
  } catch (e) {
    const err = toCaptureError(e);
    void notifyFailure(tab?.id, err, "Failed to capture selected area.");
    throw err;
  } finally {
    // Restore WHILE holding the locks, release after (see visible.ts).
    // sessionHeld: a superseded selection wait owns nothing — releasing
    // unconditionally here would clear a SUCCESSOR's live lock.
    try {
      await finalizeCapture(tab?.id, prepared, stickyHidden);
    } finally {
      try {
        if (lockToken) await releaseGlobalLock(lockToken);
      } catch {
        // ignore — TTL expires it anyway
      }
      if (sessionHeld) globalSession.release();
    }
  }
}
