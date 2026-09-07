/**
 * Editor toolbar — tool switching, style, undo/redo, export actions.
 */
import { Redo2, Undo2, Trash2, Download, Copy, Check } from "lucide-react";
import { TOOLS, STROKE_COLORS } from "../tools";
import { useEditorStore } from "../state/useEditorStore";

interface Props {
  onExport: () => void;
  onCopy: () => void;
  onApplyCrop: () => void;
  copied: boolean;
  /** Auto-split groups show parts stacked — crop applies to single images only. */
  multiPart?: boolean;
}

export default function Toolbar({ onExport, onCopy, onApplyCrop, copied, multiPart }: Props): React.JSX.Element {
  const {
    activeTool, setTool, color, setColor, strokeWidth, setStrokeWidth,
    fontSize, setFontSize, shapes, past, future, selectedId,
    deleteSelected, undo, redo, pendingCrop,
  } = useEditorStore();

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.filter((t) => !(multiPart && t.id === "crop")).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setTool(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
              activeTool === id
                ? "bg-[hsl(var(--primary))] text-white"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{label}</span>
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
        <button type="button" title="Undo" onClick={undo} disabled={past.length === 0} className="rounded-lg p-1.5 hover:bg-[hsl(var(--secondary))] disabled:opacity-30">
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" title="Redo" onClick={redo} disabled={future.length === 0} className="rounded-lg p-1.5 hover:bg-[hsl(var(--secondary))] disabled:opacity-30">
          <Redo2 className="h-4 w-4" />
        </button>
        <button type="button" title="Delete selected" onClick={deleteSelected} disabled={!selectedId} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30">
          <Trash2 className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
        <button type="button" title="Copy PNG to clipboard" onClick={onCopy} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-[hsl(var(--secondary))]">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" title="Download image" onClick={onExport} className="inline-flex items-center gap-1 rounded-lg bg-[hsl(var(--primary))] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90">
          <Download className="h-3.5 w-3.5" /> Export
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-[hsl(var(--border))] pt-2">
        <div className="flex items-center gap-1">
          {STROKE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full ring-2 ring-offset-1 ${color === c ? "ring-[hsl(var(--primary))]" : "ring-transparent"}`}
              style={{ background: c, border: "1px solid rgba(0,0,0,0.15)" }}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          Width
          <input
            type="range" min={2} max={16} step={1} value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-20 accent-[hsl(var(--primary))]"
          />
          <span className="w-5 font-mono">{strokeWidth}</span>
        </label>
        {activeTool === "text" && (
          <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            Font
            <input
              type="range" min={14} max={72} step={2} value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-20 accent-[hsl(var(--primary))]"
            />
            <span className="w-7 font-mono">{fontSize}</span>
          </label>
        )}
        {pendingCrop && (
          <button
            type="button"
            onClick={onApplyCrop}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Check className="h-3.5 w-3.5" /> Apply crop ({Math.round(pendingCrop.w)}×{Math.round(pendingCrop.h)})
          </button>
        )}
        {!pendingCrop && (
          <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">
            {shapes.length} annotation{shapes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
