import { clampBoxToViewport, fullWidthBox, moveBox, resizeBoxBR } from "../src/content/selection/boxMath";
import { test, expect, describe } from "vitest";

describe("boxMath", () => {
  test("moveBox shifts and clamps into the viewport", () => {
    expect(moveBox({ left: 10, top: 10, width: 100, height: 100 }, 5, -3, 800, 600)).toEqual({
      left: 15,
      top: 7,
      width: 100,
      height: 100,
    });
    expect(moveBox({ left: 10, top: 10, width: 100, height: 100 }, -50, 0, 800, 600).left).toBe(0);
  });

  test("resizeBoxBR grows/shrinks with a 12px floor", () => {
    expect(resizeBoxBR({ left: 10, top: 10, width: 100, height: 100 }, 20, -200, 800, 600)).toEqual({
      left: 10,
      top: 10,
      width: 120,
      height: 12,
    });
  });

  test("fullWidthBox spans the viewport keeping vertical span", () => {
    expect(fullWidthBox({ left: 100, top: 50, width: 200, height: 300 }, 800)).toEqual({
      left: 0,
      top: 50,
      width: 800,
      height: 300,
    });
  });

  test("clampBoxToViewport keeps position inside", () => {
    const box = clampBoxToViewport({ left: -20, top: 700, width: 100, height: 100 }, 800, 600);
    expect(box.left).toBe(0);
    expect(box.top).toBeLessThanOrEqual(599);
    expect(box.width).toBeGreaterThan(0);
  });
});
