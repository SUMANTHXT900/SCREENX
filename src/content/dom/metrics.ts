/**
 * Page metrics — document + scroll-container measurements
 * (plan: content/dom/metrics.ts).
 */
import { getScrollController, type ScrollController } from "../scroll/ScrollController";
import { measurePageOcclusions } from "./occlusion";

export function measurePage(pinned?: ScrollController | null) {
  const controller = pinned ?? getScrollController();
  const viewportWidth = controller.getViewportWidth();
  const viewportHeight = controller.getViewportHeight();
  const totalWidth = controller.getScrollWidth();
  const totalHeight = controller.getScrollHeight();
  const scrollX = controller.getScrollLeft();
  const scrollY = controller.getScrollTop();
  const dpr = window.devicePixelRatio || 1;

  const docEl = document.documentElement;
  const body = document.body;
  const docWidth = Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, window.innerWidth);
  const docHeight = Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, window.innerHeight);
  const finalTotalWidth = Math.max(totalWidth, docWidth, viewportWidth);
  const finalTotalHeight = Math.max(totalHeight, docHeight, viewportHeight);

  const fixedElements = measurePageOcclusions(window.innerWidth, window.innerHeight);

  return {
    totalWidth: finalTotalWidth,
    totalHeight: finalTotalHeight,
    viewportWidth,
    viewportHeight,
    winViewportWidth: window.innerWidth,
    winViewportHeight: window.innerHeight,
    scrollX,
    scrollY,
    dpr,
    maxScrollY: Math.max(0, finalTotalHeight - viewportHeight),
    maxScrollX: Math.max(0, finalTotalWidth - viewportWidth),
    controllerType: controller.describe(),
    fixedElements,
  };
}
