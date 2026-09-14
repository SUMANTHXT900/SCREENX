/**
 * Scroll controller — window vs nested-element abstraction
 * (plan: content/scroll/ScrollController.ts).
 * Single source; src/content/dom/scrollController.ts re-exports for compat.
 */

export interface ScrollController {
  element: Window | HTMLElement;
  getScrollTop(): number;
  setScrollTop(y: number): void;
  getScrollLeft(): number;
  setScrollLeft(x: number): void;
  getViewportHeight(): number;
  getViewportWidth(): number;
  getScrollHeight(): number;
  getScrollWidth(): number;
  getMaxScrollY(): number;
  getMaxScrollX(): number;
  describe(): string;
}

export function createWindowScrollController(): ScrollController {
  const docEl = document.documentElement;
  const body = document.body;

  return {
    element: window,
    getScrollTop: () => window.scrollY,
    setScrollTop: (y: number) => {
      window.scrollTo({ left: window.scrollX, top: y, behavior: "instant" as ScrollBehavior });
      window.scrollTo(window.scrollX, y);
    },
    getScrollLeft: () => window.scrollX,
    setScrollLeft: (x: number) => {
      window.scrollTo({ left: x, top: window.scrollY, behavior: "instant" as ScrollBehavior });
      window.scrollTo(x, window.scrollY);
    },
    getViewportHeight: () => window.innerHeight,
    getViewportWidth: () => window.innerWidth,
    getScrollHeight: () => Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, docEl.clientHeight, window.innerHeight),
    getScrollWidth: () => Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, docEl.clientWidth, window.innerWidth),
    getMaxScrollY: () => Math.max(0, Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, docEl.clientHeight, window.innerHeight) - window.innerHeight),
    getMaxScrollX: () => Math.max(0, Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, docEl.clientWidth, window.innerWidth) - window.innerWidth),
    describe: () => "window",
  };
}

/** Walk document + open shadow roots; querySelectorAll(document) misses shadow DOM panes. */
function collectElementsDeep(root: Document | ShadowRoot, out: HTMLElement[] = [], seen = new Set<ShadowRoot>()): HTMLElement[] {
  for (const node of Array.from(root.querySelectorAll("*"))) {
    if (node instanceof HTMLElement) out.push(node);
    const shadow = node.shadowRoot;
    if (shadow && !seen.has(shadow)) {
      seen.add(shadow);
      collectElementsDeep(shadow, out, seen);
    }
  }
  return out;
}

export function findElementScrollController(): ScrollController | null {
  const candidates = collectElementsDeep(document);
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    // A 4px threshold admits short real panes while filtering subpixel/layout
    // noise. The point-based selector uses the same contract below.
    if (el.scrollHeight - el.clientHeight <= 4) continue;
    if (el.clientHeight <= window.innerHeight * 0.4) continue;
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;
    const scrollableHeight = el.scrollHeight - el.clientHeight;
    {
      const rect = el.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.6 && rect.height > window.innerHeight * 0.4) {
        if (scrollableHeight > bestScore) {
          bestScore = scrollableHeight;
          best = el;
        }
      }
    }
  }

  if (best && bestScore > 4) {
    return {
      element: best,
      getScrollTop: () => best!.scrollTop,
      setScrollTop: (y: number) => {
        best!.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
        best!.scrollTop = y;
      },
      getScrollLeft: () => best!.scrollLeft,
      setScrollLeft: (x: number) => {
        best!.scrollTo({ left: x, behavior: "instant" as ScrollBehavior });
        best!.scrollLeft = x;
      },
      getViewportHeight: () => best!.clientHeight,
      getViewportWidth: () => best!.clientWidth,
      getScrollHeight: () => best!.scrollHeight,
      getScrollWidth: () => best!.scrollWidth,
      getMaxScrollY: () => Math.max(0, best!.scrollHeight - best!.clientHeight),
      getMaxScrollX: () => Math.max(0, best!.scrollWidth - best!.clientWidth),
      describe: () => `${best!.tagName.toLowerCase()}${best!.id ? "#" + best!.id : ""}${best!.className ? "." + String(best!.className).split(" ")[0] : ""}`,
    };
  }

  return null;
}

export function getScrollController(): ScrollController {
  const docEl = document.documentElement;
  const body = document.body;
  const windowScrollHeight = Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, docEl.clientHeight);
  const windowViewportHeight = window.innerHeight;
  const windowScrollable = windowScrollHeight - windowViewportHeight;

  const elementController = findElementScrollController();
  if (elementController) {
    // Drive the DOMINANT scroller: on dual-scroll pages (Notion, Gmail, Jira)
    // scrolling the wrong element stalls every position and silently truncates
    // the stitch. The old windowScrollable<100 gate ignored a huge inner pane
    // whenever the window scrolled even slightly.
    const elementRange = elementController.getMaxScrollY();
    if (elementRange >= windowScrollable) return elementController;
  }
  return createWindowScrollController();
}

/** Document Y for a mouse event, honoring nested scroll containers. */
export function getSelectionDocumentY(e: MouseEvent): number {
  const controller = getScrollController();
  if (controller.element === window) {
    return e.clientY + window.scrollY;
  }
  const el = controller.element as HTMLElement;
  const rect = el.getBoundingClientRect();
  return e.clientY - rect.top + el.scrollTop;
}

/**
 * Resolve the scroll controller for a specific viewport point: walk up from
 * whatever is under (x, y) and take the nearest genuinely scrollable ancestor.
 * Region capture uses this so the box scrolls the container actually behind it,
 * even when that isn't the page's global "best" scroller.
 */
export function findScrollContainerAt(x: number, y: number): ScrollController {
  let element = document.elementFromPoint(x, y) as HTMLElement | null;
  while (element && element.shadowRoot) {
    try {
      const inner = (element.shadowRoot as ShadowRoot).elementFromPoint(x, y) as HTMLElement | null;
      if (!inner || inner === element) break;
      element = inner;
    } catch {
      break;
    }
  }
  let node: HTMLElement | null = element;
  while (node && node !== document.body && node !== document.documentElement) {
    let overflowY = "";
    try {
      overflowY = getComputedStyle(node).overflowY;
    } catch {
      break;
    }
    if (/^(auto|scroll|overlay)$/.test(overflowY) && node.scrollHeight - node.clientHeight > 4) {
      const target = node;
      return {
        element: target,
        getScrollTop: () => target.scrollTop,
        setScrollTop: (top: number) => {
          try {
            target.scrollTo({ top, behavior: "instant" as ScrollBehavior });
          } catch {
            // ignore
          }
          target.scrollTop = top;
        },
        getScrollLeft: () => target.scrollLeft,
        setScrollLeft: (left: number) => {
          try {
            target.scrollTo({ left, behavior: "instant" as ScrollBehavior });
          } catch {
            // ignore
          }
          target.scrollLeft = left;
        },
        getViewportHeight: () => target.clientHeight,
        getViewportWidth: () => target.clientWidth,
        getScrollHeight: () => target.scrollHeight,
        getScrollWidth: () => target.scrollWidth,
        getMaxScrollY: () => Math.max(0, target.scrollHeight - target.clientHeight),
        getMaxScrollX: () => Math.max(0, target.scrollWidth - target.clientWidth),
        describe: () =>
          `${target.tagName.toLowerCase()}${target.id ? "#" + target.id : ""}${
            typeof target.className === "string" && target.className.trim()
              ? "." + target.className.trim().split(/\s+/)[0]
              : ""
          }`,
      };
    }
    node = node.parentElement;
  }
  return createWindowScrollController();
}
