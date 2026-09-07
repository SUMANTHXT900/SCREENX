/**
 * Command + message routing helpers (plan: background/handlers/commandHandler.ts).
 */
import type { ToastOptions } from "@/messaging/events";

function queryActiveTabId(cb: (tabId: number | undefined) => void): void {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab?.id !== undefined) {
      cb(activeTab.id);
      return;
    }
    chrome.tabs.query({ active: true }, (allActiveTabs) => {
      cb(allActiveTabs[0]?.id);
    });
  });
}

export function sendToastToActiveTab(toast: ToastOptions): void {
  const message = { type: "SCREENX_TOAST", toast };
  queryActiveTabId((tabId) => {
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, message, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

/**
 * Send a toast to a specific tab, reporting delivery. Resolves false when
 * the tab has no listening content script (stale/missing injection) so
 * callers can log + fall back instead of failing silently.
 *
 * Delivery is render-true: the content script only acks ok after showToast
 * runs without throwing, and reports whether the document is focused (an
 * undelivered-feeling toast on an unfocused tab still "delivered").
 */
export interface ToastDelivery {
  delivered: boolean;
  focused?: boolean;
}

export async function sendToastToTab(tabId: number, toast: ToastOptions): Promise<ToastDelivery> {
  try {
    const delivery = await new Promise<ToastDelivery>((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { type: "SCREENX_TOAST", toast }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ delivered: false });
            return;
          }
          const r = res as { ok?: boolean; error?: string; rendered?: boolean; focused?: boolean } | undefined;
          if (r?.ok === true) {
            resolve({ delivered: true, focused: r.focused });
          } else {
            resolve({ delivered: false });
          }
        });
      } catch {
        resolve({ delivered: false });
      }
    });
    if (!delivery.delivered) {
      console.debug("[ScreenX] toast not delivered to tab", tabId, "(no listening content script?)");
    }
    return delivery;
  } catch {
    return { delivered: false };
  }
}

export function forwardToActiveTab(message: unknown): void {
  queryActiveTabId((tabId) => {
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, message, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}
