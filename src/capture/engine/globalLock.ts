/**
 * Global capture lock — cross-context mutex (plan: capture/engine/globalLock.ts).
 *
 * Why: the in-memory CaptureSession only guards ONE JS context, but captures
 * run in two: the popup page (visible/full-page) and the background service
 * worker (commands + selected-area). Without a shared lock, a shortcut fired
 * mid-popup-capture (or vice versa) interleaves two scroll/snap loops on the
 * same tab and both come out corrupt.
 *
 * Implementation: a short-lived claim in chrome.storage.session. Not strictly
 * atomic (no CAS API), but combined with the in-memory session it closes the
 * real-world races. A TTL prevents permanent deadlock if a context dies
 * mid-capture (popup closed, SW evicted).
 */
import { CaptureError } from "@/types/capture";

const LOCK_KEY = "screenx:capture:lock";
// 30s: long enough that no legitimate capture gap exceeds it while the loop
// heartbeats every chunk, short enough that a worker death / tab crash
// blocks the user for seconds, not minutes. Active captures keep extending
// their claim via heartbeatGlobalLock — expiry means "owner is dead".
export const LOCK_TTL_MS = 30 * 1000;

interface LockClaim {
  token: string;
  owner: string;
  tabId?: number;
  /** Monotonic owner id — releases only clear a claim they own (see below). */
  acquiredAt: number;
  expiresAt: number;
}

/** Claims written by older extension versions lack acquiredAt — estimate it. */
function acquiredAtOf(claim: LockClaim): number {
  return typeof claim.acquiredAt === "number" ? claim.acquiredAt : claim.expiresAt - LOCK_TTL_MS;
}

function newToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `lock-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

async function readClaim(): Promise<LockClaim | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      const res = await chrome.storage.session.get(LOCK_KEY);
      const val = (res as Record<string, unknown>)[LOCK_KEY] as LockClaim | undefined;
      if (val && typeof val.expiresAt === "number") return val;
    }
  } catch {
    // ignore — fall through as unlocked
  }
  return null;
}

async function writeClaim(claim: LockClaim): Promise<void> {
  await chrome.storage.session.set({ [LOCK_KEY]: claim });
}

async function clearClaim(token: string): Promise<void> {
  try {
    const current = await readClaim();
    if (current && current.token === token) {
      await chrome.storage.session.remove([LOCK_KEY]);
    }
  } catch {
    // ignore — TTL expires it anyway
  }
}

/**
 * Acquire the global capture lock. Throws CAPTURE_IN_PROGRESS if another
 * capture holds a live claim. Callers must release in a finally block —
 * BEFORE any HUD/finalize awaits, so a throwing cleanup can't leak the lock.
 */
export async function acquireGlobalLock(owner: string, tabId?: number): Promise<string> {
  let existing: LockClaim | null = null;
  try {
    existing = await readClaim();
  } catch {
    existing = null;
  }
  if (existing && existing.expiresAt > Date.now()) {
    throw new CaptureError(
      "CAPTURE_IN_PROGRESS",
      "A capture is already running. Please wait for it to finish before starting another."
    );
  }
  const token = newToken();
  try {
    await writeClaim({ token, owner, tabId, acquiredAt: Date.now(), expiresAt: Date.now() + LOCK_TTL_MS });
  } catch (e) {
    // Storage unavailable — proceed without the cross-context lock rather than
    // blocking captures entirely (in-memory session still guards this context).
    console.warn("[ScreenX] global lock write failed, continuing unlocked:", e instanceof Error ? e.message : String(e));
  }
  return token;
}

export async function releaseGlobalLock(token: string): Promise<void> {
  await clearClaim(token);
}

/**
 * Extend our own claim — call once per capture-loop chunk (and other long
 * phases) so a long legitimate capture never hits its own TTL. Only extends
 * when the stored claim is still ours (token match); never throws.
 */
export async function heartbeatGlobalLock(token: string): Promise<boolean> {
  try {
    const current = await readClaim();
    if (!current || current.token !== token) return false;
    await writeClaim({ ...current, expiresAt: Date.now() + LOCK_TTL_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * SW-startup purge: a dead worker's claim can only be EXPIRED (a live claim
 * means a capture is genuinely running elsewhere). Removes the expired claim
 * so the phantom "already capturing" window collapses to ~0 on restart.
 * Never throws; returns true when it purged something.
 */
export async function purgeExpiredGlobalLock(): Promise<boolean> {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.session) return false;
    const current = await readClaim();
    if (current && current.expiresAt <= Date.now()) {
      await chrome.storage.session.remove([LOCK_KEY]);
      console.debug("[ScreenX] purged expired capture lock", {
        owner: current.owner,
        ageMs: Date.now() - acquiredAtOf(current),
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface LockDescription {
  owner: string;
  tabId?: number;
  ageMs: number;
}

/**
 * Describe the live claim for busy-state UX ("running ~12s" vs a stale
 * claim). Returns null when unlocked or unreadable. Never throws.
 */
export async function describeGlobalLock(): Promise<LockDescription | null> {
  try {
    const current = await readClaim();
    if (!current || current.expiresAt <= Date.now()) return null;
    return { owner: current.owner, tabId: current.tabId, ageMs: Math.max(0, Date.now() - acquiredAtOf(current)) };
  } catch {
    return null;
  }
}
