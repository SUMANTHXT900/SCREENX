import * as React from "react";
import { Monitor, Scan, ScrollText, Clock, Library, Sparkles, Loader2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { capture, openEditorForCapture } from "@/capture";
import { CaptureError, type CaptureType } from "@/types";

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
  },
  {
    id: "full-page" as const,
    label: "Full Page",
    desc: "Entire scrollable page",
    icon: ScrollText,
    shortcut: "Alt ⇧ F",
    enabled: true,
  },
  {
    id: "selected-area" as const,
    label: "Selected Area",
    desc: "Cross-scroll range",
    icon: Scan,
    shortcut: "Alt ⇧ S",
    enabled: true,
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
    case "TIMEOUT":
      return "Capture timed out. The page may be too large or still loading. Try again.";
    case "STITCH_FAILED":
      return "Failed to combine screenshots. Try again or use visible capture.";
    case "STORAGE_FAILED":
      return "Screenshot storage failed. Try again.";
    case "INVALID_SELECTION":
      return err.message || "Invalid selection. Click START then END, then press End.";
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

      // Selected area needs cross-scroll UI that outlives the popup — delegate to background
      if (type === "selected-area") {
        setIsCapturing(true);
        setCapturingType(type);
        setError(null);
        try {
          // Trigger background to start selection mode; it will handle End/Esc and stitching
          await new Promise<void>((resolve, reject) => {
            chrome.runtime.sendMessage({ type: "TRIGGER_SELECTED_AREA" }, () => {
              const err = chrome.runtime.lastError;
              if (err) reject(new Error(err.message));
              else resolve();
            });
          });
          // Close popup immediately — selection continues in page
          window.close();
        } catch (e) {
          const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", e instanceof Error ? e.message : String(e));
          const msg = friendlyError(err);
          if (msg) setError(msg);
          console.error(`[ScreenX] popup trigger selected-area failed`, err);
          setIsCapturing(false);
          setCapturingType(null);
        }
        return;
      }

      setIsCapturing(true);
      setCapturingType(type);
      setError(null);
      try {
        const result = await capture(type);
        await openEditorForCapture(result.id);
        window.close();
      } catch (e) {
        const err = e instanceof CaptureError ? e : new CaptureError("CAPTURE_FAILED", e instanceof Error ? e.message : String(e));
        const msg = friendlyError(err);
        if (msg) setError(msg);
        console.error(`[ScreenX] popup capture(${type}) failed`, err);
      } finally {
        setIsCapturing(false);
        setCapturingType(null);
      }
    },
    [isCapturing]
  );

  const isVisibleCapturing = isCapturing && capturingType === "visible";
  const isFullPageCapturing = isCapturing && capturingType === "full-page";

  return (
    <div className="w-[360px] bg-white text-[hsl(var(--foreground))] antialiased">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[hsl(var(--primary))] text-white shadow-sm">
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="leading-none">
              <div className="text-[14.5px] font-semibold tracking-tight">ScreenX</div>
              <div className="text-[11px] font-medium tracking-wide text-[hsl(var(--muted-foreground))]">
                CAPTURE STUDIO
              </div>
            </div>
          </div>
          <Badge className="rounded-full bg-white font-mono text-[10px] tracking-wide text-[hsl(var(--muted-foreground))] shadow-none">
            v0.1.0 • Step 3
          </Badge>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-[1.5] text-[hsl(var(--muted-foreground))]">
          Visible, Full-page & Cross-scroll range ready.
        </p>
      </div>

      <Separator />

      {/* Capture */}
      <div className="px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-widest text-[hsl(var(--muted-foreground))]">
            CAPTURE
          </span>
          {isCapturing ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 ring-1 ring-amber-200">
              <Loader2 className="h-3 w-3 animate-spin" />
              {capturingType === "selected-area"
                ? "SELECTING…"
                : capturingType === "full-page"
                  ? "CAPTURING FULL PAGE…"
                  : "CAPTURING…"}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700 ring-1 ring-emerald-200">
              READY
            </span>
          )}
        </div>

        <div className="space-y-2">
          {CAPTURE_OPTIONS.map((opt) => {
            if (!opt.enabled) {
              return (
                <button
                  key={opt.id}
                  disabled
                  aria-disabled="true"
                  title={`${opt.label} will be available soon`}
                  className="group flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-[10px] text-left opacity-[0.78] transition-colors hover:bg-[hsl(var(--secondary))]/40 disabled:cursor-not-allowed"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] ring-1 ring-[hsl(var(--border))]">
                    <opt.icon className="h-4 w-4" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium leading-none">{opt.label}</span>
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400/80 ring-1 ring-amber-500/20" />
                    </div>
                    <div className="text-[11.5px] leading-none text-[hsl(var(--muted-foreground))]">{opt.desc}</div>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                    <span className="rounded-md bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[hsl(var(--muted-foreground))]">
                      {opt.shortcut}
                    </span>
                    <span className="text-[10px] font-medium tracking-wide text-amber-600/70">SOON</span>
                  </div>
                </button>
              );
            }

            const isThisCapturing =
              (opt.id === "visible" && isVisibleCapturing) ||
              (opt.id === "full-page" && isFullPageCapturing) ||
              (opt.id === "selected-area" && isCapturing && capturingType === "selected-area");
            const isAnyCapturing = isCapturing;

            return (
              <button
                key={opt.id}
                onClick={() => handleCapture(opt.id)}
                disabled={isAnyCapturing}
                aria-busy={isThisCapturing}
                title={
                  opt.id === "visible"
                    ? "Capture the visible viewport (Alt+Shift+V)"
                    : opt.id === "full-page"
                      ? "Capture the entire page (Alt+Shift+F)"
                      : "Capture a cross-scroll range (Alt+Shift+S)"
                }
                className="group flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-[10px] text-left shadow-sm transition-all hover:border-[hsl(var(--foreground))]/15 hover:bg-[hsl(var(--secondary))]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] shadow-sm ${
                    opt.id === "full-page"
                      ? "bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] ring-1 ring-[hsl(var(--border))] group-hover:bg-white"
                      : "bg-[hsl(var(--primary))] text-white"
                  }`}
                >
                  {isThisCapturing ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
                  ) : (
                    <opt.icon className="h-4 w-4" strokeWidth={1.7} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium leading-none">{opt.label}</span>
                    <span className={`inline-flex h-1.5 w-1.5 rounded-full ring-1 ${isThisCapturing ? "bg-amber-500 ring-amber-500/20" : "bg-emerald-500 ring-emerald-500/20"}`} />
                  </div>
                  <div className="text-[11.5px] leading-none text-[hsl(var(--muted-foreground))]">
                    {isThisCapturing
                      ? opt.id === "selected-area"
                        ? "Selecting range…"
                        : opt.id === "full-page"
                          ? "Stitching full page…"
                          : "Capturing viewport…"
                      : opt.desc}
                  </div>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="rounded-md bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[hsl(var(--muted-foreground))]">
                    {opt.shortcut}
                  </span>
                  <span className={`text-[10px] font-medium tracking-wide ${isThisCapturing ? "text-amber-600" : "text-emerald-600"}`}>
                    {isThisCapturing ? "…" : "READY"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-snug text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="shrink-0 rounded-md p-1 text-red-400 hover:bg-red-100 hover:text-red-600"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="mt-2.5 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40 px-3 py-2">
          <p className="text-[11.5px] leading-snug text-[hsl(var(--muted-foreground))]">
            <span className="font-medium text-[hsl(var(--foreground))]">Popup</span> and shortcuts share{" "}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] ring-1 ring-[hsl(var(--border))]">
              capture("visible") / "full-page" / "selected-area"
            </code>{" "}
            . Selected area uses cross-scroll range (End/Esc).
          </p>
        </div>
      </div>

      <Separator />

      {/* Library */}
      <div className="px-3 py-3">
        <div className="mb-2 px-1 text-[11px] font-semibold tracking-widest text-[hsl(var(--muted-foreground))]">
          LIBRARY
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 rounded-xl border-[hsl(var(--border))] bg-white px-3 py-3 text-left hover:bg-[hsl(var(--secondary))]"
            onClick={() => openExtensionPage("workspace.html")}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-white">
              <Library className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-medium leading-none">Workspace</span>
            <span className="text-[11px] font-normal leading-none text-[hsl(var(--muted-foreground))]">
              Saved items • 0
            </span>
          </Button>

          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 rounded-xl border-[hsl(var(--border))] bg-white px-3 py-3 text-left hover:bg-[hsl(var(--secondary))]"
            onClick={() => openExtensionPage("history.html")}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[hsl(var(--foreground))] ring-1 ring-[hsl(var(--border))]">
              <Clock className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-medium leading-none">History</span>
            <span className="text-[11px] font-normal leading-none text-[hsl(var(--muted-foreground))]">
              Activity • 0
            </span>
          </Button>
        </div>

        <Button
          variant="ghost"
          className="mt-2 w-full justify-center rounded-xl bg-[hsl(var(--secondary))]/60 text-[12px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]"
          onClick={() => openExtensionPage("editor.html")}
        >
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Open Editor (empty state)
        </Button>
      </div>

      <Separator />

      {/* Footer */}
      <div className="flex items-center justify-between bg-[hsl(var(--secondary))]/30 px-4 py-2.5">
        <span className="font-mono text-[10px] tracking-wide text-[hsl(var(--muted-foreground))]">
          MANIFEST V3 • MV3
        </span>
        <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
          activeTab + storage + scripting
        </span>
      </div>
    </div>
  );
}
