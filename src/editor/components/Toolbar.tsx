/**
 * Editor toolbar — tool switching, style, undo/redo, export actions.
 */
import { Redo2, Undo2, Trash2, Download, Copy, Check, PaintBucket, X } from "lucide-react";
import { TOOLS, STROKE_COLORS, type AnnotationTool } from "../tools";
import { useEditorStore } from "../state/useEditorStore";

const TOOL_KEYS: Record<AnnotationTool, string> = {
  select: "V",
  rect: "R",
  ellipse: "O",
  arrow: "A",
  text: "T",
  pencil: "P",
  highlight: "H",
  badge: "N",
  blur: "B",
  redact: "D",
  crop: "C",
};

interface Props {
  onExport: () => void;
  onCopy: () => void;
  onApplyCrop: () => void;
  onRevertCrop: () => void;
  copied: boolean;
  /** True right after a crop — offers one-step revert (crop bakes pixels). */
  canRevertCrop?: boolean;
}

export default function Toolbar({ onExport, onCopy, onApplyCrop, onRevertCrop, copied, canRevertCrop }: Props): React.JSX.Element {
  // Granular subscriptions: the toolbar must not re-render for store slices
  // it doesn't display (e.g. canvas drag state committed per mousemove).
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const color = useEditorStore((s) => s.color);
  const setColor = useEditorStore((s) => s.setColor);
  const strokeWidth = useEditorStore((s) => s.strokeWidth);
  const setStrokeWidth = useEditorStore((s) => s.setStrokeWidth);
  const fontSize = useEditorStore((s) => s.fontSize);
  const setFontSize = useEditorStore((s) => s.setFontSize);
  const fillNext = useEditorStore((s) => s.fillNext);
  const setFillNext = useEditorStore((s) => s.setFillNext);
  const shapes = useEditorStore((s) => s.shapes);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const selectedId = useEditorStore((s) => s.selectedId);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const pendingCrop = useEditorStore((s) => s.pendingCrop);
  const restyleSelected = useEditorStore((s) => s.restyleSelected);

  const selected = shapes.find((s) => s.id === selectedId) ?? null;
  // Style controls edit the SELECTED shape (with undo) when one exists,
  // otherwise they set the defaults for the next shape.
  const pickColor = (c: string) => (selected ? restyleSelected({ color: c }) : setColor(c));
  const pickWidth = (w: number) => (selected ? restyleSelected({ strokeWidth: w }) : setStrokeWidth(w));
  const pickFont = (s: number) => (selected ? restyleSelected({ fontSize: s }) : setFontSize(s));
  const showFont = activeTool === "text" || activeTool === "badge" || selected?.kind === "text" || selected?.kind === "badge";
  const fontValue = selected?.kind === "text" || selected?.kind === "badge" ? selected.fontSize : fontSize;
  // Fill applies to rect/ellipse: the selection, or the next shape drawn.
  const selBox =
    selected && (selected.kind === "rect" || selected.kind === "ellipse") ? selected : null;
  const fillActive = selBox ? selBox.fill != null : fillNext;
  const toggleFill = () => {
    if (selBox) {
      restyleSelected({ fill: selBox.fill != null ? null : selBox.color });
    } else {
      setFillNext(!fillNext);
    }
  };

  return (
    <div className="border-[3px] border-black bg-[#FFFDF7] px-3 py-2.5 shadow-[5px_5px_0_#000]">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            title={`${label} (${TOOL_KEYS[id]})`}
            aria-label={`${label} tool`}
            aria-pressed={activeTool === id}
            onClick={() => {
              setTool(id);
            }}
            className={`inline-flex cursor-pointer items-center gap-1.5 border-2 px-2.5 py-1.5 text-xs font-bold transition-all duration-100 ${
              activeTool === id
                ? "border-black bg-black text-white shadow-[2px_2px_0_rgba(0,0,0,0.35)]"
                : "border-transparent text-black/60 hover:border-black hover:bg-white hover:text-black hover:shadow-[2px_2px_0_#000]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
            <span className="hidden xl:inline">{label}</span>
          </button>
        ))}
        <span className="mx-1 h-5 w-0.5 bg-black/15" />
        <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => { undo();  }} disabled={!canUndo} className="cursor-pointer border-2 border-transparent p-1.5 hover:border-black hover:bg-white hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:shadow-none">
          <Undo2 className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => { redo();  }} disabled={!canRedo} className="cursor-pointer border-2 border-transparent p-1.5 hover:border-black hover:bg-white hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:shadow-none">
          <Redo2 className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <button type="button" title="Delete selected (Del)" aria-label="Delete selected annotation" onClick={() => { deleteSelected();  }} disabled={!selectedId} className="cursor-pointer border-2 border-transparent p-1.5 text-black hover:border-black hover:bg-[#F87171] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent">
          <Trash2 className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <span className="mx-1 h-5 w-0.5 bg-black/15" />
        <button type="button" title="Copy PNG to clipboard" onClick={() => { onCopy();  }} className="inline-flex cursor-pointer items-center gap-1 border-2 border-black bg-white px-2 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
          {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" title="Download image" onClick={() => { onExport();  }} className="inline-flex cursor-pointer items-center gap-1 border-2 border-black bg-black px-2.5 py-1.5 text-xs font-bold text-white shadow-[2px_2px_0_rgba(0,0,0,0.35)] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px]">
          <Download className="h-3.5 w-3.5" strokeWidth={2.25} /> Export
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t-2 border-black/10 pt-2">
        <div className="flex items-center gap-1.5">
          {STROKE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => pickColor(c)}
              className={`h-5 w-5 cursor-pointer border-2 border-black ${color === c && !selected ? "shadow-[2px_2px_0_#000]" : ""} ${selected?.color === c ? "shadow-[2px_2px_0_#000] outline outline-2 outline-offset-1 outline-black" : ""}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-black/60">
          Width
          <input
            type="range" min={2} max={16} step={1} value={selected?.strokeWidth ?? strokeWidth}
            onChange={(e) => pickWidth(Number(e.target.value))}
            className="w-20 accent-black"
          />
          <span className="w-5 font-mono font-bold text-black">{selected?.strokeWidth ?? strokeWidth}</span>
        </label>
        {showFont && (
          <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            Font
            <input
              type="range" min={14} max={72} step={2} value={fontValue}
              onChange={(e) => pickFont(Number(e.target.value))}
              className="w-20 accent-[hsl(var(--primary))]"
            />
            <span className="w-7 font-mono">{fontValue}</span>
          </label>
        )}
        {(activeTool === "rect" || activeTool === "ellipse" || selBox) && (
          <button
            type="button"
            title={selBox ? "Toggle fill on the selected shape" : "New rectangles/ellipses start filled"}
            onClick={toggleFill}
            className={`inline-flex cursor-pointer items-center gap-1 border-2 border-black px-2 py-1 text-[11px] font-bold transition-all duration-100 ${
              fillActive
                ? "bg-black text-white shadow-[2px_2px_0_rgba(0,0,0,0.35)]"
                : "bg-white shadow-[2px_2px_0_#000] hover:translate-x-[-1px] hover:translate-y-[-1px]"
            }`}
          >
            <PaintBucket className="h-3.5 w-3.5" strokeWidth={2.5} /> Fill{fillActive ? " on" : ""}
          </button>
        )}
        {selected && (
          <span className="border-2 border-black bg-[#4ADE80] px-2 py-0.5 font-mono text-[10px] font-bold">
            1 SELECTED — EDITS APPLY TO IT
          </span>
        )}
        {pendingCrop && (
          <>
            <button
              type="button"
              onClick={() => { onApplyCrop();  }}
              className="ml-auto inline-flex cursor-pointer items-center gap-1 border-2 border-black bg-[#4ADE80] px-2.5 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000]"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Apply crop ({Math.round(pendingCrop.w)}×{Math.round(pendingCrop.h)})
            </button>
            <button
              type="button"
              onClick={() => { useEditorStore.getState().setPendingCrop(null);  }}
              title="Discard the crop box (Esc)"
              className="inline-flex cursor-pointer items-center gap-1 border-2 border-black bg-white px-2.5 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:bg-black hover:text-white"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} /> Cancel
            </button>
          </>
        )}
        {!pendingCrop && canRevertCrop && (
            <button
              type="button"
              onClick={() => { onRevertCrop();  }}
              title="Restore the image and annotations from before the crop"
            className="ml-auto inline-flex cursor-pointer items-center gap-1 border-2 border-black bg-white px-2.5 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000]"
          >
            <Undo2 className="h-3.5 w-3.5" strokeWidth={2.5} /> Revert crop
          </button>
        )}
        {!pendingCrop && !canRevertCrop && (
          <span className="ml-auto font-mono text-[11px] text-black/55">
            {shapes.length} annotation{shapes.length === 1 ? "" : "s"}
            {selected ? " · styling selection" : ""} · keys V R O A T P H N B D C
          </span>
        )}
      </div>
    </div>
  );
}
