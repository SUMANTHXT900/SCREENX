/**
 * Workspace grouping — folds auto-split parts (shared groupId) into one
 * card. Pure (no chrome APIs) — tested in tests/grouping.test.ts.
 */
import type { CaptureMeta, CaptureRecord } from "@/storage/idb/capturesRepo";

export interface Group<T extends CaptureRecord | CaptureMeta = CaptureRecord | CaptureMeta> {
  key: string;
  /** Cover record: earliest-created part (same-ms ties break to lowest part). */
  first: T;
  count: number;
  ids: string[];
}

export function toGroups<T extends CaptureRecord | CaptureMeta>(records: T[]): Group<T>[] {
  const map = new Map<string, Group<T>>();
  for (const r of records) {
    const key = r.groupId ?? r.id;
    const g = map.get(key);
    if (g) {
      g.ids.push(r.id);
      // Keep earliest-created part first for stable cover + ordering.
      // Same-ms ties (tight auto-split loop) break toward the lowest part.
      const rPart = r.partIndex ?? 0;
      const fPart = g.first.partIndex ?? 0;
      if (r.createdAt < g.first.createdAt || (r.createdAt === g.first.createdAt && rPart < fPart)) g.first = r;
      g.count += 1;
    } else {
      map.set(key, { key, first: r, count: 1, ids: [r.id] });
    }
  }
  return [...map.values()].sort((a, b) => b.first.createdAt - a.first.createdAt);
}
