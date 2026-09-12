import { describe, test, expect } from "vitest";
import { isValidShape } from "../src/editor/state/shapeGuard";

const base = { id: "s1", color: "#000", strokeWidth: 2 };

describe("shapeGuard", () => {
  test("accepts every well-formed kind", () => {
    const shapes = [
      { ...base, kind: "rect", x: 1, y: 2, w: 3, h: 4, fill: null },
      { ...base, kind: "ellipse", x: 1, y: 2, w: 3, h: 4, fill: "#fff" },
      { ...base, kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4 },
      { ...base, kind: "text", x: 1, y: 2, text: "hi", fontSize: 14 },
      { ...base, kind: "pencil", points: [{ x: 1, y: 2 }] },
      { ...base, kind: "highlight", points: [{ x: 1, y: 2 }], width: 14 },
      { ...base, kind: "badge", x: 1, y: 2, n: 3, fontSize: 14 },
      { ...base, kind: "blur", x: 1, y: 2, w: 3, h: 4 },
      { ...base, kind: "redact", x: 1, y: 2, w: 3, h: 4 },
    ];
    for (const s of shapes) expect(isValidShape(s)).toBe(true);
  });

  test("rejects corrupt shapes that crash the renderer", () => {
    // text without .text (t.text.split crash), empty pencil points (±Infinity bounds)
    expect(isValidShape({ ...base, kind: "text", x: 1, y: 2, fontSize: 14 })).toBe(false);
    expect(isValidShape({ ...base, kind: "pencil", points: [] })).toBe(false);
    expect(isValidShape({ ...base, kind: "highlight", points: [{ x: 1, y: 2 }] })).toBe(false); // missing width
    expect(isValidShape({ ...base, kind: "badge", x: 1, y: 2, fontSize: 14 })).toBe(false); // missing n
    expect(isValidShape({ ...base, kind: "rect", x: 1, y: 2, w: 3, h: 4 })).toBe(false); // missing fill
    expect(isValidShape({ ...base, kind: "arrow", x1: 1, y1: NaN, x2: 3, y2: 4 })).toBe(false);
    expect(isValidShape({ ...base, kind: "nope", x: 1 })).toBe(false);
    expect(isValidShape(null)).toBe(false);
    expect(isValidShape("rect")).toBe(false);
    expect(isValidShape({ kind: "rect", x: 1, y: 2, w: 3, h: 4, fill: null })).toBe(false); // missing base
  });
});
