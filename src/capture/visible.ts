import { CaptureError, type CaptureResult } from "@/types";
import { isRestrictedUrl, queryActiveTab } from "./captureUtils";
import { ensureContentScript } from "./client/ensureContent";
import { captureVisibleTabThrottled } from "./client/tabCaptureClient";
import { hideProgressHud, restoreCapture, sendProgress, showProgressHud } from "./client/contentBridge";
import { clearCaptureBadge } from "@/messaging/client";
import {
  notifyFailure,
  persistCapture,
  toCaptureError,
} from "./engine/finalize";
import { globalSession } from "./engine/CaptureSession";
import { acquireGlobalLock, releaseGlobalLock } from "./engine/globalLock";

export async function captureVisible(): Promise<CaptureResult> {
  globalSession.acquire();
  let tab: chrome.tabs.Tab | null = null;
  let lockToken: string | null = null;

  try {
    tab = await queryActiveTab();

    if (isRestrictedUrl(tab.url)) {
      throw new CaptureError(
        "RESTRICTED_PAGE",
        "Cannot capture this page — browser internal pages are protected. Open a normal website and try again."
      );
    }

    if (tab.id === undefined) {
      throw new CaptureError("NO_ACTIVE_TAB", "No active tab found. Open a webpage and try again.");
    }

    lockToken = await acquireGlobalLock("visible", tab.id);

    // Visible needs no scrolling, but the post-capture UX (clipboard copy,
    // choice toast, progress HUD) all talk to the content script — ensure a
    // listener exists or they fail silently with "receiving end does not exist".
    await ensureContentScript(tab);

    const totalChunks = 1;
    const completedChunks = 0;

    sendProgress(tab.id, {
      mode: "visible",
      stage: "Preparing...",
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: 0,
      totalChunks,
    });

    sendProgress(tab.id, {
      mode: "visible",
      stage: "Capturing...",
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: 1,
      totalChunks,
    });

    let dataUrl: string;
    try {
      dataUrl = await captureVisibleTabThrottled(
        tab.windowId,
        2,
        async () => {
          if (tab?.id !== undefined) await hideProgressHud(tab.id);
        },
        async () => {
          if (tab?.id !== undefined) await showProgressHud(tab.id);
        }
      );
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("CAPTURE_FAILED", msg, { cause: e as Error });
    }

    const doneChunks = 1;
    sendProgress(tab.id, {
      mode: "visible",
      stage: "Processing...",
      percent: Math.round((doneChunks / totalChunks) * 100),
      currentChunk: 1,
      totalChunks,
    });


    let width: number | undefined;
    let height: number | undefined;
    let blob: Blob | undefined;
    try {
      if (typeof createImageBitmap === "function") {
        const res = await fetch(dataUrl);
        blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      } else if (typeof Image !== "undefined") {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new CaptureError("CAPTURE_FAILED", "Failed to decode captured image."));
          i.src = dataUrl;
        });
        width = img.naturalWidth;
        height = img.naturalHeight;
      }
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("CAPTURE_FAILED", `Image decode failed: ${msg}`, { cause: e instanceof Error ? e : undefined });
    }

    const result: CaptureResult = {
      id: crypto.randomUUID(),
      type: "visible",
      dataUrl,
      blob,
      createdAt: Date.now(),
      sourceTabId: tab.id,
      sourceUrl: tab.url,
      sourceTitle: tab.title,
      width,
      height,
    };

    sendProgress(tab.id, {
      mode: "visible",
      stage: "Finalizing...",
      percent: Math.round((doneChunks / totalChunks) * 100),
      currentChunk: 1,
      totalChunks,
    });

    await persistCapture(result);

    // No success toast here: the background handler shows the sticky
    // copy → editor/download choice toast after capture returns.
    return result;
  } catch (e) {
    const err = toCaptureError(e);
    void notifyFailure(tab?.id, err, "Failed to capture visible area.");
    throw err;
  } finally {
    // Restore WHILE holding the locks, release after: a successor must not
    // PREPARE (and start scrolling) while our retried RESTORE is still in
    // flight — it would reset prepared state and scroll away mid-run.
    // Releases are finally-nested + individually guarded so a throwing HUD
    // call can never leak them (that leak is the phantom CAPTURE_IN_PROGRESS).
    try {
      // Visible has no engine finalize step — clear the badge here so the
      // toolbar never sticks at 100% (progress sets it, nothing else clears it).
      clearCaptureBadge();
      if (tab?.id !== undefined) {
        await hideProgressHud(tab.id);
        await restoreCapture(tab.id);
      }
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

export { isRestrictedUrl as _isRestrictedUrlForTest, queryActiveTab as _queryActiveTabForTest } from "./captureUtils";
