/**
 * Background Service Worker — commands router & async capture delegator.
 * Thin entry; logic lives in ./handlers/.
 */

import { handleCapture, recoverPendingChoice } from "./handlers/captureHandler";
import { openEditorForToastAction, retryCopyFromToast } from "./handlers/toastActions";
import { forwardToActiveTab } from "./handlers/commandHandler";
import { downloadCapture } from "./handlers/downloadHandler";
import { wireNotificationClicks } from "./handlers/notifyFallback";
import { verifyToastToken } from "./handlers/toastTokens";
import { getCapture } from "@/storage/idb";
import { purgeExpiredGlobalLock } from "@/capture/engine/globalLock";
import { recoverInterruptedSelection } from "@/capture/selectedArea";
import { clearCaptureBadge } from "@/messaging/client";

// Fresh worker: drop any stale toolbar badge, purge a dead worker's expired
// lock claim (collapses the phantom "already capturing" window to ~0),
// close an orphaned selection wait loudly, and re-show an unannounced
// capture instead of fading silently.
clearCaptureBadge();
void purgeExpiredGlobalLock().catch(() => {
  // ignore — purge is best-effort; TTL expires the claim anyway
});
wireNotificationClicks();
void recoverInterruptedSelection().catch(() => {
  // ignore — recovery is best-effort
});
void recoverPendingChoice().catch(() => {
  // ignore — recovery is best-effort
});

// Keyboard-spam guard: the popup disables its buttons while capturing, but
// shortcuts have no such gate — a double-pressed hotkey would otherwise make
// the second press fail loudly with CAPTURE_IN_PROGRESS. Collapse repeats of
// the same command inside the window into the in-flight run.
const COMMAND_DEBOUNCE_MS = 800;
const lastCommandAt = new Map<string, number>();

function shouldDebounce(command: string): boolean {
  const now = Date.now();
  const prev = lastCommandAt.get(command) ?? 0;
  lastCommandAt.set(command, now);
  if (now - prev < COMMAND_DEBOUNCE_MS) {
    return true;
  }
  return false;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "capture-visible") {
    if (!shouldDebounce(command)) await handleCapture("visible", "capture-visible");
    return;
  }
  if (command === "capture-fullpage") {
    if (!shouldDebounce(command)) await handleCapture("full-page", "capture-fullpage");
    return;
  }
  if (command === "capture-selected-area") {
    if (!shouldDebounce(command)) await handleCapture("selected-area", "capture-selected-area");
    return;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = (message as { type?: string })?.type;

  if (type === "PING_CONTENT") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }

  // Legacy alias (was "PING", now "PING_CONTENT" canonical).
  if (type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }

  // Popup delegates ALL captures to background so the popup can close
  // immediately: capture orchestration must not live in the popup document,
  // which dies (aborting the run) the moment the user clicks elsewhere.
  // Legacy TRIGGER_SELECTED_AREA maps to the same path.
  if (type === "TRIGGER_CAPTURE" || type === "TRIGGER_SELECTED_AREA") {
    const requested = (message as { captureType?: string })?.captureType;
    const captureType =
      requested === "visible" || requested === "full-page" || requested === "selected-area"
        ? requested
        : ("selected-area" as const);
    // Same double-fire guard as shortcuts: the popup's disabled state lives
    // in async React state, so a fast double-click can send twice — the
    // second message is the same user intent as the in-flight run.
    if (shouldDebounce(`trigger:${captureType}`)) {
      try {
        sendResponse({ ok: true, debounced: true });
      } catch {
        // ignore
      }
      return true;
    }
    (async () => {
      try {
        sendResponse({ ok: true });
      } catch {
        // ignore
      }
      await handleCapture(captureType, `trigger-${captureType}`);
    })();
    return true;
  }

  // Toast action buttons (from the sticky post-capture choice toast).
  if (type === "SCREENX_TOAST_ACTION") {
    const msg = message as { action?: string; captureId?: string; groupId?: string; nonce?: string };
    // Prefer the tab the click came from for tab-targeted follow-ups.
    const fromTab = sender.tab?.id;
    const runAction = (action: string, captureId: string, groupId: string | undefined): void => {
      if (action === "open-editor") {
        void openEditorForToastAction(captureId, groupId).then(
          undefined,
          (e) => console.error("[ScreenX] toast action → editor open failed:", e instanceof Error ? e.message : String(e))
        );
      } else if (action === "copy") {
        void retryCopyFromToast(captureId, fromTab);
      } else if (action === "download") {
        void downloadCapture(captureId);
      }
      // ignore anything else
    };
    // Shape check first: ids are alphanumerics/dashes only (UUIDs in
    // practice) — rejects injection smuggled through id fields.
    const idOk = (v: string): boolean => v.length > 0 && v.length <= 64 && /^[A-Za-z0-9-]+$/.test(v);
    const { action } = msg;
    const rawId = msg.captureId ?? "";
    if ((action !== "open-editor" && action !== "copy" && action !== "download") || !idOk(rawId)) {
      return false;
    }
    if (msg.groupId !== undefined && !idOk(msg.groupId)) return false;
    const grant = verifyToastToken(msg.nonce, rawId, fromTab);
    if (grant) {
      // Bound ids win over the message's — a tampered captureId fails closed.
      runAction(action, grant.captureId, grant.groupId);
      return false;
    }
    if (fromTab === undefined) {
      // Extension pages (popup/editor/workspace/history) have no sender tab
      // and are same-origin UI — allow without a grant.
      runAction(action, rawId, msg.groupId);
      return false;
    }
    // Legacy path (pre-grant sticky toasts): only the tab that owns the
    // capture may drive it — never a foreign tab. Async by necessity
    // (IDB read); actions are fire-and-forget by design.
    void (async () => {
      try {
        const record = await getCapture(rawId).catch(() => null);
        if (record?.sourceTabId !== undefined && fromTab !== record.sourceTabId) return;
        runAction(action, rawId, msg.groupId);
      } catch {
        // ignore
      }
    })();
    return false;
  }

  // Forward progress and toast notifications to the active tab's content script
  if (type === "SCREENX_PROGRESS" || type === "SCREENX_TOAST") {
    forwardToActiveTab(message);
    return false;
  }

  // Allow waitForSelection's runtime messages to be handled by its own listener
  void sender;
  return false;
});

export {};
