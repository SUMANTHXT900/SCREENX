import { CaptureError, type CaptureResult, type ProgressPayload } from "@/types";
import { storePendingCapture } from "@/storage/captureHandoff";
import { isRestrictedUrl, queryActiveTab } from "./captureUtils";
import { captureVisibleTabThrottled } from "./captureVisibleTab";

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

export async function captureVisible(): Promise<CaptureResult> {
  let tab: chrome.tabs.Tab | null = null;

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

    const totalChunks = 1;
    let completedChunks = 0;

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
          if (tab?.id) {
            try {
              await new Promise<void>((resolve) => {
                chrome.tabs.sendMessage(tab!.id!, { type: "SCREENX_HIDE_PROGRESS" }, () => {
                  void chrome.runtime.lastError;
                  resolve();
                });
              });
            } catch {
              // ignore
            }
          }
        },
        async () => {
          if (tab?.id) {
            try {
              await new Promise<void>((resolve) => {
                chrome.tabs.sendMessage(tab!.id!, { type: "SCREENX_SHOW_PROGRESS" }, () => {
                  void chrome.runtime.lastError;
                  resolve();
                });
              });
            } catch {
              // ignore
            }
          }
        }
      );
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("CAPTURE_FAILED", msg, { cause: e as Error });
    }

    completedChunks = 1;
    sendProgress(tab.id, {
      mode: "visible",
      stage: "Processing...",
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: 1,
      totalChunks,
    });

    console.debug("[ScreenX] visible capture", JSON.stringify({ windowId: tab.windowId, dataUrlLength: dataUrl.length }));

    // Try to get viewport dimensions for metadata
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
      percent: Math.round((completedChunks / totalChunks) * 100),
      currentChunk: 1,
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
          // ignore cleanup failure
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
              message: "Visible area captured successfully.",
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
              message: err.message || "Failed to capture visible area.",
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
        await new Promise<void>((resolve) => {
          chrome.tabs.sendMessage(tab!.id!, { type: "SCREENX_HIDE_PROGRESS" }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        });
      } catch {
        // ignore
      }
      try {
        await new Promise<void>((resolve) => {
          chrome.tabs.sendMessage(tab!.id!, { type: "SCREENX_RESTORE_CAPTURE" }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        });
      } catch {
        // ignore
      }
    }
  }
}

export { isRestrictedUrl as _isRestrictedUrlForTest, queryActiveTab as _queryActiveTabForTest };
