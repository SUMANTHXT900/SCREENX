/**
 * Export compositor — flatten base image(s) + annotations to canvas (plan: editor/export).
 */
import type { Shape } from "../state/useEditorStore";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image for export."));
    img.src = src;
  });
}

/** Shift shapes by a delta (used when a crop changes the image origin). */
export function offsetShapes(shapes: Shape[], dx: number, dy: number): Shape[] {
  return shapes.map((s) => {
    switch (s.kind) {
      case "rect":
      case "ellipse":
      case "blur":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "arrow":
        return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
      case "text":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "pencil":
        return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    }
  });
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  size: number
): void {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(ang - Math.PI / 7), y2 - size * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(ang + Math.PI / 7), y2 - size * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/**
 * Render base image + shapes. If crop is given, the canvas is the crop region
 * and shapes shift by (-crop.x, -crop.y) — canvas clips overflow.
 */
export function renderComposite(
  base: HTMLImageElement,
  shapes: Shape[],
  crop?: { x: number; y: number; w: number; h: number } | null
): HTMLCanvasElement {
  const sx = crop ? Math.max(0, Math.round(crop.x)) : 0;
  const sy = crop ? Math.max(0, Math.round(crop.y)) : 0;
  const sw = crop ? Math.min(base.naturalWidth - sx, Math.round(crop.w)) : base.naturalWidth;
  const sh = crop ? Math.min(base.naturalHeight - sy, Math.round(crop.h)) : base.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sw);
  canvas.height = Math.max(1, sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");

  ctx.drawImage(base, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  paintShapes(ctx, shapes, -sx, -sy, () => {
    ctx.drawImage(base, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  });

  return canvas;
}

/**
 * Render stacked part images (auto-split groups) + stack-coordinate shapes
 * as ONE image, parts top-to-bottom. Export may still fail for absurd totals
 * (canvas limits) — callers surface the error with a Workspace fallback.
 */
export function renderStackedComposite(
  images: HTMLImageElement[],
  shapes: Shape[]
): HTMLCanvasElement {
  if (images.length === 0) throw new Error("No images to export.");
  const width = Math.max(...images.map((i) => i.naturalWidth));
  const height = images.reduce((n, i) => n + i.naturalHeight, 0);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");

  let y = 0;
  for (const img of images) {
    ctx.drawImage(img, 0, y, img.naturalWidth, img.naturalHeight);
    y += img.naturalHeight;
  }
  paintShapes(ctx, shapes, 0, 0, () => {
    ctx.drawImage(canvas, 0, 0);
  });

  return canvas;
}

/** Paint annotations; blitBase repaints the clean backdrop inside blur clips. */
function paintShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  ox: number,
  oy: number,
  blitBase: () => void
): void {
  for (const s of shapes) {
    if (s.kind === "blur") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x + ox, s.y + oy, s.w, s.h);
      ctx.clip();
      ctx.filter = "blur(12px)";
      blitBase();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(s.x + ox, s.y + oy, s.w, s.h);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.kind === "rect") {
      ctx.strokeRect(s.x + ox, s.y + oy, s.w, s.h);
    } else if (s.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(s.x + ox + s.w / 2, s.y + oy + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.kind === "arrow") {
      ctx.beginPath();
      ctx.moveTo(s.x1 + ox, s.y1 + oy);
      ctx.lineTo(s.x2 + ox, s.y2 + oy);
      ctx.stroke();
      drawArrowHead(ctx, s.x1 + ox, s.y1 + oy, s.x2 + ox, s.y2 + oy, s.color, Math.max(14, s.strokeWidth * 4));
    } else if (s.kind === "pencil") {
      if (s.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(s.points[0]!.x + ox, s.points[0]!.y + oy);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i]!.x + ox, s.points[i]!.y + oy);
        ctx.stroke();
      }
    } else if (s.kind === "text") {
      ctx.font = `700 ${s.fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(1, s.fontSize / 10);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.strokeText(s.text, s.x + ox, s.y + oy);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x + ox, s.y + oy);
    }
    ctx.restore();
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: "png" | "jpeg" | "webp",
  quality: number
): Promise<Blob> {
  const mime = format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export encoding failed."))),
      mime,
      format === "png" ? undefined : quality
    );
  });
}
