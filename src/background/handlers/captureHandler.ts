/**
 * Capture handler — shared popup / command flow (plan: background/handlers/captureHandler.ts).
 *
 * Post-capture flow: persist happens inside the engines. Here we (1) copy
 * the result to the clipboard so paste works immediately, then (2) show a
 * sticky choice toast (Open Editor / Download) instead of auto-opening the
 * editor. Nothing here throws for clipboard/download failures — capture
 * success never depends on them.
 */
import { capture } from "@/capture";
import { cancelPendingSelection } from "@/capture/selectedArea";
import { encodeForClipboard } from "@/capture/clipboard";
import { attemptCopyWithFocus, readTab } from "./copyAttempt";
import { getCapture } from "@/storage/idb";
import { CaptureError } from "@/types/capture";
import { sendToastToActiveTab, sendToastToTab } from "./commandHandler";
import { buildChoiceToast, type ChoiceInput } from "./choiceToast";
import { classifyClipboardTarget } from "./clipboardTarget";
import { clearCaptureBadge } from "@/messaging/client";
import { describeGlobalLock } from "@/capture/engine/globalLock";
import { notifyChoiceFallback } from "./notifyFallback";

const PENDING_CHOICE_KEY = "screenx:choice-pending";
const PENDING_CHOICE_TTL_MS = 10 * 60 * 1000;

interface PendingChoice {
  captureId: string;
  ts: number;
}

async function savePendingChoice(captureId: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [PENDING_CHOICE_KEY]: { captureId, ts: Date.now() } satisfies PendingChoice });
  } catch {
    // ignore — recovery is best-effort
  }
}

async function clearPendingChoice(): Promise<void> {
  try {
    await chrome.storage.session.remove([PENDING_CHOICE_KEY]);
  } catch {
    // ignore
  }
}

/**
 * SW-startup recovery: if a previous worker died between persisting a
 * capture and showing its choice toast, the user would otherwise see
 * nothing. Re-show it (without re-copying — the Copy button covers that).
 */
export async function recoverPendingChoice(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(PENDING_CHOICE_KEY);
    const pending = (stored as Record<string, unknown>)[PENDING_CHOICE_KEY] as PendingChoice | undefined;
    if (!pending?.captureId) return;
    if (Date.now() - pending.ts > PENDING_CHOICE_TTL_MS) {
      await clearPendingChoice();
      return;
    }
    const record = await getCapture(pending.captureId).catch(() => null);
    if (!record) {
      await clearPendingChoice();
      return;
    }
    console.debug("[ScreenX] recovering unannounced capture:", pending.captureId);
    await showChoiceToast(record, false);
    await clearPendingChoice();
  } catch (e) {
    console.debug("[ScreenX] pending-choice recovery skipped:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Show the sticky post-capture choice toast. Returns delivery status (false
 * → caller falls back + warns loudly instead of fading silently).
 */
async function showChoiceToast(
  result: ChoiceInput,
  copied: boolean,
  copyDataUrl?: string,
  copyNote?: string
): Promise<{ delivered: boolean; focused?: boolean }> {
  const toast = buildChoiceToast(result, copied, copyDataUrl, copyNote);
  if (result.sourceTabId !== undefined) {
    const delivery = await sendToastToTab(result.sourceTabId, toast);
    console.debug(
      `[ScreenX] choice toast delivered=${delivery.delivered} focused=${delivery.focused} tab=`,
      result.sourceTabId
    );
    return delivery;
  }
  return { delivered: false };
}

export async function handleCapture(
  type: Parameters<typeof capture>[0],
  label: string
): Promise<void> {
  try {
    console.debug(`[ScreenX] ${label} → capture started`);
    // A selection wait from an earlier trigger holds no locks but owns the
    // tab overlay: supersede it first so a re-click (or a different mode)
    // replaces the stale run instead of colliding with it. No-op normally.
    cancelPendingSelection();
    const result = await capture(type);
    console.debug(`[ScreenX] ${label} → captured:`, result.id);

    // Persist-first guarantee: if this worker dies anywhere below, the next
    // startup re-shows the choice toast instead of fading silently.
    await savePendingChoice(result.id);

    console.debug(`[ScreenX] ${label} → copying to clipboard…`);
    // Encode once: the bytes feed the automatic send AND ride along in the
    // Copy button, so a click retries with a synchronous in-gesture write.
    const copyDataUrl = await encodeForClipboard(result.blob);
    let copied = false;
    let copyNote: string | undefined;
    if (!copyDataUrl) {
      // Oversized (or encode failure) — no bytes to send or embed. The Copy
      // button degrades to the worker round trip, which can't help here, so
      // say so up front and point at Download.
      copyNote = "Image is too large for the clipboard — use Download.";
      console.debug(`[ScreenX] ${label} → clipboard skipped: no encodable bytes`);
    } else if (result.sourceTabId !== undefined) {
      // Pre-classify the tab: restricted pages (chrome://, Web Store) block
      // injection and http: pages have no navigator.clipboard — attempting
      // the write there only produces noisy, doomed failures.
      const tabId = result.sourceTabId;
      const tab = await readTab(tabId);
      const target = classifyClipboardTarget(tab.url);
      if (target.kind !== "writable") {
        console.debug(`[ScreenX] ${label} → clipboard skipped: ${target.reason}`);
        copyNote =
          target.kind === "insecure"
            ? "Clipboard needs a secure (https) page — use Download, or copy from the Editor."
            : "Clipboard isn't available on this page — use Download, or copy from the Editor.";
      } else {
        // Shared attempt helper: real window focus + bounded retries (only
        // on unfocused reports — a focused refusal stops after attempt one).
        // attemptCopyWithFocus logs each attempt with this label.
        const attempt = await attemptCopyWithFocus(tabId, copyDataUrl, tab.windowId, `${label} [${result.id}]`);
        copied = attempt.copied;
        if (!copied) {
          copyNote = "Auto-copy missed (the tab wasn't focused) — tap Copy.";
        }
      }
    }
    console.debug(`[ScreenX] ${label} → clipboard copied=${copied}`);

    console.debug(`[ScreenX] ${label} → sending choice toast to tab`, result.sourceTabId);
    const { delivered, focused } = await showChoiceToast(result, copied, copyDataUrl ?? undefined, copyNote);
    if (!delivered) {
      // Same full toast (buttons included) via the active tab — wherever it
      // renders, the actions still work — plus a system notification so the
      // result is visible even when the user isn't looking at any tab.
      console.debug(`[ScreenX] ${label} → direct toast failed, falling back to active tab + notification`);
      sendToastToActiveTab(buildChoiceToast(result, copied, copyDataUrl ?? undefined, copyNote));
      await notifyChoiceFallback(result, copied, copyNote);
      console.warn(
        `[ScreenX] ${label} → choice toast NOT confirmed delivered for capture ${result.id}; ` +
          "check the tab has a listening content script (reload the tab if the extension just updated)."
      );
    } else if (focused === false) {
      // Rendered, but the document isn't focused (DevTools open, other window
      // on top) — the user can't see it, so mirror to a notification.
      console.debug(`[ScreenX] ${label} → tab unfocused, mirroring choice to notification`);
      await notifyChoiceFallback(result, copied, copyNote);
    }
    await clearPendingChoice();
    console.debug(`[ScreenX] ${label} → done (delivered=${delivered})`);
  } catch (e) {
    const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", String(e), { cause: e as Error });
    // User cancelled is not an error — just log info
    if (err.code === "USER_CANCELLED") {
      console.debug(`[ScreenX] ${label} cancelled by user`);
      return;
    }
    // Busy, not broken: surface HOW LONG the other capture has held the lock
    // so a stale claim is distinguishable from a genuinely running capture.
    // (Stale claims self-expire via TTL + startup purge; see globalLock.ts.)
    if (err.code === "CAPTURE_IN_PROGRESS") {
      const lock = await describeGlobalLock();
      const age = lock ? ` (other capture running ~${Math.round(lock.ageMs / 1000)}s)` : "";
      console.debug(`[ScreenX] ${label} busy${age}`);
      sendToastToActiveTab({
        type: "error",
        title: "Already Capturing",
        message: `A capture is already running${age ? ` — started ~${Math.round(lock!.ageMs / 1000)}s ago` : ""}. Wait for it to finish, then try again.`,
      });
      return;
    }
    console.error(`[ScreenX] ${label} failed [${err.code}]:`, err.message, err.cause ?? "");

    // Send toast to the active tab
    sendToastToActiveTab({
      type: "error",
      title: "Capture Error",
      message: err.message,
    });
  } finally {
    // Badge must never stick: the loop may have set 100% and died after.
    clearCaptureBadge();
  }
}
