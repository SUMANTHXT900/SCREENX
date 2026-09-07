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

export async function putCapture(record: CaptureRecord): Promise<void> {
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptureError("STORAGE_FAILED", `IndexedDB put failed: ${msg}`, { cause: e as Error });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
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

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1] ?? "image/png";
  const b64 = match[2] ?? "";
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime ?? "image/png" });
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
