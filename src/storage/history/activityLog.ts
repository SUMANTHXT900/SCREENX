/**
 * Activity history — lightweight capture-event log (metadata only, no blobs).
 * Stored in chrome.storage.local (capped), separate from Workspace by design.
 */
import type { CaptureType } from "@/types/capture";

export interface HistoryEntry {
  id: string;
  type: CaptureType;
  createdAt: number;
  sourceUrl?: string;
  sourceTitle?: string;
  width?: number;
  height?: number;
  /** Shared by auto-split parts of one capture. */
  groupId?: string;
  partIndex?: number;
  partTotal?: number;
}

const KEY = "screenx:history";
const MAX_ENTRIES = 200;
/** Ids the user explicitly deleted — backfill must not resurrect them. */
const TOMBSTONE_KEY = "screenx:history:deleted";
const MAX_TOMBSTONES = 500;

function area(): chrome.storage.StorageArea | null {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  } catch {
    // ignore
  }
  return null;
}

function fallback(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // ignore
  }
  return null;
}

export async function logHistoryEntry(entry: HistoryEntry): Promise<void> {
  const list = await listHistory();
  const next = [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES);
  const a = area();
  if (a) {
    try {
      await a.set({ [KEY]: next });
      return;
    } catch {
      // fall through to fallback
    }
  }
  try {
    fallback()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore — history is best-effort
  }
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const a = area();
  if (a) {
    try {
      const res = await a.get(KEY);
      const val = (res as Record<string, unknown>)[KEY];
      if (Array.isArray(val)) return val as HistoryEntry[];
    } catch {
      // fall through
    }
  }
  try {
    const raw = fallback()?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as HistoryEntry[];
    }
  } catch {
    // ignore
  }
  return [];
}

export async function clearHistory(ids: string[] = []): Promise<void> {
  const a = area();
  if (a) {
    try {
      await a.remove([KEY]);
    } catch {
      // ignore
    }
  }
  try {
    fallback()?.removeItem(KEY);
  } catch {
    // ignore
  }
  // Cleared lines must stay cleared — tombstone them so the next
  // reconcile doesn't backfill the (still-stored) images.
  await addTombstones(ids);
}

async function readTombstones(): Promise<string[]> {
  const a = area();
  if (a) {
    try {
      const res = await a.get(TOMBSTONE_KEY);
      const val = (res as Record<string, unknown>)[TOMBSTONE_KEY];
      if (Array.isArray(val)) return (val as unknown[]).filter((v): v is string => typeof v === "string");
    } catch {
      // fall through
    }
  }
  try {
    const raw = fallback()?.getItem(TOMBSTONE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

/** Ids explicitly deleted by the user. Never throws. */
export async function listTombstones(): Promise<string[]> {
  try {
    return await readTombstones();
  } catch {
    return [];
  }
}

async function addTombstones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const merged = [...new Set([...(await readTombstones()), ...ids])].slice(-MAX_TOMBSTONES);
    const a = area();
    if (a) {
      try {
        await a.set({ [TOMBSTONE_KEY]: merged });
        return;
      } catch {
        // fall through to fallback
      }
    }
    try {
      fallback()?.setItem(TOMBSTONE_KEY, JSON.stringify(merged));
    } catch {
      // ignore — history is best-effort
    }
  } catch {
    // ignore
  }
}

/** Remove a single entry by id (keeps order of the rest). Never throws. */
export async function deleteHistoryEntry(id: string): Promise<void> {
  try {
    const list = await listHistory();
    const next = list.filter((e) => e.id !== id);
    if (next.length !== list.length) {
      const a = area();
      if (a) {
        try {
          await a.set({ [KEY]: next });
        } catch {
          // fall through to fallback
          try {
            fallback()?.setItem(KEY, JSON.stringify(next));
          } catch {
            // ignore — history is best-effort
          }
        }
      } else {
        try {
          fallback()?.setItem(KEY, JSON.stringify(next));
        } catch {
          // ignore — history is best-effort
        }
      }
    }
  } catch {
    // ignore
  }
  // Tombstone regardless: a deleted line must never come back via backfill,
  // even if the log write above raced or the entry was never logged.
  await addTombstones([id]);
}

/**
 * Workspace ↔ History reconciliation (pure — see tests/activityLog.test.ts).
 *
 * The history log is append-only metadata; Workspace deletions (or captures
 * from before logging worked) would otherwise leave the two views diverged.
 * Given the stored log plus the current Workspace records:
 * - `visible`: log entries whose image still exists, newest-first, with
 *   backfilled record entries merged in (orphans dropped).
 * - `backfill`: record entries missing from the log, OLDEST-first, for the
 *   caller to persist via logHistoryEntry (which keeps newest-first order).
 * - `deleted`: tombstoned ids (see deleteHistoryEntry/clearHistory) — records
 *   the user explicitly removed are never backfilled, so deletes stick.
 */
export interface ReconcileRecord {
  id: string;
  type: HistoryEntry["type"];
  createdAt: number;
  sourceUrl?: string;
  sourceTitle?: string;
  width?: number;
  height?: number;
  groupId?: string;
  partIndex?: number;
  partTotal?: number;
}

export function reconcileHistory(
  log: HistoryEntry[],
  records: ReconcileRecord[],
  deleted: Iterable<string> = []
): { visible: HistoryEntry[]; backfill: HistoryEntry[] } {
  const recordById = new Map(records.map((r) => [r.id, r]));
  const loggedIds = new Set(log.map((e) => e.id));
  const deletedIds = new Set(deleted);
  // Orphans (logged but image gone) are dropped — Workspace is the source of truth.
  const visible: HistoryEntry[] = log.filter((e) => recordById.has(e.id));
  const backfill: HistoryEntry[] = records
    .filter((r) => !loggedIds.has(r.id) && !deletedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      type: r.type,
      createdAt: r.createdAt,
      sourceUrl: r.sourceUrl,
      sourceTitle: r.sourceTitle,
      width: r.width,
      height: r.height,
      groupId: r.groupId,
      partIndex: r.partIndex,
      partTotal: r.partTotal,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
  const merged = [
    ...visible,
    ...[...backfill].sort((a, b) => b.createdAt - a.createdAt),
  ].sort((a, b) => b.createdAt - a.createdAt);
  return { visible: merged, backfill };
}
