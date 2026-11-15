/**
 * SX-01 regression tests — nested pane source coordinate mapping.
 *
 * The old formula `(rectTop + docY) * s − (rectTop + scrollY) * s` cancelled
 * rectTop, producing srcY = (docY − scrollY) * s instead of the correct
 * (rectTop + docY − scrollY) * s. This lost the pane's viewport offset.
 *
 * Demonstrates with the audit's mandatory example:
 *   pane (left:190, top:150, width:800, height:520)
 *   scrollTop=400, contentY=450
 *   correct screenY = 150 + (450 − 400) = 200, bitmapY = 200 * scale
 *   old buggy code: srcY = (450 − 400) * scale = 50 * scale
 */
import { describe, test, expect } from "vitest";
import { projectSlice } from "../src/capture/stitch/coordinateMath";

describe("SX-01: nested pane source coordinate fix", () => {
  test("audit mandatory example: pane(190,150), scroll=400, contentY=450 → srcY=200 (not 50)", () => {
    // Window: 1200×900, pane at (190,150) size 800×520
    // Scroller is at scrollTop=400, we want content row 450
    // Bitmap is 1200×900 (DPR=1)
    const r = projectSlice({
      sliceDocTop: 450,
      sliceDocBottom: 451,
      sliceDocLeft: 0,
      sliceDocRight: 800,
      vpX: 0,          // scrollLeft
      vpY: 400,         // scrollTop
      targetX: 0,
      targetY: 0,       // target origin for destination
      rectLeft: 190,
      rectTop: 150,
      bmpWidth: 1200,
      bmpHeight: 900,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // Screen position = 150 + (450 - 400) = 200
    // At DPR 1 (scale=1), srcY should be 200
    expect(r!.srcY).toBe(200);
  });

  test("window scroller (rectTop=0): srcY = docY - scrollY", () => {
    const r = projectSlice({
      sliceDocTop: 450,
      sliceDocBottom: 900,
      sliceDocLeft: 0,
      sliceDocRight: 1200,
      vpX: 0,
      vpY: 400,
      targetX: 0,
      targetY: 0,
      rectLeft: 0,
      rectTop: 0,
      bmpWidth: 1200,
      bmpHeight: 900,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // Window scroll: screenY = 0 + (450 - 400) = 50
    expect(r!.srcY).toBe(50);
  });

  test("pane at (190,150) with DPR=2", () => {
    const r = projectSlice({
      sliceDocTop: 450,
      sliceDocBottom: 451,
      sliceDocLeft: 0,
      sliceDocRight: 800,
      vpX: 0,
      vpY: 400,
      targetX: 0,
      targetY: 0,
      rectLeft: 190,
      rectTop: 150,
      bmpWidth: 2400,    // 1200 * 2
      bmpHeight: 1800,   // 900 * 2
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // Screen position = 150 + (450 - 400) = 200
    // Scale = 2400/1200 = 2, so bitmap Y = 200 * 2 = 400
    expect(r!.srcY).toBe(400);
  });

  test("horizontal pane offset: pane at left=190, scrollLeft=100, contentX=150", () => {
    const r = projectSlice({
      sliceDocTop: 0,
      sliceDocBottom: 100,
      sliceDocLeft: 150,
      sliceDocRight: 151,
      vpX: 100,          // scrollLeft
      vpY: 0,
      targetX: 0,
      targetY: 0,
      rectLeft: 190,
      rectTop: 0,
      bmpWidth: 1200,
      bmpHeight: 900,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // Screen position X = 190 + (150 - 100) = 240
    expect(r!.srcX).toBe(240);
  });

  test("fractional DPR 1.25: pane offset preserved", () => {
    const r = projectSlice({
      sliceDocTop: 450,
      sliceDocBottom: 500,
      sliceDocLeft: 0,
      sliceDocRight: 800,
      vpX: 0,
      vpY: 400,
      targetX: 0,
      targetY: 0,
      rectLeft: 190,
      rectTop: 150,
      bmpWidth: 1500,    // 1200 * 1.25
      bmpHeight: 1125,   // 900 * 1.25
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // Screen position = 150 + (450 - 400) = 200
    // Scale = 1500/1200 = 1.25, bitmap Y = round(200 * 1.25) = 250
    expect(r!.srcY).toBe(250);
  });

  test("content at pane top edge: screenY = paneTop exactly", () => {
    const r = projectSlice({
      sliceDocTop: 400,     // equals scrollTop
      sliceDocBottom: 401,
      sliceDocLeft: 0,
      sliceDocRight: 100,
      vpX: 0,
      vpY: 400,
      targetX: 0,
      targetY: 0,
      rectLeft: 0,
      rectTop: 150,
      bmpWidth: 1200,
      bmpHeight: 900,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // screenY = 150 + (400 - 400) = 150
    expect(r!.srcY).toBe(150);
  });

  test("content below pane bottom clips to bitmap bounds", () => {
    // Content coordinate that maps to below the bitmap
    const r = projectSlice({
      sliceDocTop: 1000,
      sliceDocBottom: 1100,
      sliceDocLeft: 0,
      sliceDocRight: 100,
      vpX: 0,
      vpY: 400,
      targetX: 0,
      targetY: 0,
      rectLeft: 0,
      rectTop: 150,
      bmpWidth: 1200,
      bmpHeight: 900,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    // screenY = 150 + (1000 - 400) = 750, screenBottom = 150 + 700 = 850
    // Both within 900px bitmap, so should be valid
    expect(r).not.toBeNull();
    expect(r!.srcY).toBe(750);
  });

  test("negative scrollLeft (RTL): pane offset preserved", () => {
    const r = projectSlice({
      sliceDocTop: 0,
      sliceDocBottom: 100,
      sliceDocLeft: -200,
      sliceDocRight: -100,
      vpX: -200,        // scrollLeft negative for RTL
      vpY: 0,
      targetX: -200,
      targetY: 0,
      rectLeft: 190,
      rectTop: 0,
      bmpWidth: 1200,
      bmpHeight: 900,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(r).not.toBeNull();
    // screenX = 190 + (-200 - (-200)) = 190
    expect(r!.srcX).toBe(190);
  });
});
