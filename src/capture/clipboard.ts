/**
 * Clipboard handoff — copy a capture blob as PNG so the user can paste it
 * anywhere without opening the editor. Needs the "clipboardWrite" manifest
 * permission; reads are never used.
 *
 * Writes happen in the CONTENT script (focused document + transient
 * activation exist only in the page — navigator.clipboard is undefined in
 * service workers on all Chrome versions, and chrome.offscreen proved
 * unavailable here too). The worker encodes the blob as a data URL and the
 * tab writes it. Large images skip clipboard (message transport limits) and
 * fall back to Download.
 */
import { blobToDataUrl } from "@/storage/idb";

export type ClipboardWriter = (blob: Blob) => Promise<void>;

async function defaultWriter(blob: Blob): Promise<void> {
  const png =
    blob.type === "image/png"
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: "image/png" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/**
 * Copy a capture blob to the clipboard. Never throws — returns false when
 * the Clipboard API is unavailable or the write fails, so capture success
 * never depends on it.
 */
export async function copyBlobToClipboard(blob: Blob, writer: ClipboardWriter = defaultWriter): Promise<boolean> {
  try {
    if (!blob || blob.size === 0) return false;
    await writer(blob);
    return true;
  } catch (e) {
    console.debug("[ScreenX] direct clipboard write failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Data URLs above this are not sent (message transport limits) — use Download. */
export const COPY_IMAGE_MAX_CHARS = 24_000_000;

export interface CopySender {
  (tabId: number, dataUrl: string, timeoutMs: number): Promise<boolean>;
}

/** Structured result of a COPY_IMAGE round trip (detail the boolean hides). */
export interface CopyReport {
  ok: boolean;
  focused?: boolean;
  transientActivation?: boolean;
  error?: string;
}

async function defaultSender(tabId: number, dataUrl: string, timeoutMs: number): Promise<boolean> {
  return (await rawCopySend(tabId, dataUrl, timeoutMs)).ok;
}

async function rawCopySend(tabId: number, dataUrl: string, timeoutMs: number): Promise<CopyReport> {
  const response = (await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("copy-timeout")), timeoutMs);
    try {
      // seq orders concurrent captures: the content script drops any write
      // older than the newest it has seen (see claimCopySlot).
      chrome.tabs.sendMessage(tabId, { type: "SCREENX_COPY_IMAGE", dataUrl, seq: Date.now() }, (res) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message ?? "send-failed"));
        else resolve(res);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  })) as { ok?: boolean; error?: string; focused?: boolean; transientActivation?: boolean } | null;
  if (response?.ok !== true) {
    console.debug("[ScreenX] content clipboard copy failed:", response?.error ?? "no-response", {
      focused: response?.focused,
      transientActivation: response?.transientActivation,
    });
    return {
      ok: false,
      focused: response?.focused,
      transientActivation: response?.transientActivation,
      error: response?.error ?? "no-response",
    };
  }
  return {
    ok: true,
    focused: response.focused,
    transientActivation: response.transientActivation,
  };
}

export interface CopyDeps {
  encode?: (blob: Blob) => Promise<string>;
  sender?: CopySender;
}

/**
 * Encode a blob for clipboard transport. Returns null when there is nothing
 * to send (missing/empty blob, encode failure) or the payload exceeds what
 * extension messaging can carry — callers fall back to Download.
 */
export async function encodeForClipboard(
  blob: Blob | undefined,
  encode: (blob: Blob) => Promise<string> = blobToDataUrl
): Promise<string | null> {
  try {
    if (!blob || blob.size === 0) return null;
    const dataUrl = await encode(blob);
    if (typeof dataUrl !== "string" || dataUrl.length > COPY_IMAGE_MAX_CHARS) {
      console.debug("[ScreenX] clipboard skipped: image too large for message transport", {
        chars: typeof dataUrl === "string" ? dataUrl.length : -1,
        cap: COPY_IMAGE_MAX_CHARS,
      });
      return null;
    }
    return dataUrl;
  } catch (e) {
    console.debug("[ScreenX] clipboard encode failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Hand a data URL to the tab for a focused-document clipboard write.
 * Never throws.
 */
export async function sendCopyImage(
  tabId: number,
  dataUrl: string,
  timeoutMs = 15_000,
  sender: CopySender = defaultSender
): Promise<boolean> {
  try {
    console.debug("[ScreenX] clipboard: sending COPY_IMAGE to tab", {
      tabId,
      chars: dataUrl.length,
    });
    const ok = await sender(tabId, dataUrl, timeoutMs);
    console.debug(`[ScreenX] clipboard: content write ok=${ok}`);
    return ok;
  } catch (e) {
    console.debug("[ScreenX] clipboard copy failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * Same round trip as sendCopyImage but returns the content script's full
 * report (focus/activation/error) so callers can decide whether a retry
 * could help. Never throws — transport failure is `{ok:false}`.
 */
export async function sendCopyImageReport(
  tabId: number,
  dataUrl: string,
  timeoutMs = 15_000
): Promise<CopyReport> {
  try {
    return await rawCopySend(tabId, dataUrl, timeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.debug("[ScreenX] clipboard copy failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Full copy pipeline for a finished capture: encode to data URL, hand to
 * the tab for a focused-document clipboard write. Returns true when the
 * user can paste. Never throws.
 *
 * NOTE: the automatic (post-capture) call has no user gesture in flight, so
 * browsers may refuse the write for lack of transient activation. The
 * reliable path is a click-driven write — see the toast Copy button, which
 * carries the same dataUrl and writes synchronously in the click handler.
 */
export async function copyCaptureToClipboard(
  captureId: string,
  blob: Blob | undefined,
  tabId: number | undefined,
  deps: CopyDeps = {},
  timeoutMs = 15_000
): Promise<boolean> {
  try {
    if (tabId === undefined) {
      console.debug("[ScreenX] clipboard skipped: missing tab", { captureId });
      return false;
    }
    console.debug("[ScreenX] clipboard: encoding blob", { bytes: blob?.size, tabId });
    const dataUrl = await encodeForClipboard(blob, deps.encode);
    if (!dataUrl) return false;
    const sender = deps.sender ?? defaultSender;
    return await sendCopyImage(tabId, dataUrl, timeoutMs, sender);
  } catch (e) {
    console.debug("[ScreenX] clipboard copy failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}
