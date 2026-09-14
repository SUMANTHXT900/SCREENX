/**
 * Export modal — format/quality choice + download (plan: editor/components).
 * Clipboard copy is always PNG (ClipboardItem requirement).
 */
import * as React from "react";
import { X, Download } from "lucide-react";
import { useSettingsStore, type ExportFormat } from "@/state/useSettingsStore";

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  fileName: string;
  onClose: () => void;
  onDownload: () => void;
  /** Multi-part captures: offer per-part files when the flattened export can't fit. */
  onDownloadParts?: (() => void) | null;
  /** True when the stacked total is known to exceed canvas limits. */
  singleBlocked?: boolean;
  /** Scaled whole-page fallback (fits limits) — shown only when blocked. */
  onDownloadScaled?: (() => void) | null;
  scaledLabel?: string;
  /** Full-resolution single PNG (streamed, bypasses canvas limits). */
  onDownloadFullRes?: (() => void) | null;
  fullResLabel?: string;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "png", label: "PNG", hint: "lossless" },
  { id: "jpeg", label: "JPEG", hint: "smaller" },
  { id: "webp", label: "WebP", hint: "modern" },
];

export default function ExportModal({ open, busy, error, fileName, onClose, onDownload, onDownloadParts, singleBlocked, onDownloadScaled, scaledLabel, onDownloadFullRes, fullResLabel }: Props): React.JSX.Element | null {
  const exportFormat = useSettingsStore((s) => s.exportFormat);
  const setExportFormat = useSettingsStore((s) => s.setExportFormat);
  const exportQuality = useSettingsStore((s) => s.exportQuality);
  const setExportQuality = useSettingsStore((s) => s.setExportQuality);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  // Dialog semantics: focus the close button on open; Escape closes (and
  // must not leak to the canvas hotkeys underneath).
  React.useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase: beat the canvas window-level hotkeys to it.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export image"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm border-[3px] border-black bg-[#FFFDF7] p-5 shadow-[8px_8px_0_#000]">
        <div className="flex items-center justify-between">
          <h2 className="font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-[16px] font-extrabold tracking-tight">
            Export image
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="cursor-pointer border-2 border-black bg-white p-1 hover:bg-black hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <p className="mt-1 font-mono text-[11px] text-black/60">{fileName} • annotations flattened</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setExportFormat(f.id)}
              className={`cursor-pointer border-2 border-black px-2 py-2.5 text-center transition-all duration-100 ${
                exportFormat === f.id
                  ? "bg-black text-white shadow-[3px_3px_0_rgba(0,0,0,0.3)]"
                  : "bg-white shadow-[3px_3px_0_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_#000]"
              }`}
            >
              <div className="text-sm font-extrabold">{f.label}</div>
              <div className={`text-[11px] font-medium ${exportFormat === f.id ? "text-white/70" : "text-black/55"}`}>
                {f.hint}
              </div>
            </button>
          ))}
        </div>
        {exportFormat !== "png" && (
          <label className="mt-4 flex items-center gap-2 text-xs font-medium text-black/70">
            Quality
            <input
              type="range" min={0.5} max={1} step={0.02} value={exportQuality}
              onChange={(e) => setExportQuality(Number(e.target.value))}
              className="flex-1 accent-black"
            />
            <span className="w-10 font-mono">{Math.round(exportQuality * 100)}%</span>
          </label>
        )}
        {error && (
          <p className="mt-3 border-2 border-black bg-[#F87171] px-3 py-2 text-xs font-bold">{error}</p>
        )}
        <button
          type="button"
          onClick={onDownload}
          disabled={busy || singleBlocked}
          title={singleBlocked ? "Stacked total exceeds browser canvas limits — use parts below" : undefined}
          className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 border-2 border-black bg-black px-3 py-2.5 text-sm font-bold text-white shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-4 w-4" strokeWidth={2.5} /> {busy ? "Rendering…" : singleBlocked ? `Single file too tall` : `Download ${exportFormat.toUpperCase()}`}
        </button>
        {singleBlocked && onDownloadFullRes && (
          <button
            type="button"
            onClick={onDownloadFullRes}
            disabled={busy}
            title="Whole page in one PNG at 100% resolution — encoded without a canvas, so no quality loss"
            className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 border-2 border-black bg-[#4ADE80] px-3 py-2.5 text-sm font-bold text-black shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" strokeWidth={2.5} /> {busy ? "Rendering…" : (fullResLabel ?? "Download single PNG · full resolution")}
          </button>
        )}
        {singleBlocked && onDownloadScaled && (
          <button
            type="button"
            onClick={onDownloadScaled}
            disabled={busy}
            title="Whole page in one file in your chosen format, shrunk just enough to fit browser canvas limits"
            className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 border-2 border-black bg-white px-3 py-2 text-xs font-bold text-black shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} /> {scaledLabel ?? "Download single file (scaled to fit)"}
          </button>
        )}
        {onDownloadParts && (
          <button
            type="button"
            onClick={onDownloadParts}
            disabled={busy}
            className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 border-2 border-black bg-white px-3 py-2 text-xs font-bold text-black shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} /> Download parts individually
          </button>
        )}
      </div>
    </div>
  );
}
