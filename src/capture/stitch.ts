import { CaptureError } from "@/types";

export interface StitchChunk {
  /** base64 PNG dataUrl captured at this position */
  dataUrl: string;
  /** scroll position in CSS pixels (top-left of viewport) */
  x: number;
  y: number;
}

export interface StitchInput {
  chunks: StitchChunk[];
  /** total document dimensions in CSS pixels */
  totalWidth: number;
  totalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** window.devicePixelRatio at capture time */
  dpr: number;
  occludedTopHeight?: number;
  occludedBottomHeight?: number;
}

/**
 * Defensive limits — documented reasoning:
 * - MAX_TOTAL_HEIGHT 20000 CSS px (~10 viewport heights on 1080p). Beyond this,
 *   canvas memory exceeds ~5000*20000*4 ≈ 400 MB at dpr=1, far beyond safe.
 * - MAX_TOTAL_WIDTH 5000 CSS px: typical desktop max; wider pages are rare.
 * - MAX_CANVAS_PIXELS 50_000_000 (≈ 50 MP): Chrome canvas limit ~268M but memory
 *   and blob creation will OOM before that. 50M allows ~5000x10000 at dpr=1.
 * - MAX_CHUNKS 40: prevents infinite loops on dynamic infinite-scroll pages.
 */
const MAX_TOTAL_HEIGHT = 65000;
const MAX_TOTAL_WIDTH = 10000;
const MAX_CANVAS_PIXELS = 268_435_456;
const MAX_CHUNKS = 150;

function assertLimits(input: StitchInput): void {
  if (input.chunks.length > MAX_CHUNKS) {
    throw new CaptureError(
      "PAGE_TOO_LARGE",
      `Page requires ${input.chunks.length} captures — exceeds limit ${MAX_CHUNKS}. Try a shorter page.`
    );
  }
  if (input.totalHeight > MAX_TOTAL_HEIGHT) {
    throw new CaptureError(
      "PAGE_TOO_LARGE",
      `Page height ${Math.round(input.totalHeight)}px exceeds ${MAX_TOTAL_HEIGHT}px limit.`
    );
  }
  if (input.totalWidth > MAX_TOTAL_WIDTH) {
    // Allow width slightly over but warn; clamp to viewportWidth for final canvas.
  }
  const finalWidth = Math.round(Math.min(input.totalWidth, input.viewportWidth) * input.dpr);
  const finalHeight = Math.round(input.totalHeight * input.dpr);
  if (finalWidth > 32767 || finalHeight > 65535 || finalWidth * finalHeight > MAX_CANVAS_PIXELS) {
    throw new CaptureError(
      "PAGE_TOO_LARGE",
      `Stitched image ${finalWidth}×${finalHeight} (${Math.round((finalWidth * finalHeight) / 1_000_000)} MP) exceeds browser canvas limits (max 65,535px height, ${MAX_CANVAS_PIXELS / 1_000_000} MP area).`
    );
  }
}

async function loadBitmap(dataUrl: string): Promise<ImageBitmap> {
  // Prefer fetch+blob → createImageBitmap (works in service worker & extension pages)
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    // createImageBitmap is available in workers and windows (Chrome 50+)
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }
  } catch {
    // fall through to Image fallback
  }

  // Fallback for environments without createImageBitmap (only when DOM Image is available, e.g., popup)
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

/**
 * Stitch captured viewport chunks into a single full-page PNG.
 * Overlap handling: each chunk's visible region is computed as
 * min(viewportSize, totalSize - position). For tall pages where
 * positions are [0, vh, 2vh … min(..., maxScroll)], only the short-page
 * case needs cropping; tall pages chunks are full height and last overlap
 * is resolved by drawing order (later chunk overwrites earlier duplicate).
 */
export interface StitchOutput {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
}

export async function stitchImages(input: StitchInput): Promise<StitchOutput> {
  console.debug("[ScreenX] stitchImages input", JSON.stringify({
    chunks: input.chunks.length,
    totalWidth: input.totalWidth,
    totalHeight: input.totalHeight,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    dpr: input.dpr,
  }));
  assertLimits(input);

  if (input.chunks.length === 0) {
    throw new CaptureError("STITCH_FAILED", "No chunks to stitch.");
  }
  if (input.chunks.length === 1) {
    // Single chunk — handle short-page cropping if viewport > totalHeight
    const c = input.chunks[0]!;
    const visibleHeight = Math.min(input.viewportHeight, input.totalHeight - c.y);
    const visibleWidth = Math.min(input.viewportWidth, input.totalWidth - c.x);
    if (visibleHeight === input.viewportHeight && visibleWidth === input.viewportWidth) {
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
    // Need to crop single image — use bitmap dimensions as authoritative
    const bmp = await loadBitmap(c.dataUrl);
    console.debug("[ScreenX] stitch single chunk crop", JSON.stringify({
      visibleWidth, visibleHeight,
      capturedBitmapWidth: bmp.width, capturedBitmapHeight: bmp.height,
      dpr: input.dpr,
    }));
    try {
      const dpr = input.dpr;
      const expectedW = Math.round(visibleWidth * dpr);
      const expectedH = Math.round(visibleHeight * dpr);
      const finalW = Math.min(bmp.width, expectedW);
      const finalH = Math.min(bmp.height, expectedH);
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(finalW, finalH)
          : (() => {
              const el = document.createElement("canvas");
              el.width = finalW;
              el.height = finalH;
              return el as unknown as OffscreenCanvas;
            })();
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new CaptureError("STITCH_FAILED", "Canvas context unavailable.");
      // White background for pages with transparency
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, finalW, finalH);
      const srcW = Math.min(bmp.width, expectedW);
      const srcH = Math.min(bmp.height, expectedH);
      (ctx as unknown as CanvasRenderingContext2D).drawImage(
        bmp as unknown as CanvasImageSource,
        0,
        0,
        srcW,
        srcH,
        0,
        0,
        srcW,
        srcH
      );
      bmp.close();
      if ("convertToBlob" in canvas) {
        const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
        return {
          blob,
          width: finalW,
          height: finalH,
          dataUrl: "",
        };
      }
      const dataUrl = (canvas as unknown as HTMLCanvasElement).toDataURL("image/png");
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return {
        blob,
        width: finalW,
        height: finalH,
        dataUrl,
      };
    } catch (e) {
      try {
        bmp.close();
      } catch {
        // ignore close errors
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("STITCH_FAILED", `Single-chunk crop failed: ${msg}`, { cause: e as Error });
    }
  }

  // Multi-chunk stitching
  const dpr = input.dpr;
  // Final dimensions: clamp width to viewportWidth for MVP (documents wider than viewport are captured at viewport width)
  const finalWidthCss = Math.min(input.totalWidth, input.viewportWidth);
  const finalWidth = Math.round(finalWidthCss * dpr);
  const finalHeight = Math.round(input.totalHeight * dpr);

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

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, finalWidth, finalHeight);

  // Load and draw each chunk sequentially using non-overlapping document intervals
  let coveredDocY = 0;
  const occludedTopHeight = input.occludedTopHeight || 0;
  const occludedBottomHeight = input.occludedBottomHeight || 0;

  for (let i = 0; i < input.chunks.length; i++) {
    const chunk = input.chunks[i]!;
    const vpX = chunk.x;
    const vpY = chunk.y;
    const vpW = input.viewportWidth;
    const vpH = input.viewportHeight;

    const safeTop = (vpY === 0) ? vpY : vpY + occludedTopHeight;
    const safeBottom = vpY + vpH - occludedBottomHeight;

    const sliceDocTop = Math.max(safeTop, coveredDocY, 0);
    const sliceDocBottom = Math.min(safeBottom, input.totalHeight);

    if (sliceDocBottom <= sliceDocTop) continue;

    let bmp: ImageBitmap | null = null;
    try {
      bmp = await loadBitmap(chunk.dataUrl);
      const scaleX = bmp.width / vpW;
      const scaleY = bmp.height / vpH;

      const sliceDocLeft = Math.max(vpX, 0);
      const sliceDocRight = Math.min(vpX + vpW, input.totalWidth);
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
      // For full-page, selX = 0, selY = 0
      const globalSelX = 0;
      const globalSelY = 0;

      const srcX = Math.max(0, globalLeft - globalVpX);
      const srcY = Math.max(0, globalTop - globalVpY);
      const srcW = Math.min(bmp.width - srcX, globalRight - globalLeft);
      const srcH = Math.min(bmp.height - srcY, globalBottom - globalTop);

      const dstX = globalLeft - globalSelX;
      const dstY = globalTop - globalSelY;
      const dstW = srcW;
      const dstH = srcH;

      console.debug("[ScreenX] stitch chunk", JSON.stringify({
        index: i,
        chunkX: chunk.x,
        chunkY: chunk.y,
        sliceDocTop,
        sliceDocBottom,
        srcX,
        srcY,
        srcW,
        srcH,
        dstX,
        dstY,
        dstW,
        dstH,
        bmpWidth: bmp.width,
        bmpHeight: bmp.height,
        scaleX,
        scaleY,
      }));

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
      } catch {
        // ignore
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new CaptureError("STITCH_FAILED", `Failed to draw chunk at y=${chunk.y}: ${msg}`, { cause: e as Error });
    }
    try {
      bmp.close();
    } catch {
      // ignore
    }
    // Yield to event loop to avoid blocking
    await new Promise<void>((r) => setTimeout(r, 0));
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
    throw new CaptureError("STITCH_FAILED", `Final canvas export failed: ${msg}`, { cause: e as Error });
  } finally {
    // Help GC
    // OffscreenCanvas has no explicit dispose; allow GC
  }
}
