/**
 * Capture finalization — shared handoff + toast + cleanup helpers.
 * Eliminates the triplicated storePendingCapture / toast / finally blocks
 * in visible.ts / fullPage.ts / selectedArea.ts.
 */
import { CaptureError, type CaptureResult } from "@/types/capture";
import { storePendingCapture } from "@/storage/captureHandoff";
import { deleteCapture } from "@/storage/idb";
import { sendToast, hideProgressHud, restoreCapture, clearCaptureBadge } from "@/messaging/client";

/** Persist a capture; cleans up orphan IDB rows on session-pointer failure. */
export async function persistCapture(result: CaptureResult): Promise<void> {
  try {
    await storePendingCapture(result);
    console.debug("[ScreenX] persist ok:", result.id, { blobBytes: result.blob?.size });
  } catch (e) {
    if (e instanceof CaptureError && e.code === "STORAGE_FAILED") {
      try {
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
  // Best-effort activity log (metadata only; never fails the capture).
  try {
    const { logHistoryEntry } = await import("@/storage/history/activityLog");
    await logHistoryEntry({
      id: result.id,
      type: result.type,
      createdAt: result.createdAt,
      sourceUrl: result.sourceUrl,
      sourceTitle: result.sourceTitle,
      width: result.width,
      height: result.height,
      groupId: result.groupId,
      partIndex: result.partIndex,
      partTotal: result.partTotal,
    });
  } catch {
    // ignore — history is non-critical
  }
}

export function notifySuccess(tabId: number | undefined, message: string): void {
  if (tabId === undefined) return;
  try {
    sendToast(tabId, { type: "success", title: "Capture Complete", message });
  } catch {
    // ignore
  }
}

export function notifyFailure(tabId: number | undefined, err: CaptureError, fallback: string): void {
  // USER_CANCELLED is silent by design; CAPTURE_IN_PROGRESS is reported by
  // the background handler with lock age — a second toast here would double
  // up on genuine overlap.
  if (tabId === undefined || err.code === "USER_CANCELLED" || err.code === "CAPTURE_IN_PROGRESS") return;
  try {
    sendToast(tabId, {
      type: "error",
      title: "Capture Failed",
      message: err.message || fallback,
    });
  } catch {
    // ignore
  }
}

export function toCaptureError(e: unknown, fallback = "Capture failed."): CaptureError {
  if (e instanceof CaptureError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new CaptureError("CAPTURE_FAILED", msg || fallback, {
    cause: e instanceof Error ? e : undefined,
  });
}

/** Best-effort HUD hide + scroll restore (call from finally blocks). */
export async function finalizeCapture(tabId: number | undefined, prepared: boolean): Promise<void> {
  clearCaptureBadge();
  if (tabId === undefined) return;
  await hideProgressHud(tabId);
  if (prepared) {
    try {
      await restoreCapture(tabId);
    } catch (e) {
      console.warn(
        "[ScreenX] restore failed (non-fatal):",
        JSON.stringify({ message: e instanceof Error ? e.message : String(e) })
      );
    }
  }
  console.debug("[ScreenX] finalize done", { tabId, prepared });
}
