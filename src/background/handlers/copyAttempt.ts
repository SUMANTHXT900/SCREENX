/**
 * Shared copy-attempt helper — single home for tab focus + bounded retries,
 * used by BOTH the automatic post-capture copy (captureHandler) and the
 * worker-side Copy retry (toastActions). Leaf module (imports only the
 * clipboard transport) so neither caller risks an import cycle.
 */
import { sendCopyImageReport, type CopyReport } from "@/capture/clipboard";

export const COPY_ATTEMPT_SETTLES_MS = [150, 500, 1000];
export const COPY_ATTEMPT_TIMEOUT_MS = 2_000;
/** First-attempt ceiling: big images need longer for decode + OS handoff. */
export const COPY_FIRST_TIMEOUT_MAX_MS = 8_000;

export interface TabIdentity {
  url?: string;
  windowId?: number;
}

/** Best-effort tab lookup for classification + focusing. Never throws. */
export async function readTab(tabId: number): Promise<TabIdentity> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { url: tab?.url, windowId: tab?.windowId };
  } catch {
    return {};
  }
}

/**
 * Focus assist for the clipboard write: activating the tab is NOT enough —
 * `tabs.update({active:true})` leaves DevTools/another-window focus in place
 * and `document.hasFocus()` stays false. Focusing the WINDOW first is what
 * actually hands document focus back to the page. Never throws.
 */
export async function focusTabForCopy(tabId: number, windowId?: number): Promise<void> {
  try {
    if (windowId !== undefined && typeof chrome.windows?.update === "function") {
      await chrome.windows.update(windowId, { focused: true });
    }
  } catch {
    // ignore — tab activation below is the fallback
  }
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // Tab may be closed; the write will simply fail gracefully.
  }
}

export interface CopyAttemptResult {
  copied: boolean;
  /** Last content-script report (for reason-specific messaging). */
  lastReport?: CopyReport;
  attempts: number;
}

/**
 * Attempt a clipboard write with real window focus and bounded retries.
 * Retries ONLY when the tab reports unfocused (a timing race focus can still
 * win); a focused refusal or structural error stops after the first attempt
 * — retrying those is pointless. Never throws.
 *
 * `logPrefix` correlates attempts in the console (pass the capture label).
 */
export async function attemptCopyWithFocus(
  tabId: number,
  dataUrl: string,
  windowId: number | undefined,
  logPrefix: string
): Promise<CopyAttemptResult> {
  let lastReport: CopyReport | undefined;
  let attempts = 0;
  for (let attempt = 0; attempt < COPY_ATTEMPT_SETTLES_MS.length; attempt++) {
    attempts = attempt + 1;
    await focusTabForCopy(tabId, windowId);
    // Let the focus event propagate to the renderer before writing.
    await new Promise<void>((r) => setTimeout(r, COPY_ATTEMPT_SETTLES_MS[attempt]!));
    // First attempt gets a payload-scaled budget: decoding + handing a
    // multi-MB PNG to the OS takes longer than the flat 2s. Retries keep
    // the short budget so a genuinely stuck tab can't stall the toast.
    const timeout =
      attempt === 0
        ? Math.min(COPY_FIRST_TIMEOUT_MAX_MS, COPY_ATTEMPT_TIMEOUT_MS + Math.ceil(dataUrl.length / 500_000) * 500)
        : COPY_ATTEMPT_TIMEOUT_MS;
    lastReport = await sendCopyImageReport(tabId, dataUrl, timeout);
    if (lastReport.ok) {
      if (attempt > 0) console.debug(`[ScreenX] ${logPrefix} → clipboard retry ${attempt + 1} succeeded`);
      return { copied: true, lastReport, attempts };
    }
    console.debug(`[ScreenX] ${logPrefix} → clipboard attempt ${attempt + 1} failed:`, lastReport.error ?? "refused", {
      focused: lastReport.focused,
      transientActivation: lastReport.transientActivation,
    });
    if (lastReport.focused !== false) break;
  }
  return { copied: false, lastReport, attempts };
}
