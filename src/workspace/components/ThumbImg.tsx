/**
 * Lazy cover thumbnail — the Workspace lag fix.
 *
 * The old grid gave every card an object URL of the FULL-RES blob, so the
 * browser decoded N multi-megapixel PNGs (up to 2561×32766 each) just to
 * paint 380px cards. With dozens of captures that meant GBs of image memory
 * and a janky page. This component instead:
 *  - waits until the card scrolls near the viewport (IntersectionObserver),
 *  - fetches only that cover's blob, downsamples to a 480×270 top-crop
 *    (exactly what the aspect-video card displays), and shows that.
 * Full blobs are never decoded for the grid — only on Open/Download.
 */
import * as React from "react";
import { ImageOff } from "lucide-react";
import { getCapture } from "@/storage/idb/capturesRepo";

const TW = 480;
const TH = 270;

async function makeThumb(blob: Blob): Promise<Blob> {
  // Fast path: let the decoder downsample straight to thumb size.
  try {
    const probe = await createImageBitmap(blob);
    const sw = probe.width;
    const sh = Math.min(probe.height, Math.round((sw * 9) / 16));
    probe.close();
    const small = await createImageBitmap(blob, 0, 0, sw, sh, {
      resizeWidth: TW,
      resizeHeight: TH,
      resizeQuality: "high",
    } as ImageBitmapOptions);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = TW;
      canvas.height = TH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, TW, TH);
      ctx.drawImage(small, 0, 0, TW, TH);
      const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
      if (!out) throw new Error("Thumb encode failed.");
      return out;
    } finally {
      small.close();
    }
  } catch (e) {
    // Fallback: full decode + manual downscale (older browsers / odd blobs).
    if (e instanceof Error && /thumb encode failed|canvas context unavailable/i.test(e.message)) throw e;
    const bmp = await createImageBitmap(blob);
    try {
      const sw = bmp.width;
      const sh = Math.min(bmp.height, Math.round((sw * 9) / 16));
      const canvas = document.createElement("canvas");
      canvas.width = TW;
      canvas.height = TH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, TW, TH);
      ctx.drawImage(bmp, 0, 0, sw, sh, 0, 0, TW, TH);
      const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
      if (!out) throw new Error("Thumb encode failed.");
      return out;
    } finally {
      bmp.close();
    }
  }
}

interface Props {
  recordId: string;
  alt: string;
  className?: string;
}

export default function ThumbImg({ recordId, alt, className }: Props): React.JSX.Element {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const host = hostRef.current;
    if (!host) return () => {};

    const load = async (): Promise<void> => {
      try {
        const rec = await getCapture(recordId);
        if (cancelled || !rec) {
          if (!cancelled) setFailed(true);
          return;
        }
        const thumb = await makeThumb(rec.blob);
        if (cancelled) return;
        url = URL.createObjectURL(thumb);
        setSrc(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    // Already near the viewport (initial page)? Load immediately; otherwise
    // wait for intersection so off-screen cards cost nothing.
    if (typeof IntersectionObserver === "undefined") {
      void load();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (en.isIntersecting) {
              io.disconnect();
              void load();
            }
          }
        },
        { rootMargin: "300px" }
      );
      io.observe(host);
      return () => {
        cancelled = true;
        io.disconnect();
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }
      };
    }
    return () => {
      cancelled = true;
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    };
  }, [recordId, retry]);

  if (failed) {
    return (
      <div ref={hostRef} className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/5">
        <p className="flex items-center gap-1.5 text-xs font-bold text-black/60">
          <ImageOff className="h-4 w-4" strokeWidth={2.25} /> Preview failed
        </p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setRetry((n) => n + 1);
          }}
          className="cursor-pointer border-2 border-black bg-white px-2.5 py-1 text-[11px] font-bold shadow-[2px_2px_0_#000] hover:translate-x-[-1px] hover:translate-y-[-1px]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!src) {
    // Fixed-size shimmer: reserves layout so the grid doesn't jump when the
    // thumb lands, and animates without decoding anything.
    return <div ref={hostRef} className="h-full w-full animate-pulse bg-black/10" aria-label="Loading preview" />;
  }

  return (
    <div ref={hostRef} className="h-full w-full">
      <img
        src={src}
        alt={alt}
        className={className ?? "h-full w-full object-cover object-top"}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </div>
  );
}
