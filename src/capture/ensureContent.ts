import { CaptureError } from "@/types";

const PING_TIMEOUT_MS = 1500;

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  return ["chrome://", "chrome-extension://", "edge://", "about:", "chrome-search://", "view-source:", "devtools://"].some((p) =>
    url.startsWith(p)
  );
}

/**
 * Ensures the content script is ready in the given tab.
 * - First tries a lightweight PING
 * - If not reachable, attempts programmatic injection via chrome.scripting (requires "scripting" permission + activeTab)
 * - Throws CONTENT_SCRIPT_NOT_READY / RESTRICTED_PAGE with actionable messages
 */
export async function ensureContentScript(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) throw new CaptureError("NO_ACTIVE_TAB", "No active tab.");
  if (isRestrictedUrl(tab.url)) {
    throw new CaptureError("RESTRICTED_PAGE", "Cannot capture this page — browser internal pages are protected. Open a normal website and try again.");
  }

  // Fast path: try ping
  const pingOk = await tryPing(tab.id);
  if (pingOk) return;

  // Fallback: try to inject via scripting API
  if (typeof chrome.scripting === "undefined" || typeof chrome.scripting.executeScript !== "function") {
    throw new CaptureError(
      "CONTENT_SCRIPT_NOT_READY",
      "Content script not ready and scripting API unavailable. Please reload the page and try again."
    );
  }

  // Check if we have permission to script this tab — activeTab should grant it after user gesture
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    // Give content script a moment to initialize
    await new Promise<void>((r) => setTimeout(r, 200));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Common failure: cannot access chrome:// or extension pages, or host permission missing
    if (/Cannot access/i.test(msg) || /chrome:/i.test(msg)) {
      throw new CaptureError("RESTRICTED_PAGE", "Cannot access this page. Try a normal website.", { cause: e as Error });
    }
    throw new CaptureError("CONTENT_SCRIPT_NOT_READY", `Failed to inject content script: ${msg}`, { cause: e as Error });
  }

  // Retry ping after injection
  const retryOk = await tryPing(tab.id);
  if (retryOk) return;

  throw new CaptureError(
    "CONTENT_SCRIPT_NOT_READY",
    "Content script not ready after injection. Please reload the page and try again."
  );
}

function tryPing(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(false);
      }
    }, PING_TIMEOUT_MS);

    try {
      chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" }, (response) => {
        if (done) return;
        clearTimeout(timer);
        done = true;
        const err = chrome.runtime.lastError;
        if (err) {
          // No listener
          resolve(false);
          return;
        }
        if (response && (response as { ok?: boolean }).ok) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    } catch {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolve(false);
      }
    }
  });
}
