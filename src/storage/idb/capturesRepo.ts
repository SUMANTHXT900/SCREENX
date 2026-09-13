/**
 * Captures repository — IndexedDB CRUD for Blobs + metadata
 * (plan: storage/idb/capturesRepo.ts).
 */
import { CaptureError } from "@/types/capture";
import type { CaptureType } from "@/types/capture";
import { STORE_NAME, openDB } from "./schema";

export interface CaptureRecord {
  id: string;
  blob: Blob;
  type: CaptureType;
  createdAt: number;
  sourceTabId?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  width?: number;
  height?: number;
  groupId?: string;
  partIndex?: number;
  partTotal?: number;
}

async function putOnce(record: CaptureRecord): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("put failed"));
      tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
    });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  if ((e as { name?: unknown }).name === "QuotaExceededError") return true;
  // Some wrappers only preserve the message (e.g. Firefox NS_ERROR_DOM_QUOTA_REACHED).
  const msg = e instanceof Error ? e.message : String(e);
  return /quota/i.test(msg);
}

export async function putCapture(record: CaptureRecord): Promise<void> {
  try {
    await putOnce(record);
    return;
  } catch (e) {
    if (!isQuotaError(e)) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("STORAGE_FAILED", `IndexedDB put failed: ${msg}`, { cause: e as Error });
    }
  }
  // Quota exceeded: evict the single oldest capture, then retry the put once.
  let evicted = false;
  try {
    const all = await listCaptures(1000);
    const oldest = all[all.length - 1];
    if (oldest && oldest.id !== record.id) {
      await deleteCapture(oldest.id);
      evicted = true;
    }
  } catch {
    // ignore eviction failures — the retry below reports honestly
  }
  try {
    await putOnce(record);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptureError(
      "STORAGE_FAILED",
      evicted
        ? `Storage is full — removed the oldest capture and retried, but the save still failed (${msg}). Free disk space or delete old captures from the Workspace.`
        : `Storage is full and no old capture could be evicted (${msg}). Free disk space or delete old captures from the Workspace.`,
      { cause: e as Error }
    );
  }
}

export async function getCapture(id: string): Promise<CaptureRecord | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const record = await new Promise<CaptureRecord | undefined>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as CaptureRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("get failed"));
    });
    return record ?? null;
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptureError("STORAGE_FAILED", `IndexedDB get failed: ${msg}`, { cause: e as Error });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export async function deleteCapture(id: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("delete failed"));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptureError("STORAGE_FAILED", `IndexedDB delete failed: ${msg}`, { cause: e as Error });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Lightweight row count for badges (popup). Uses IDB count() — no blob
 * deserialization, safe to call on every popup open.
 */
export async function countCaptures(): Promise<number> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const n = await new Promise<number>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(typeof req.result === "number" ? req.result : 0);
      req.onerror = () => reject(req.error ?? new Error("count failed"));
    });
    return n;
  } catch {
    return 0;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export async function listCaptures(limit = 100): Promise<CaptureRecord[]> {  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const records = await new Promise<CaptureRecord[]>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("createdAt");
      const results: CaptureRecord[] = [];
      const req = index.openCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value as CaptureRecord);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("list failed"));
    });
    return records;
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptureError("STORAGE_FAILED", `IndexedDB list failed: ${msg}`, { cause: e as Error });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) throw new Error("Invalid data URL");
  let res: Response;
  try {
    res = await fetch(dataUrl);
  } catch (e) {
    throw new Error(`Invalid data URL: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error("Invalid data URL");
  return await res.blob();
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** All parts of an auto-split capture, ordered by partIndex. */
export async function getCapturesByGroup(groupId: string): Promise<CaptureRecord[]> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    // Use the groupId index if available (schema v2+), otherwise fall back to full scan.
    if (store.indexNames.contains("groupId")) {
      const index = store.index("groupId");
      const records = await new Promise<CaptureRecord[]>((resolve, reject) => {
        const results: CaptureRecord[] = [];
        const req = index.openCursor(IDBKeyRange.only(groupId));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            results.push(cursor.value as CaptureRecord);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => reject(req.error ?? new Error("group query failed"));
      });
      return records.sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0));
    }
    // Fallback for pre-v2 databases without the index
    const all = await listCaptures(500);
    return all
      .filter((r) => r.groupId === groupId)
      .sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0));
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptureError("STORAGE_FAILED", `IndexedDB group query failed: ${msg}`, { cause: e as Error });
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/** Delete every part of an auto-split group. */
export async function deleteGroup(groupId: string): Promise<void> {
  const parts = await getCapturesByGroup(groupId);
  for (const p of parts) {
    try {
      await deleteCapture(p.id);
    } catch {
      // ignore single failures, keep deleting the rest
    }
  }
}
