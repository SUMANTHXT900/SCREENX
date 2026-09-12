import { describe, test, expect, beforeEach } from "vitest";

function installStorageStub(initial: Record<string, unknown> = {}): Map<string, unknown> {
  const store = new Map<string, unknown>(Object.entries(initial));
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string[]) => {
          for (const k of keys) store.delete(k);
        },
      },
    },
  };
  return store;
}

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "visible" as const,
  createdAt: Date.now(),
  ...extra,
});

describe("activityLog", () => {
  beforeEach(() => {
    installStorageStub();
  });

  test("records newest-first and dedups re-logged ids", async () => {
    const log = await import("../src/storage/history/activityLog");
    await log.logHistoryEntry(entry("a"));
    await log.logHistoryEntry(entry("b"));
    expect((await log.listHistory()).map((e) => e.id)).toEqual(["b", "a"]);
    // Re-logging "a" moves it to front instead of duplicating.
    await log.logHistoryEntry(entry("a"));
    expect((await log.listHistory()).map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("caps at 200 entries", async () => {
    const log = await import("../src/storage/history/activityLog");
    for (let i = 0; i < 205; i++) await log.logHistoryEntry(entry(`id-${i}`));
    const list = await log.listHistory();
    expect(list).toHaveLength(200);
    expect(list[0]!.id).toBe("id-204");
  });

  test("deleteHistoryEntry removes one row, clearHistory empties", async () => {
    const log = await import("../src/storage/history/activityLog");
    await log.logHistoryEntry(entry("a"));
    await log.logHistoryEntry(entry("b"));
    await log.deleteHistoryEntry("b");
    expect((await log.listHistory()).map((e) => e.id)).toEqual(["a"]);
    await log.deleteHistoryEntry("missing");
    expect((await log.listHistory()).map((e) => e.id)).toEqual(["a"]);
    await log.clearHistory();
    expect(await log.listHistory()).toEqual([]);
  });

  test("reconcileHistory backfills missing records oldest-first, drops orphans", async () => {
    const { reconcileHistory } = await import("../src/storage/history/activityLog");
    const rec = (id: string, createdAt: number) => ({ id, type: "visible" as const, createdAt });
    const log = [entry("a", { createdAt: 100 }), entry("orphan", { createdAt: 999 })];
    const records = [rec("a", 100), rec("b", 300), rec("c", 200)];
    const { visible, backfill } = reconcileHistory(log, records);
    // Orphan dropped; merged newest-first.
    expect(visible.map((e) => e.id)).toEqual(["b", "c", "a"]);
    // Backfill oldest-first so sequential logHistoryEntry keeps newest-first.
    expect(backfill.map((e) => e.id)).toEqual(["c", "b"]);
  });

  test("reconcileHistory with empty log backfills everything", async () => {
    const { reconcileHistory } = await import("../src/storage/history/activityLog");
    const records = [
      { id: "x", type: "full-page" as const, createdAt: 50 },
      { id: "y", type: "visible" as const, createdAt: 150 },
    ];
    const { visible, backfill } = reconcileHistory([], records);
    expect(visible.map((e) => e.id)).toEqual(["y", "x"]);
    expect(backfill.map((e) => e.id)).toEqual(["x", "y"]);
    expect(visible[0]).toMatchObject({ type: "visible", createdAt: 150 });
  });

  test("deleted ids are tombstoned and never backfilled (deletes stick)", async () => {
    const log = await import("../src/storage/history/activityLog");
    await log.logHistoryEntry(entry("a"));
    await log.logHistoryEntry(entry("b"));
    await log.deleteHistoryEntry("a");
    expect(await log.listTombstones()).toContain("a");
    // Reconcile with the image still in Workspace: no backfill for "a".
    const records = [
      { id: "a", type: "visible" as const, createdAt: 100 },
      { id: "b", type: "visible" as const, createdAt: 200 },
    ];
    const current = await log.listHistory();
    const { visible, backfill } = log.reconcileHistory(current, records, await log.listTombstones());
    expect(visible.map((e) => e.id)).toEqual(["b"]);
    expect(backfill.map((e) => e.id)).toEqual([]);
  });

  test("clearHistory tombstones the cleared ids", async () => {
    const log = await import("../src/storage/history/activityLog");
    await log.logHistoryEntry(entry("a"));
    await log.logHistoryEntry(entry("b"));
    await log.clearHistory(["a", "b"]);
    expect(await log.listHistory()).toEqual([]);
    expect(await log.listTombstones()).toEqual(expect.arrayContaining(["a", "b"]));
    const records = [
      { id: "a", type: "visible" as const, createdAt: 100 },
      { id: "b", type: "visible" as const, createdAt: 200 },
    ];
    const { visible, backfill } = log.reconcileHistory([], records, await log.listTombstones());
    expect(visible).toEqual([]);
    expect(backfill).toEqual([]);
  });

  test("falls back to localStorage without chrome", async () => {
    delete (globalThis as Record<string, unknown>).chrome;
    const mem = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      },
    };
    try {
      const log = await import("../src/storage/history/activityLog");
      await log.logHistoryEntry(entry("x"));
      expect((await log.listHistory()).map((e) => e.id)).toEqual(["x"]);
      await log.clearHistory();
      expect(await log.listHistory()).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });
});
