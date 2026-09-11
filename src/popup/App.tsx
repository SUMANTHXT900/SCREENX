import * as React from "react";
import { Monitor, Scan, ScrollText, Clock, Library, Crop, Loader2, AlertCircle, X } from "lucide-react";
import { CaptureError, type CaptureType } from "@/types";
import { CONTENT_PROTOCOL_VERSION } from "@/messaging/events";

function openExtensionPage(page: string): void {
  const url = chrome.runtime?.getURL ? chrome.runtime.getURL(page) : `/${page}`;
  if (chrome.tabs?.create) {
    void chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

const CAPTURE_OPTIONS = [
  {
    id: "visible" as const,
    label: "Visible",
    desc: "Current viewport",
    icon: Monitor,
    shortcut: "Alt ⇧ V",
    enabled: true,
    tile: "bg-[#4ADE80]",
  },
  {
    id: "full-page" as const,
    label: "Full Page",
    desc: "Entire scrollable page",
    icon: ScrollText,
    shortcut: "Alt ⇧ F",
    enabled: true,
    tile: "bg-[#FBBF24]",
  },
  {
    id: "selected-area" as const,
    label: "Selected Area",
    desc: "Drag a box, extend it",
    icon: Scan,
    shortcut: "Alt ⇧ S",
    enabled: true,
    tile: "bg-[#60A5FA]",
  },
] as const;

function friendlyError(err: CaptureError): string {
  switch (err.code) {
    case "RESTRICTED_PAGE":
      return "This page can't be captured (browser pages like chrome:// are protected). Try a normal website.";
    case "NO_ACTIVE_TAB":
      return "No active tab found. Open a webpage and try again.";
    case "PERMISSION_DENIED":
      return "Permission denied. Ensure you're on a regular webpage and try again.";
    case "CONTENT_UNAVAILABLE":
    case "CONTENT_SCRIPT_NOT_READY":
      return "Page not ready. Reload the page and try again.";
    case "PAGE_TOO_LARGE":
      return err.message || "Page is too large to capture in one image. Try a smaller range.";
    case "CAPTURE_IN_PROGRESS":
      return "A capture is already running. Please wait for it to finish before starting another.";
    case "TAB_SWITCHED":
      return "Capture stopped because the tab changed. Stay on the page until the capture finishes, then try again.";
    case "TIMEOUT":
      return "Capture timed out. The page may be too large or still loading. Try again.";
    case "STITCH_FAILED":
      return "Failed to combine screenshots. Try again or use visible capture.";
    case "STORAGE_FAILED":
      return "Screenshot storage failed. Try again.";
    case "INVALID_SELECTION":
      return err.message || "Invalid selection. Drag a box, pull the handle down, release to capture.";
    case "HANDOFF_FAILED":
      return "Capture succeeded but couldn't open editor. Try again.";
    case "USER_CANCELLED":
      return "";
    default:
      return err.message || "Screenshot failed. Try again on a different page.";
  }
}

export default function App(): React.JSX.Element {
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [capturingType, setCapturingType] = React.useState<CaptureType | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleCapture = React.useCallback(
    async (type: CaptureType) => {
      if (isCapturing) return;

      // All orchestration lives in the background service worker: trigger it,
      // then close immediately. Running captures in the popup document would
      // abort them the moment the popup loses focus.
      setIsCapturing(true);
      setCapturingType(type);
      setError(null);
      try {
        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: "TRIGGER_CAPTURE", captureType: type }, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
          });
        });
        window.close();
      } catch (e) {
        const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", e instanceof Error ? e.message : String(e));
        const msg = friendlyError(err);
        if (msg) setError(msg);
        console.error(`[ScreenX] popup trigger ${type} failed`, err);
        setIsCapturing(false);
        setCapturingType(null);
      }
    },
    [isCapturing]
  );

  return (
    <div className="w-[360px] bg-[#FFF6E9] font-['Public_Sans',ui-sans-serif,system-ui,sans-serif] text-black antialiased">
      {/* Header */}
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-black text-white shadow-[3px_3px_0_#000]">
              <Crop className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div className="leading-none">
              <div className="nb-font-display text-[19px] font-extrabold tracking-tight">
                ScreenX
              </div>
              <div className="mt-1 font-mono text-[10px] font-medium text-black/60">
                v0.1.1-redcross · proto {CONTENT_PROTOCOL_VERSION}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div aria-hidden="true" className="h-0.5 bg-black" />

      {/* Capture */}
      <div className="px-4 py-4">
        <div className="nb-font-display mb-2.5 text-[15px] font-extrabold tracking-tight">
          Capture
        </div>

        <div className="space-y-3">
          {CAPTURE_OPTIONS.map((opt) => {
            const isThisCapturing = isCapturing && capturingType === opt.id;
            const sub = isThisCapturing
              ? opt.id === "selected-area"
                ? "Selecting range…"
                : opt.id === "full-page"
                  ? "Stitching full page…"
                  : "Capturing viewport…"
              : opt.desc;

            return (
              <button
                key={opt.id}
                onClick={() => handleCapture(opt.id)}
                disabled={isCapturing}
                aria-busy={isThisCapturing}
                title={
                  opt.id === "visible"
                    ? "Capture the visible viewport (Alt+Shift+V)"
                    : opt.id === "full-page"
                      ? "Capture the entire page (Alt+Shift+F)"
                      : "Capture a cross-scroll range (Alt+Shift+S)"
                }
                className="nb-card nb-press flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black ${opt.tile}`}
                >
                  {isThisCapturing ? (
                    <Loader2 className="h-5 w-5 animate-spin text-black" strokeWidth={2.25} />
                  ) : (
                    <opt.icon className="h-5 w-5 text-black" strokeWidth={2.25} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold leading-tight">{opt.label}</div>
                  <div className="mt-0.5 text-[12px] font-medium leading-tight text-black/60">
                    {sub}
                  </div>
                </div>
                <span className="hidden shrink-0 border-2 border-black bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none shadow-[2px_2px_0_#000] sm:inline">
                  {opt.shortcut}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 border-2 border-black bg-[#F87171] px-3 py-2.5 text-[12.5px] font-medium leading-snug shadow-[4px_4px_0_#000]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-black" strokeWidth={2.25} />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="shrink-0 cursor-pointer border-2 border-black bg-white p-0.5 hover:bg-black hover:text-white"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
        )}

        {isCapturing && capturingType !== "selected-area" && (
          <div className="mt-3 flex items-start gap-2 border-2 border-black bg-[#FBBF24] px-3 py-2 text-[12px] font-medium leading-snug shadow-[4px_4px_0_#000]">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.5} />
            <span>
              Capture in progress — <span className="font-bold">stay on this tab</span> until it
              finishes. Switching tabs stops the capture.
            </span>
          </div>
        )}

        <div className="mt-3 border-2 border-dashed border-black/40 px-3 py-2">
          <p className="text-[12px] font-medium leading-snug text-black/70">
            Selected area: drag a box, pull the handle down, release (Esc cancels).
          </p>
        </div>
      </div>

      <div aria-hidden="true" className="h-0.5 bg-black" />

      {/* Library */}
      <div className="px-4 py-4">
        <div className="nb-font-display mb-2.5 text-[15px] font-extrabold tracking-tight">
          Library
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            className="nb-card nb-press flex h-auto cursor-pointer flex-col items-start gap-1.5 px-3 py-3 text-left text-black disabled:cursor-not-allowed disabled:opacity-70"
            onClick={() => openExtensionPage("workspace.html")}
            disabled={isCapturing}
            title={isCapturing ? "Wait for the capture to finish" : "Open workspace"}
          >
            <span className="flex h-8 w-8 items-center justify-center border-2 border-black bg-black text-white">
              <Library className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="text-[14px] font-bold leading-none">Workspace</span>
            <span className="font-mono text-[10.5px] font-medium leading-none text-black/60">
              Saved items • 0
            </span>
          </button>

          <button
            className="nb-card nb-press flex h-auto cursor-pointer flex-col items-start gap-1.5 px-3 py-3 text-left text-black disabled:cursor-not-allowed disabled:opacity-70"
            onClick={() => openExtensionPage("history.html")}
            disabled={isCapturing}
            title={isCapturing ? "Wait for the capture to finish" : "Open history"}
          >
            <span className="flex h-8 w-8 items-center justify-center border-2 border-black bg-black text-white">
              <Clock className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="text-[14px] font-bold leading-none">History</span>
            <span className="font-mono text-[10.5px] font-medium leading-none text-black/60">
              Activity • 0
            </span>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t-2 border-black bg-[#FFE9C7] px-4 py-2">
        <span className="font-mono text-[10px] font-bold tracking-wide">SCREENX © 2026</span>
        <span className="font-mono text-[10px] text-black/60">MANIFEST V3</span>
      </div>
    </div>
  );
}
