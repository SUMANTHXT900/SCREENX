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
 * Pass `background` (e.g. "#ffffff") for JPEG/WebP exports so transparent
 * pixels don't encode as black; PNG callers leave it unset.
 */
export function renderComposite(
  base: HTMLImageElement,
  shapes: Shape[],
  crop?: { x: number; y: number; w: number; h: number } | null,
  background?: string | null
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

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
  shapes: Shape[],
  background?: string | null
): HTMLCanvasElement {
  if (images.length === 0) throw new Error("No images to export.");
  const width = Math.max(...images.map((i) => i.naturalWidth));
  const height = images.reduce((n, i) => n + i.naturalHeight, 0);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

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

/** Paint annotations; blitBase repaints the clean backdrop inside blur clips. Exported for full-res tiled export. */
export function paintShapes(
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

/**
 * Scale that fits a W×H image inside the browser canvas limits. Always ≤1 —
 * this never upscales. A 0.998 safety margin keeps rounding safely inside the
 * limit (a 32767px edge rounds down to 32700, never over).
 */
export function fitScaleForLimits(
  w: number,
  h: number,
  maxW = 32767,
  maxH = 32767,
  maxPx = 268_435_456
): { scale: number; width: number; height: number } {
  if (!(w > 0 && h > 0)) return { scale: 1, width: Math.max(1, w), height: Math.max(1, h) };
  const byW = maxW / w;
  const byH = maxH / h;
  const byPx = Math.sqrt(maxPx / (w * h));
  const scale = Math.min(1, byW, byH, byPx) * 0.998;
  return {
    scale,
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
  };
}

/**
 * Scaled stacked export — the "all in one image" fallback when the full-size
 * stack exceeds canvas limits. NEVER allocates the full-size canvas: parts are
 * drawn directly into a fit-to-limits canvas under a scale transform, so a
 * 40367px-tall stack exports as e.g. 2079×32700 without ever creating the
 * impossible 40367px bitmap. Shapes are painted in original coordinates under
 * the same transform, so annotations land in the right places.
 */
export function renderStackedCompositeScaled(
  images: HTMLImageElement[],
  shapes: Shape[],
  scale: number,
  background?: string | null
): HTMLCanvasElement {
  if (images.length === 0) throw new Error("No images to export.");
  if (!(scale > 0 && scale <= 1)) throw new Error("Invalid export scale.");
  const width = Math.max(...images.map((i) => i.naturalWidth));
  const totalH = images.reduce((n, i) => n + i.naturalHeight, 0);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(totalH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const paintBase = (c: CanvasRenderingContext2D): void => {
    let y = 0;
    for (const img of images) {
      const x = Math.max(0, Math.round((width - img.naturalWidth) / 2));
      c.drawImage(img, x, y, img.naturalWidth, img.naturalHeight);
      y += img.naturalHeight;
    }
  };

  ctx.save();
  ctx.scale(scale, scale);
  paintBase(ctx);
  paintShapes(ctx, shapes, 0, 0, () => {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintBase(ctx);
    ctx.restore();
  });
  ctx.restore();

  return canvas;
}

/**
 * One part tile at FULL resolution with its slice of stack-coordinate
 * annotations. Shapes live in stacked coordinates, so part i paints them with
 * oy=-yOffset. Returns a canvas exactly img-sized (always within limits —
 * each part was stitched to fit).
 */
export function renderPartTile(
  img: HTMLImageElement,
  shapes: Shape[],
  yOffset: number,
  background?: string | null
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, img.naturalWidth);
  canvas.height = Math.max(1, img.naturalHeight);
  // willReadFrequently: tiles are always read back row-by-row by the
  // full-res PNG streamer — without it every getImageData logs a
  // "Multiple readback operations" console warning and runs slower. Must be
  // set on FIRST getContext call for this canvas (later calls with different
  // attrs are ignored, which is exactly how the warning was introduced).
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas context unavailable.");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  paintShapes(ctx, shapes, 0, -yOffset, () => {
    ctx.drawImage(img, 0, 0);
  });
  return canvas;
}

/* CRC-32 (IEEE) for PNG chunks — table built once, no dependency. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0)!;
  out[5] = type.charCodeAt(1)!;
  out[6] = type.charCodeAt(2)!;
  out[7] = type.charCodeAt(3)!;
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

/**
 * Full-resolution single PNG WITHOUT ever allocating the full-size canvas.
 * Streams the stack row-by-row (band by band, part by part) through a
 * deflate stream into ONE .png Blob at 100% quality.
 *
 * Why this exists: the browser canvas limit (32767px/side) makes
 * `renderStackedComposite` throw for tall stacks — the ONLY way to get a
 * full-res single raster file is to bypass canvas for the final assembly and
 * encode PNG manually. JPEG/WebP have no manual encoder available, so this
 * is PNG-only; scaled export remains the fallback for those formats.
 *
 * Memory: peak is one part tile canvas + one 256-row band + the deflate
 * buffer — never the full 400MB+ bitmap. 2561×40367 takes a few seconds.
 */
export async function encodeFullResStackedPNG(
  images: HTMLImageElement[],
  shapes: Shape[],
  background: string | null = null,
  onProgress?: (doneRows: number, totalRows: number) => void
): Promise<Blob> {
  if (images.length === 0) throw new Error("No images to export.");
  if (typeof CompressionStream === "undefined") {
    throw new Error("Streaming compression isn't supported in this browser — use parts or scaled export.");
  }
  const width = Math.max(...images.map((i) => i.naturalWidth));
  const totalH = images.reduce((n, i) => n + i.naturalHeight, 0);
  if (!(width > 0 && totalH > 0)) throw new Error("Image has no pixels to export.");
  if (width > 100000 || totalH > 1000000) {
    throw new Error(`Image is ${width}×${totalH}px — too large even for streamed export. Download parts instead.`);
  }

  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  const readAll = (async () => {
    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  })();

  const BAND_ROWS = 256;
  const rowLen = 1 + width * 4;
  let yOffset = 0;
  let doneRows = 0;
  try {
    for (const img of images) {
      const tile = renderPartTile(img, shapes, yOffset, background);
      const tctx = tile.getContext("2d", { willReadFrequently: true }) ?? tile.getContext("2d");
      if (!tctx) throw new Error("Canvas context unavailable.");
      const xOff = Math.max(0, Math.round((width - tile.width) / 2));
      for (let y0 = 0; y0 < tile.height; y0 += BAND_ROWS) {
        const bh = Math.min(BAND_ROWS, tile.height - y0);
        const pixels = tctx.getImageData(0, y0, tile.width, bh).data;
        const band = new Uint8Array(bh * rowLen);
        // Pre-fill white (opaque) once per band; narrower tiles stay white
        // at the margins, matching renderStackedComposite centering.
        for (let r = 0; r < bh; r++) {
          const base = r * rowLen;
          band[base] = 0; // filter type 0 (None)
          for (let x = 0; x < width; x++) {
            const o = base + 1 + x * 4;
            band[o] = 255;
            band[o + 1] = 255;
            band[o + 2] = 255;
            band[o + 3] = 255;
          }
        }
        for (let r = 0; r < bh; r++) {
          const srcRow = r * tile.width * 4;
          const dstBase = r * rowLen + 1 + xOff * 4;
          band.set(pixels.subarray(srcRow, srcRow + tile.width * 4), dstBase);
        }
        await writer.write(band as unknown as Uint8Array<ArrayBuffer>);
        doneRows += bh;
        onProgress?.(doneRows, totalH);
        // Let the UI breathe on very tall stacks.
        if ((y0 / BAND_ROWS) % 8 === 7) await new Promise<void>((r) => setTimeout(r, 0));
      }
      yOffset += img.naturalHeight;
    }
  } finally {
    try {
      await writer.close();
    } catch {
      // ignore — readAll surfaces the real error
    }
  }
  const idat = await readAll;

  const ihdr = new Uint8Array(13);
  const iview = new DataView(ihdr.buffer);
  iview.setUint32(0, width);
  iview.setUint32(4, totalH);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  // Split IDAT into 8MB chunks — some decoders balk at a single giant IDAT.
  const idatChunks: Uint8Array[] = [];
  const IDAT_SPLIT = 8 * 1024 * 1024;
  for (let o = 0; o < idat.length; o += IDAT_SPLIT) {
    idatChunks.push(pngChunk("IDAT", idat.subarray(o, Math.min(idat.length, o + IDAT_SPLIT))));
  }
  const parts = [sig, pngChunk("IHDR", ihdr), ...idatChunks, pngChunk("IEND", new Uint8Array(0))];
  return new Blob(parts as unknown as BlobPart[], { type: "image/png" });
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
