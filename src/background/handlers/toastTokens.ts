/**
 * Toast action grants — binds a toast button click to the tab the toast was
 * shown in. The router verifies the grant before running open-editor / copy
 * / download, so a content script in another tab cannot drive actions with
 * a guessed captureId (toast payloads are visible to every tab's content
 * script once rendered).
 *
 * Grants are unguessable (crypto.randomUUID), tab-bound, short-lived, and
 * capped. Multi-use within TTL: retries (Copy tap-again) re-present the
 * same nonce from the same tab, which verification still accepts.
 */
import type { ToastAction } from "@/messaging/events";

interface ToastGrant {
  captureId: string;
  groupId?: string;
  /** Tab the toast was shown in. Undefined = shown nowhere specific (unused). */
  tabId?: number;
  ts: number;
}

const grants = new Map<string, ToastGrant>();
const GRANT_TTL_MS = 10 * 60 * 1000;
const MAX_GRANTS = 100;

function prune(now: number): void {
  for (const [nonce, g] of grants) {
    if (now - g.ts > GRANT_TTL_MS) grants.delete(nonce);
  }
  if (grants.size > MAX_GRANTS) {
    const overflow = grants.size - MAX_GRANTS;
    const keys = grants.keys();
    for (let i = 0; i < overflow; i++) {
      const k = keys.next();
      if (k.done) break;
      grants.delete(k.value);
    }
  }
}

/** Mint a grant for one toast button. Never throws. */
export function issueToastToken(captureId: string, groupId: string | undefined, tabId: number | undefined): string {
  try {
    const nonce = crypto.randomUUID();
    grants.set(nonce, { captureId, groupId, tabId, ts: Date.now() });
    prune(Date.now());
    return nonce;
  } catch {
    // ignore — caller treats empty nonce as "no grant" (legacy path)
    return "";
  }
}

/** Stamp every action of a built choice toast with a tab-bound grant. Never throws. */
export function armToastActions(
  actions: ToastAction[] | undefined,
  captureId: string,
  groupId: string | undefined,
  tabId: number | undefined
): void {
  if (!actions) return;
  try {
    for (const a of actions) {
      const nonce = issueToastToken(captureId, groupId, tabId);
      if (nonce) a.nonce = nonce;
    }
  } catch {
    // ignore — unarmed actions fall back to the legacy same-tab rule
  }
}

export interface VerifiedGrant {
  captureId: string;
  groupId?: string;
}

/**
 * Verify a presented grant. Returns the BOUND ids (use these, not the
 * message's) or null. Extension pages (no sender tab) and legacy toasts
 * (no nonce) are handled by the caller, not here.
 */
export function verifyToastToken(
  nonce: string | undefined,
  captureId: string,
  senderTabId: number | undefined
): VerifiedGrant | null {
  try {
    if (!nonce) return null;
    const g = grants.get(nonce);
    if (!g) return null;
    if (Date.now() - g.ts > GRANT_TTL_MS) {
      grants.delete(nonce);
      return null;
    }
    if (g.captureId !== captureId) return null;
    if (senderTabId !== undefined && g.tabId !== undefined && senderTabId !== g.tabId) return null;
    return { captureId: g.captureId, groupId: g.groupId };
  } catch {
    return null;
  }
}
