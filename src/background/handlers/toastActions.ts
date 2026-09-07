/**
 * Toast action handlers — what the choice toast's buttons do. Leaf module
 * (no imports from captureHandler) so both the message router and the
 * notification fallback can use it without import cycles.
 */
import { openEditorForCaptureResult } from "@/capture";
import { copyCaptureToClipboard } from "@/capture/clipboard";
import { getCapture } from "@/storage/idb";
import { sendToastToActiveTab } from "./commandHandler";

/** Open the editor for a toast action (single capture or stacked group). */
export async function openEditorForToastAction(captureId: string, groupId?: string): Promise<void> {
  await openEditorForCaptureResult({ id: captureId, groupId });
}

/** Retry a failed clipboard copy from the choice toast's Copy button. */
export async function retryCopyFromToast(captureId: string, tabId?: number): Promise<void> {
  try {
    const record = await getCapture(captureId).catch(() => null);
    const targetTab = tabId ?? record?.sourceTabId;
    const ok = await copyCaptureToClipboard(captureId, record?.blob, targetTab);
    sendToastToActiveTab(
      ok
        ? { type: "success", title: "Copied", message: "Screenshot is on your clipboard — paste it anywhere." }
        : { type: "error", title: "Copy failed", message: "Clipboard is still unavailable — use Download instead." }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendToastToActiveTab({ type: "error", title: "Copy failed", message: msg });
  }
}
