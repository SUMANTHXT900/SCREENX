/**
 * IndexedDB schema (plan: storage/idb/schema.ts).
 */
export const DB_NAME = "screenx";
export const DB_VERSION = 2;
export const STORE_NAME = "captures";

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const oldVersion = event.oldVersion;
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("groupId", "groupId", { unique: false });
        } else if (oldVersion < 2) {
          // Existing DB from v1 — add the missing groupId index
          const tx = (event.target as IDBOpenDBRequest).transaction!;
          const store = tx.objectStore(STORE_NAME);
          if (!store.indexNames.contains("groupId")) {
            store.createIndex("groupId", "groupId", { unique: false });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Don't block other contexts that need to upgrade: close our handle
        // when a version change arrives, and note unexpected closes.
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // ignore
          }
        };
        db.onclose = () => {
          // Connection closed by the browser — next operation reopens it.
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    } catch (e) {
      reject(e);
    }
  });
}
