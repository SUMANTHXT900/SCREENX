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

/** Active tab id for flows that must bind follow-ups to the shown tab. Never throws. */
export async function queryActiveTabIdAsync(): Promise<number | undefined> {
  try {
    return await new Promise<number | undefined>((resolve) => {
      try {
        queryActiveTabId((id) => resolve(id));
      } catch {
        resolve(undefined);
      }
    });
  } catch {
    return undefined;
  }
}

/**
 * Delivery-checked active-tab toast. Returns false when no tab or no
 * listening content script — callers fall back to a notification instead
 * of fading silently.
 */
export async function sendToastToActiveTabWithDelivery(toast: ToastOptions): Promise<boolean> {
  try {
    const tabId = await queryActiveTabIdAsync();
    if (tabId === undefined) return false;
    const delivery = await sendToastToTab(tabId, toast);
    return delivery.delivered;
  } catch {
    return false;
  }
}

/** Last-resort error surface: system notification. Never throws. */
export async function notifyErrorFallback(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `ScreenX — ${title}`,
      message,
      priority: 2,
    });
  } catch {
    // ignore — nothing left to escalate to
  }
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
          // ignore
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
