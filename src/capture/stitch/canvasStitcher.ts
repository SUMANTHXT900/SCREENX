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
}

export interface StitchOutput {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
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

    if (options.selection) {
      this.isFullPage = false;
      this.targetX = options.selection.x;
      this.targetWidth = options.selection.width;
      this.targetY = Math.min(options.selection.startY, options.selection.endY);
      this.targetHeight = Math.abs(options.selection.endY - options.selection.startY);
    } else if (options.totalWidth !== undefined && options.totalHeight !== undefined) {
      this.isFullPage = true;
      this.targetX = 0;
      this.targetWidth = Math.min(options.totalWidth, options.viewportWidth);
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

    if (this.isFullPage && this.chunks.length === 1 && this.targetX === 0 && this.targetY === 0) {
      const c = this.chunks[0]!;
      const visibleHeight = Math.min(this.viewportHeight, this.targetHeight - c.y);
      const visibleWidth = Math.min(this.viewportWidth, this.targetWidth - c.x);

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
        
        if ("convertToBlob" in canvas) {
          const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
          return { blob, width: fw, height: fh, dataUrl: "" };
        }
        const dataUrl = (canvas as unknown as HTMLCanvasElement).toDataURL("image/png");
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return { blob, width: fw, height: fh, dataUrl };
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
    // Pixel-drift carried across seams: each alignment correction shifts all
    // later strips, instead of being rediscovered at every seam. Clamped to
    // ±ALIGN_SEARCH — one false match on repeating content (tables, code)
    // must not displace the entire rest of the page.
    let drift = 0;
    // Adaptive fade trim: the first MATCHED seam measures the page's real
    // edge-fade depth and shrinks later strips' trims to fit (only ever
    // shrinks — a cautious fixed guess deletes live rows on pages that fade
    // nothing). Until measured, the planner's occlusion trims apply.
    let effOccTop = this.occludedTopHeight;
    let effOccBottom = this.occludedBottomHeight;
    let adaptiveMeasured = false;
    // Previous strip's drawn span (canvas-local), for the fade measurement.
    let prevDstY = 0;
    let prevDrawH = 0;

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      const vpX = chunk.x;
      const vpY = chunk.y;
      const vpW = this.viewportWidth;
      const vpH = this.viewportHeight;
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
      const safeBottom = isLastChunk
        ? Math.min(vpY + vpH, targetEndY)
        : vpY + vpH - effOccBottom;

      // Retain the deliberate viewport overlap for pixel alignment. The
      // previous implementation used coveredDocY as the new top, which
      // discarded the overlap before the aligner could inspect it; that made
      // fractional-DPR/layout drift impossible to correct and created seams.
      const sliceDocTop = Math.max(safeTop, this.targetY);
      const sliceDocBottom = Math.min(safeBottom, targetEndY);

      if (sliceDocBottom <= sliceDocTop) continue;

      let bmp: ImageBitmap | null = null;
      try {
        bmp = await this.loadBitmap(chunk.dataUrl);
        const scaleX = bmp.width / vpW;
        const scaleY = bmp.height / vpH;

        const sliceDocLeft = Math.max(vpX, this.targetX);
        const sliceDocRight = Math.min(vpX + vpW, this.targetX + this.targetWidth);
        if (sliceDocRight <= sliceDocLeft) {
          bmp.close();
          continue;
        }

        const globalLeft = Math.round((rectLeft + sliceDocLeft) * scaleX);
        const globalRight = Math.round((rectLeft + sliceDocRight) * scaleX);
        const globalTop = Math.round((rectTop + sliceDocTop) * scaleY);
        const globalBottom = Math.round((rectTop + sliceDocBottom) * scaleY);

        const globalVpX = Math.round((rectLeft + vpX) * scaleX);
        const globalVpY = Math.round((rectTop + vpY) * scaleY);

        const srcX = Math.max(0, globalLeft - globalVpX);
        const srcY = Math.max(0, globalTop - globalVpY);
        const srcW = Math.min(bmp.width - srcX, globalRight - globalLeft);
        const srcH = Math.min(bmp.height - srcY, globalBottom - globalTop);

        // Destination relative to the target origin (not differenced rounded
        // absolutes) so spans always match the canvas at fractional DPR.
        const dstX = Math.round((sliceDocLeft - this.targetX) * scaleX);
        const dstW = srcW;
        const dstH = srcH;
        // Scroll math predicts dstY; the page may have shifted, so verify
        // against actual pixels (first strip is trusted as the anchor).
        // dstY is target-relative (matches the canvas exactly at any DPR).
        let dstY = Math.round((sliceDocTop - this.targetY) * scaleY) + drift;
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

        // Measure BEFORE drawing the new strip. Once drawImage overwrites the
        // overlap, the canvas no longer contains the crisp previous copy and
        // every fade would incorrectly measure as zero.
        if (i === 1 && stripMatched && !adaptiveMeasured && prevDrawH > 0) {
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
                // Shrink-only, with a spare-rows margin; CSS-px for the trims.
                effOccTop = Math.min(effOccTop, fades.top / scaleY + 6);
                effOccBottom = Math.min(effOccBottom, fades.bottom / scaleY + 6);
                console.debug(
                  "[ScreenX] measured page fade",
                  JSON.stringify({ topPx: fades.top, bottomPx: fades.bottom, trimTop: effOccTop, trimBottom: effOccBottom })
                );
              }
            }
          } catch {
            // ignore — measurement is opportunistic; cautious trims stand
          }
          adaptiveMeasured = true;
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

    if (coveredDocY < targetEndY - 2) {
      const gap = targetEndY - coveredDocY;
      const label = this.isFullPage ? "[ScreenX] Stitch warning: coveredDocY did not reach page end" : "[ScreenX][SelectedArea] Stitch warning: coveredDocY did not fully reach selEndY";
      console.warn(label, JSON.stringify(this.isFullPage ? { coveredDocY, pageEndY: targetEndY, gap } : { coveredDocY, selEndY: targetEndY, gap }));
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
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorMsg = this.isFullPage ? `Final canvas export failed: ${msg}` : `Final export failed: ${msg}`;
      throw new CaptureError("STITCH_FAILED", errorMsg, { cause: e as Error });
    }
  }
}
