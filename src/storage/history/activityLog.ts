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

export async function clearHistory(): Promise<void> {
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
}
