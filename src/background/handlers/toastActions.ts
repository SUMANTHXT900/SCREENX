/**
 * Toast action handlers — what the choice toast's buttons do. Leaf module
 * (no imports from captureHandler) so both the message router and the
 * notification fallback can use it without import cycles.
 */
import { openEditorForCaptureResult } from "@/capture";
import { encodeForClipboard } from "@/capture/clipboard";
import { getCapture } from "@/storage/idb";
import { sendToastToActiveTab } from "./commandHandler";
import { attemptCopyWithFocus, readTab } from "./copyAttempt";
import { ensureContentScript } from "@/capture/client/ensureContent";
import { CaptureError } from "@/types/capture";

/** Open the editor for a toast action (single capture or stacked group). */
export async function openEditorForToastAction(captureId: string, groupId?: string): Promise<void> {
  await openEditorForCaptureResult({ id: captureId, groupId });
}

/**
 * Retry a failed clipboard copy from the choice toast's Copy button.
 * This runs in the worker (the click gesture does NOT propagate through the
 * message round trip), so it gets the same focus assist as the automatic
 * copy. Honest outcomes:
 * - oversized (encode null) → say so; no doomed re-attempt.
 * - missing record/blob/tab → say what's missing.
 * - content not listening → best-effort re-ensure, then report precisely.
 */
export async function retryCopyFromToast(captureId: string, tabId?: number): Promise<void> {
  const log = `retry-copy [${captureId}]`;
  try {
    const record = await getCapture(captureId).catch(() => null);
    const targetTab = tabId ?? record?.sourceTabId;
    if (!record || !record.blob || record.blob.size === 0) {
      console.debug(`[ScreenX] ${log} → no stored image; pointing at Download`);
      sendToastToActiveTab({
        type: "error",
        title: "Copy failed",
        message: "Screenshot data is gone — use Download instead.",
      });
      return;
    }
    if (targetTab === undefined) {
      sendToastToActiveTab({
        type: "error",
        title: "Copy failed",
        message: "No target tab — open the Editor and copy from there.",
      });
      return;
    }
    // Oversized images can never cross message transport: the automatic copy
    // already proved encode null, and re-encoding the same blob repeats it.
    // Say so instead of attempting a doomed write.
    const dataUrl = await encodeForClipboard(record.blob);
    if (!dataUrl) {
      console.debug(`[ScreenX] ${log} → oversized, skipping write`);
      sendToastToActiveTab({
        type: "error",
        title: "Copy failed",
        message: "Image is too large for the clipboard — use Download.",
      });
      return;
    }
    // The tab may have navigated since capture (stale content script).
    // Best-effort re-ensure: failure surfaces precisely instead of a bare
    // "receiving end does not exist".
    try {
      const tab = await chrome.tabs.get(targetTab);
      await ensureContentScript(tab);
    } catch (e) {
      const msg = e instanceof CaptureError ? e.message : e instanceof Error ? e.message : String(e);
      console.debug(`[ScreenX] ${log} → content unavailable:`, msg);
      sendToastToActiveTab({ type: "error", title: "Copy failed", message: msg });
      return;
    }
    const { windowId } = await readTab(targetTab);
    const attempt = await attemptCopyWithFocus(targetTab, dataUrl, windowId, log);
    if (attempt.copied) {
      sendToastToActiveTab({
        type: "success",
        title: "Copied",
        message: "Screenshot is on your clipboard — paste it anywhere.",
      });
      return;
    }
    const err = attempt.lastReport?.error ?? "refused";
    console.debug(`[ScreenX] ${log} → final failure:`, err, { focused: attempt.lastReport?.focused });
    sendToastToActiveTab({
      type: "error",
      title: "Copy failed",
      message:
        attempt.lastReport?.focused === false
          ? "The tab still isn't focused — click the page, then tap Copy again."
          : `Clipboard refused the write (${err}) — use Download instead.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendToastToActiveTab({ type: "error", title: "Copy failed", message: msg });
  }
}
