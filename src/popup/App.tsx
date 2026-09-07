import * as React from "react";
import { Monitor, Scan, ScrollText, Clock, Library, Sparkles, Loader2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
    tile: "bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-[0_4px_14px_rgba(99,102,241,0.4)]",
  },
  {
    id: "full-page" as const,
    label: "Full Page",
    desc: "Entire scrollable page",
    icon: ScrollText,
    shortcut: "Alt ⇧ F",
    enabled: true,
    tile: "bg-white/[0.07] text-zinc-100 ring-1 ring-white/10",
  },
  {
    id: "selected-area" as const,
    label: "Selected Area",
    desc: "Drag a box, extend it",
    icon: Scan,
    shortcut: "Alt ⇧ S",
    enabled: true,
    tile: "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-[0_4px_14px_rgba(168,85,247,0.4)]",
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

  const statusLabel =
    capturingType === "selected-area"
      ? "SELECTING…"
      : capturingType === "full-page"
        ? "CAPTURING FULL PAGE…"
        : "CAPTURING…";

  return (
    <div className="relative w-[360px] overflow-hidden bg-[#0b0b0d] text-zinc-100 antialiased">
      {/* Ambient top glow — same family as the HUD gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-indigo-500/[0.14] via-violet-500/[0.05] to-transparent"
      />

      {/* Header */}
      <div className="relative px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-[0_4px_14px_rgba(99,102,241,0.45)]">
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="leading-none">
              <div className="text-[14.5px] font-semibold tracking-tight text-white">ScreenX</div>
              <div className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-zinc-500">
                CAPTURE STUDIO
              </div>
            </div>
          </div>
          <span
            className="rounded-full bg-white/[0.06] px-2 py-1 font-mono text-[10px] tracking-wide text-zinc-400 ring-1 ring-white/10"
            title="Content-protocol version — must match the tab's console '[ScreenX] content script loaded · proto N'"
          >
            v0.1.0 • proto {CONTENT_PROTOCOL_VERSION}
          </span>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-[1.5] text-zinc-400">
          Visible, Full-page &amp; Cross-scroll range ready.
        </p>
      </div>

      <Separator className="bg-white/[0.07]" />

      {/* Capture */}
      <div className="relative px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-zinc-500">CAPTURE</span>
          {isCapturing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              {statusLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              READY
            </span>
          )}
        </div>

        <div className="space-y-2">
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
                className="group flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-[10px] text-left ring-1 ring-white/10 transition-all hover:bg-white/[0.07] hover:ring-white/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${opt.tile}`}>
                  {isThisCapturing ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
                  ) : (
                    <opt.icon className="h-4 w-4" strokeWidth={1.7} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium leading-none text-white">{opt.label}</span>
                    <span
                      className={`inline-flex h-1.5 w-1.5 rounded-full ${
                        isThisCapturing ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                    />
                  </div>
                  <div className="mt-1 text-[11.5px] leading-none text-zinc-400">{sub}</div>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-400 ring-1 ring-white/10">
                    {opt.shortcut}
                  </span>
                  <span
                    className={`text-[10px] font-semibold tracking-wide ${
                      isThisCapturing ? "text-amber-300" : "text-emerald-300/80"
                    }`}
                  >
                    {isThisCapturing ? "…" : "READY"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[12px] leading-snug text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="shrink-0 rounded-md p-1 text-red-300/70 hover:bg-red-500/20 hover:text-red-200"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="mt-2.5 rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="text-[11.5px] leading-snug text-zinc-500">
            <span className="font-medium text-zinc-300">Popup</span> and shortcuts share{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-zinc-300 ring-1 ring-white/10">
              capture("visible") / "full-page" / "selected-area"
            </code>{" "}
            . Selected area: drag a box, pull the handle down, release (Esc cancels).
          </p>
        </div>
      </div>

      <Separator className="bg-white/[0.07]" />

      {/* Library */}
      <div className="relative px-3 py-3">
        <div className="mb-2 px-1 text-[11px] font-semibold tracking-[0.12em] text-zinc-500">LIBRARY</div>

        {isCapturing && capturingType !== "selected-area" && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-snug text-amber-200">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            <span>
              Capture in progress — <span className="font-medium">stay on this tab</span> until it
              finishes. Switching tabs stops the capture.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1.5 rounded-2xl border-white/10 bg-white/[0.04] px-3 py-3 text-left text-zinc-100 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => openExtensionPage("workspace.html")}
            disabled={isCapturing}
            title={isCapturing ? "Wait for the capture to finish" : "Open workspace"}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-white">
              <Library className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-medium leading-none">Workspace</span>
            <span className="text-[11px] font-normal leading-none text-zinc-500">Saved items • 0</span>
          </Button>

          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1.5 rounded-2xl border-white/10 bg-white/[0.04] px-3 py-3 text-left text-zinc-100 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => openExtensionPage("history.html")}
            disabled={isCapturing}
            title={isCapturing ? "Wait for the capture to finish" : "Open history"}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.07] text-zinc-200 ring-1 ring-white/10">
              <Clock className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-medium leading-none">History</span>
            <span className="text-[11px] font-normal leading-none text-zinc-500">Activity • 0</span>
          </Button>
        </div>

        <Button
          variant="ghost"
          className="mt-2 w-full justify-center rounded-xl bg-white/[0.04] text-[12px] font-medium text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => openExtensionPage("editor.html")}
          disabled={isCapturing}
          title={isCapturing ? "Wait for the capture to finish — opening a tab now would stop it" : "Open empty editor"}
        >
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${isCapturing ? "bg-amber-400" : "bg-emerald-400"}`} />
          {isCapturing ? "Capturing — stay on this tab…" : "Open Editor (empty state)"}
        </Button>
      </div>

      <Separator className="bg-white/[0.07]" />

      {/* Footer */}
      <div className="flex items-center justify-between bg-white/[0.02] px-4 py-2.5">
        <span className="font-mono text-[10px] tracking-wide text-zinc-600">MANIFEST V3 • MV3</span>
        <span className="text-[11px] font-medium text-zinc-500">activeTab + storage + scripting</span>
      </div>
    </div>
  );
}
