import { CanvasStitcher } from "./stitch/canvasStitcher";

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

  const stitcher = new CanvasStitcher({
    chunks: input.chunks,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    dpr: input.dpr,
    occludedTopHeight: input.occludedTopHeight,
    occludedBottomHeight: input.occludedBottomHeight,
    totalWidth: input.totalWidth,
    totalHeight: input.totalHeight,
  });

  return await stitcher.stitch();
}
