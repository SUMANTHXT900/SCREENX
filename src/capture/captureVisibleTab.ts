import { CaptureError } from "@/types";

/**
 * Centralized captureVisibleTab with rate limiting and retry.
 * Chrome limits captureVisibleTab to ~2 calls/sec. We enforce 600ms minimum interval.
 * Shared by visible, full-page, selected-area.
 */

const MIN_INTERVAL_MS = 600;
let lastCaptureTime = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

export async function waitThrottle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCaptureTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
}

async function throttledCapture(windowId: number | undefined): Promise<string> {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const options: chrome.tabs.CaptureVisibleTabOptions = { format: "png" };
      const cb = (dataUrl: string): void => {
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message ?? "Unknown capture error";
          // Detect rate limit
          if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND_EXCEEDED/i.test(msg) || /rate.?limit/i.test(msg) || /Too many/i.test(msg)) {
            reject(new CaptureError("CAPTURE_FAILED", `Rate limited: ${msg}`, { cause: err }));
            return;
          }
          if (/permission/i.test(msg) || /host/i.test(msg)) {
            reject(new CaptureError("PERMISSION_DENIED", msg, { cause: err }));
          } else if (/restricted|chrome:\/\//i.test(msg)) {
            reject(new CaptureError("RESTRICTED_PAGE", msg, { cause: err }));
          } else {
            reject(new CaptureError("CAPTURE_FAILED", msg, { cause: err }));
          }
          return;
        }
        if (!dataUrl || !dataUrl.startsWith("data:image")) {
          reject(new CaptureError("CAPTURE_FAILED", "Capture returned empty result."));
          return;
        }
        resolve(dataUrl);
      };

      try {
        if (typeof windowId === "number") {
          chrome.tabs.captureVisibleTab(windowId, options, cb);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (chrome.tabs.captureVisibleTab as any)(options, cb);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        reject(new CaptureError("CAPTURE_FAILED", msg, { cause: e as Error }));
      }
    });

    return result;
  } finally {
    lastCaptureTime = Date.now();
  }
}

export async function captureVisibleTabThrottled(
  windowId: number | undefined,
  maxRetries = 2,
  onBeforeCapture?: () => Promise<void>,
  onAfterCapture?: () => Promise<void>
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await waitThrottle();
    if (onBeforeCapture) {
      await onBeforeCapture();
    }
    
    try {
      const result = await throttledCapture(windowId);
      if (onAfterCapture) {
        await onAfterCapture();
      }
      return result;
    } catch (e) {
      if (onAfterCapture) {
        await onAfterCapture();
      }
      
      lastError = e;
      const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", String(e));
      
      // Only retry on rate-limit
      if (/Rate limited/i.test(err.message) && attempt < maxRetries) {
        console.warn(`[ScreenX] captureVisibleTab rate limited, retry ${attempt + 1}/${maxRetries} after ${MIN_INTERVAL_MS}ms`, JSON.stringify({ attempt, message: err.message }));
        await sleep(MIN_INTERVAL_MS); // HUD is visible during this sleep
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
