/**
 * Background download handler — save a persisted capture straight to the
 * downloads folder (needs the "downloads" manifest permission).
 *
 * NOTE: downloads run through a data: URL, never URL.createObjectURL —
 * object URLs do not exist in service workers and throw at runtime.
 */
import { blobToDataUrl, getCapture } from "@/storage/idb";
import { sendToastToActiveTab } from "./commandHandler";

export function downloadFilename(date: Date, partIndex?: number, partTotal?: number): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const suffix = partTotal && partTotal > 1 && partIndex ? `-part${partIndex}of${partTotal}` : "";
  return `screenx-${stamp}${suffix}.png`;
}

/** Maximum data URL length that chrome.downloads.download reliably accepts. */
const MAX_DOWNLOAD_DATA_URL_CHARS = 50_000_000;

/** Download a persisted capture by id. Never throws (reports via toast). */
export async function downloadCapture(captureId: string): Promise<void> {
  console.debug("[ScreenX] download requested:", captureId);
  try {
    const record = await getCapture(captureId);
    if (!record) {
      console.debug("[ScreenX] download aborted: record not found:", captureId);
      sendToastToActiveTab({ type: "error", title: "Download failed", message: "Screenshot not found in storage." });
      return;
    }
    const filename = downloadFilename(new Date(record.createdAt), record.partIndex, record.partTotal);
    console.debug("[ScreenX] download starting:", filename, { bytes: record.blob?.size });
    const url = await blobToDataUrl(record.blob);
    if (url.length > MAX_DOWNLOAD_DATA_URL_CHARS) {
      console.warn("[ScreenX] download: data URL too large for chrome.downloads, falling back to content-script download", { chars: url.length });
      // Fall back: send the data URL to the active tab's content script for
      // a synthetic <a download> click (same approach the friend's repo uses).
      const sent = await new Promise<boolean>((resolve) => {
        try {
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (tabId === undefined) { resolve(false); return; }
            chrome.tabs.sendMessage(tabId, { type: "SCREENX_DOWNLOAD_BLOB", dataUrl: url, filename }, (res) => {
              void chrome.runtime.lastError;
              resolve(!!(res as { ok?: boolean } | undefined)?.ok);
            });
          });
        } catch { resolve(false); }
      });
      if (sent) {
        sendToastToActiveTab({ type: "success", title: "Downloaded", message: "Screenshot saved to your downloads folder." });
      } else {
        sendToastToActiveTab({ type: "error", title: "Download failed", message: "Image too large — try capturing a smaller area." });
      }
      return;
    }
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });
    console.debug("[ScreenX] download accepted by browser, id=", downloadId);
    sendToastToActiveTab({ type: "success", title: "Downloaded", message: "Screenshot saved to your downloads folder." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ScreenX] download failed:", captureId, msg);
    sendToastToActiveTab({ type: "error", title: "Download failed", message: msg });
  }
}
