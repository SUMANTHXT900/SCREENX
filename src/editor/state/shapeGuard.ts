/**
 * Draft-shape guard — validates persisted annotation shapes before they
 * reach the renderer. Drafts persist across extension updates, so a stored
 * shape may predate (or corrupt against) the current renderer; malformed
 * entries are dropped instead of crashing render/export (e.g. text without
 * `.text`, empty pencil point lists yielding ±Infinity bounds).
 * Pure (no chrome APIs) — tested in tests/shapeGuard.test.ts.
 */
import type { Shape } from "./useEditorStore";

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isValidPoint(p: unknown): p is { x: number; y: number } {
  return !!p && typeof p === "object" && isFiniteNum((p as { x: unknown }).x) && isFiniteNum((p as { y: unknown }).y);
}

export function isValidShape(s: unknown): s is Shape {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.color !== "string" || !isFiniteNum(o.strokeWidth)) return false;
  switch (o.kind) {
    case "rect":
    case "ellipse":
      return (
        isFiniteNum(o.x) && isFiniteNum(o.y) && isFiniteNum(o.w) && isFiniteNum(o.h) &&
        (o.fill === null || typeof o.fill === "string")
      );
    case "arrow":
      return isFiniteNum(o.x1) && isFiniteNum(o.y1) && isFiniteNum(o.x2) && isFiniteNum(o.y2);
    case "text":
      return isFiniteNum(o.x) && isFiniteNum(o.y) && typeof o.text === "string" && isFiniteNum(o.fontSize);
    case "pencil":
      return Array.isArray(o.points) && o.points.length > 0 && o.points.every(isValidPoint);
    case "highlight":
      return Array.isArray(o.points) && o.points.length > 0 && o.points.every(isValidPoint) && isFiniteNum(o.width);
    case "badge":
      return isFiniteNum(o.x) && isFiniteNum(o.y) && isFiniteNum(o.n) && isFiniteNum(o.fontSize);
    case "blur":
    case "redact":
      return isFiniteNum(o.x) && isFiniteNum(o.y) && isFiniteNum(o.w) && isFiniteNum(o.h);
    default:
      return false;
  }
}
