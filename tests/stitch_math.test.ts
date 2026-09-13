import { describe, it, expect } from "vitest";
import { calculateRangePositions } from "../src/capture/captureUtils";

describe("stitch math test", () => {
  it("calculates range positions correctly", () => {
    const positions = calculateRangePositions(0, 1200, 600, 2000, 20, 0, 0);
    // 600px viewport keeps the 150px minimum overlap, so step=450 and
    // three exposures cover the 1200px range without a seam gap.
    expect(positions).toEqual([0, 450, 900]);
  });

  it("normalizes reversed inputs to the same positions", () => {
    expect(calculateRangePositions(1200, 0, 600, 2000, 20, 0, 0)).toEqual([0, 450, 900]);
  });
});
