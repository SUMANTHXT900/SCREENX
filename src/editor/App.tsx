import * as React from "react";
import { ArrowLeft, ImageOff, Clock, Monitor, ScrollText, ExternalLink, Loader2, Library, Maximize, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPendingCapture, getLatestPendingCapture } from "@/storage/captureHandoff";
import { getCapturesByGroup } from "@/storage/idb/capturesRepo";
import type { PendingCapture } from "@/types";
import { isValidShape } from "./state/shapeGuard";
import type { AnnotationTool } from "./tools";
import { buildTag } from "@/version";
import { captureFileBase } from "@/storage/downloadName";
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
  { label: "100%", value: 1 },
];

/** chrome.storage.local key for per-capture annotation drafts. */
function annotationsKey(id: string): string {
  return `screenx:annotations:${id}`;
}

/** Hostname for display — never throws on malformed stored URLs. */
function safeHost(url: string | undefined): string {
  if (!url) return "unknown host";
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown host";
  }
}

/** Link target allowlist — stored URLs are tab-supplied, not trusted. */
function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:" ? url : undefined;
  } catch {
    return undefined;
  }
}

interface AnnotationsDraft {
  shapes: unknown;
  partsCount: number;
  savedAt: number;
}

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
  // Shown when the requested captureId missed and the latest was opened.
  const [usedFallback, setUsedFallback] = React.useState(false);
  // Pre-crop snapshot (parts + shapes) for one-step revert. Cropping bakes
  // annotations into pixels, so undo lives here instead of shape history.
  const cropSnapshot = React.useRef<{ parts: PartView[]; shapes: unknown } | null>(null);
  const [canRevertCrop, setCanRevertCrop] = React.useState(false);

  const resetEditor = useEditorStore((s) => s.reset);
  const loadSettings = useSettingsStore((s) => s.load);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Self-heal against stale code: extension pages keep their JS until the
  // tab reloads, so an old editor tab would otherwise run dead code forever
  // (and report bugs that no longer exist). Poll the LIVE manifest version;
  // a mismatch means the extension updated/rebuilt underneath us — reload to
  // match. Annotation drafts persist continuously, so in-flight work
  // restores after the reload; the crop-revert snapshot does not survive,
  // which is acceptable (it references pre-reload blobs anyway).
  const loadedVersion = React.useRef<string | null>(null);
  React.useEffect(() => {
    try {
      loadedVersion.current =
        typeof chrome !== "undefined" && chrome.runtime?.getManifest
          ? chrome.runtime.getManifest().version
          : null;
    } catch {
      loadedVersion.current = null;
    }
    if (!loadedVersion.current) return;
    const timer = setInterval(() => {
      try {
        const now =
          typeof chrome !== "undefined" && chrome.runtime?.getManifest
            ? chrome.runtime.getManifest().version
            : null;
        if (now && now !== loadedVersion.current) {
          window.location.reload();
        }
      } catch {
        // ignore
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

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
            if (pending && !cancelled) setUsedFallback(true);
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
  // Stable array identity: CanvasViewport resets its measured sizes when the
  // images array identity changes. Without memo, EVERY App re-render (zoom,
  // export modal, copy feedback) would wipe sizes — and cached <img>s never
  // refire onLoad, leaving totalW=1px (the "image disappeared" bug).
  const imageUrls = React.useMemo(() => parts.map((p) => p.url), [parts]);
  const fileBase = capture
    ? captureFileBase({ sourceUrl: capture.sourceUrl, type: capture.type, createdAt: capture.createdAt })
    : "screenx";

  const applyCrop = React.useCallback(async () => {
    const st = useEditorStore.getState();
    const crop = st.pendingCrop;
    const first = parts[0];
    if (!crop || !first) return;
    const cx = Math.round(crop.x);
    const cy = Math.round(crop.y);
    const cw = Math.round(crop.w);
    const ch = Math.round(crop.h);
    // Ownership rule: snapshot urls must stay alive until revert (or a newer
    // snapshot replaces them). Revoking the original here is what produced
    // the broken-image-on-revert bug — the snapshot held the same url.
    const snapshotUrls = new Set(parts.map((p) => p.url));
    const prevSnap = cropSnapshot.current;
    try {
      // Snapshot for one-step revert (crop bakes pixels + annotations).
      cropSnapshot.current = { parts, shapes: st.shapes };
      let nextUrl: string;
      if (multiPart) {
        // Crop the flattened stack: annotations bake in, result is single.
        const imgs = await Promise.all(parts.map((p) => loadImage(p.url)));
        const flat = renderStackedComposite(imgs, st.shapes);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.min(flat.width - cx, cw));
        canvas.height = Math.max(1, Math.min(flat.height - cy, ch));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable.");
        ctx.drawImage(flat, cx, cy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, "png", 1);
        nextUrl = URL.createObjectURL(blob);
        st.commit([]);
      } else {
        const img = await loadImage(first.url);
        const canvas = renderComposite(img, [], { x: cx, y: cy, w: cw, h: ch });
        const blob = await canvasToBlob(canvas, "png", 1);
        nextUrl = URL.createObjectURL(blob);
        // Shift annotations into cropped coordinates so they stay put.
        st.commit(offsetShapes(st.shapes, -cx, -cy));
      }
      // Retire the PREVIOUS snapshot's urls (a crop-over-crop orphan) — but
      // never urls the new snapshot still references (see ownership rule).
      if (prevSnap) {
        for (const p of prevSnap.parts) {
          if (!snapshotUrls.has(p.url) && p.url.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(p.url);
            } catch {
              // ignore
            }
          }
        }
      }
      st.setPendingCrop(null);
      st.select(null);
      setParts([{ id: first.id, url: nextUrl }]);
      setCanRevertCrop(true);
    } catch (e) {
      cropSnapshot.current = null;
      setCanRevertCrop(false);
      const msg = e instanceof Error ? e.message : String(e);
      setExportError(msg);
      setExportOpen(true);
    }
  }, [parts, multiPart]);

  const revertCrop = React.useCallback(() => {
    const snap = cropSnapshot.current;
    if (!snap) {
      return;
    }
    // Revoke only urls the snapshot does NOT reference (the crop results).
    // The snapshot's own urls stay alive — revoking them is the old bug.
    const keep = new Set(snap.parts.map((p) => p.url));
    for (const part of parts) {
      if (!keep.has(part.url) && part.url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(part.url);
        } catch {
          // ignore
        }
      }
    }
    setParts(snap.parts);
    useEditorStore.setState({
      // Guard like drafts: the snapshot may predate the current renderer.
      shapes: Array.isArray(snap.shapes) ? snap.shapes.filter(isValidShape) : [],
      past: [],
      future: [],
      selectedId: null,
      pendingCrop: null,
    });
    cropSnapshot.current = null;
    setCanRevertCrop(false);
  }, [parts]);

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
      const msg =
        e instanceof Error
          ? `${e.message} Tip: absurdly tall stacks can exceed canvas limits — download parts individually from Workspace.`
          : String(e);
      setExportError(msg);
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
      const msg = e instanceof Error ? e.message : "Copy failed — clipboard access was denied.";
      setExportError(msg);
      setExportOpen(true);
    }
  }, [renderForExport]);

  // Persist annotation drafts per capture/group so a refresh or accidental
  // close doesn't lose work. Restored only when the part count matches.
  const liveShapes = useEditorStore((s) => s.shapes);
  React.useEffect(() => {
    if (state !== "ready" || !captureId) return;
    const key = annotationsKey(captureId);
    const t = setTimeout(() => {
      try {
        const shapes = useEditorStore.getState().shapes;
        const payload: AnnotationsDraft = { shapes, partsCount: parts.length, savedAt: Date.now() };
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          void chrome.storage.local.set({ [key]: payload });
        } else {
          try {
            localStorage.setItem(key, JSON.stringify(payload));
          } catch {
            // ignore — private mode etc.
          }
        }
      } catch {
        // ignore — persistence is best-effort
      }
    }, 500);
    return () => clearTimeout(t);
  }, [state, captureId, parts.length, liveShapes]);

  React.useEffect(() => {
    if (state !== "ready" || !captureId) return;
    let cancelled = false;
    (async () => {
      try {
        const key = annotationsKey(captureId);
        let draft: AnnotationsDraft | null = null;
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get(key);
          draft = (res as Record<string, AnnotationsDraft | undefined>)[key] ?? null;
        } else {
          const raw = localStorage.getItem(key);
          draft = raw ? (JSON.parse(raw) as AnnotationsDraft) : null;
        }
        if (!cancelled && draft && Array.isArray(draft.shapes) && draft.partsCount === parts.length) {
          useEditorStore.setState({
            shapes: draft.shapes.filter(isValidShape),
            past: [],
            future: [],
            selectedId: null,
          });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, captureId, parts.length]);

  // Flight-recorder state transitions (load outcomes, zoom) — one line per
  // change so a console read tells the whole session story.
  const loggedState = React.useRef("");
  React.useEffect(() => {
    const key = `${state}|${captureId ?? ""}|${parts.length}|${usedFallback}`;
    if (key === loggedState.current) return;
    loggedState.current = key;
  }, [state, captureId, parts.length, usedFallback]);

  React.useEffect(() => {
      // ignore
  }
, [zoom]);

  // Global hotkeys: undo/redo, tool shortcuts, zoom. Skipped while typing.
  React.useEffect(() => {
    if (state !== "ready") return;
    const TOOL_KEYS: Record<string, AnnotationTool> = {
      v: "select",
      r: "rect",
      o: "ellipse",
      a: "arrow",
      t: "text",
      p: "pencil",
      h: "highlight",
      n: "badge",
      b: "blur",
      d: "redact",
      c: "crop",
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const st = useEditorStore.getState();
      // Text composer open (even unfocused): letters belong to the text.
      if (st.composing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod) return;
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) {
        st.setTool(tool);
        return;
      }
      // Zoom is Fit / 100% buttons only — no keyboard stepping.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

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
    <div className="nb-scope min-h-screen bg-[#FFF6E9] font-['Public_Sans',ui-sans-serif,system-ui,sans-serif] text-black antialiased">
      <header className="sticky top-0 z-10 border-b-[3px] border-black bg-[#FFFDF7]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-black text-white shadow-[3px_3px_0_#000]">
              <Crop className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-[17px] font-extrabold tracking-tight">Editor</span>
                {capture && (
                  <span className="border-2 border-black bg-black px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                    {capture.type === "full-page" ? "FULL PAGE" : capture.type === "visible" ? "VISIBLE" : "SELECTED AREA"}
                  </span>
                )}
                {capture?.partTotal != null && capture.partTotal > 1 && (
                  <span className="border-2 border-black bg-[#FBBF24] px-2 py-0.5 font-mono text-[10px] font-bold">
                    {capture.partTotal} PARTS STACKED
                  </span>
                )}
                {state === "empty" && (
                  <span className="border-2 border-black bg-white px-2 py-0.5 font-mono text-[10px] font-bold">
                    NO CAPTURE
                  </span>
                )}
                <span
                  className="border-2 border-black bg-white px-2 py-0.5 font-mono text-[10px] font-bold"
                  title="Build identity — if this doesn't match the latest announced build, reload this tab (extension pages keep old JS until reloaded)"
                >
                  {buildTag()}
                </span>
              </div>
              <div className="font-mono text-[11px] text-black/60">
                {metaLine ?? "Dedicated capture tab"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {capture?.sourceUrl && safeHref(capture.sourceUrl) && (
              <a
                href={safeHref(capture.sourceUrl)}
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000] sm:inline-flex"
                title={capture.sourceUrl}
              >
                <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                <span className="max-w-[20ch] truncate">{capture.sourceTitle ?? capture.sourceUrl}</span>
              </a>
            )}
            <a
              href={workspaceUrl()}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000] sm:inline-flex"
            >
              <Library className="h-3 w-3" strokeWidth={2.5} /> Workspace
            </a>
            <Button variant="outline" size="sm" onClick={() => window.close()} className="cursor-pointer rounded-none border-2 border-black bg-white font-bold shadow-[2px_2px_0_#000] hover:bg-black hover:text-white">
              <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              Close
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {state === "loading" && (
          <div className="flex flex-col items-center justify-center border-[3px] border-black bg-[#FFFDF7] px-8 py-24 text-center shadow-[6px_6px_0_#000]">
            <Loader2 className="h-8 w-8 animate-spin" strokeWidth={2.25} />
            <p className="mt-3 text-sm font-bold">Loading capture…</p>
            <p className="font-mono text-xs text-black/60">
              {captureId ? `id: ${captureId.slice(0, 8)}…` : "Looking up latest capture"}
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="border-[3px] border-black bg-[#F87171] p-8 text-center shadow-[6px_6px_0_#000]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-black bg-white">
              <ImageOff className="h-6 w-6" strokeWidth={2.25} />
            </div>
            <h1 className="mt-4 font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-lg font-extrabold">Failed to load screenshot</h1>
            <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6">{error ?? "Unknown error"}</p>
            <p className="mt-1 font-mono text-xs">
              Try capturing again from the popup or with Alt+Shift+S.
            </p>
          </div>
        )}

        {state === "empty" && (
          <div className="border-[3px] border-dashed border-black bg-[#FFFDF7] p-12 text-center shadow-[6px_6px_0_#000]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center border-2 border-black bg-[#4ADE80]">
              <ImageOff className="h-7 w-7 text-black" strokeWidth={2.25} />
            </div>
            <h1 className="mt-4 font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-xl font-extrabold tracking-tight">No screenshot loaded</h1>
            <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-black/60">
              Capture from the popup{" "}
              <span className="inline-flex items-center gap-1 border-2 border-black bg-white px-1.5 py-0.5 font-mono text-xs font-bold">
                <Monitor className="h-3 w-3" strokeWidth={2.5} /> Visible
              </span>{" "}
              or{" "}
              <span className="inline-flex items-center gap-1 border-2 border-black bg-white px-1.5 py-0.5 font-mono text-xs font-bold">
                <ScrollText className="h-3 w-3" strokeWidth={2.5} /> Full Page
              </span>{" "}
              or press <code className="border-2 border-black bg-white px-1.5 py-0.5 font-mono text-xs font-bold">Alt+Shift+S</code> /{" "}
              <code className="border-2 border-black bg-white px-1.5 py-0.5 font-mono text-xs font-bold">Alt+Shift+F</code>. The image
              will appear here.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 font-mono text-xs text-black/60">
              <Clock className="h-3.5 w-3.5" strokeWidth={2.5} />
              Waiting for next capture…
            </div>
          </div>
        )}

        {state === "ready" && capture && parts.length > 0 && (
          <div className="space-y-4">
            {usedFallback && (
              <div className="border-[3px] border-black bg-[#FBBF24] px-4 py-2.5 text-xs font-bold leading-snug shadow-[4px_4px_0_#000]">
                Requested capture wasn&apos;t found — opened the latest capture instead. If this isn&apos;t
                the right image, pick it from the Workspace.
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-[3px] border-black bg-[#FFFDF7] px-4 py-3 text-xs shadow-[4px_4px_0_#000]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 border-2 border-black bg-black px-2.5 py-1 font-bold text-white">
                  <Monitor className="h-3 w-3" strokeWidth={2.5} />{" "}
                  {capture.type === "full-page" ? "Full Page" : capture.type === "selected-area" ? "Selected Area" : "Visible"}
                </span>
                <span className="font-mono text-black/60">
                  {safeHost(capture.sourceUrl)}
                </span>
                <span className="hidden text-black/60 sm:inline">
                  • {new Date(capture.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <span className="font-mono text-[10px] tracking-wide text-black/60">
                {multiPart ? `${parts.length} parts stacked` : `id ${capture.id.slice(0, 8)}`} • {capture.type} • {capture.width ? `${capture.width}×${capture.height}` : "image"}
              </span>
            </div>

            <Toolbar
              onExport={() => { setExportError(null); setExportOpen(true); }}
              onCopy={() => void doCopy()}
              onApplyCrop={() => void applyCrop()}
              onRevertCrop={revertCrop}
              copied={copied}
              canRevertCrop={canRevertCrop}
            />

            <div className="flex items-center justify-center gap-1.5">
              {ZOOM_STEPS.map((z) => (
                <button
                  key={z.label}
                  type="button"
                  onClick={() => setZoom(z.value)}
                  title={z.value === "fit" ? "Fit to canvas" : "Show at natural size (100%)"}
                  aria-pressed={zoom === z.value}
                  className={`inline-flex cursor-pointer items-center gap-1 border-2 border-black px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all duration-100 ${
                    zoom === z.value
                      ? "bg-black text-white shadow-[2px_2px_0_rgba(0,0,0,0.35)]"
                      : "bg-white shadow-[2px_2px_0_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000]"
                  }`}
                >
                  {z.value === "fit" && <Maximize className="h-3 w-3" strokeWidth={2.5} />}
                  {z.label}
                </button>
              ))}
            </div>

            <CanvasViewport images={imageUrls} zoom={zoom} />

            <p className="text-center font-mono text-[11px] text-black/55">
              {multiPart
                ? "All parts stacked as one canvas — annotate across them, export flattens to a single file."
                : "Annotate with shapes, arrows, text, blur, or crop — then Export or Copy."}{" "}
              Shortcuts: V R O A T P H N B D C · Del · Ctrl+Z · click selects, drag moves, empty/right-click clears
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
