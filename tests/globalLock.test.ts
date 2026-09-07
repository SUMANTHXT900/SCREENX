import { describe, test, expect, beforeEach } from "vitest";

const LOCK_KEY = "screenx:capture:lock";

function installSessionStub(initial: Record<string, unknown> = {}): Map<string, unknown> {
  const store = new Map<string, unknown>(Object.entries(initial));
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      session: {
        get: async (key: string) =>
          store.has(key) ? { [key]: store.get(key) } : {},
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

describe("globalLock lifecycle", () => {
  beforeEach(() => {
    installSessionStub();
  });

  test("second acquire while live throws CAPTURE_IN_PROGRESS", async () => {
    const lock = await import("../src/capture/engine/globalLock");
    const token = await lock.acquireGlobalLock("visible", 1);
    expect(typeof token).toBe("string");
    await expect(lock.acquireGlobalLock("full-page", 1)).rejects.toMatchObject({
      code: "CAPTURE_IN_PROGRESS",
    });
    await lock.releaseGlobalLock(token);
    // Released → acquirable again.
    const token2 = await lock.acquireGlobalLock("full-page", 1);
    await lock.releaseGlobalLock(token2);
  });

  test("foreign token cannot release another owner's claim", async () => {
    const lock = await import("../src/capture/engine/globalLock");
    const token = await lock.acquireGlobalLock("visible", 1);
    await lock.releaseGlobalLock("not-my-token");
    await expect(lock.acquireGlobalLock("full-page", 1)).rejects.toMatchObject({
      code: "CAPTURE_IN_PROGRESS",
    });
    await lock.releaseGlobalLock(token);
  });

  test("heartbeat extends the claim; foreign heartbeat is a no-op", async () => {
    const lock = await import("../src/capture/engine/globalLock");
    const store = installSessionStub();
    const token = await lock.acquireGlobalLock("full-page", 1);
    const before = (store.get(LOCK_KEY) as { expiresAt: number }).expiresAt;
    // Backdate the expiry so extension is observable.
    store.set(LOCK_KEY, { ...(store.get(LOCK_KEY) as object), expiresAt: Date.now() + 1000 });
    expect(await lock.heartbeatGlobalLock(token)).toBe(true);
    const after = (store.get(LOCK_KEY) as { expiresAt: number }).expiresAt;
    expect(after).toBeGreaterThan(Date.now() + 1000);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(await lock.heartbeatGlobalLock("foreign")).toBe(false);
    await lock.releaseGlobalLock(token);
  });

  test("purge removes only expired claims", async () => {
    const lock = await import("../src/capture/engine/globalLock");
    const store = installSessionStub({
      [LOCK_KEY]: { token: "old", owner: "dead-worker", acquiredAt: Date.now() - 60_000, expiresAt: Date.now() - 1_000 },
    });
    expect(await lock.purgeExpiredGlobalLock()).toBe(true);
    expect(store.has(LOCK_KEY)).toBe(false);

    const token = await lock.acquireGlobalLock("visible", 1);
    expect(await lock.purgeExpiredGlobalLock()).toBe(false);
    // Live claim untouched.
    await expect(lock.acquireGlobalLock("full-page", 1)).rejects.toMatchObject({
      code: "CAPTURE_IN_PROGRESS",
    });
    await lock.releaseGlobalLock(token);
  });

  test("describe reports live claims with age, null when free", async () => {
    const lock = await import("../src/capture/engine/globalLock");
    expect(await lock.describeGlobalLock()).toBeNull();
    const token = await lock.acquireGlobalLock("selected-area", 9);
    const desc = await lock.describeGlobalLock();
    expect(desc?.owner).toBe("selected-area");
    expect(desc?.tabId).toBe(9);
    expect(desc!.ageMs).toBeGreaterThanOrEqual(0);
    await lock.releaseGlobalLock(token);
    expect(await lock.describeGlobalLock()).toBeNull();
  });

  test("LOCK_TTL_MS is short (30s) so orphans block briefly", async () => {
    const lock = await import("../src/capture/engine/globalLock");
    expect(lock.LOCK_TTL_MS).toBe(30 * 1000);
  });
});
