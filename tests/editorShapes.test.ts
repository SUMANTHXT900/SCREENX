import { describe, test, expect, beforeEach } from "vitest";
import { pencilBounds } from "../src/editor/components/geometry";
import { boxCorners, resizeBox } from "../src/editor/components/geometry";
import { useEditorStore } from "../src/editor/state/useEditorStore";
import { offsetShapes } from "../src/editor/export/composite";

describe("pencilBounds", () => {
  test("bounds a stroke and collapses a single dot", () => {
    expect(pencilBounds([{ x: 10, y: 20 }, { x: 30, y: 5 }])).toEqual({ x: 10, y: 5, w: 20, h: 15 });
    expect(pencilBounds([{ x: 7, y: 7 }, { x: 7, y: 7 }])).toEqual({ x: 7, y: 7, w: 0, h: 0 });
  });
});

describe("resizeBox", () => {
  const box = { x: 10, y: 20, w: 100, h: 50 };
  test("drags the corner, anchors the opposite", () => {
    expect(resizeBox(box, "se", { x: 200, y: 100 })).toEqual({ x: 10, y: 20, w: 190, h: 80 });
    expect(resizeBox(box, "nw", { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 110, h: 70 });
    expect(resizeBox(box, "ne", { x: 200, y: 0 })).toEqual({ x: 10, y: 0, w: 190, h: 70 });
    expect(resizeBox(box, "sw", { x: 0, y: 100 })).toEqual({ x: 0, y: 20, w: 110, h: 80 });
  });
  test("clamps to minimum size, never inverts", () => {
    const r = resizeBox(box, "nw", { x: 500, y: 500 });
    expect(r.w).toBeGreaterThanOrEqual(8);
    expect(r.h).toBeGreaterThanOrEqual(8);
    expect(r.x + r.w).toBe(110);
    expect(r.y + r.h).toBe(70);
  });
  test("boxCorners returns four anchored corners", () => {
    const cs = boxCorners(box);
    expect(cs.map((c) => c.handle).sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect(cs.find((c) => c.handle === "se")).toMatchObject({ x: 110, y: 70 });
  });
});

describe("offsetShapes new kinds", () => {
  test("badge and highlight translate", () => {
    const out = offsetShapes(
      [
        { kind: "badge", id: "b", color: "#000", strokeWidth: 1, x: 5, y: 5, n: 1, fontSize: 20 },
        { kind: "highlight", id: "h", color: "#000", strokeWidth: 1, points: [{ x: 1, y: 1 }], width: 14 },
      ],
      10,
      -3
    );
    expect(out[0]).toMatchObject({ x: 15, y: 2 });
    expect(out[1]).toMatchObject({ points: [{ x: 11, y: -2 }] });
  });
});
describe("restyleSelected", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  test("no-op without a selection, patches + history with one", () => {
    const st = useEditorStore.getState();
    st.restyleSelected({ color: "#000000" });
    expect(useEditorStore.getState().shapes).toEqual([]);

    st.addShape({ kind: "rect", id: "r1", color: "#ef4444", strokeWidth: 4, x: 0, y: 0, w: 10, h: 10, fill: null });
    const sel = useEditorStore.getState().selectedId;
    expect(sel).toBe("r1");
    useEditorStore.getState().restyleSelected({ color: "#22c55e", strokeWidth: 8 });
    const shape = useEditorStore.getState().shapes[0];
    expect(shape).toMatchObject({ color: "#22c55e", strokeWidth: 8 });
    // Undo restores the pre-restyle shape.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().shapes[0]).toMatchObject({ color: "#ef4444", strokeWidth: 4 });
  });
});
