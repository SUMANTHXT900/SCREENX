/**
 * Last-used box range memory (plan: content/selection/lastBox.ts).
 * Remembers the most recent capture's horizontal span in session storage so a
 * repeated column capture is one keypress away. Best-effort: storage may be
 * unavailable; callers must not depend on it.
 */

const KEY = "screenx:lastBoxRange";
const MAX_AGE_MS = 30 * 60 * 1000;

export interface SavedBoxRange {
  left: number;
  width: number;
  at: number;
}

export function saveLastBoxRange(left: number, width: number): void {
  try {
    chrome.storage?.session?.set({ [KEY]: { left, width, at: Date.now() } }, () => {
      try {
        void chrome.runtime.lastError;
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore — memory is a convenience, never a requirement
  }
}

export function loadLastBoxRange(): Promise<SavedBoxRange | null> {
  return new Promise((resolve) => {
    try {
      const area = chrome.storage?.session;
      if (!area?.get) {
        resolve(null);
        return;
      }
      area.get(KEY, (res) => {
        try {
          void chrome.runtime.lastError;
          const v = (res as Record<string, unknown>)[KEY] as SavedBoxRange | undefined;
          if (
            v &&
            typeof v.left === "number" &&
            typeof v.width === "number" &&
            typeof v.at === "number" &&
            Date.now() - v.at < MAX_AGE_MS
          ) {
            resolve({ left: v.left, width: v.width, at: v.at });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}
