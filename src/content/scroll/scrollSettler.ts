/**
 * Scroll settler — transactional scrollToAndSettle state machine
 * (plan: content/scroll/scrollSettler.ts).
 */
import { getScrollController, type ScrollController } from "./ScrollController";

export interface ScrollResult {
  requestedX: number;
  requestedY: number;
  actualX: number;
  actualY: number;
  attempts: number;
  settled: boolean;
}

export async function scrollToAndSettle(
  controller: ScrollController | null,
  x: number,
  y: number,
  maxAttempts = 3
): Promise<ScrollResult> {
  const c = controller ?? getScrollController();
  const el = c.element;
  // Scroll-snap must die for the whole run — including the WINDOW path:
  // snap-section sites (Apple-style, fullpage.js) otherwise yank the scroll
  // post-settle and every seam duplicates. documentElement carries the page's
  // snap on the window path; restore both in a finally below.
  let originalScrollSnap = "";
  let originalOverflowAnchor = "";
  let docSnap = "";
  const docEl = typeof document !== "undefined" ? document.documentElement : null;
  try {
    if (el instanceof HTMLElement && el.style) {
      originalScrollSnap = el.style.scrollSnapType;
      originalOverflowAnchor = el.style.overflowAnchor;
      el.style.scrollSnapType = "none";
      el.style.overflowAnchor = "none";
    }
    if (docEl && el !== docEl) {
      docSnap = docEl.style.scrollSnapType;
      docEl.style.scrollSnapType = "none";
    }
  } catch {
    // ignore — best effort
  }

  let attempts = 0;
  let actualX = 0;
  let actualY = 0;
  let settled = false;

  let maxScrollY = c.getMaxScrollY();
  const maxScrollX = c.getMaxScrollX();

  try {
    while (attempts < maxAttempts) {
      attempts++;

      maxScrollY = c.getMaxScrollY();
      const clampedMaxX = c.getMaxScrollX();

      const clampedX = Math.max(0, Math.min(x, clampedMaxX));
      const clampedY = Math.max(0, Math.min(y, maxScrollY));

      c.setScrollTop(clampedY);
      c.setScrollLeft(clampedX);

      // Repaint, then a real settle pause (lazy images, fade-ins, webfonts),
      // then verify the container has stopped moving before trusting a
      // reading. Attempt 1 waits longer: the first scroll kicks off the most
      // lazy decoding, and capturing too early shifts every later seam.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 150 + attempts * 100);
          });
        });
      });
      await waitForStableScroll(c);
      // Best-effort content quiet: fonts + one layout-height poll. Lazy
      // images/fonts that resolve BETWEEN the position read and the shot are
      // the classic "rows moved under us" seam tear. Never blocks longer
      // than ~600ms and never throws.
      await waitForQuietContent();

      actualX = c.getScrollLeft();
      actualY = c.getScrollTop();

      if (Math.abs(actualX - clampedX) <= 2 && Math.abs(actualY - clampedY) <= 2) {
        settled = true;
        break;
      }
    }
  } finally {
    // Restore even if getMaxScrollY throws mid-loop — leaving snap "none"
    // would permanently break the page's scrolling.
    try {
      if (el instanceof HTMLElement && el.style) {
        el.style.scrollSnapType = originalScrollSnap;
        el.style.overflowAnchor = originalOverflowAnchor;
      }
      if (docEl && el !== docEl) docEl.style.scrollSnapType = docSnap;
    } catch {
      // ignore
    }
  }

  if (!settled) {
    // Align-and-continue: report where we actually are instead of throwing.
    // The capture loop stitches from actual positions and the stitcher
    // pixel-aligns every seam, so a near-miss still yields a good image.
    console.warn(
      "[ScreenX] scroll did not fully settle; continuing with actual position",
      JSON.stringify({ requested: { x, y }, actual: { x: actualX, y: actualY }, attempts })
    );
  }

  void maxScrollX;
  return { requestedX: x, requestedY: y, actualX, actualY, attempts, settled };
}

/** Best-effort wait for fonts/layout to stop shifting rows (~600ms max). */
export function waitForQuietContent(timeoutMs = 600): Promise<void> {
  const quiet = (async () => {
    try {
      // Webfont swap shifts line breaks mid-capture on Substack/Medium-likes.
      const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (fonts?.ready) {
        await Promise.race([
          fonts.ready,
          new Promise<void>((r) => setTimeout(r, 350)),
        ]);
      }
    } catch {
      // ignore
    }
    try {
      // Two height samples 120ms apart: a changing scrollHeight means lazy
      // content is still reflowing — wait one more beat, then proceed anyway
      // (the stitcher's gap-heal + aligner absorb the residue).
      const h1 = document.documentElement?.scrollHeight ?? 0;
      await new Promise<void>((r) => setTimeout(r, 120));
      const h2 = document.documentElement?.scrollHeight ?? 0;
      if (h1 > 0 && h2 !== h1) {
        await new Promise<void>((r) => setTimeout(r, 120));
      }
    } catch {
      // ignore
    }
  })();
  return Promise.race([
    quiet,
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Poll until the container stops moving (≤0.5px between frames, ≤30 frames). */
export function waitForStableScroll(c: ScrollController): Promise<void> {
  return new Promise((resolve) => {
    let previous: number;
    try {
      previous = c.getScrollTop();
    } catch {
      resolve();
      return;
    }
    let attempt = 0;
    const tick = () => {
      attempt++;
      let current: number;
      try {
        current = c.getScrollTop();
      } catch {
        resolve();
        return;
      }
      if (Math.abs(current - previous) < 0.5 || attempt >= 30) {
        resolve();
        return;
      }
      previous = current;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
