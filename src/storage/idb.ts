/**
 * IndexedDB layer for ScreenX captures.
 * Stores screenshot Blob + lightweight metadata.
 * Reusable for future Workspace.
 */

import { CaptureError } from "@/types";
import type { CaptureType } from "@/types";

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
}

const DB_NAME = "screenx";
const DB_VERSION = 1;
const STORE_NAME = "captures";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("type", "type", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    } catch (e) {
      reject(e);
    }
  });
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

export function dataUrlToBlob(dataUrl: string): Blob {
  // data:[<mediatype>][;base64],<data>
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
