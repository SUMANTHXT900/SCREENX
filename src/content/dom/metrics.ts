/**
 * Page metrics — document + scroll-container measurements
 * (plan: content/dom/metrics.ts).
 *
 * SX-02/SX-03 fix: report independent document and active-scroller metrics.
 * The active scroller's maxScrollY is its own scrollHeight − clientHeight,
 * NOT a hybrid with document height. totalHeight/totalWidth represent the
 * scroller's content extent (what needs to be captured), not a max of
 * document and scroller. Window dimensions are reported separately for
 * bitmap mapping (captureVisibleTab always photographs the whole window).
 */
import { getScrollController, type ScrollController } from "../scroll/ScrollController";
import { measurePageOcclusions } from "./occlusion";

export function measurePage(pinned?: ScrollController | null) {
  const controller = pinned ?? getScrollController();
  const isWindow = controller.element === window;

  // Scroller's own content dimensions (what we need to scroll through)
  const scrollerWidth = controller.getScrollWidth();
  const scrollerHeight = controller.getScrollHeight();
  const scrollerViewportWidth = controller.getViewportWidth();
  const scrollerViewportHeight = controller.getViewportHeight();
  const scrollX = controller.getScrollLeft();
  const scrollY = controller.getScrollTop();
  const dpr = window.devicePixelRatio || 1;

  // For the window scroller, totalHeight is the classic max of document dims.
  // For a nested scroller, totalHeight is the scroller's own scrollHeight —
  // NOT blended with document.scrollHeight (SX-03 fix).
  let totalWidth: number;
  let totalHeight: number;

  if (isWindow) {
    const docEl = document.documentElement;
    const body = document.body;
    const docWidth = Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, window.innerWidth);
    const docHeight = Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, window.innerHeight);
    totalWidth = Math.max(scrollerWidth, docWidth, scrollerViewportWidth);
    totalHeight = Math.max(scrollerHeight, docHeight, scrollerViewportHeight);
  } else {
    // Nested scroller: use its own content extent, never blend with document
    totalWidth = scrollerWidth;
    totalHeight = scrollerHeight;
  }

  // maxScrollY is the active controller's own max — never a hybrid (SX-03)
  const maxScrollY = controller.getMaxScrollY();
  const maxScrollX = controller.getMaxScrollX();

  const fixedElements = measurePageOcclusions(window.innerWidth, window.innerHeight);

  // Pane client rect for nested scrollers (SX-02: the stitcher needs to know
  // where the pane sits in the window and how tall it is)
  let paneLeft = 0;
  let paneTop = 0;
  let paneWidth = window.innerWidth;
  let paneHeight = window.innerHeight;
  if (!isWindow && controller.element instanceof HTMLElement && typeof controller.element.getBoundingClientRect === "function") {
    const el = controller.element;
    const rect = el.getBoundingClientRect();
    paneLeft = rect.left + (el.clientLeft || 0);
    paneTop = rect.top + (el.clientTop || 0);
    paneWidth = el.clientWidth || rect.width;
    paneHeight = el.clientHeight || rect.height;
  }

  return {
    totalWidth,
    totalHeight,
    viewportWidth: scrollerViewportWidth,
    viewportHeight: scrollerViewportHeight,
    winViewportWidth: window.innerWidth,
    winViewportHeight: window.innerHeight,
    scrollX,
    scrollY,
    dpr,
    maxScrollY,
    maxScrollX,
    controllerType: controller.describe(),
    fixedElements,
    // SX-02: pane geometry for frame-aware stitching
    paneLeft,
    paneTop,
    paneWidth,
    paneHeight,
  };
}
