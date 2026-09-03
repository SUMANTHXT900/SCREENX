import * as React from "react";
import { Sparkles, ArrowLeft, ImageOff, Clock, Monitor, ScrollText, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPendingCapture, getLatestPendingCapture } from "@/storage/captureHandoff";
import type { PendingCapture } from "@/types";

type LoadState = "loading" | "empty" | "ready" | "error";

export default function EditorApp(): React.JSX.Element {
  const [state, setState] = React.useState<LoadState>("loading");
  const [capture, setCapture] = React.useState<PendingCapture | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [captureId, setCaptureId] = React.useState<string | null>(null);

  // Revoke blob object URLs when capture changes or unmounts
  React.useEffect(() => {
    return () => {
      if (capture?.dataUrl?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(capture.dataUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [capture?.dataUrl]);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load(): Promise<void> {
      try {
        const url = new URL(window.location.href);
        const id = url.searchParams.get("captureId");
        if (!cancelled) setCaptureId(id);

        let pending: PendingCapture | null = null;

        if (id) {
          pending = await getPendingCapture(id);
          if (!pending) {
            console.warn("[ScreenX] captureId not found in IndexedDB, trying latest:", id);
            pending = await getLatestPendingCapture();
          }
        } else {
          pending = await getLatestPendingCapture();
        }

        if (cancelled) {
          // Revoke if we created an object URL but cancelled
          if (pending?.dataUrl?.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(pending.dataUrl);
            } catch {
              // ignore
            }
          }
          return;
        }

        if (pending?.dataUrl) {
          objectUrl = pending.dataUrl;
          setCapture(pending);
          setState("ready");
        } else {
          setState("empty");
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setState("error");
        console.error("[ScreenX] editor load failed", e);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const metaLine = capture
    ? `${
        capture.type === "visible"
          ? "Visible viewport"
          : capture.type === "full-page"
            ? "Full page"
            : capture.type === "selected-area"
              ? "Selected area"
              : capture.type
      } • ${new Date(capture.createdAt).toLocaleString()}`
    : null;

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-[hsl(var(--foreground))] antialiased">
      <header className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[hsl(var(--primary))] text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">ScreenX — Editor</span>
                {capture && (
                  <Badge className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    Step 2 • {capture.type === "full-page" ? "Full Page" : capture.type === "visible" ? "Visible" : capture.type}
                  </Badge>
                )}
                {state === "empty" && <Badge className="bg-white font-mono text-[11px]">No capture</Badge>}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                {metaLine ?? "Dedicated capture tab — preview only"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {capture?.sourceUrl && (
              <a
                href={capture.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] sm:inline-flex"
                title={capture.sourceUrl}
              >
                <ExternalLink className="h-3 w-3" />
                <span className="max-w-[20ch] truncate">{capture.sourceTitle ?? capture.sourceUrl}</span>
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => window.close()}>
              <ArrowLeft className="h-4 w-4" />
              Close
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {state === "loading" && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white px-8 py-24 text-center shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--muted-foreground))]" />
            <p className="mt-3 text-sm font-medium">Loading capture…</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {captureId ? `captureId: ${captureId.slice(0, 8)}…` : "Looking up latest capture"}
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-red-500 ring-1 ring-red-200">
              <ImageOff className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-lg font-semibold">Failed to load screenshot</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-red-700/80">{error ?? "Unknown error"}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              Try capturing again from the popup or with Alt+Shift+V.
            </p>
          </div>
        )}

        {state === "empty" && (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]">
              <ImageOff className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">No screenshot loaded</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              Capture from the popup{" "}
              <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 font-mono text-xs">
                <Monitor className="h-3 w-3" /> Visible
              </span>{" "}
              or{" "}
              <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 font-mono text-xs">
                <ScrollText className="h-3 w-3" /> Full Page
              </span>{" "}
              or press <code className="rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 font-mono text-xs">Alt+Shift+V</code> /{" "}
              <code className="rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 font-mono text-xs">Alt+Shift+F</code>. The image
              will appear here. No workspace persistence yet.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <Clock className="h-3.5 w-3.5" />
              Waiting for next capture…
            </div>
          </div>
        )}

        {state === "ready" && capture && (
          <div className="space-y-4">
            {/* Info bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-3 text-xs shadow-sm">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary))] px-2.5 py-1 font-medium text-white">
                  <Monitor className="h-3 w-3" />{" "}
                  {capture.type === "full-page" ? "Full Page" : capture.type === "selected-area" ? "Selected Area" : "Visible"}
                </span>
                <span className="font-mono text-[hsl(var(--muted-foreground))]">
                  {capture.sourceUrl ? new URL(capture.sourceUrl).hostname : "unknown host"}
                </span>
                <span className="hidden text-[hsl(var(--muted-foreground))] sm:inline">
                  • {new Date(capture.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <span className="font-mono text-[10px] tracking-wide text-[hsl(var(--muted-foreground))]">
                id {capture.id.slice(0, 8)} • {capture.type} • {capture.width ? `${capture.width}×${capture.height}` : "image"}
              </span>
            </div>

            {/* Image stage */}
            <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-sm sm:p-6">
              <div className="flex min-h-[40vh] items-center justify-center rounded-xl bg-[#0a0a0a]/[0.02] p-2 sm:min-h-[60vh] sm:p-8">
                <img
                  src={capture.dataUrl}
                  alt="Captured viewport"
                  className="block h-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/5"
                  style={{ imageRendering: "auto" }}
                />
              </div>
              <p className="mt-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
                Preview only — editing, download, and workspace save arrive in later steps. Image stored in{" "}
                <code className="rounded bg-[hsl(var(--secondary))] px-1 py-0.5 font-mono text-[10px]">IndexedDB</code> + lightweight{" "}
                <code className="rounded bg-[hsl(var(--secondary))] px-1 py-0.5 font-mono text-[10px]">chrome.storage.session</code> pointer.
              </p>
            </div>
          </div>
        )}

        {/* Minimal placeholder for future toolbar — keep boundary clear */}
        <div className="mt-8 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/30 px-4 py-3">
          <p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">
            <span className="font-medium text-[hsl(var(--foreground))]">Step 3 verified:</span> popup/shortcut →{" "}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] ring-1 ring-[hsl(var(--border))]">
              capture("visible") / "full-page" / "selected-area"
            </code>{" "}
            → stitch → IndexedDB + session pointer → preview. Editing remains future work.
          </p>
        </div>
      </main>
    </div>
  );
}
