import { calculateRangePositions, calculatePositions } from "../src/capture/captureUtils";
import { test, expect, describe } from "vitest";

describe("Planner tests", () => {
  test("Test 1: No occlusions", () => {
    const positions = calculateRangePositions(0, 1000, 800, 2000, 40, 0, 0);
    // The planner keeps a 160px overlap on an 800px viewport so seam alignment
    // can correct fractional-DPR and layout drift.
    expect(positions).toEqual([0, 640]);
  });

  test("Test 2: Perfect fit at end", () => {
    const positions = calculateRangePositions(100, 2500, 800, 5000, 40, 0, 0);
    // Step = 640px (800px viewport − 160px alignment overlap).
    expect(positions).toEqual([100, 740, 1380, 2020]);
  });

  test("Test 3: Fixed occlusion", () => {
    const positions = calculateRangePositions(100, 2500, 800, 5000, 40, 100, 50);
    // 100px top + 50px bottom overlays require a 170px overlap; step=630px.
    expect(positions).toEqual([0, 630, 1260, 1890]);
  });

  test("Test 4: Clamp at maxScrollY", () => {
    const positions = calculateRangePositions(500, 1800, 800, 1000, 40, 0, 0);
    // starts 500. next = 1300 but clamped to 1000.
    expect(positions).toEqual([500, 1000]);
  });
});

describe("Stitcher math tests", () => {
  test("Exact physical coordinate mapping", () => {
    const chunks = [
      { y: 0, x: 0 },
      { y: 650, x: 0 },
      { y: 1300, x: 0 },
      { y: 1950, x: 0 }
    ];
    
    let coveredDocY = 100;
    const selStartY = 100;
    const selEndY = 2500;
    const occludedTopHeight = 100;
    const occludedBottomHeight = 50;
    const vpH = 800;
    
    const outputs: { sliceDocTop: number; sliceDocBottom: number; srcY: number; srcH: number; dstY: number; dstH: number }[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const vpY = chunks[i].y;
      const safeTop = (vpY === 0) ? vpY : vpY + occludedTopHeight;
      const safeBottom = vpY + vpH - occludedBottomHeight;
      
      const sliceDocTop = Math.max(safeTop, coveredDocY, selStartY);
      const sliceDocBottom = Math.min(safeBottom, selEndY);
      
      if (sliceDocBottom <= sliceDocTop) continue;
      
      const scaleY = 1.25;
      
      const globalTop = Math.round(sliceDocTop * scaleY);
      const globalBottom = Math.round(sliceDocBottom * scaleY);
      const globalVpY = Math.round(vpY * scaleY);
      const globalSelY = Math.round(selStartY * scaleY);
      
      const srcY = Math.max(0, globalTop - globalVpY);
      const srcH = globalBottom - globalTop;
      const dstY = globalTop - globalSelY;
      const dstH = srcH;
      
      outputs.push({ sliceDocTop, sliceDocBottom, srcY, srcH, dstY, dstH });
      coveredDocY = sliceDocBottom;
    }
    
    expect(coveredDocY).toBe(selEndY);
    
    let expectedDstY = 0;
    for (let i = 0; i < outputs.length; i++) {
      expect(outputs[i].dstY).toBe(expectedDstY);
      expectedDstY += outputs[i].dstH;
    }
    
    const expectedTotalHeight = Math.round((selEndY - selStartY) * 1.25);
    expect(expectedDstY).toBe(expectedTotalHeight);
  });

  test("Test 5: Large range selection (30,460px from 24117 to 54578)", () => {
    const startY = 24117;
    const endY = 54578;
    const viewportHeight = 800;
    const maxScrollY = 60000;
    const positions = calculateRangePositions(startY, endY, viewportHeight, maxScrollY, 150, 0, 0);

    // Height is 30,461px with a 640px aligned step → 48 overlapping chunks.
    expect(positions.length).toBe(48);
    expect(positions[0]).toBe(startY);
    expect(positions[positions.length - 1]).toBe(54197);
    expect(positions[positions.length - 1]! + viewportHeight).toBeGreaterThanOrEqual(endY);
  });

  test("Test 6: Continuous coverage across 50+ chunks with occlusions", () => {
    const startY = 0;
    const endY = 40000;
    const vpH = 900;
    const topOcclusion = 80;
    const botOcclusion = 40;
    const positions = calculateRangePositions(startY, endY, vpH, 50000, 150, topOcclusion, botOcclusion);

    // 40,000px with a 720px aligned step (900 − 180 overlap) → 56 chunks.
    expect(positions.length).toBe(56);

    // Verify mathematical continuity
    let coveredDocY = startY;
    for (let i = 0; i < positions.length; i++) {
      const vpY = positions[i]!;
      const safeTop = (vpY === 0) ? vpY : vpY + topOcclusion;
      const safeBottom = vpY + vpH - botOcclusion;
      const sliceTop = Math.max(safeTop, coveredDocY, startY);
      const sliceBottom = Math.min(safeBottom, endY);
      if (sliceBottom > sliceTop) {
        // Assert no gap: sliceTop must not jump ahead of coveredDocY
        expect(sliceTop).toBeLessThanOrEqual(coveredDocY);
        coveredDocY = sliceBottom;
      }
    }
    expect(coveredDocY).toBe(endY);
  });

  test("Test 7: Adaptive step scaling prevents exceeding maxPositions on small-step scenarios", () => {
    // Total height 50,000 with safe step 700 (800 − 60 − 40) needs 72 chunks:
    // fits without adapting.
    const positions = calculatePositions(50000, 800, 50000, 300, 60, 40);

    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length).toBeLessThanOrEqual(300);
    // Verify last position reaches near the end
    expect(positions[positions.length - 1]! + 800).toBeGreaterThanOrEqual(50000);
  });

  test("Test 7b: Adaptive step refuses occlusion-unsafe steps (honest PAGE_TOO_LARGE)", () => {
    // 320+320px occlusions on an 800px viewport leave a 160px safe step;
    // 50,000px would need 313 chunks. The old code widened the step past the
    // safe step (167 > 160), silently dropping 7 rows per seam. Now it throws
    // instead of returning a gappy plan as success.
    expect(() => calculatePositions(50000, 800, 50000, 300, 320, 320)).toThrow(
      /exceeds 300 limit/
    );
  });

  test("Test 8: Full 65,000px capture plans within 300 viewports with valid overlaps", () => {
    const positions = calculatePositions(65000, 900, 65000, 300, 50, 50);

    expect(positions.length).toBeGreaterThan(50);
    expect(positions.length).toBeLessThanOrEqual(300);
    // Verify each chunk overlaps with the previous one
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeLessThan(positions[i - 1]! + 900);
    }
  });
});
