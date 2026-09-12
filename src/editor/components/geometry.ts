/**
 * Editor geometry helpers — pure, tested in tests/editorShapes.test.ts.
 * Kept out of CanvasViewport so the component file exports only components.
 */
import type { Point } from "../state/useEditorStore";

/** Bounding box of pencil samples (collapses to w=h=0 for a single dot). */
export function pencilBounds(points: Point[]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export interface BoxGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resize a box by dragging one corner; the opposite corner stays anchored.
 * Enforces a minimum size so shapes can't invert or vanish. Pure — tested.
 */
export function resizeBox(g: BoxGeom, handle: ResizeHandle, p: Point, min = 8): BoxGeom {
  const x2 = g.x + g.w;
  const y2 = g.y + g.h;
  switch (handle) {
    case "se":
      return { x: g.x, y: g.y, w: Math.max(min, p.x - g.x), h: Math.max(min, p.y - g.y) };
    case "sw": {
      const nx = Math.min(p.x, x2 - min);
      return { x: nx, y: g.y, w: x2 - nx, h: Math.max(min, p.y - g.y) };
    }
    case "ne": {
      const ny = Math.min(p.y, y2 - min);
      return { x: g.x, y: ny, w: Math.max(min, p.x - g.x), h: y2 - ny };
    }
    case "nw": {
      const nx = Math.min(p.x, x2 - min);
      const ny = Math.min(p.y, y2 - min);
      return { x: nx, y: ny, w: x2 - nx, h: y2 - ny };
    }
    default:
      return g;
  }
}

/** Corner anchor points for resize handles. */
export function boxCorners(g: BoxGeom): { handle: ResizeHandle; x: number; y: number }[] {
  return [
    { handle: "nw", x: g.x, y: g.y },
    { handle: "ne", x: g.x + g.w, y: g.y },
    { handle: "sw", x: g.x, y: g.y + g.h },
    { handle: "se", x: g.x + g.w, y: g.y + g.h },
  ];
}

export function handleCursor(handle: ResizeHandle | "p1" | "p2"): string {
  return handle === "nw" || handle === "se" || handle === "p1" || handle === "p2"
    ? "nwse-resize"
    : "nesw-resize";
}
