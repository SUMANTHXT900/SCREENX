/**
 * Content-side clipboard write helpers (plan: content/clipboardWrite.ts).
 * Lives inside the content bundle (classic script — no shared chunks), so
 * both the COPY_IMAGE handler (index.ts) and the toast Copy button use it.
 *
 * Two reliability guarantees:
 * 1. CSP-independent Data URL → Blob decode. The old `fetch(dataUrl)` path
 *    is subject to the PAGE's Content Security Policy and fails on strict
 *    sites — a site-dependent intermittent copy failure. Base64 decoding is
 *    pure JS: no network, no CSP surface, and synchronous (strictly better
 *    for transient-activation preservation).
 * 2. Cross-capture ordering. Auto-copy retries span seconds; without
 *    ordering, an older capture's late retry can overwrite a newer capture's
 *    image. Every worker-initiated copy carries a wall-clock seq; the slot
 *    guard drops anything older than the newest seen. In-gesture clicks bump
 *    the slot so they always win over in-flight background retries.
 */

/** Newest copy seq observed in this page. Module state = per-tab. Correct. */
let lastCopySeq = 0;

/**
 * Decode a `data:image/...;base64,...` URL to a Blob. Synchronous — throws
 * on malformed input (callers map to copy errors, never to silent success).
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("bad-image");
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("bad-image");
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(header)) throw new Error("unsupported-encoding");
  const mime = header.slice("data:".length, header.length - ";base64".length) || "image/png";
  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    throw new Error("decode-failed");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Async variant that yields to the event loop every 1 MiB so huge images
 * don't freeze the page (and the Copy button's spinner keeps animating)
 * while decoding. Identical output to dataUrlToBlob — prefer it wherever a
 * loading state is visible.
 */
export async function dataUrlToBlobAsync(dataUrl: string): Promise<Blob> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("bad-image");
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("bad-image");
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(header)) throw new Error("unsupported-encoding");
  const mime = header.slice("data:".length, header.length - ";base64".length) || "image/png";
  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    throw new Error("decode-failed");
  }
  const bytes = new Uint8Array(binary.length);
  const SLICE = 1 << 20;
  for (let start = 0; start < binary.length; start += SLICE) {
    const end = Math.min(start + SLICE, binary.length);
    for (let i = start; i < end; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // Let paint/input run between slices — the final slice skips the yield.
    if (end < binary.length) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Claim the clipboard slot for a worker-initiated copy. Returns false when
 * a NEWER copy was already seen — the caller must skip the write (and report
 * `superseded`, never success). Missing/NaN seq accepts (back-compat).
 */
export function claimCopySlot(seq: number | undefined): boolean {
  if (typeof seq !== "number" || Number.isNaN(seq)) return true;
  if (seq < lastCopySeq) return false;
  lastCopySeq = seq;
  return true;
}

/** Record an in-gesture local write so stale background retries lose. */
export function markLocalCopyDone(now: number = Date.now()): void {
  if (now > lastCopySeq) lastCopySeq = now;
}

/** Test/introspection helper. */
export function lastSeenCopySeq(): number {
  return lastCopySeq;
}
