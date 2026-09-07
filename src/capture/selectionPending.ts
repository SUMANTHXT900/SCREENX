/**
 * Pending-selection registry — at most ONE selected-area "waiting for the
 * user's drag" waiter exists at a time. A newer trigger supersedes the older
 * one (its overlay is replaced by the fresh START_SELECTION); a different
 * mode's trigger dismisses it outright.
 *
 * Pure state machine (no chrome APIs) — tested in
 * tests/selectionPending.test.ts. The chrome sends live at the call sites.
 */
export interface PendingSelection {
  tabId: number;
  /** Reject the waiter's promise so the stale run unwinds quietly. */
  onSuperseded: () => void;
}

let current: PendingSelection | null = null;

/**
 * Register a new selection waiter. Supersedes (and returns) any previous
 * one so the caller can reject it. Registration is synchronous — call it
 * BEFORE any await in the wait path so same-tick double triggers serialize.
 */
export function registerPendingSelection(next: PendingSelection): PendingSelection | null {
  const prev = current;
  current = next;
  return prev;
}

/** Drop a waiter that settled normally (complete / cancel / timeout). */
export function clearPendingSelection(pending: PendingSelection): void {
  if (current === pending) current = null;
}

/**
 * Take (and clear) the current waiter, if any. The caller rejects it and —
 * when no fresh START_SELECTION follows (i.e. a different capture mode) —
 * tells the tab to tear the overlay down.
 */
export function takePendingSelection(): PendingSelection | null {
  const pending = current;
  current = null;
  return pending;
}

/** Test/introspection helper — never used in production flow. */
export function hasPendingSelection(): boolean {
  return current !== null;
}
