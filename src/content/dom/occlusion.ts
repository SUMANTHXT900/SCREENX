/**
 * Occlusion detector — FIXED-position element discovery (50ms budget).
 * Metrics live in ./metrics.ts.
 *
 * Fixed-only, deliberately NOT sticky: a sticky bar docks and undocks as the
 * page scrolls, so a one-time measurement applied as a trim to every chunk
 * deletes real content from chunks where the bar isn't stuck (white bands).
 * A docked sticky bar may duplicate a few rows instead — the seam aligner
 * absorbs duplication, but no aligner can recover trimmed-away rows.
 */
export function measurePageOcclusions(viewportWidth: number, viewportHeight: number) {
  const fixedElements: { top: number; bottom: number; left: number; right: number }[] = [];
  try {
    const t0 = performance.now();
    const elementsToCheck = new Set<Element>();

    // Sweep a real grid (not ~5 columns): cookie banners, chat widgets, PiP
    // and side rails hide between sparse samples and ghost-repeat in output.
    const stepX = Math.max(40, viewportWidth / 6);
    for (let x = 10; x < viewportWidth; x += stepX) {
      for (const y of [10, viewportHeight / 2, viewportHeight - 10]) {
        const found = document.elementFromPoint(x, y);
        if (found) elementsToCheck.add(found);
      }
    }

    const layoutEls = document.querySelectorAll('header, footer, nav, [class*="fixed" i], [class*="sticky" i], [style*="fixed" i], [style*="sticky" i]');
    for (let i = 0; i < layoutEls.length; i++) {
      const el = layoutEls[i];
      if (el) elementsToCheck.add(el);
    }

    for (const el of elementsToCheck) {
      if (performance.now() - t0 > 50) {
        console.warn("[ScreenX] Occlusion measurement timed out");
        break;
      }
      const htmlEl = el as HTMLElement;
      if (!htmlEl || htmlEl.nodeType !== Node.ELEMENT_NODE) continue;
      if (htmlEl.id && htmlEl.id.startsWith("__screenx")) continue;

      const style = window.getComputedStyle(htmlEl);
      // Fixed ONLY (see file header): sticky docks/undocks per scroll position,
      // so trimming it from every chunk deletes live content as white bands.
      if (style.position !== "fixed") continue;
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) continue;
      const rect = htmlEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      fixedElements.push({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      });
    }
  } catch (e) {
    console.warn("[ScreenX] Failed to measure occlusions", e);
  }
  return fixedElements;
}
