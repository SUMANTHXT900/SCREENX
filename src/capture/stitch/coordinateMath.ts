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

/** Luminance of a pixel (rec.601): text edges live in all channels, not just red. */
function luminanceAt(data: Uint8ClampedArray, index: number): number {
  const r = data[index]!;
  const g = data[index + 1]!;
  const b = data[index + 2]!;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Pixel variation in a band (luminance, dense sampling). Flat bands match anywhere — untrusted. */
export function bandDetail(data: Uint8ClampedArray, width: number, height: number): number {
  let minimum = 255;
  let maximum = 0;
  let count = 0;
  // Every row, every 4th column: thin 1px text lines vanish under y+=2/x+=8
  // sparse sampling, making textured bands look blank (seams then fall back
  // to scroll math and tear). Denser sampling costs ~4x but the band is tiny.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 4) {
      const value = luminanceAt(data, (y * width + x) * 4);
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
      count++;
    }
  }
  return count === 0 ? 0 : maximum - minimum;
}

/** Mean abs luminance difference placing the band at candidateY (Infinity if out of region). */
export function bandMeanError(
  band: { data: Uint8ClampedArray; width: number; height: number },
  region: { data: Uint8ClampedArray; width: number; height: number },
  regionTop: number,
  candidateY: number
): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < band.height; y += 1) {
    const regionRow = candidateY + y - regionTop;
    if (regionRow < 0 || regionRow >= region.height) return Infinity;
    for (let x = 0; x < band.width; x += 4) {
      const a = luminanceAt(band.data, (y * band.width + x) * 4);
      const b = luminanceAt(region.data, (regionRow * region.width + x) * 4);
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

// ── Adaptive fade measurement (device pixels) ────────────────────────
// Many apps fade content at scroll-container edges (gradient masks under
// headers, above chat inputs). Those faded rows are real screenshot pixels:
// drawing them duplicates a washed-out band at every seam, while trimming a
// fixed guess deletes live rows on pages that fade nothing. So the first
// matched seam measures the real fade from the overlap (which holds the same
// content twice — once crisp, once faded; disagreeing rows ARE the fade) and
// later strips trim exactly that. Only ever shrinks trims, never grows them.

/** Row disagreement threshold: mean abs red-channel diff above this = faded. */
export const FADE_ROW_DIFF = 10;

/** Mean abs luminance difference between two rows (dense sampling). Null when either is out of range. */
export function rowMeanAbsDiff(
  a: { data: Uint8ClampedArray; width: number; height: number },
  aRow: number,
  b: { data: Uint8ClampedArray; width: number; height: number },
  bRow: number
): number | null {
  if (aRow < 0 || aRow >= a.height || bRow < 0 || bRow >= b.height) return null;
  const width = Math.min(a.width, b.width);
  let total = 0;
  let count = 0;
  for (let x = 0; x < width; x += 4) {
    const av = luminanceAt(a.data, (aRow * a.width + x) * 4);
    const bv = luminanceAt(b.data, (bRow * b.width + x) * 4);
    total += av > bv ? av - bv : bv - av;
    count++;
  }
  return count === 0 ? null : total / count;
}

export interface PixBuf {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Measure edge-fade depth at a matched seam. `head` is the new strip's kept
 * top rows (row 0 = first drawn row); `canvas` is already-drawn pixels with
 * `regionTop` = canvas Y of its row 0. `matchedY` = canvas Y where head row 0
 * sits; [prevTop, prevBottom) = canvas span of the previous strip's drawn rows.
 * Returns fade depth in device px, or null when untrusted (too few comparable
 * rows, or fade fills the whole probe — the strips don't really line up).
 */
export function measureSeamFade(
  head: PixBuf,
  canvas: PixBuf,
  regionTop: number,
  matchedY: number,
  prevTop: number,
  prevBottom: number,
  maxProbe: number
): { top: number; bottom: number } | null {
  // Only the outer half of the overlap is scanned from each side, so the
  // top-fade scan can never wander into the previous strip's own bottom
  // fade (or vice versa) — full-probe scans overlap and saturate each other.
  const half = Math.max(4, Math.floor(Math.max(8, Math.floor(maxProbe)) / 2));
  if (head.height < half) return null;

  // Top fade of the NEW strip: walk down from its first row. Take the deepest
  // disagreement, not the first agreement — a blank line inside a fade agrees
  // with the crisp copy and would end the scan too early.
  let topFade = 0;
  let topCompared = 0;
  for (let r = 0; r < half; r++) {
    const d = rowMeanAbsDiff(head, r, canvas, matchedY + r - regionTop);
    if (d === null) continue;
    topCompared++;
    if (d > FADE_ROW_DIFF) topFade = r + 1;
  }
  // Bottom fade of the PREVIOUS strip: walk up from its last drawn row.
  // Prev row p shows the same content as head row (p − matchedY).
  let bottomFade = 0;
  let bottomCompared = 0;
  for (let r = 0; r < half; r++) {
    const prevRow = prevBottom - 1 - r;
    if (prevRow < prevTop) continue;
    const d = rowMeanAbsDiff(canvas, prevRow - regionTop, head, prevRow - matchedY);
    if (d === null) continue;
    bottomCompared++;
    if (d > FADE_ROW_DIFF) bottomFade = r + 1;
  }

  if (topCompared < half || bottomCompared < half) return null;
  if (topFade >= half || bottomFade >= half) return null;
  return { top: topFade, bottom: bottomFade };
}
