/**
 * Sticky-bar hide/restore bridge (worker side of src/content/dom/stickyHider.ts).
 *
 * Hiding fixed/sticky bars during multi-strip passes removes seam duplication
 * at the source — no strip re-photographs a bar, so nothing needs trimming
 * and no live rows are ever deleted. When hiding is active the caller must
 * drop its occlusion trims (measured bars are gone; trimming would cut live
 * content) and keep only the HUD reserve.
 *
 * Every function here is best-effort and NEVER throws: a stale content
 * script (no HIDE handler) or a dead tab must fall back to occlusion
 * trimming, never fail the capture.
 */
import { sendToContent } from "./contentBridge";

export interface StickyHideResult {
  /** True when the content script confirmed bars are hidden. */
  active: boolean;
  /** How many bars were hidden (0 when none overlapped). */
  hidden: number;
}

export async function hideStickyBarsForCapture(
  tabId: number | undefined,
  bandLeft?: number,
  bandRight?: number
): Promise<StickyHideResult> {
  if (tabId === undefined) return { active: false, hidden: 0 };
  try {
    const res = await sendToContent<{ ok: boolean; hidden?: number }>(tabId, {
      type: "SCREENX_HIDE_STICKY",
      ...(typeof bandLeft === "number" ? { bandLeft } : {}),
      ...(typeof bandRight === "number" ? { bandRight } : {}),
    });
    const hidden = res.hidden ?? 0;
    if (res && res.ok && hidden > 0) return { active: true, hidden };
    return { active: false, hidden };
  } catch {
    return { active: false, hidden: 0 };
  }
}

/** Best-effort restore. Never throws — restore also has content-side backstops. */
export async function restoreStickyBarsForCapture(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  try {
    await sendToContent(tabId, { type: "SCREENX_RESTORE_STICKY" });
  } catch {
    // ignore — watchdog + reset entry restore content-side
  }
}
