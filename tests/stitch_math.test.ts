import { describe, it, expect } from "vitest";
import { calculateRangePositions } from "../src/capture/captureUtils";

describe("stitch math test", () => {
  it("calculates range positions correctly", () => {
    const positions = calculateRangePositions(0, 1200, 600, 2000, 20, 0, 0);
    // 1200px range, 600px viewport, step 600 → top + one step; last viewport covers the bottom.
    expect(positions).toEqual([0, 600]);
  });

  it("normalizes reversed inputs to the same positions", () => {
    expect(calculateRangePositions(1200, 0, 600, 2000, 20, 0, 0)).toEqual([0, 600]);
  });
});
