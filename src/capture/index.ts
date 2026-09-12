import { type CaptureResult, type CaptureType } from "@/types";
import { captureVisible } from "./visible";
import { captureFullPage } from "./fullPage";
import { captureSelectedArea } from "./selectedArea";
import { registerCaptureEngine, runCaptureEngine } from "./engine/registry";

// Built-in engines self-register here. To swap an engine, call
// registerCaptureEngine() again with the same type — later registration wins.
registerCaptureEngine("visible", captureVisible);
registerCaptureEngine("full-page", captureFullPage);
registerCaptureEngine("selected-area", captureSelectedArea);

/**
 * Unified capture entry point.
 * Popup and background (commands) must both call this — no duplicated logic.
 * Dispatches through the engine registry, so engines are swappable without
 * touching this router.
 */
export async function capture(type: CaptureType): Promise<CaptureResult> {
  return runCaptureEngine(type);
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

export function getGroupEditorUrl(groupId: string): string {
  const base =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("editor.html")
      : "/editor.html";
  return `${base}?groupId=${encodeURIComponent(groupId)}`;
}

export async function openEditorForCapture(captureId: string): Promise<void> {
  const url = getEditorUrl(captureId);
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

/** Open a capture result — routes auto-split groups to the stacked group view. */
export async function openEditorForCaptureResult(result: { id: string; groupId?: string }): Promise<void> {
  const url = result.groupId ? getGroupEditorUrl(result.groupId) : getEditorUrl(result.id);
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
  await openEditorForCaptureResult(result);
  return result;
}

export { captureVisible } from "./visible";
export { captureFullPage } from "./fullPage";
export { captureSelectedArea } from "./selectedArea";

// Submodule barrels for discoverability (plan structure)
export * from "./planner/index";
export * from "./stitch/index";
