import { CaptureError, type CaptureResult, type CaptureType } from "@/types";
import { captureVisible } from "./visible";
import { captureFullPage } from "./fullPage";
import { captureSelectedArea } from "./selectedArea";

/**
 * Unified capture entry point.
 * Popup and background (commands) must both call this — no duplicated logic.
 */
export async function capture(type: CaptureType): Promise<CaptureResult> {
  switch (type) {
    case "visible":
      return captureVisible();
    case "full-page":
      return captureFullPage();
    case "selected-area":
      return captureSelectedArea();
    default: {
      const _exhaustive: never = type;
      throw new CaptureError("UNSUPPORTED_TYPE", `Unknown capture type: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Editor handoff helpers (shared between popup & background)
// ---------------------------------------------------------------------------

export function getEditorUrl(captureId: string): string {
  const base =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("editor.html")
      : "/editor.html";
  return `${base}?captureId=${encodeURIComponent(captureId)}`;
}

export async function openEditorForCapture(captureId: string): Promise<void> {
  const url = getEditorUrl(captureId);
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

/**
 * Convenience: capture then immediately open the editor tab.
 */
export async function captureAndOpenEditor(type: CaptureType): Promise<CaptureResult> {
  const result = await capture(type);
  await openEditorForCapture(result.id);
  return result;
}

export { captureVisible } from "./visible";
export { captureFullPage } from "./fullPage";
export { captureSelectedArea } from "./selectedArea";
