/**
 * Segment planner — auto-split oversized captures into saveable parts
 * (plan: capture/planner/segments.ts).
 *
 * A single canvas cannot exceed 32767px per side / 268MP area (Chrome's real
 * limit — not 65535). Instead of failing (or silently clamping away content),
 * tall captures split into N vertical parts, each stitched separately from
 * the SAME chunks via the CanvasStitcher selection mode. No re-scrolling,
 * no re-capture. NOTE: the parts are stored separately precisely because
 * their STACKED total may still exceed one canvas — stacking them back into
 * a single file can remain impossible (see editor export pre-check).
 */
import { CaptureError } from "@/types/capture";
import { MAX_CANVAS_HEIGHT, MAX_CANVAS_PIXELS, MAX_TOTAL_HEIGHT } from "../stitch/limits";

/** Hard cap on auto-split parts — beyond this the page is genuinely too long. */
export const MAX_PARTS = 8;

/** CSS-px height of one part for the given width/dpr, or 0 if unsplittable. */
export function maxPartHeightCss(totalWidthCss: number, dpr: number): number {
  if (!Number.isFinite(totalWidthCss) || totalWidthCss <= 0) return 0;
  const d = dpr > 0 ? dpr : 1;
  const finalWidth = Math.round(totalWidthCss * d);
  if (finalWidth <= 0) return 0;
  const byPixels = Math.floor(MAX_CANVAS_PIXELS / (finalWidth * d));
  const byHeight = Math.floor(MAX_CANVAS_HEIGHT / d);
  return Math.max(0, Math.min(MAX_TOTAL_HEIGHT, byPixels, byHeight));
}

/** Estimated final size in megapixels (physical pixels). */
export function estimateMegapixels(widthCss: number, heightCss: number, dpr: number): number {
  const d = dpr > 0 ? dpr : 1;
  return (Math.round(widthCss * d) * Math.round(heightCss * d)) / 1_000_000;
}

export interface Segment {
  index: number;
  total: number;
  /** Document Y range in CSS px, half-open [startY, endY). */
  startY: number;
  endY: number;
}

/**
 * Split a vertical span into canvas-safe segments. Throws PAGE_TOO_LARGE
 * only when even splitting cannot help (too many parts / unsplittable width).
 */
export function planSegments(
  totalWidthCss: number,
  startY: number,
  endY: number,
  dpr: number
): Segment[] {
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  const height = bottom - top;
  if (height <= 0) throw new CaptureError("INVALID_SELECTION", "Invalid selection height.");

  const partH = maxPartHeightCss(totalWidthCss, dpr);
  if (partH <= 0) {
    throw new CaptureError(
      "PAGE_TOO_LARGE",
      "This page is too wide to capture at the current zoom. Zoom out and try again."
    );
  }
  const count = Math.ceil(height / partH);
  if (count > MAX_PARTS) {
    throw new CaptureError(
      "PAGE_TOO_LARGE",
      `This capture needs ${count} images — more than the ${MAX_PARTS}-part limit. Try a smaller range or zoom out to shrink it.`
    );
  }
  const segments: Segment[] = [];
  for (let i = 0; i < count; i++) {
    segments.push({
      index: i + 1,
      total: count,
      startY: top + i * partH,
      endY: Math.min(bottom, top + (i + 1) * partH),
    });
  }
  return segments;
}

/** True when the span fits in a single canvas (no split needed). */
export function fitsInOneCanvas(widthCss: number, heightCss: number, dpr: number): boolean {
  if (heightCss > MAX_TOTAL_HEIGHT) return false;
  return estimateMegapixels(widthCss, heightCss, dpr) * 1_000_000 <= MAX_CANVAS_PIXELS &&
    Math.round(heightCss * (dpr || 1)) <= MAX_CANVAS_HEIGHT;
}
