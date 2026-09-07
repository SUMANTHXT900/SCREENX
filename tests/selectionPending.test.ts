import { describe, test, expect } from "vitest";
import {
  clearPendingSelection,
  hasPendingSelection,
  registerPendingSelection,
  takePendingSelection,
  type PendingSelection,
} from "../src/capture/selectionPending";

function pending(tabId: number, log: string[]): PendingSelection {
  return { tabId, onSuperseded: () => void log.push(`superseded:${tabId}`) };
}

describe("selectionPending registry", () => {
  test("starts empty; take on empty is null", () => {
    expect(takePendingSelection()).toBeNull();
    expect(hasPendingSelection()).toBe(false);
  });

  test("register returns previous waiter so the new run can supersede it", () => {
    const log: string[] = [];
    const a = pending(1, log);
    expect(registerPendingSelection(a)).toBeNull();
    expect(hasPendingSelection()).toBe(true);
    const b = pending(1, log);
    expect(registerPendingSelection(b)).toBe(a);
    // Caller rejects the stale waiter…
    a.onSuperseded();
    expect(log).toEqual(["superseded:1"]);
    // …and the settled run clears only itself.
    clearPendingSelection(a);
    expect(hasPendingSelection()).toBe(true);
    clearPendingSelection(b);
    expect(hasPendingSelection()).toBe(false);
  });

  test("take clears and returns the waiter for cross-trigger cancel", () => {
    const log: string[] = [];
    const a = pending(2, log);
    registerPendingSelection(a);
    expect(takePendingSelection()).toBe(a);
    expect(hasPendingSelection()).toBe(false);
    expect(takePendingSelection()).toBeNull();
  });
});
