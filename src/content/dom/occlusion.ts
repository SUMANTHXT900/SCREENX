import { getScrollController } from "./scrollController.js";

export function measurePageOcclusions(viewportWidth: number, viewportHeight: number) {
  const fixedElements: { top: number; bottom: number; left: number; right: number }[] = [];
  try {
    const t0 = performance.now();
    const elementsToCheck = new Set<Element>();
    
    for (let x = 10; x < viewportWidth; x += Math.max(50, viewportWidth / 4)) {
      const topEl = document.elementFromPoint(x, 10);
      if (topEl) elementsToCheck.add(topEl);
      const bottomEl = document.elementFromPoint(x, viewportHeight - 10);
      if (bottomEl) elementsToCheck.add(bottomEl);
    }
    
    const layoutEls = document.querySelectorAll('header, footer, nav, [class*="fixed" i], [class*="sticky" i], [style*="fixed" i], [style*="sticky" i]');
    for (let i = 0; i < layoutEls.length; i++) {
      const el = layoutEls[i];
      if (el) elementsToCheck.add(el);
    }

    for (const el of elementsToCheck) {
      if (performance.now() - t0 > 50) {
        console.warn('[ScreenX] Occlusion measurement timed out');
        break;
      }
      const htmlEl = el as HTMLElement;
      if (!htmlEl || htmlEl.nodeType !== Node.ELEMENT_NODE) continue;
      if (htmlEl.id && htmlEl.id.startsWith('__screenx')) continue;
      
      const style = window.getComputedStyle(htmlEl);
      if (style.position === 'fixed' || style.position === 'sticky') {
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        
        fixedElements.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right
        });
      }
    }
  } catch (e) {
    console.warn('[ScreenX] Failed to measure occlusions', e);
  }
  return fixedElements;
}

export function measurePage() {
  const controller = getScrollController();
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
    scrollX,
    scrollY,
    dpr,
    maxScrollY: Math.max(0, finalTotalHeight - viewportHeight),
    maxScrollX: Math.max(0, finalTotalWidth - viewportWidth),
    controllerType: controller.describe(),
    fixedElements
  };
}
