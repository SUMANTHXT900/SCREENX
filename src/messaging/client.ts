/**
 * Type-safe messaging client (Stage 1).
 * Single place for chrome.tabs / chrome.runtime message sends.
 * Replaces the 3x sendToContent + 4x sendProgress copies.
 */
import { CaptureError } from "@/types/capture";
import type {
  ExtensionMessage,
  ProgressPayload,
  ToastOptions,
} from "./events";

export const CONTENT_TIMEOUT_MS = 3500;

export function sendToContent<T>(
  tabId: number,
  message: ExtensionMessage,
  timeoutMs = CONTENT_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(
        new CaptureError(
          "TIMEOUT",
          `Content script did not respond to ${message.type} within ${timeoutMs}ms. Try reloading the page.`
        )
      );
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (timedOut) return;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message ?? "Unknown messaging error";
          if (/Receiving end does not exist/i.test(msg)) {
            reject(
              new CaptureError(
                "CONTENT_SCRIPT_NOT_READY",
                "Content script not ready. Please reload the page and try again.",
                { cause: err }
              )
            );
          } else {
            reject(new CaptureError("CAPTURE_FAILED", msg, { cause: err }));
          }
          return;
        }
        if (response && typeof response === "object" && "error" in response) {
          const msg = (response as { error: string }).error;
          reject(new CaptureError("CAPTURE_FAILED", msg));
          return;
        }
        resolve(response as T);
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      reject(new CaptureError("CAPTURE_FAILED", msg, { cause: e as Error }));
    }
  });
}

export function sendProgress(tabId: number, progress: ProgressPayload): void {
  // Single path on purpose: an earlier version ALSO broadcast via
  // chrome.runtime.sendMessage, which the background forwarded straight back
  // to the tab — every update rendered 2–3× and the HUD visibly flickered.
  try {
    chrome.tabs.sendMessage(tabId, { type: "SCREENX_PROGRESS", progress }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore — tab may be closed
  }
  // Mirror percent to the toolbar badge: flicker-free progress that needs no
  // DOM in the page at all.
  try {
    const pct = progress.percent;
    setCaptureBadge(typeof pct === "number" && Number.isFinite(pct) ? `${Math.max(0, Math.min(100, Math.round(pct)))}%` : "…");
  } catch {
    // ignore
  }
}

let lastBadgeText: string | null = null;

export function setCaptureBadge(text: string): void {
  try {
    if (lastBadgeText === text) return;
    lastBadgeText = text;
    chrome.action?.setBadgeText?.({ text });
    chrome.action?.setBadgeBackgroundColor?.({ color: "#3b82f6" });
  } catch {
    // ignore — e.g. unit tests without chrome
  }
}

export function clearCaptureBadge(): void {
  try {
    lastBadgeText = null;
    chrome.action?.setBadgeText?.({ text: "" });
  } catch {
    // ignore
  }
}

export function sendToast(tabId: number, toast: ToastOptions): void {
  try {
    chrome.tabs.sendMessage(tabId, { type: "SCREENX_TOAST", toast }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore
  }
}

/**
 * Delivery-checked toast send. Resolves false (never throws) when the tab
 * has no listening content script — callers escalate to a notification
 * instead of fading silently.
 */
export async function sendToastToTab(tabId: number, toast: ToastOptions): Promise<{ delivered: boolean }> {
  try {
    const res = await sendToContent<{ ok?: boolean }>(tabId, { type: "SCREENX_TOAST", toast });
    return { delivered: res?.ok === true };
  } catch {
    return { delivered: false };
  }
}

export async function hideProgressHud(tabId: number): Promise<void> {
  try {
    await sendToContent<{ ok: true }>(tabId, { type: "SCREENX_HIDE_PROGRESS" });
  } catch {
    // ignore — best effort
  }
}

export async function showProgressHud(tabId: number): Promise<void> {
  try {
    await sendToContent<{ ok: true }>(tabId, { type: "SCREENX_SHOW_PROGRESS" });
  } catch {
    // ignore — best effort
  }
}

export async function restoreCapture(tabId: number): Promise<void> {
  // Retry once: a dropped restore leaves the content script's `prepared`
  // flag stuck true for the tab's lifetime, silently poisoning every later
  // capture (stale scroll readings, dropped container pins). A final failure
  // warns LOUDLY — the old swallow-everything version made this entire
  // failure class invisible.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendToContent<{ ok: true }>(tabId, { type: "SCREENX_RESTORE_CAPTURE" });
      return;
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      console.warn(
        "[ScreenX] restoreCapture failed after retry — content-script capture state " +
          "may be stuck until the tab reloads:",
        e instanceof Error ? e.message : String(e)
      );
    }
  }
}
