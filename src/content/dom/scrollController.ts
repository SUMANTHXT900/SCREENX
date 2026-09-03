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

export function findElementScrollController(): ScrollController | null {
  const candidates = Array.from(document.querySelectorAll("*")) as HTMLElement[];
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;
    const scrollableHeight = el.scrollHeight - el.clientHeight;
    if (scrollableHeight > 100 && el.clientHeight > window.innerHeight * 0.4) {
      const rect = el.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.6 && rect.height > window.innerHeight * 0.4) {
        if (scrollableHeight > bestScore) {
          bestScore = scrollableHeight;
          best = el;
        }
      }
    }
  }

  if (best && bestScore > 200) {
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
  if (elementController && windowScrollable < 100) {
    return elementController;
  }
  return createWindowScrollController();
}

export function getSelectionDocumentY(e: MouseEvent): number {
  const controller = getScrollController();
  if (controller.element === window) {
    return e.clientY + window.scrollY;
  } else {
    const el = controller.element as HTMLElement;
    const rect = el.getBoundingClientRect();
    return (e.clientY - rect.top) + el.scrollTop;
  }
}

export interface ScrollResult {
  requestedX: number;
  requestedY: number;
  actualX: number;
  actualY: number;
  attempts: number;
  settled: boolean;
}

export async function scrollToAndSettle(controller: ScrollController | null, x: number, y: number, maxAttempts = 3): Promise<ScrollResult> {
  const c = controller ?? getScrollController();
  const el = c.element;
  let originalScrollSnap = "";
  let originalOverflowAnchor = "";
  if (el instanceof HTMLElement && el.style) {
    originalScrollSnap = el.style.scrollSnapType;
    originalOverflowAnchor = el.style.overflowAnchor;
    el.style.scrollSnapType = "none";
    el.style.overflowAnchor = "none";
  }

  let attempts = 0;
  let actualX = 0;
  let actualY = 0;
  let settled = false;
  
  let maxScrollY = c.getMaxScrollY();
  let maxScrollX = c.getMaxScrollX();

  while (attempts < maxAttempts) {
    attempts++;
    
    maxScrollY = c.getMaxScrollY();
    maxScrollX = c.getMaxScrollX();
    
    const clampedX = Math.max(0, Math.min(x, maxScrollX));
    const clampedY = Math.max(0, Math.min(y, maxScrollY));

    c.setScrollTop(clampedY);
    c.setScrollLeft(clampedX);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 80 + attempts * 50);
        });
      });
    });

    actualX = c.getScrollLeft();
    actualY = c.getScrollTop();

    if (Math.abs(actualX - clampedX) <= 2 && Math.abs(actualY - clampedY) <= 2) {
      settled = true;
      break;
    }
  }

  if (el instanceof HTMLElement && el.style) {
    el.style.scrollSnapType = originalScrollSnap;
    el.style.overflowAnchor = originalOverflowAnchor;
  }

  if (!settled) {
    const info = {
      requested: { x, y },
      actual: { x: actualX, y: actualY },
      controller: c.describe(),
      scrollHeight: c.getScrollHeight(),
      clientHeight: c.getViewportHeight(),
      maxScrollY,
    };
    console.warn("[ScreenX] scroll position unstable", JSON.stringify(info));
    throw new Error(JSON.stringify({ 
      code: "SCROLL_POSITION_UNSTABLE", 
      message: `Failed to settle scroll position after ${attempts} attempts (requested y=${y}, actual y=${actualY})`,
      details: info 
    }));
  }

  return { requestedX: x, requestedY: y, actualX, actualY, attempts, settled };
}
