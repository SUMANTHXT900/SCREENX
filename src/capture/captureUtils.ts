import { CaptureError } from "@/types";

const RESTRICTED_PREFIXES = ["chrome://", "chrome-extension://", "edge://", "about:", "chrome-search://", "view-source:", "devtools://"];

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

/**
 * Calculate required scroll positions for full-page or range.
 * Fix Bug 6: first calculate required count, throw if exceeds MAX_POSITIONS, then generate.
 */
export function calculatePositions(
  totalHeight: number, 
  viewportHeight: number, 
  maxScrollY: number, 
  maxPositions = 150,
  occludedTopHeight = 0,
  occludedBottomHeight = 0
): number[] {
  if (viewportHeight <= 0) throw new CaptureError("CAPTURE_FAILED", "Invalid viewport height.");
  const step = Math.max(10, viewportHeight - occludedTopHeight - occludedBottomHeight);
  
  const required = Math.ceil(totalHeight / step);
  if (required > maxPositions) {
    throw new CaptureError("PAGE_TOO_LARGE", `Page requires ${required} viewports — exceeds ${maxPositions} limit. Try a shorter page or selected range.`);
  }

  const positions: number[] = [];
  for (let y = 0; y < totalHeight; y += step) {
    const clamped = Math.min(y, maxScrollY);
    if (positions.length === 0 || positions[positions.length - 1] !== clamped) {
      positions.push(clamped);
    }
    if (positions.length >= maxPositions) break;
  }
  if (positions.length > 0 && positions[positions.length - 1] !== maxScrollY && totalHeight > viewportHeight) {
    if (positions.length < maxPositions) {
      const last = positions[positions.length - 1];
      if (last !== maxScrollY) positions.push(maxScrollY);
    }
  }
  if (positions.length > maxPositions) {
    throw new CaptureError("PAGE_TOO_LARGE", `Page requires ${positions.length} viewports — exceeds ${maxPositions} limit.`);
  }
  return positions;
}

export function calculateRangePositions(
  startY: number,
  endY: number,
  viewportHeight: number,
  maxScrollY?: number,
  maxPositions = 150,
  occludedTopHeight = 0,
  occludedBottomHeight = 0
): number[] {
  if (viewportHeight <= 0) throw new CaptureError("CAPTURE_FAILED", "Invalid viewport height.");
  const rangeTop = Math.min(startY, endY);
  const rangeBottom = Math.max(startY, endY);
  const rangeHeight = rangeBottom - rangeTop;
  if (rangeHeight <= 0) throw new CaptureError("INVALID_SELECTION", "Invalid selection height.");

  const step = Math.max(10, viewportHeight - occludedTopHeight - occludedBottomHeight);

  const clampedMaxScrollY =
    typeof maxScrollY === "number" && Number.isFinite(maxScrollY)
      ? Math.max(0, maxScrollY)
      : Number.MAX_SAFE_INTEGER;

  const required = Math.ceil(rangeHeight / step) + 1;
  if (required > maxPositions) {
    throw new CaptureError("PAGE_TOO_LARGE", `Selected range requires ${required} viewports — exceeds ${maxPositions} limit. Choose a smaller range.`);
  }

  const positions: number[] = [];
  // Offset the first viewport so its safe region starts exactly at rangeTop
  const startScrollY = Math.max(0, rangeTop - occludedTopHeight);
  let currentY = Math.min(startScrollY, clampedMaxScrollY);
  positions.push(currentY);

  while (currentY + occludedTopHeight + step < rangeBottom && positions.length < maxPositions) {
    const nextY = Math.min(currentY + step, clampedMaxScrollY);
    if (nextY === currentY) break;
    positions.push(nextY);
    currentY = nextY;
  }

  // Ensure the bottom part is captured, unless we're clamped at maxScrollY
  const lastY = positions[positions.length - 1]!;
  if (lastY + viewportHeight - occludedBottomHeight < rangeBottom && lastY < clampedMaxScrollY && positions.length < maxPositions) {
    const finalY = Math.min(rangeBottom - viewportHeight + occludedBottomHeight, clampedMaxScrollY);
    if (finalY > lastY) positions.push(finalY);
  }

  if (positions.length > maxPositions) {
    throw new CaptureError("PAGE_TOO_LARGE", `Selected range requires ${positions.length} viewports — exceeds ${maxPositions} limit.`);
  }

  return positions;
}

export function calculateTotalTimeout(numChunks: number, stabilizeMs = 160, captureIntervalMs = 600, overheadMs = 2000): number {
  // Per chunk: scroll (up to 3500) + stabilize + capture (600) + stitch overhead
  // Use conservative estimate: 3500 + 160 + 600 = 4260 per chunk
  const perChunk = 3500 + stabilizeMs + captureIntervalMs;
  const estimated = numChunks * perChunk + overheadMs;
  // Clamp between 15s and 300s, scaling with chunks
  return Math.max(15000, Math.min(300000, estimated + 5000));
}
