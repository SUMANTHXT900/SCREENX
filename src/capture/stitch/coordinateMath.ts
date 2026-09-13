/**
 * Stitch coordinate math (plan: capture/stitch/coordinateMath.ts).
 * Absolute global pixel mapping — round boundaries, never heights.
 */

export interface SliceRect {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
  dstW: number;
  dstH: number;
}

/**
 * Project a document slice to physical source/destination rects.
 * Guarantees srcH === dstH (no interpolation blur) and gapless dstY abutment.
 *
 * Frame model (viewport-space bitmaps): captureVisibleTab photographs the
 * window viewport, so bitmap pixel (bx,by) shows scroller-content row/col
 *   content = scroll + (b/s − rect)
 * where rect is the scroller's viewport offset (0 for the window scroller)
 * and s is the measured bitmap scale. rectLeft/rectTop MUST be the rect
 * measured after the chunk's scroll settled — rects move as the page scrolls,
 * never cache them across chunks. Round only the final values, never inputs.
 */
export function projectSlice(options: {
  sliceDocLeft: number;
  sliceDocRight: number;
  sliceDocTop: number;
  sliceDocBottom: number;
  vpX: number;
  vpY: number;
  targetX: number;
  targetY: number;
  /** Scroller viewport offset in CSS px (0 for window). Measured post-settle, per chunk. */
  rectLeft?: number;
  rectTop?: number;
  bmpWidth: number;
  bmpHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): SliceRect | null {
  const {
    sliceDocLeft,
    sliceDocRight,
    sliceDocTop,
    sliceDocBottom,
    vpX,
    vpY,
    targetX,
    targetY,
    rectLeft = 0,
    rectTop = 0,
    bmpWidth,
    bmpHeight,
    viewportWidth,
    viewportHeight,
  } = options;

  if (sliceDocRight <= sliceDocLeft || sliceDocBottom <= sliceDocTop) return null;

  const scaleX = bmpWidth / viewportWidth;
  const scaleY = bmpHeight / viewportHeight;

  // Viewport-space mapping: content column L sits at viewport x = rectLeft +
  // (L − scrollLeft). Omitting rectLeft samples every strip too far left on
  // nested scrollers (left edge sliced off) — the offset is NOT optional.
  const globalLeft = Math.round((rectLeft + sliceDocLeft) * scaleX);
  const globalRight = Math.round((rectLeft + sliceDocRight) * scaleX);
  const globalTop = Math.round((rectTop + sliceDocTop) * scaleY);
  const globalBottom = Math.round((rectTop + sliceDocBottom) * scaleY);

  const globalVpX = Math.round((rectLeft + vpX) * scaleX);
  const globalVpY = Math.round((rectTop + vpY) * scaleY);

  const srcX = Math.max(0, globalLeft - globalVpX);
  const srcY = Math.max(0, globalTop - globalVpY);
  const srcW = Math.min(bmpWidth - srcX, globalRight - globalLeft);
  const srcH = Math.min(bmpHeight - srcY, globalBottom - globalTop);

  if (srcW <= 0 || srcH <= 0) return null;

  // Destination is computed RELATIVE to the target origin (not by differencing
  // independently rounded absolutes): span round((end−start)·s) always equals
  // the canvas span round(size·s), so no ±1px white/crop lines at fractional DPR.
  const dstX = Math.round((sliceDocLeft - targetX) * scaleX);
  const dstY = Math.round((sliceDocTop - targetY) * scaleY);

  return { srcX, srcY, srcW, srcH, dstX, dstY, dstW: srcW, dstH: srcH };
}

/** Safe (un-occluded) vertical band of a chunk in document coordinates. */
export function safeVerticalBand(
  vpY: number,
  viewportHeight: number,
  occludedTop: number,
  occludedBottom: number
): { safeTop: number; safeBottom: number } {
  const safeTop = vpY === 0 ? vpY : vpY + occludedTop;
  const safeBottom = vpY + viewportHeight - occludedBottom;
  return { safeTop, safeBottom };
}

// ── Seam alignment (device pixels) ─────────────────────────────────────
// Scroll positions lie: lazy content, re-renders, and late smooth-scrolls
// shift strips by a few px. Each strip's top band is matched against the
// already-drawn canvas within ±ALIGN_SEARCH and nudged to the best fit.
// Thresholds mirror the proven field values: blank bands are untrusted,
// poor best-matches fall back to scroll math.

export const ALIGN_BAND = 28;
export const ALIGN_SEARCH = 120;
export const ALIGN_MIN_DETAIL = 6;
export const ALIGN_MAX_ERROR = 26;

/** Pixel variation in a band (red channel, sparse sampling). Flat bands match anywhere — untrusted. */
export function bandDetail(data: Uint8ClampedArray, width: number, height: number): number {
  let minimum = 255;
  let maximum = 0;
  let count = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 8) {
      const value = data[(y * width + x) * 4]!;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
      count++;
    }
  }
  return count === 0 ? 0 : maximum - minimum;
}

/** Mean abs red-channel difference placing the band at candidateY (Infinity if out of region). */
export function bandMeanError(
  band: { data: Uint8ClampedArray; width: number; height: number },
  region: { data: Uint8ClampedArray; width: number; height: number },
  regionTop: number,
  candidateY: number
): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < band.height; y += 2) {
    const regionRow = candidateY + y - regionTop;
    if (regionRow < 0 || regionRow >= region.height) return Infinity;
    for (let x = 0; x < band.width; x += 8) {
      const a = band.data[(y * band.width + x) * 4]!;
      const b = region.data[(regionRow * region.width + x) * 4]!;
      total += a > b ? a - b : b - a;
      count++;
    }
  }
  return count === 0 ? Infinity : total / count;
}

/** Best canvas Y for the band near expectedY, or expectedY when untrusted/poor. */
export function findBestAlignment(
  band: { data: Uint8ClampedArray; width: number; height: number },
  region: { data: Uint8ClampedArray; width: number; height: number },
  regionTop: number,
  expectedY: number
): { y: number; error: number; matched: boolean } {
  if (bandDetail(band.data, band.width, band.height) < ALIGN_MIN_DETAIL) {
    return { y: expectedY, error: Infinity, matched: false };
  }
  let bestY = expectedY;
  let bestError = Infinity;
  for (let offset = -ALIGN_SEARCH; offset <= ALIGN_SEARCH; offset++) {
    const candidateY = expectedY + offset;
    if (candidateY < 0) continue;
    const error = bandMeanError(band, region, regionTop, candidateY);
    if (error < bestError) {
      bestError = error;
      bestY = candidateY;
    }
  }
  if (bestError > ALIGN_MAX_ERROR) return { y: expectedY, error: bestError, matched: false };
  return { y: bestY, error: bestError, matched: true };
}
