/**
 * Background Service Worker — Step 3: visible + full-page + selected-area.
 */

import { capture, openEditorForCapture } from "@/capture";
import { CaptureError } from "@/types";

chrome.runtime.onInstalled.addListener((details) => {
  console.debug("[ScreenX] background installed:", details.reason);
});

async function handleCapture(type: Parameters<typeof capture>[0], label: string): Promise<void> {
  try {
    const result = await capture(type);
    await openEditorForCapture(result.id);
    console.debug(`[ScreenX] ${label} → editor opened:`, result.id);
  } catch (e) {
    const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", String(e), { cause: e as Error });
    // User cancelled is not an error — just log info
    if (err.code === "USER_CANCELLED") {
      console.debug(`[ScreenX] ${label} cancelled by user`);
      return;
    }
    console.error(`[ScreenX] ${label} failed [${err.code}]:`, err.message, err.cause ?? "");
    
    // Send toast to the active tab
    const message = { 
      type: "SCREENX_TOAST", 
      toast: { 
        type: "error", 
        title: "Capture Error", 
        message: err.message 
      } 
    };
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id !== undefined) {
        chrome.tabs.sendMessage(activeTab.id, message, () => { void chrome.runtime.lastError; });
      } else {
        chrome.tabs.query({ active: true }, (allActiveTabs) => {
          const fallbackTab = allActiveTabs[0];
          if (fallbackTab?.id !== undefined) {
            chrome.tabs.sendMessage(fallbackTab.id, message, () => { void chrome.runtime.lastError; });
          }
        });
      }
    });
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  console.debug("[ScreenX] command received:", command);
  if (command === "capture-visible") {
    await handleCapture("visible", "capture-visible");
    return;
  }
  if (command === "capture-fullpage") {
    await handleCapture("full-page", "capture-fullpage");
    return;
  }
  if (command === "capture-selected-area") {
    await handleCapture("selected-area", "capture-selected-area");
    return;
  }
  console.debug("[ScreenX] unknown command:", command);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = (message as { type?: string })?.type;

  if (type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }

  // Popup delegates selected-area to background so popup can close while user selects
  if (type === "TRIGGER_SELECTED_AREA") {
    // Keep channel open for async
    (async () => {
      try {
        // Acknowledge immediately so popup can close
        sendResponse({ ok: true });
      } catch {
        // ignore
      }
      await handleCapture("selected-area", "trigger-selected-area");
    })();
    return true;
  }

  // Forward progress and toast notifications to the active tab's content script
  if (type === "SCREENX_PROGRESS" || type === "SCREENX_TOAST") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id !== undefined) {
        chrome.tabs.sendMessage(activeTab.id, message, () => {
          void chrome.runtime.lastError;
        });
      } else {
        chrome.tabs.query({ active: true }, (allActiveTabs) => {
          const fallbackTab = allActiveTabs[0];
          if (fallbackTab?.id !== undefined) {
            chrome.tabs.sendMessage(fallbackTab.id, message, () => {
              void chrome.runtime.lastError;
            });
          }
        });
      }
    });
    return false;
  }

  // Allow waitForSelection's runtime messages to be handled by its own listener
  // Return false for unknown so other listeners can handle SCREENX_SELECTION_*
  return false;
});

export {};
