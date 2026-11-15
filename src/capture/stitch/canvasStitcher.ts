import { CaptureError } from "@/types";
import {
  MAX_CANVAS_HEIGHT,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_WIDTH,
  MAX_CHUNKS,
  MAX_TOTAL_HEIGHT,
} from "./limits";
import { ALIGN_BAND, ALIGN_SEARCH, findBestAlignment, measureSeamFade } from "./coordinateMath";
import type { RangeSelection } from "@/messaging/events";

// RangeSelection is single-sourced in @/messaging/events; re-exported here for compat.
export type { RangeSelection } from "@/messaging/events";

export interface StitchChunk {
  dataUrl: string;
  /** Scroll position in CSS px (top-left of viewport content). */
  x: number;
  y: number;
  /**
   * Scroller viewport offset in CSS px, measured AFTER this chunk's scroll
   * settled (0,0 for the window scroller). Viewport-space bitmaps need it:
   * content column L sits at viewport x = rx + (L − scrollLeft). Missing it
   * samples every strip too far left on nested scrollers (sliced left edge).
   */
  rx?: number;
  ry?: number;
  /** SX-02: scroller viewport width & height (clientWidth / clientHeight). */
  rw?: number;
  rh?: number;
}

export interface StitchCoverage {
  status: "complete" | "partial" | "failed";
  coveragePercent: number;
  coveredDocY: number;
  targetEndY: number;
  gapDocPx: number;
  healedDocPx: number;
  clippedPx: number;
}

export interface StitchOutput {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
  coverage?: StitchCoverage;
}

export interface CanvasStitcherOptions {
  chunks: StitchChunk[];
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
  occludedTopHeight?: number;
  occludedBottomHeight?: number;
  // If undefined, implies full page capture using total dimensions
  totalWidth?: number;
  totalHeight?: number;
  // If undefined, implies full page capture
  selection?: RangeSelection;
  /**
   * SX-02: scroll pane geometry within the window viewport.
   * For window scrollers, pane covers the full viewport (0, 0, vpW, vpH).
   * For nested scrollers, pane is the scroller's client rect.
   * Used to plan per-strip content coverage (paneHeight, not viewportHeight).
   */
  paneTop?: number;
  paneLeft?: number;
  paneWidth?: number;
  paneHeight?: number;
}

/**
 * Stitcher contract — any class with stitch() can back the pipeline.
 * CanvasStitcher is the default; override the factory to swap it
 * (e.g. a WebGL stitcher, a worker-based stitcher, a test stub):
 *
 *   import { setStitcherFactory } from "@/capture/stitch/canvasStitcher";
 *   setStitcherFactory((opts) => new MyStitcher(opts));
 */
export interface Stitcher {
  stitch(): Promise<StitchOutput>;
}

export type StitcherFactory = (options: CanvasStitcherOptions) => Stitcher;

let stitcherFactory: StitcherFactory = (options) => new CanvasStitcher(options);

export function setStitcherFactory(factory: StitcherFactory): void {
  stitcherFactory = factory;
}

export function resetStitcherFactory(): void {
  stitcherFactory = (options) => new CanvasStitcher(options);
}

export function createStitcher(options: CanvasStitcherOptions): Stitcher {
  return stitcherFactory(options);
}

type Ctx2D = CanvasRenderingContext2D;

/** Read bandH rows of a strip starting at (srcX, srcY) into plain pixels. Null on any failure. */
function readStripBand(
  bmp: ImageBitmap,
  srcX: number,
  srcY: number,
  srcW: number,
  bandH: number
): { data: Uint8ClampedArray; width: number; height: number } | null {
  try {
    if (srcW <= 0 || bandH <= 0) return null;
    const scratch = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(srcW, bandH)
      : (() => {
          const el = document.createElement("canvas");
          el.width = srcW;
          el.height = bandH;
          return el as unknown as OffscreenCanvas;
        })();
    const sctx = (scratch as OffscreenCanvas).getContext("2d") as unknown as Ctx2D | null;
    if (!sctx) return null;
    sctx.drawImage(bmp as unknown as CanvasImageSource, srcX, srcY, srcW, bandH, 0, 0, srcW, bandH);
    const pixels = sctx.getImageData(0, 0, srcW, bandH);
    return { data: pixels.data, width: srcW, height: bandH };
  } catch {
    return null;
  }
}

/** 2d context with readback hint; null when unavailable (alignment is skipped). */
function getReadableContext(canvas: OffscreenCanvas): Ctx2D | null {
  try {
    const ctx = (canvas as OffscreenCanvas).getContext("2d", { willReadFrequently: true });
    if (ctx) return ctx as unknown as Ctx2D;
  } catch {
    // fall through to plain context
  }
  try {
    const ctx = (canvas as OffscreenCanvas).getContext("2d");
    return (ctx ?? null) as unknown as Ctx2D | null;
  } catch {
    return null;
  }
}

/**
 * Nudge a slice's destination Y so its top band matches the already-drawn
 * canvas. Returns { y, matched }: matched=false means the answer is scroll
 * math (blank band or poor match), which adaptive-trim must not trust.
 * Never throws — any readback failure falls back to scroll math.
 */
function alignSliceToCanvas(
  ctx: Ctx2D,
  bmp: ImageBitmap,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  dstX: number,
  expectedDstY: number,
  canvasWidth: number,
  canvasHeight: number
): { y: number; matched: boolean } {
  try {
    if (srcW <= 0 || srcH <= 0) return { y: expectedDstY, matched: false };
    const bandH = Math.min(ALIGN_BAND, srcH);
    const band = readStripBand(bmp, srcX, srcY, srcW, bandH);
    if (!band) return { y: expectedDstY, matched: false };
    const bandPixels = { data: band.data, width: band.width, height: band.height };

    const regionTop = Math.max(0, expectedDstY - ALIGN_SEARCH);
    const regionBottom = Math.min(canvasHeight, expectedDstY + ALIGN_SEARCH + bandH);
    if (regionBottom - regionTop < bandH || dstX + srcW > canvasWidth) return { y: expectedDstY, matched: false };
    const regionPixels = ctx.getImageData(dstX, regionTop, srcW, regionBottom - regionTop);

    const found = findBestAlignment(
      { data: bandPixels.data, width: srcW, height: bandH },
      { data: regionPixels.data, width: srcW, height: regionBottom - regionTop },
      regionTop,
      expectedDstY
    );
    return found.matched ? { y: found.y, matched: true } : { y: expectedDstY, matched: false };
  } catch {
    return { y: expectedDstY, matched: false };
  }
}

export class CanvasStitcher implements Stitcher {
  private chunks: StitchChunk[];
  private viewportWidth: number;
  private viewportHeight: number;
  private dpr: number;
  private occludedTopHeight: number;
  private occludedBottomHeight: number;
  /** SX-02: visible height of the scroll pane (== viewportHeight for window). */
  private paneHeight: number;
  /** SX-02: visible width of the scroll pane (== viewportWidth for window). */
  private paneWidth: number;

  private targetX: number;
  private targetY: number;
  private targetWidth: number;
  private targetHeight: number;
  private isFullPage: boolean;

  constructor(options: CanvasStitcherOptions) {
    this.chunks = options.chunks;
    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.dpr = options.dpr || 1;
    this.occludedTopHeight = options.occludedTopHeight || 0;
    this.occludedBottomHeight = options.occludedBottomHeight || 0;
    // SX-02: pane dimensions for coverage calculation; default to viewport dimensions
    this.paneHeight = options.paneHeight && options.paneHeight > 0
      ? options.paneHeight
      : options.viewportHeight;
    this.paneWidth = options.paneWidth && options.paneWidth > 0
      ? options.paneWidth
      : options.viewportWidth;

    if (options.selection) {
      this.isFullPage = false;
      this.targetX = options.selection.x;
      this.targetWidth = options.selection.width;
      this.targetY = Math.min(options.selection.startY, options.selection.endY);
      this.targetHeight = Math.abs(options.selection.endY - options.selection.startY);
    } else if (options.totalWidth !== undefined && options.totalHeight !== undefined) {
      this.isFullPage = true;
      this.targetX = 0;
      this.targetWidth = Math.min(options.totalWidth, this.paneWidth);
      this.targetY = 0;
      this.targetHeight = options.totalHeight;
    } else {
      throw new CaptureError("STITCH_FAILED", "Must provide either selection or total dimensions.");
    }
  }

  private assertLimits(): void {
    if (this.chunks.length > MAX_CHUNKS) {
      throw new CaptureError(
        "PAGE_TOO_LARGE",
        `Page requires ${this.chunks.length} captures \u2014 exceeds limit ${MAX_CHUNKS}. Try a shorter page.`
      );
    }
    
    if (this.isFullPage) {
      if (this.targetHeight > MAX_TOTAL_HEIGHT) {
        throw new CaptureError(
          "PAGE_TOO_LARGE",
          `Page height ${Math.round(this.targetHeight)}px exceeds ${MAX_TOTAL_HEIGHT}px limit.`
        );
      }
    }

    const finalWidth = Math.round(this.targetWidth * this.dpr);
    const finalHeight = Math.round(this.targetHeight * this.dpr);
    if (finalWidth > MAX_CANVAS_WIDTH || finalHeight > MAX_CANVAS_HEIGHT || finalWidth * finalHeight > MAX_CANVAS_PIXELS) {
      const typeStr = this.isFullPage ? "Stitched image" : "Selected area";
      throw new CaptureError(
        "PAGE_TOO_LARGE",
        `${typeStr} ${finalWidth}\u00d7${finalHeight} (${Math.round((finalWidth * finalHeight) / 1_000_000)} MP) exceeds browser canvas limits (max ${MAX_CANVAS_WIDTH}px wide, ${MAX_CANVAS_HEIGHT}px tall, ${MAX_CANVAS_PIXELS / 1_000_000} MP area). Try a smaller range.`
      );
    }
  }

  private async loadBitmap(dataUrl: string): Promise<ImageBitmap> {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if (typeof createImageBitmap === "function") {
        return await createImageBitmap(blob);
      }
    } catch {
      // fall through
    }
    if (typeof Image !== "undefined") {
      return await new Promise<ImageBitmap>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          if (typeof createImageBitmap === "function") {
            createImageBitmap(img)
              .then(resolve)
              .catch(() => reject(new Error("createImageBitmap failed fallback")));
          } else {
            reject(new Error("No ImageBitmap support"));
          }
        };
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = dataUrl;
      });
    }
    throw new Error("ImageBitmap unavailable and Image not available in this context");
  }

  public async stitch(): Promise<StitchOutput> {
    if (this.chunks.length === 0) {
      throw new CaptureError("STITCH_FAILED", this.isFullPage ? "No chunks to stitch." : "No captured chunks to stitch.");
    }
    if (this.targetWidth <= 0 || this.targetHeight <= 0) {
      throw new CaptureError("INVALID_SELECTION", "Invalid selection dimensions.");
    }

    this.assertLimits();

    const dpr = this.dpr;
    const finalWidth = Math.round(this.targetWidth * dpr);
    const finalHeight = Math.round(this.targetHeight * dpr);

    if (
      this.isFullPage &&
      this.chunks.length === 1 &&
      this.targetX === 0 &&
      this.targetY === 0 &&
      this.targetHeight <= this.paneHeight &&
      this.targetWidth <= this.paneWidth
    ) {
      const c = this.chunks[0]!;
      const visibleHeight = Math.min(this.paneHeight, this.targetHeight - c.y);
      const visibleWidth = Math.min(this.paneWidth, this.targetWidth - c.x);

      if (visibleHeight === this.viewportHeight && visibleWidth === this.viewportWidth) {
        const res = await fetch(c.dataUrl);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const w = bmp.width;
        const h = bmp.height;
        bmp.close();
        return {
          blob,
          width: w,
          height: h,
          dataUrl: c.dataUrl,
          coverage: {
            status: "complete",
            coveragePercent: 100,
            coveredDocY: this.targetHeight,
            targetEndY: this.targetHeight,
            gapDocPx: 0,
            healedDocPx: 0,
            clippedPx: 0,
          },
        };
      }
      
      const bmp = await this.loadBitmap(c.dataUrl);
      try {
        const expectedW = Math.round(visibleWidth * dpr);
        const expectedH = Math.round(visibleHeight * dpr);
        const fw = Math.min(bmp.width, expectedW);
        const fh = Math.min(bmp.height, expectedH);
        
        const canvas = typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(fw, fh)
          : (() => {
              const el = document.createElement("canvas");
              el.width = fw;
              el.height = fh;
              return el as unknown as OffscreenCanvas;
            })();
            
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new CaptureError("STITCH_FAILED", "Canvas context unavailable.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, fw, fh);
        
        const srcW = Math.min(bmp.width, expectedW);
        const srcH = Math.min(bmp.height, expectedH);
        (ctx as unknown as CanvasRenderingContext2D).drawImage(
          bmp as unknown as CanvasImageSource,
          0, 0, srcW, srcH,
          0, 0, srcW, srcH
        );
        bmp.close();
        
        const singleCoverage: StitchCoverage = {
          status: "complete",
          coveragePercent: 100,
          coveredDocY: this.targetHeight,
          targetEndY: this.targetHeight,
          gapDocPx: 0,
          healedDocPx: 0,
          clippedPx: 0,
        };

        if ("convertToBlob" in canvas) {
          const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
          return { blob, width: fw, height: fh, dataUrl: "", coverage: singleCoverage };
        }
        const dataUrl = (canvas as unknown as HTMLCanvasElement).toDataURL("image/png");
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return { blob, width: fw, height: fh, dataUrl, coverage: singleCoverage };
      } catch (e) {
        try { bmp.close(); } catch { /* ignore */ }
        const msg = e instanceof Error ? e.message : String(e);
        throw new CaptureError("STITCH_FAILED", `Single-chunk crop failed: ${msg}`, { cause: e as Error });
      }
    }

    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(finalWidth, finalHeight)
        : (() => {
            const el = document.createElement("canvas");
            el.width = finalWidth;
            el.height = finalHeight;
            return el as unknown as OffscreenCanvas;
          })();

    const ctx = getReadableContext(canvas);
    if (!ctx) throw new CaptureError("STITCH_FAILED", "Canvas context unavailable.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, finalWidth, finalHeight);

    let coveredDocY = this.targetY;
    const targetEndY = this.targetY + this.targetHeight;
    // Canvas scale is authoritative for destinations; per-chunk bitmap scales
    // are authoritative for sources. Decoupling them (with resampling on
    // draw) absorbs fractional-DPR / zoom rounding where bmpScale != dpr —
    // the systematic ±1px-per-seam drift that tore long pages.
    const canvasScaleX = finalWidth / this.targetWidth;
    const canvasScaleY = finalHeight / this.targetHeight;
    // Pixel-drift carried across seams: each alignment correction shifts all
    // later strips, instead of being rediscovered at every seam. Clamped to
    // ±ALIGN_SEARCH — one false match on repeating content (tables, code)
    // must not displace the entire rest of the page.
    let drift = 0;
    // Adaptive fade trim: every MATCHED seam re-measures the page's real
    // edge-fade depth and shrinks later strips' trims to fit (only ever
    // shrinks — a cautious fixed guess deletes live rows on pages that fade
    // nothing). Until measured, the planner's occlusion trims apply.
    let effOccTop = this.occludedTopHeight;
    let effOccBottom = this.occludedBottomHeight;
    // Previous strip's drawn span (canvas-local), for fade + overlap-clip.
    let prevDstY = 0;
    let prevDrawH = 0;
    let healedDocPx = 0;
    let clippedPx = 0;
    let gapDocPx = 0;

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      const vpX = chunk.x;
      const vpY = chunk.y;
      const vpW = this.viewportWidth;
      const vpH = this.viewportHeight;
      // SX-02: for safe-band calculation, use pane height (the visible scroll
      // content extent per strip), not the full window height. For window
      // scrollers, paneH === vpH.
      const paneH = chunk.rh ?? this.paneHeight;
      const paneW = chunk.rw ?? this.paneWidth;
      // Scroller viewport offset for THIS chunk (0,0 for window). Rects move
      // as the page scrolls, so a cached/global rect would mis-sample strips.
      const rectLeft = chunk.rx ?? 0;
      const rectTop = chunk.ry ?? 0;
      const isLastChunk = i === this.chunks.length - 1;

      const safeTop = (vpY === 0) ? vpY : vpY + effOccTop;
      // Final chunk: extend to the target end instead of trimming the bottom
      // occlusion. Those rows are photographed in no other chunk — trimming
      // them leaves a permanent white tail exactly occludedBottomHeight tall.
      // (A fixed bottom bar may show at the very end; a gap is worse.)
      // SX-02: use paneH for content coverage, not vpH (window height).
      const safeBottom = isLastChunk
        ? Math.min(vpY + paneH, targetEndY)
        : vpY + paneH - effOccBottom;

      // Retain the deliberate viewport overlap for pixel alignment, then heal
      // doc-space gaps BEFORE sampling: if the scroll jumped further than the
      // planned step (lazy layout shift, over-trim, clamped maxScrollY), the
      // rows between coveredDocY and safeTop exist in THIS bitmap's trimmed
      // band — pulling them back beats leaving a white seam. Heal is bounded
      // by the bitmap top (vpY) so it never invents pixels.
      let sliceDocTop = Math.max(safeTop, this.targetY);
      const sliceDocBottom = Math.min(safeBottom, targetEndY);

      if (sliceDocBottom <= sliceDocTop) continue;
      if (sliceDocTop > coveredDocY && coveredDocY > this.targetY) {
        const gap = sliceDocTop - coveredDocY;
        // Only heal plausible seam gaps (not a genuinely missing viewport).
        if (gap > 0 && gap <= paneH) {
          const availableAbove = sliceDocTop - vpY;
          const heal = Math.min(gap, Math.max(0, availableAbove));
          if (heal > 0) {
            sliceDocTop -= heal;
            healedDocPx += heal;
          } else {
            gapDocPx += gap;
          }
        } else {
          gapDocPx += gap;
        }
      }

      let bmp: ImageBitmap | null = null;
      try {
        bmp = await this.loadBitmap(chunk.dataUrl);
        const scaleX = bmp.width / vpW;
        const scaleY = bmp.height / vpH;
        // Bitmap scale must match the canvas scale; a >2% deviation means
        // zoom/resize mid-run or a throttled capture — warn loudly, then
        // resample through canvasScale so the seam still lands gapless.
        if (Math.abs(scaleX - canvasScaleX) / canvasScaleX > 0.02 ||
            Math.abs(scaleY - canvasScaleY) / canvasScaleY > 0.02) {
          console.warn("[ScreenX] bitmap scale drift",
            JSON.stringify({ chunk: i, bmpW: bmp.width, bmpH: bmp.height, vpW, vpH, scaleX, scaleY, canvasScaleX, canvasScaleY }));
        }
        const scaleYForTrim = scaleY > 0 ? scaleY : canvasScaleY;

        const sliceDocLeft = Math.max(vpX, this.targetX);
        const sliceDocRight = Math.min(vpX + paneW, this.targetX + this.targetWidth);
        if (sliceDocRight <= sliceDocLeft) {
          bmp.close();
          continue;
        }

        // Source pixel mapping: content at document coordinate D is at
        // viewport position rectOffset + (D − scrollOffset). The bitmap
        // pixel = round(viewportPos * bitmapScale). Previous code added
        // rectLeft/rectTop to BOTH content and scroll coords, so they
        // cancelled — losing the pane offset entirely (SX-01 fix).
        // Clip source extraction to the pane client bounds so application
        // shell (composer, sidebar, headers) is never sampled as content (SX-02).
        const screenLeft = Math.max(rectLeft, rectLeft + (sliceDocLeft - vpX));
        const screenRight = Math.min(rectLeft + paneW, rectLeft + (sliceDocRight - vpX));
        const screenTop = Math.max(rectTop, rectTop + (sliceDocTop - vpY));
        const screenBottom = Math.min(rectTop + paneH, rectTop + (sliceDocBottom - vpY));

        const srcX = Math.max(0, Math.round(screenLeft * scaleX));
        let srcY = Math.max(0, Math.round(screenTop * scaleY));
        const srcRight = Math.min(bmp.width, Math.round(screenRight * scaleX));
        const srcBottom = Math.min(bmp.height, Math.round(screenBottom * scaleY));
        const srcW = Math.max(0, Math.min(bmp.width - srcX, srcRight - srcX));
        let srcH = Math.max(0, Math.min(bmp.height - srcY, srcBottom - srcY));

        // Destinations use the CANVAS scale (target-relative, not differenced
        // rounded absolutes) so spans match the canvas at fractional DPR even
        // when a bitmap rounded to a different size. drawImage resamples the
        // small delta — no accumulated ±1px drift.
        const dstX = Math.round((sliceDocLeft - this.targetX) * canvasScaleX);
        let dstW = Math.round((sliceDocRight - sliceDocLeft) * canvasScaleX);
        let dstH = Math.round((sliceDocBottom - sliceDocTop) * canvasScaleY);
        // Scroll math predicts dstY; the page may have shifted, so verify
        // against actual pixels (first strip is trusted as the anchor).
        let dstY = Math.round((sliceDocTop - this.targetY) * canvasScaleY) + drift;
        let stripMatched = false;
        if (i > 0) {
          const aligned = alignSliceToCanvas(
            ctx as unknown as CanvasRenderingContext2D,
            bmp,
            srcX,
            srcY,
            srcW,
            srcH,
            dstX,
            dstY,
            finalWidth,
            finalHeight
          );
          stripMatched = aligned.matched;
          if (aligned.y !== dstY) {
            drift += aligned.y - dstY;
            // One false match on repeating content must not displace the rest
            // of the page: clamp the carried correction to the search window.
            if (drift > ALIGN_SEARCH) drift = ALIGN_SEARCH;
            else if (drift < -ALIGN_SEARCH) drift = -ALIGN_SEARCH;
            dstY = aligned.y;
          }
        }
        dstY = Math.max(0, Math.min(dstY, Math.max(0, finalHeight - dstH)));

        // Measure BEFORE drawing the new strip, at EVERY matched seam (not
        // just the first). Once drawImage overwrites the overlap, the canvas
        // no longer holds the crisp previous copy and fade reads as zero.
        // Shrink-only: trims never grow, so a late fade can't delete rows.
        if (i > 0 && stripMatched && prevDrawH > 0 && (effOccTop > 0 || effOccBottom > 0)) {
          try {
            const prevBottom = prevDstY + prevDrawH;
            const probePx = Math.max(8, Math.min(96, Math.floor(Math.min(srcH, prevDrawH) / 4)));
            const head = readStripBand(bmp, srcX, srcY, srcW, probePx);
            const regionTop = Math.max(0, Math.min(dstY, prevBottom - probePx));
            const regionBottom = Math.min(finalHeight, Math.max(dstY + probePx, prevBottom));
            if (head && regionBottom - regionTop >= probePx) {
              const regionPixels = (ctx as unknown as CanvasRenderingContext2D).getImageData(
                dstX, regionTop, srcW, regionBottom - regionTop
              );
              const fades = measureSeamFade(
                { data: head.data, width: head.width, height: head.height },
                { data: regionPixels.data, width: srcW, height: regionBottom - regionTop },
                regionTop,
                dstY,
                prevDstY,
                prevBottom,
                probePx
              );
              if (fades) {
                effOccTop = Math.min(effOccTop, fades.top / scaleYForTrim + 6);
                effOccBottom = Math.min(effOccBottom, fades.bottom / scaleYForTrim + 6);
                if (i === 1) {
                  console.debug("[ScreenX] measured page fade",
                    JSON.stringify({ topPx: fades.top, bottomPx: fades.bottom, trimTop: effOccTop, trimBottom: effOccBottom }));
                }
              }
            }
          } catch {
            // ignore — measurement is opportunistic; cautious trims stand
          }
        }

        // Novel-only draw: clip rows the previous strip already painted.
        // Overwriting the overlap with a 1px-misaligned copy is what ghosts
        // text (double lines) at every seam; skipping it makes seams invisible
        // even when alignment is off by a pixel. Proportional clip keeps
        // src/dst in sync when bitmap and canvas scales differ.
        if (i > 0 && prevDrawH > 0) {
          const prevBottom = prevDstY + prevDrawH;
          if (dstY < prevBottom) {
            const overlap = prevBottom - dstY;
            if (overlap < dstH) {
              const srcClip = Math.round((overlap * srcH) / dstH);
              if (srcClip > 0 && srcClip < srcH) {
                srcY += srcClip;
                srcH -= srcClip;
                dstY = prevBottom;
                dstH -= overlap;
                dstW = Math.min(dstW, srcW);
                clippedPx += overlap;
              }
            } else {
              // Fully covered (stalled scroll duplicate) — skip the strip.
              bmp.close();
              await new Promise<void>((r) => setTimeout(r, 0));
              continue;
            }
          } else if (dstY > prevBottom && !stripMatched) {
            // Untrusted scroll math left a small white gap; butt-joint rather
            // than leave a hairline through text. Matched seams keep their
            // measured position (a real gap there means missing content).
            const gapPx = dstY - prevBottom;
            if (gapPx > 0 && gapPx <= 64) {
              dstY = prevBottom;
            }
          }
        }
        if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
          bmp.close();
          await new Promise<void>((r) => setTimeout(r, 0));
          continue;
        }

        (ctx as unknown as CanvasRenderingContext2D).drawImage(
          bmp as unknown as CanvasImageSource,
          srcX,
          srcY,
          srcW,
          srcH,
          dstX,
          dstY,
          dstW,
          dstH
        );

        prevDstY = dstY;
        prevDrawH = dstH;

        coveredDocY = Math.max(coveredDocY, sliceDocBottom);
      } catch (e) {
        try {
          bmp?.close();
        } catch { /* ignore */ }
        const msg = e instanceof Error ? e.message : String(e);
        const errorMsg = this.isFullPage ? `Failed to draw chunk at y=${chunk.y}: ${msg}` : `Failed to draw chunk ${i} at y=${vpY}: ${msg}`;
        throw new CaptureError("STITCH_FAILED", errorMsg, { cause: e as Error });
      }
      try {
        bmp.close();
      } catch { /* ignore */ }
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    const uncoveredGap = Math.max(0, targetEndY - coveredDocY);
    const totalMissingDocPx = gapDocPx + (uncoveredGap > 2 ? uncoveredGap : 0);
    const coveragePercent = this.targetHeight > 0
      ? Math.max(0, Math.min(100, Math.round(((this.targetHeight - totalMissingDocPx) / this.targetHeight) * 100)))
      : 100;

    let coverageStatus: "complete" | "partial" | "failed" = "complete";
    if (coveragePercent < 20 && this.chunks.length > 0) {
      coverageStatus = "failed";
    } else if (uncoveredGap > 2 || gapDocPx > 0) {
      coverageStatus = "partial";
    }

    const coverage: StitchCoverage = {
      status: coverageStatus,
      coveragePercent,
      coveredDocY,
      targetEndY,
      gapDocPx,
      healedDocPx,
      clippedPx,
    };

    if (uncoveredGap > 2) {
      const label = this.isFullPage ? "[ScreenX] Stitch warning: coveredDocY did not reach page end" : "[ScreenX][SelectedArea] Stitch warning: coveredDocY did not fully reach selEndY";
      console.warn(label, JSON.stringify(this.isFullPage
        ? { coveredDocY, pageEndY: targetEndY, gap: uncoveredGap, healedDocPx, clippedPx, gapDocPx, coveragePercent }
        : { coveredDocY, selEndY: targetEndY, gap: uncoveredGap, healedDocPx, clippedPx, gapDocPx, coveragePercent }));
    } else if (healedDocPx > 0 || gapDocPx > 0) {
      console.debug("[ScreenX] stitch seam stats", JSON.stringify({ healedDocPx, clippedPx, gapDocPx, chunks: this.chunks.length, coveragePercent }));
    }

    try {
      let blob: Blob;
      let dataUrl = "";
      if ("convertToBlob" in canvas) {
        blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
      } else {
        dataUrl = (canvas as unknown as HTMLCanvasElement).toDataURL("image/png");
        const res = await fetch(dataUrl);
        blob = await res.blob();
      }
      return {
        blob,
        width: finalWidth,
        height: finalHeight,
        dataUrl,
        coverage,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorMsg = this.isFullPage ? `Final canvas export failed: ${msg}` : `Final export failed: ${msg}`;
      throw new CaptureError("STITCH_FAILED", errorMsg, { cause: e as Error });
    }
  }
}
