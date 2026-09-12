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
      case "redact":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "arrow":
        return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
      case "text":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "badge":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "pencil":
      case "highlight":
        return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      default:
        // Forward-compat: a corrupt/unknown persisted kind passes through
        // instead of returning undefined and poisoning the array.
        return s;
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
    // Center narrower parts (widths can differ by a pixel after DPR math).
    const x = Math.max(0, Math.round((width - img.naturalWidth) / 2));
    ctx.drawImage(img, x, y, img.naturalWidth, img.naturalHeight);
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
    if (s.kind === "redact") {
      // Opaque blackout — no blur, no alpha, nothing recoverable.
      ctx.save();
      ctx.fillStyle = "#000000";
      ctx.fillRect(s.x + ox, s.y + oy, s.w, s.h);
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
      if (s.fill) {
        ctx.fillStyle = s.fill;
        ctx.fillRect(s.x + ox, s.y + oy, s.w, s.h);
      }
      ctx.strokeRect(s.x + ox, s.y + oy, s.w, s.h);
    } else if (s.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(s.x + ox + s.w / 2, s.y + oy + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
      if (s.fill) {
        ctx.fillStyle = s.fill;
        ctx.fill();
      }
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
      } else if (s.points.length === 1) {
        // Single-sample dot (round caps render zero-length strokes as dots).
        ctx.beginPath();
        ctx.arc(s.points[0]!.x + ox, s.points[0]!.y + oy, s.strokeWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s.kind === "highlight") {
      ctx.save();
      ctx.globalAlpha = 0.45;
      if (s.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(s.points[0]!.x + ox, s.points[0]!.y + oy);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i]!.x + ox, s.points[i]!.y + oy);
        ctx.lineWidth = s.width;
        ctx.stroke();
      } else if (s.points.length === 1) {
        ctx.beginPath();
        ctx.arc(s.points[0]!.x + ox, s.points[0]!.y + oy, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (s.kind === "badge") {
      const r = Math.max(14, s.fontSize * 0.72);
      ctx.beginPath();
      ctx.arc(s.x + ox, s.y + oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, r / 7);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${s.fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(s.n), s.x + ox, s.y + oy + 1);
    } else if (s.kind === "text") {
      ctx.font = `700 ${s.fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(1, s.fontSize / 10);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.fillStyle = s.color;
      const lines = s.text.split("\n");
      const lh = s.fontSize * 1.2;
      lines.forEach((ln, i) => {
        const ly = s.y + oy + i * lh;
        ctx.strokeText(ln, s.x + ox, ly);
        ctx.fillText(ln, s.x + ox, ly);
      });
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
