import * as React from "react";
import { Sparkles, ArrowLeft, ImageOff, Clock, Monitor, ScrollText, ExternalLink, Loader2, Library, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPendingCapture, getLatestPendingCapture } from "@/storage/captureHandoff";
import { getCapturesByGroup } from "@/storage/idb/capturesRepo";
import type { PendingCapture } from "@/types";
import { useEditorStore } from "./state/useEditorStore";
import { useSettingsStore } from "@/state/useSettingsStore";
import Toolbar from "./components/Toolbar";
import CanvasViewport, { type Zoom } from "./components/CanvasViewport";
import ExportModal from "./components/ExportModal";
import { loadImage, offsetShapes, renderComposite, renderStackedComposite, canvasToBlob } from "./export/composite";

type LoadState = "loading" | "empty" | "ready" | "error";

interface PartView {
  id: string;
  url: string;
}

function workspaceUrl(): string {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) return chrome.runtime.getURL("workspace.html");
  } catch {
    // ignore
  }
  return "workspace.html";
}

const ZOOM_STEPS: { label: string; value: Zoom }[] = [
  { label: "Fit", value: "fit" },
  { label: "50%", value: 0.5 },
  { label: "100%", value: 1 },
];

export default function EditorApp(): React.JSX.Element {
  const [state, setState] = React.useState<LoadState>("loading");
  const [capture, setCapture] = React.useState<PendingCapture | null>(null);
  const [parts, setParts] = React.useState<PartView[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [captureId, setCaptureId] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState<Zoom>("fit");
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetEditor = useEditorStore((s) => s.reset);
  const loadSettings = useSettingsStore((s) => s.load);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  React.useEffect(() => {
    let cancelled = false;
    const owned: string[] = [];

    const track = (url: string): string => {
      owned.push(url);
      return url;
    };

    async function load(): Promise<void> {
      try {
        const url = new URL(window.location.href);
        const gid = url.searchParams.get("groupId");
        const id = url.searchParams.get("captureId");
        if (!cancelled) setCaptureId(gid ?? id);

        // Auto-split group → stacked parts view.
        if (gid) {
          const records = await getCapturesByGroup(gid);
          if (cancelled) return;
          if (records.length === 0) {
            setState("empty");
            return;
          }
          const views = records.map((r) => ({ id: r.id, url: track(URL.createObjectURL(r.blob)) }));
          if (cancelled) {
            for (const v of views) {
              try {
                URL.revokeObjectURL(v.url);
              } catch {
                // ignore
              }
            }
            return;
          }
          const head = records[0]!;
          setCapture({
            id: head.id,
            type: head.type,
            dataUrl: views[0]!.url,
            createdAt: head.createdAt,
            sourceTabId: head.sourceTabId,
            sourceUrl: head.sourceUrl,
            sourceTitle: head.sourceTitle,
            width: head.width,
            height: head.height,
            groupId: gid,
            partIndex: 1,
            partTotal: records.length,
          });
          setParts(views);
          resetEditor();
          setState("ready");
          return;
        }

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
          setCapture(pending);
          setParts([{ id: pending.id, url: pending.dataUrl }]);
          resetEditor();
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
      for (const u of owned) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          // ignore
        }
      }
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [resetEditor]);

  const multiPart = parts.length > 1;
  const fileBase = capture
    ? capture.groupId
      ? `screenx-group-${capture.groupId.slice(0, 8)}`
      : `screenx-${capture.id.slice(0, 8)}`
    : "screenx";

  const applyCrop = React.useCallback(async () => {
    const st = useEditorStore.getState();
    const crop = st.pendingCrop;
    const first = parts[0];
    if (!crop || !first || multiPart) return;
    try {
      const img = await loadImage(first.url);
      const canvas = renderComposite(img, [], { x: crop.x, y: crop.y, w: crop.w, h: crop.h });
      const blob = await canvasToBlob(canvas, "png", 1);
      const nextUrl = URL.createObjectURL(blob);
      if (first.url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(first.url);
        } catch {
          // ignore
        }
      }
      // Shift annotations into cropped coordinates so they stay put.
      st.commit(offsetShapes(st.shapes, -Math.round(crop.x), -Math.round(crop.y)));
      st.setPendingCrop(null);
      st.select(null);
      setParts([{ id: first.id, url: nextUrl }]);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
      setExportOpen(true);
    }
  }, [parts, multiPart]);

  const renderForExport = React.useCallback(async () => {
    if (parts.length === 0) throw new Error("No image loaded.");
    const imgs = await Promise.all(parts.map((p) => loadImage(p.url)));
    if (imgs.length === 1) return renderComposite(imgs[0]!, useEditorStore.getState().shapes);
    return renderStackedComposite(imgs, useEditorStore.getState().shapes);
  }, [parts]);

  const doDownload = React.useCallback(async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const { exportFormat, exportQuality } = useSettingsStore.getState();
      const canvas = await renderForExport();
      const blob = await canvasToBlob(canvas, exportFormat, exportQuality);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase}.${exportFormat === "jpeg" ? "jpg" : exportFormat}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 10_000);
      setExportOpen(false);
    } catch (e) {
      setExportError(
        e instanceof Error
          ? `${e.message} Tip: absurdly tall stacks can exceed canvas limits — download parts individually from Workspace.`
          : String(e)
      );
    } finally {
      setExportBusy(false);
    }
  }, [renderForExport, fileBase]);

  const doCopy = React.useCallback(async () => {
    try {
      const canvas = await renderForExport();
      const blob = await canvasToBlob(canvas, "png", 1);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Copy failed — clipboard access was denied.");
      setExportOpen(true);
    }
  }, [renderForExport]);

  const cycleZoom = React.useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const order: Zoom[] = ["fit", 0.5, 1];
      const i = order.indexOf(z);
      const next = i === -1 ? 0 : (i + dir + order.length) % order.length;
      return order[next]!;
    });
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
                    {capture.type === "full-page" ? "Full Page" : capture.type === "visible" ? "Visible" : "Selected Area"}
                  </Badge>
                )}
                {capture?.partTotal != null && capture.partTotal > 1 && (
                  <Badge className="bg-amber-50 font-mono text-[11px] text-amber-800 ring-1 ring-amber-200">
                    Part 1–{capture.partTotal} stacked
                  </Badge>
                )}
                {state === "empty" && <Badge className="bg-white font-mono text-[11px]">No capture</Badge>}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                {metaLine ?? "Dedicated capture tab"}
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
            <a
              href={workspaceUrl()}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] sm:inline-flex"
            >
              <Library className="h-3 w-3" /> Workspace
            </a>
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
              {captureId ? `id: ${captureId.slice(0, 8)}…` : "Looking up latest capture"}
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
              will appear here.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <Clock className="h-3.5 w-3.5" />
              Waiting for next capture…
            </div>
          </div>
        )}

        {state === "ready" && capture && parts.length > 0 && (
          <div className="space-y-4">
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
                {multiPart ? `${parts.length} parts stacked` : `id ${capture.id.slice(0, 8)}`} • {capture.type} • {capture.width ? `${capture.width}×${capture.height}` : "image"}
              </span>
            </div>

            <Toolbar
              onExport={() => { setExportError(null); setExportOpen(true); }}
              onCopy={() => void doCopy()}
              onApplyCrop={() => void applyCrop()}
              copied={copied}
              multiPart={multiPart}
            />

            <div className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                title="Zoom out"
                onClick={() => cycleZoom(-1)}
                className="rounded-lg border border-[hsl(var(--border))] bg-white p-1.5 hover:bg-[hsl(var(--secondary))]"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              {ZOOM_STEPS.map((z) => (
                <button
                  key={z.label}
                  type="button"
                  onClick={() => setZoom(z.value)}
                  title={z.value === "fit" ? "Fit width (no upscaling)" : `Show at ${z.label} of natural size`}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono text-[11px] ${
                    zoom === z.value
                      ? "bg-[hsl(var(--primary))] text-white"
                      : "border border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--secondary))]"
                  }`}
                >
                  {z.value === "fit" && <Maximize className="h-3 w-3" />}
                  {z.label}
                </button>
              ))}
              <button
                type="button"
                title="Zoom in"
                onClick={() => cycleZoom(1)}
                className="rounded-lg border border-[hsl(var(--border))] bg-white p-1.5 hover:bg-[hsl(var(--secondary))]"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>

            <CanvasViewport images={parts.map((p) => p.url)} zoom={zoom} />

            <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">
              {multiPart
                ? "All parts shown stacked top-to-bottom as one canvas — annotate across them, export flattens to a single file."
                : "Annotate with shapes, arrows, text, blur, or crop — then Export or Copy."}{" "}
              Stored in{" "}
              <code className="rounded bg-[hsl(var(--secondary))] px-1 py-0.5 font-mono text-[10px]">IndexedDB</code> + lightweight{" "}
              <code className="rounded bg-[hsl(var(--secondary))] px-1 py-0.5 font-mono text-[10px]">chrome.storage.session</code> pointer.
            </p>
          </div>
        )}

        <ExportModal
          open={exportOpen}
          busy={exportBusy}
          error={exportError}
          fileName={fileBase}
          onClose={() => setExportOpen(false)}
          onDownload={() => void doDownload()}
        />
      </main>
    </div>
  );
}
