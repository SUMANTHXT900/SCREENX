/**
 * Content-script readiness — programmatic injection fallback.
 * (plan: capture/client/ensureContent.ts)
 * Single source; src/capture/ensureContent.ts re-exports for compat.
 */
import { CaptureError } from "@/types/capture";
import { CONTENT_PROTOCOL_VERSION } from "@/messaging/events";
import { isRestrictedUrl } from "../captureUtils";

const PING_TIMEOUT_MS = 1500;

type PingState = "ready" | "stale" | "missing";

/**
 * Ensures the content script is ready in the given tab.
 * - First tries a lightweight PING (with protocol version check)
 * - Stale scripts (open tabs predating an extension update — re-injection
 *   cannot replace them) fail fast with a "reload the tab" message
 * - If not reachable, attempts programmatic injection via chrome.scripting
 * - Throws CONTENT_SCRIPT_NOT_READY / RESTRICTED_PAGE with actionable messages
 */
export async function ensureContentScript(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) throw new CaptureError("NO_ACTIVE_TAB", "No active tab.");
  if (isRestrictedUrl(tab.url)) {
    throw new CaptureError("RESTRICTED_PAGE", "Cannot capture this page — browser internal pages are protected. Open a normal website and try again.");
  }

  const ping = await tryPing(tab.id);
  if (ping === "ready") {
    await resetTabCaptureState(tab.id);
    return;
  }
  if (ping === "stale") {
    throw new CaptureError(
      "CONTENT_SCRIPT_NOT_READY",
      "This tab is running an older version of ScreenX. Please reload the tab and try again."
    );
  }

  if (typeof chrome.scripting === "undefined" || typeof chrome.scripting.executeScript !== "function") {
    throw new CaptureError(
      "CONTENT_SCRIPT_NOT_READY",
      "Content script not ready and scripting API unavailable. Please reload the page and try again."
    );
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await new Promise<void>((r) => setTimeout(r, 200));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Cannot access/i.test(msg) || /chrome:/i.test(msg)) {
      throw new CaptureError("RESTRICTED_PAGE", "Cannot access this page. Try a normal website.", { cause: e as Error });
    }
    throw new CaptureError("CONTENT_SCRIPT_NOT_READY", `Failed to inject content script: ${msg}`, { cause: e as Error });
  }

  const retry = await tryPing(tab.id);
  if (retry === "ready") {
    await resetTabCaptureState(tab.id);
    return;
  }
  if (retry === "stale") {
    throw new CaptureError(
      "CONTENT_SCRIPT_NOT_READY",
      "This tab is running an older version of ScreenX. Please reload the tab and try again."
    );
  }

  throw new CaptureError(
    "CONTENT_SCRIPT_NOT_READY",
    "Content script not ready after injection. Please reload the page and try again."
  );
}

/**
 * Self-heal entry: clear any stuck content-side capture state (a previous
 * run's dropped RESTORE left `prepared=true`, silently poisoning later
 * captures with stale scroll readings and dropped container pins). The ping
 * above already proved version match, so the RESET route exists.
 * Best-effort — failure falls back to today's behavior, never blocks capture.
 */
function resetTabCaptureState(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, PING_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, { type: "SCREENX_RESET_CAPTURE_STATE" }, () => {
        if (done) return;
        clearTimeout(timer);
        done = true;
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolve();
      }
    }
  });
}

function tryPing(tabId: number): Promise<PingState> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve("missing");
      }
    }, PING_TIMEOUT_MS);

    try {
      chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" }, (response) => {
        if (done) return;
        clearTimeout(timer);
        done = true;
        const err = chrome.runtime.lastError;
        if (err) {
          resolve("missing");
          return;
        }
        if (response && (response as { ok?: boolean }).ok) {
          const proto = (response as { proto?: unknown }).proto;
          resolve(proto === CONTENT_PROTOCOL_VERSION ? "ready" : "stale");
        } else {
          resolve("missing");
        }
      });
    } catch {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolve("missing");
      }
    }
  });
}
