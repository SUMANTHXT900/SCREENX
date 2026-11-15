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
  const scoredCandidates: Array<{ el: HTMLElement; score: number; scrollRange: number }> = [];

  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const winArea = winW * winH;

  for (const el of candidates) {
    if (!el.isConnected) continue;
    // 4px threshold admits real panes while filtering subpixel/layout noise
    const scrollableHeight = el.scrollHeight - el.clientHeight;
    if (scrollableHeight <= 4) continue;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") < 0.05) {
      continue;
    }
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;

    const rect = el.getBoundingClientRect();
    // Intersect with window viewport
    const intersectW = Math.max(0, Math.min(rect.right, winW) - Math.max(rect.left, 0));
    const intersectH = Math.max(0, Math.min(rect.bottom, winH) - Math.max(rect.top, 0));
    const visibleArea = intersectW * intersectH;

    // Must occupy a meaningful visible portion of the viewport (at least 180px in each dimension and >= 8% area)
    if (intersectW < 180 || intersectH < 180 || visibleArea < winArea * 0.08) continue;

    // Center alignment bonus: main feed / chat conversation panes are centrally placed,
    // whereas navigation sidebars sit at the edges.
    const paneCenterX = (Math.max(rect.left, 0) + Math.min(rect.right, winW)) / 2;
    const distFromCenter = Math.abs(paneCenterX - winW / 2) / (winW / 2);
    const centerFactor = 1.0 - 0.25 * Math.min(1, distFromCenter);

    // Sidebar penalty: narrow containers (<340px) pinned to the far left or right
    let sidebarPenalty = 1.0;
    if (rect.width < 340 && (rect.left <= 40 || rect.right >= winW - 40)) {
      sidebarPenalty = 0.5;
    }

    // Combined score: balance visible presence and scroll capacity (SX-04)
    const score = (visibleArea * 0.4 + Math.min(scrollableHeight, 15000) * 100 * 0.6) * centerFactor * sidebarPenalty;

    scoredCandidates.push({ el, score, scrollRange: scrollableHeight });
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (scoredCandidates.length > 1) {
    scoredCandidates.sort((a, b) => b.score - a.score);
    const top = scoredCandidates[0]!;
    const second = scoredCandidates[1]!;
    if (second.score > top.score * 0.65) {
      console.warn("[ScreenX] Multiple competing scroll panes detected; selecting dominant candidate", JSON.stringify({
        chosen: `${top.el.tagName}#${top.el.id || "noid"} (score=${Math.round(top.score)}, range=${top.scrollRange})`,
        alternate: `${second.el.tagName}#${second.el.id || "noid"} (score=${Math.round(second.score)}, range=${second.scrollRange})`,
      }));
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
