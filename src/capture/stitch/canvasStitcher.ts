import { CaptureError } from "@/types";

export interface StitchChunk {
  dataUrl: string;
  x: number;
  y: number;
}

export interface StitchOutput {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
}

export interface RangeSelection {
  x: number;
  width: number;
  startY: number;
  endY: number;
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

const MAX_TOTAL_HEIGHT = 65000;
const MAX_CANVAS_PIXELS = 268_435_456;
const MAX_CHUNKS = 300;

export class CanvasStitcher {
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
    if (finalWidth > 32767 || finalHeight > 65535 || finalWidth * finalHeight > MAX_CANVAS_PIXELS) {
      const typeStr = this.isFullPage ? "Stitched image" : "Selected area";
      throw new CaptureError(
        "PAGE_TOO_LARGE",
        `${typeStr} ${finalWidth}\u00d7${finalHeight} (${Math.round((finalWidth * finalHeight) / 1_000_000)} MP) exceeds browser canvas limits (max 65,535px height, ${MAX_CANVAS_PIXELS / 1_000_000} MP area).`
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

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new CaptureError("STITCH_FAILED", "Canvas context unavailable.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, finalWidth, finalHeight);

    let coveredDocY = this.targetY;
    const targetEndY = this.targetY + this.targetHeight;

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      const vpX = chunk.x;
      const vpY = chunk.y;
      const vpW = this.viewportWidth;
      const vpH = this.viewportHeight;

      const safeTop = (vpY === 0) ? vpY : vpY + this.occludedTopHeight;
      const safeBottom = vpY + vpH - this.occludedBottomHeight;

      const sliceDocTop = Math.max(safeTop, coveredDocY, this.targetY);
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

        const globalLeft = Math.round(sliceDocLeft * scaleX);
        const globalRight = Math.round(sliceDocRight * scaleX);
        const globalTop = Math.round(sliceDocTop * scaleY);
        const globalBottom = Math.round(sliceDocBottom * scaleY);

        const globalVpX = Math.round(vpX * scaleX);
        const globalVpY = Math.round(vpY * scaleY);
        const globalSelX = Math.round(this.targetX * scaleX);
        const globalSelY = Math.round(this.targetY * scaleY);

        const srcX = Math.max(0, globalLeft - globalVpX);
        const srcY = Math.max(0, globalTop - globalVpY);
        const srcW = Math.min(bmp.width - srcX, globalRight - globalLeft);
        const srcH = Math.min(bmp.height - srcY, globalBottom - globalTop);

        const dstX = globalLeft - globalSelX;
        const dstY = globalTop - globalSelY;
        const dstW = srcW;
        const dstH = srcH;

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

        coveredDocY = sliceDocBottom;
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

    if (!this.isFullPage && coveredDocY < targetEndY - 2) {
      console.warn("[ScreenX][SelectedArea] Stitch warning: coveredDocY did not fully reach selEndY", JSON.stringify({ coveredDocY, selEndY: targetEndY, gap: targetEndY - coveredDocY }));
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
