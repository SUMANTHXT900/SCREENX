import type { PendingCapture } from "@/types";
import { CaptureError } from "@/types";
import { dataUrlToBlob, getCapture, putCapture } from "./idb";

const PREFIX = "screenx:pending:";

/** Stable session key for the most-recent capture (overwritten each time) */
export const LATEST_PENDING_KEY = `${PREFIX}latest`;

export function pendingKey(id: string): string {
  return `${PREFIX}${id}`;
}

function getSessionArea(): chrome.storage.StorageArea | null {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      return chrome.storage.session;
    }
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      return chrome.storage.local;
    }
  } catch {
    // ignore
  }
  return null;
}

function fallbackStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Store a pending capture.
 * - Converts dataUrl → Blob and stores in IndexedDB (avoids session quota)
 * - Stores lightweight pointer {id} in chrome.storage.session (never large payload)
 */
export async function storePendingCapture(capture: PendingCapture): Promise<void> {
  // Use existing Blob if available (avoids expensive base64 encoding/decoding)
  let blob: Blob;
  if (capture.blob instanceof Blob) {
    blob = capture.blob;
  } else {
    try {
      blob = dataUrlToBlob(capture.dataUrl);
    } catch (e) {
      throw new CaptureError("STORAGE_FAILED", `Failed to convert screenshot to Blob: ${e instanceof Error ? e.message : String(e)}`, {
        cause: e as Error,
      });
    }
  }

  // Store Blob + metadata in IndexedDB
  try {
    await putCapture({
      id: capture.id,
      blob,
      type: capture.type,
      createdAt: capture.createdAt,
      sourceTabId: capture.sourceTabId,
      sourceUrl: capture.sourceUrl,
      sourceTitle: capture.sourceTitle,
      width: capture.width,
      height: capture.height,
    });
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError("STORAGE_FAILED", `IndexedDB store failed: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e as Error,
    });
  }

  // Store lightweight pointer in session storage
  const area = getSessionArea();
  const lightweight = { id: capture.id, type: capture.type, createdAt: capture.createdAt } as Record<string, unknown>;

  const payloadSession: Record<string, unknown> = {
    [pendingKey(capture.id)]: lightweight,
    [LATEST_PENDING_KEY]: lightweight,
  };

  if (area) {
    try {
      await area.set(payloadSession);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Cleanup IDB to avoid orphan
      try {
        const { deleteCapture } = await import("./idb");
        await deleteCapture(capture.id);
      } catch {
        // ignore cleanup failure
      }
      throw new CaptureError("STORAGE_FAILED", `Session pointer store failed: ${msg}`, { cause: e as Error });
    }
  }

  const fallback = fallbackStorage();
  if (fallback) {
    try {
      fallback.setItem(pendingKey(capture.id), JSON.stringify(lightweight));
      fallback.setItem(LATEST_PENDING_KEY, JSON.stringify(lightweight));
      return;
    } catch (e) {
      try {
        const { deleteCapture } = await import("./idb");
        await deleteCapture(capture.id);
      } catch {
        // ignore
      }
      throw new CaptureError("STORAGE_FAILED", `Fallback storage failed: ${e instanceof Error ? e.message : String(e)}`, {
        cause: e as Error,
      });
    }
  }

  throw new CaptureError("STORAGE_FAILED", "No storage area available for capture handoff");
}

async function loadFromIdb(id: string): Promise<PendingCapture | null> {
  try {
    const record = await getCapture(id);
    if (!record) return null;
    // Create object URL for display; caller should revoke when done
    const objectUrl = URL.createObjectURL(record.blob);
    const pending: PendingCapture = {
      id: record.id,
      type: record.type,
      dataUrl: objectUrl,
      createdAt: record.createdAt,
      sourceTabId: record.sourceTabId,
      sourceUrl: record.sourceUrl,
      sourceTitle: record.sourceTitle,
      width: record.width,
      height: record.height,
    };
    return pending;
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError("STORAGE_FAILED", `IndexedDB load failed: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e as Error,
    });
  }
}

export async function getPendingCapture(id: string): Promise<PendingCapture | null> {
  // First, verify session pointer exists (lightweight check), but primary is IDB
  // We attempt IDB directly; session pointer is just for latest fallback and existence check
  return await loadFromIdb(id);
}

export async function getLatestPendingCapture(): Promise<PendingCapture | null> {
  const area = getSessionArea();

  let latestId: string | null = null;

  if (area) {
    try {
      const result = await area.get(LATEST_PENDING_KEY);
      const val = (result as Record<string, unknown>)[LATEST_PENDING_KEY] as { id?: string } | undefined;
      if (val?.id) latestId = val.id;
    } catch {
      // ignore, fall through to fallback
    }
  }

  if (!latestId) {
    const fallback = fallbackStorage();
    if (fallback) {
      try {
        const raw = fallback.getItem(LATEST_PENDING_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { id?: string };
          if (parsed?.id) latestId = parsed.id;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!latestId) return null;
  return await loadFromIdb(latestId);
}

export async function clearPendingCapture(id: string): Promise<void> {
  // Note: we keep IDB record for potential Workspace later; only clear session pointer
  const area = getSessionArea();
  if (area) {
    try {
      await area.remove([pendingKey(id)]);
    } catch {
      // ignore
    }
    return;
  }
  const fallback = fallbackStorage();
  if (fallback) {
    try {
      fallback.removeItem(pendingKey(id));
    } catch {
      // ignore
    }
  }
}
