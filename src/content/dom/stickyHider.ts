/**
 * Sticky/fixed bar hider for multi-strip captures.
 *
 * Rationale: fixed and sticky bars (nav headers, filter chips, chat inputs)
 * stay glued to the viewport while content scrolls past, so every strip
 * photographs them again. Trimming them out of each strip instead deletes
 * LIVE rows on chunks where a sticky bar isn't docked (white seam bands),
 * and no aligner can recover deleted rows. Hiding the bars during the pass
 * removes the problem at the source: every strip then holds only scrolling
 * content, and duplication is impossible by construction.
 *
 * Deliberately spared (hiding these breaks the page or blanks the shot):
 *  - our own UI (ids starting with __screenx)
 *  - any ancestor of the active scroll container (chat apps often fix the
 *    whole app shell — hiding it blanks the viewport)
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
 * Hide fixed/sticky bars overlapping [bandLeft, bandRight] (CSS px, viewport
 * space; defaults to the full viewport). Returns the hidden count.
 * `scrollRoot` is the active scroller element (or window): its ancestors are
 * spared. Idempotent — hides only what isn't already hidden by us.
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
