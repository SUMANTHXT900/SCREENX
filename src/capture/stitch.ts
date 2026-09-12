/**
 * Stitch facade — thin wrapper over CanvasStitcher (Stage 3 unified).
 * Canonical DTOs live in ./stitch/canvasStitcher.ts; this file re-exports
 * for backward compatibility.
 */
import { createStitcher } from "./stitch/canvasStitcher";
import type { StitchChunk } from "./stitch/canvasStitcher";

export type { StitchChunk, StitchOutput } from "./stitch/canvasStitcher";

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

export async function stitchImages(input: StitchInput) {

  const stitcher = createStitcher({
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
