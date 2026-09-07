/**
 * Export modal — format/quality choice + download (plan: editor/components).
 * Clipboard copy is always PNG (ClipboardItem requirement).
 */
import { X, Download } from "lucide-react";
import { useSettingsStore, type ExportFormat } from "@/state/useSettingsStore";

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  fileName: string;
  onClose: () => void;
  onDownload: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "png", label: "PNG", hint: "lossless" },
  { id: "jpeg", label: "JPEG", hint: "smaller" },
  { id: "webp", label: "WebP", hint: "modern" },
];

export default function ExportModal({ open, busy, error, fileName, onClose, onDownload }: Props): React.JSX.Element | null {
  const { exportFormat, setExportFormat, exportQuality, setExportQuality } = useSettingsStore();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Export image</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-[hsl(var(--secondary))]" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{fileName} • annotations flattened</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setExportFormat(f.id)}
              className={`rounded-xl border px-2 py-2.5 text-center transition ${
                exportFormat === f.id
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5"
                  : "border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]"
              }`}
            >
              <div className="text-sm font-semibold">{f.label}</div>
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{f.hint}</div>
            </button>
          ))}
        </div>
        {exportFormat !== "png" && (
          <label className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            Quality
            <input
              type="range" min={0.5} max={1} step={0.02} value={exportQuality}
              onChange={(e) => setExportQuality(Number(e.target.value))}
              className="flex-1 accent-[hsl(var(--primary))]"
            />
            <span className="w-10 font-mono">{Math.round(exportQuality * 100)}%</span>
          </label>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> {busy ? "Rendering…" : `Download ${exportFormat.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
