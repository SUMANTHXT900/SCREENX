import { CaptureError } from "@/types";

/** Browser/chrome-internal schemes capture can never run on. Kept in sync
 * with the clipboard classifier (background/handlers/clipboardTarget.ts) —
 * a page restricted for one surface is restricted for the other. */
const RESTRICTED_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "brave://", "opera://", "vivaldi://", "about:", "chrome-search://", "view-source:", "devtools://"];

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  return RESTRICTED_PREFIXES.some((p) => url.startsWith(p));
}

export function queryActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new CaptureError("CAPTURE_FAILED", err.message ?? "Unknown query error", { cause: err }));
          return;
        }
        const tab = tabs[0];
        if (!tab?.id) {
          reject(new CaptureError("NO_ACTIVE_TAB", "No active tab found. Open a webpage and try again."));
          return;
        }
        resolve(tab);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reject(new CaptureError("CAPTURE_FAILED", msg, { cause: e as Error }));
    }
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CaptureError("TIMEOUT", `${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// Planner (single source lives in ./planner/) — re-exported here for compat.
export { planFullPagePositions as calculatePositions } from "./planner/fullPagePlan";
export { planRangePositions as calculateRangePositions } from "./planner/rangePlan";
export { calculateTotalTimeout } from "./planner/adaptiveStep";
