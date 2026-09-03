import { describe, it, expect } from "vitest";
import { calculateRangePositions } from "../src/capture/captureUtils";

describe("stitch math test", () => {
  it("calculates range positions correctly", () => {
    const positions = calculateRangePositions(0, 1200, 600, 2000, 20, 0, 0);
    expect(positions.length).toBeGreaterThan(0);
  });
});
