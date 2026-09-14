/**
 * Sticky/fixed widget hider for multi-strip captures.
 *
 * Capture-as-is contract: hiding is page mutation, and `visibility:hidden`
 * on an ancestor hides its WHOLE subtree — one over-eager hide of a sticky
 * content wrapper deletes real fields (e.g. a form input) from EVERY strip,
 * which no stitcher can recover. That data-loss class is worse than any
 * cosmetic seam, so hiding is deliberately minimal now:
 *
 *  - ONLY tiny floating widgets are hidden (icon buttons, chat bubbles,
 *    back-to-top pills): they repeat in every strip, can't be trimmed (they
 *    sit outside the top/bottom occlusion bands), and carry no content.
 *  - Bars, headers, banners and sections are NEVER hidden, even docked ones:
 *    a docked strip can be page content (contact bar, cookie notice, sticky
 *    section) and structure alone can't tell chrome from content. Fixed
 *    top/bottom bars are still removed via measured occlusion TRIMS (which
 *    only cut viewport-docked bands and keep one full copy in the top chunk),
 *    and sticky leftovers may cosmetically repeat — accepted, documented.
 *
 * Deliberately spared (hiding these loses content or blanks the shot):
 *  - our own UI (ids starting with __screenx)
 *  - any ancestor of the active scroll container (chat apps often fix the
 *    whole app shell — hiding it blanks the viewport)
 *  - anything larger than a small widget (bars, panels, wrappers, sections)
 *  - anything containing form controls (input/textarea/select/contenteditable)
 *  - anything containing media (img/video/canvas/iframe/svg) or >80 text chars
 *  - elements taller than 60% of the viewport (layout wrappers, not bars)
 *  - bars that don't overlap the capture band horizontally
 *
 * visibility:hidden is used (never display:none) so hiding causes no reflow
 * and scroll positions stay valid. Everything is restored by
 * restoreStickyBars(); a watchdog auto-restores after 120s so a dead worker
 * (SW restart mid-pass) can't leave bars hidden forever.
 */

/** Inline visibility values saved for restore. */
interface HiddenEntry {
  element: HTMLElement;
  value: string;
  priority: string;
}

let hidden: HiddenEntry[] = [];
let watchdog: ReturnType<typeof setTimeout> | null = null;

/** Query open shadow roots too; sticky bars in component trees repeat just like light-DOM bars. */
function collectElementsDeep(root: Document | ShadowRoot, out: Element[] = [], seen = new Set<ShadowRoot>()): Element[] {
  for (const node of Array.from(root.querySelectorAll("*"))) {
    out.push(node);
    const shadow = node.shadowRoot;
    if (shadow && !seen.has(shadow)) {
      seen.add(shadow);
      collectElementsDeep(shadow, out, seen);
    }
  }
  return out;
}

function clearWatchdog(): void {
  if (watchdog !== null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

/** Our own overlay/HUD/toast nodes — never touch. */
function isOwnUi(el: Element): boolean {
  if (el instanceof HTMLElement && el.id.startsWith("__screenx")) return true;
  let node: Element | null = el;
  while (node) {
    if (node instanceof HTMLElement && node.id.startsWith("__screenx")) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * DOM-free hide decision (pure — unit-tested). Only tiny, content-free
 * floating widgets qualify. Everything else stays exactly as-is on the page.
 */
export interface HideCandidate {
  width: number;
  height: number;
  /** Visible text length inside the element (textContent, trimmed). */
  textLength: number;
  /** True when the element or any descendant is a form control. */
  hasFormControl: boolean;
  /** True when the element or any descendant is media (img/video/canvas/iframe/svg). */
  hasMedia: boolean;
}

/** Max widget dimension (CSS px) eligible for hiding — bars/panels never qualify. */
export const MAX_HIDE_WIDGET_PX = 200;
/** Max text length (chars) eligible for hiding — content sections never qualify. */
export const MAX_HIDE_TEXT_LEN = 80;

export function shouldHideCandidate(c: HideCandidate): boolean {
  if (c.width > MAX_HIDE_WIDGET_PX || c.height > MAX_HIDE_WIDGET_PX) return false;
  if (c.hasFormControl || c.hasMedia) return false;
  if (c.textLength > MAX_HIDE_TEXT_LEN) return false;
  return true;
}

const FORM_CONTROL_SELECTOR = "input,textarea,select,[contenteditable]";
const MEDIA_SELECTOR = "img,video,canvas,iframe,svg";

function subtreeHas(el: HTMLElement, selector: string): boolean {
  try {
    if (typeof el.matches === "function" && el.matches(selector)) return true;
    return el.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

/**
 * Hide content-free floating widgets overlapping [bandLeft, bandRight] (CSS
 * px, viewport space; defaults to the full viewport). Returns the hidden
 * count. `scrollRoot` is the active scroller element (or window): its
 * ancestors are spared. Idempotent — hides only what isn't already hidden.
 */
export function hideStickyBars(
  bandLeft?: number,
  bandRight?: number,
  scrollRoot?: Window | HTMLElement | null
): number {
  const left = typeof bandLeft === "number" ? bandLeft : 0;
  const right = typeof bandRight === "number" ? bandRight : window.innerWidth;
  const tallLimit = window.innerHeight * 0.6;
  const scrollerEl = scrollRoot instanceof HTMLElement ? scrollRoot : null;

  const found: HiddenEntry[] = [];
  let candidates: Element[];
  try {
    candidates = collectElementsDeep(document);
  } catch {
    return 0;
  }
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    if (isOwnUi(el)) continue;
    // Never hide something the scrolling content lives inside.
    if (scrollerEl && el !== scrollerEl && el.contains(scrollerEl)) continue;
    let position = "";
    try {
      const style = getComputedStyle(el);
      position = style.position;
      if (position !== "fixed" && position !== "sticky") continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
    } catch {
      continue;
    }
    let rect: DOMRect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.height > tallLimit) continue; // a wrapper, not a bar
    if (rect.right <= left || rect.left >= right) continue;

    // Capture-as-is: only tiny content-free widgets may be hidden. A sticky
    // ancestor hides its whole subtree, so one wrong hide deletes live
    // fields from every strip — size + form + media + text guards keep that
    // from ever happening again.
    let textLength = 0;
    try {
      textLength = (el.textContent ?? "").trim().length;
    } catch {
      textLength = Number.MAX_SAFE_INTEGER;
    }
    if (
      !shouldHideCandidate({
        width: rect.width,
        height: rect.height,
        textLength,
        hasFormControl: subtreeHas(el, FORM_CONTROL_SELECTOR),
        hasMedia: subtreeHas(el, MEDIA_SELECTOR),
      })
    ) {
      continue;
    }

    let value = "";
    let priority = "";
    try {
      value = el.style.getPropertyValue("visibility");
      priority = el.style.getPropertyPriority("visibility");
      el.style.setProperty("visibility", "hidden", "important");
    } catch {
      continue;
    }
    found.push({ element: el, value, priority });
  }

  hidden = hidden.concat(found);
  // Watchdog: a worker that dies mid-pass (SW restart) never sends RESTORE.
  // Bars are visibility-hidden (page still works), and this puts them back.
  clearWatchdog();
  if (hidden.length > 0) {
    watchdog = setTimeout(() => {
      try {
        restoreStickyBars();
      } catch {
        // ignore
      }
    }, 120_000);
  }
  return found.length;
}

/** Restore every bar hidden by hideStickyBars(). Idempotent. */
export function restoreStickyBars(): number {
  clearWatchdog();
  let count = 0;
  for (const entry of hidden) {
    try {
      if (entry.value) {
        entry.element.style.setProperty("visibility", entry.value, entry.priority);
      } else {
        entry.element.style.removeProperty("visibility");
      }
      count++;
    } catch {
      // ignore — element may be gone
    }
  }
  hidden = [];
  return count;
}

/** For tests/diagnostics: how many bars are currently hidden. */
export function hiddenStickyCount(): number {
  return hidden.length;
}
