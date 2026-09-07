/**
 * Canvas viewport — stacked part images + ONE SVG annotation overlay
 * (plan: editor/components). Auto-split parts display as a single tall
 * image; all coordinates are stack pixels (part tops accumulate).
 */
import * as React from "react";
import { TOOLS } from "../tools";
import { useEditorStore, type Point, type Shape } from "../state/useEditorStore";

export type Zoom = "fit" | number;

function toImageCoords(svg: SVGSVGElement, clientX: number, clientY: number, totalW: number, totalH: number): Point {
  const r = svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(totalW, ((clientX - r.left) / r.width) * totalW)),
    y: Math.max(0, Math.min(totalH, ((clientY - r.top) / r.height) * totalH)),
  };
}

function normRect(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case "rect":
    case "ellipse":
    case "blur":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "arrow":
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case "text":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "pencil":
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const p1 = `${x2 - size * Math.cos(ang - Math.PI / 7)},${y2 - size * Math.sin(ang - Math.PI / 7)}`;
  const p2 = `${x2 - size * Math.cos(ang + Math.PI / 7)},${y2 - size * Math.sin(ang + Math.PI / 7)}`;
  return `${x2},${y2} ${p1} ${p2}`;
}

interface Draft {
  start: Point;
  current: Point;
  points?: Point[];
}

interface Props {
  images: string[];
  zoom: Zoom;
}

export default function CanvasViewport({ images, zoom }: Props): React.JSX.Element {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [sizes, setSizes] = React.useState<({ w: number; h: number } | null)[]>(() => images.map(() => null));
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [textAt, setTextAt] = React.useState<Point | null>(null);
  const [textValue, setTextValue] = React.useState("");
  const [drag, setDrag] = React.useState<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const dragStart = React.useRef<{ x: number; y: number } | null>(null);

  const {
    activeTool, color, strokeWidth,
    shapes, selectedId, select,
    deleteSelected,
  } = useEditorStore();

  // New image set → clear transient UI (kept shapes belong to the stack).
  React.useEffect(() => {
    setSizes(images.map(() => null));
    setDraft(null);
    setTextAt(null);
    setTextValue("");
    setDrag(null);
  }, [images]);

  const dims = React.useMemo(() => {
    const totalW = Math.max(...sizes.map((s) => s?.w ?? 0), 1);
    const totalH = sizes.reduce((n, s) => n + (s?.h ?? 600), 0);
    return { totalW, totalH, ready: sizes.every(Boolean) && sizes.length > 0 };
  }, [sizes]);

  const toolDef = TOOLS.find((t) => t.id === activeTool);

  // Delete key removes the selected shape (not while typing).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && useEditorStore.getState().selectedId) {
        e.preventDefault();
        useEditorStore.getState().deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pt = React.useCallback(
    (e: React.MouseEvent) => {
      if (!svgRef.current) return { x: 0, y: 0 };
      return toImageCoords(svgRef.current, e.clientX, e.clientY, dims.totalW, dims.totalH);
    },
    [dims.totalW, dims.totalH]
  );

  const onBackgroundDown = (e: React.MouseEvent) => {
    if (!dims.ready || activeTool === "select") return;
    const p = pt(e);
    if (activeTool === "text") {
      setTextAt(p);
      setTextValue("");
      return;
    }
    if (activeTool === "pencil") {
      setDraft({ start: p, current: p, points: [p] });
      return;
    }
    setDraft({ start: p, current: p });
  };

  const onMove = (e: React.MouseEvent) => {
    if (!dims.ready) return;
    const p = pt(e);
    if (draft) {
      setDraft((d) =>
        d ? { ...d, current: p, points: d.points ? [...d.points, p] : undefined } : d
      );
      return;
    }
    if (drag && dragStart.current) {
      const s = pt(e);
      setDrag({ ...drag, dx: s.x - dragStart.current.x, dy: s.y - dragStart.current.y, moved: true });
    }
  };

  const finishDraft = () => {
    if (!draft) return;
    const st = useEditorStore.getState();
    const id = st.newId();
    const c = st.color;
    const sw = st.strokeWidth;
    if (activeTool === "pencil" && draft.points && draft.points.length > 1) {
      st.addShape({ kind: "pencil", id, color: c, strokeWidth: sw, points: draft.points });
    } else if (activeTool === "rect" || activeTool === "blur" || activeTool === "crop" || activeTool === "ellipse") {
      const r = normRect(draft.start, draft.current);
      if (r.w >= 8 && r.h >= 8) {
        if (activeTool === "crop") {
          st.setPendingCrop(r);
          st.select(null);
        } else if (activeTool === "ellipse") {
          st.addShape({ kind: "ellipse", id, color: c, strokeWidth: sw, ...r });
        } else if (activeTool === "blur") {
          st.addShape({ kind: "blur", id, color: c, strokeWidth: sw, ...r });
        } else {
          st.addShape({ kind: "rect", id, color: c, strokeWidth: sw, ...r });
        }
      }
    } else if (activeTool === "arrow") {
      const dx = draft.current.x - draft.start.x;
      const dy = draft.current.y - draft.start.y;
      if (Math.hypot(dx, dy) >= 10) {
        st.addShape({
          kind: "arrow", id, color: c, strokeWidth: sw,
          x1: draft.start.x, y1: draft.start.y, x2: draft.current.x, y2: draft.current.y,
        });
      }
    }
    setDraft(null);
  };

  const beginMove = (e: React.MouseEvent, id: string) => {
    if (activeTool !== "select" || !dims.ready) return;
    e.stopPropagation();
    select(id);
    const p = pt(e);
    dragStart.current = p;
    setDrag({ id, dx: 0, dy: 0, moved: false });
  };

  const finishMove = () => {
    if (drag?.moved) {
      const st = useEditorStore.getState();
      st.commit(st.shapes.map((s) => (s.id === drag.id ? translateShape(s, drag.dx, drag.dy) : s)));
    }
    setDrag(null);
    dragStart.current = null;
  };

  const commitText = () => {
    const v = textValue.trim();
    if (textAt && v) {
      const st = useEditorStore.getState();
      st.addShape({
        kind: "text", id: st.newId(), color: st.color, strokeWidth: st.strokeWidth,
        x: textAt.x, y: textAt.y, text: v.slice(0, 280), fontSize: st.fontSize,
      });
    }
    setTextAt(null);
    setTextValue("");
  };

  const renderShape = (s: Shape): React.ReactNode => {
    const t = drag && drag.id === s.id ? translateShape(s, drag.dx, drag.dy) : s;
    const sel = s.id === selectedId;
    const selProps = sel
      ? { stroke: "#3b82f6", strokeWidth: Math.max(2, s.strokeWidth / 2), strokeDasharray: "8 6", fill: "none" as const, pointerEvents: "none" as const }
      : null;
    switch (t.kind) {
      case "rect":
        return (
          <g key={s.id}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke={t.color} strokeWidth={t.strokeWidth} />
            {selProps && <rect x={t.x - 6} y={t.y - 6} width={t.w + 12} height={t.h + 12} {...selProps} />}
          </g>
        );
      case "ellipse":
        return (
          <g key={s.id}>
            <ellipse cx={t.x + t.w / 2} cy={t.y + t.h / 2} rx={t.w / 2} ry={t.h / 2} fill="none" stroke={t.color} strokeWidth={t.strokeWidth} />
            {selProps && <rect x={t.x - 6} y={t.y - 6} width={t.w + 12} height={t.h + 12} {...selProps} />}
          </g>
        );
      case "arrow": {
        const head = arrowHead(t.x1, t.y1, t.x2, t.y2, Math.max(14, t.strokeWidth * 4));
        return (
          <g key={s.id}>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.color} strokeWidth={t.strokeWidth} strokeLinecap="round" />
            <polygon points={head} fill={t.color} />
            {selProps && (
              <rect x={Math.min(t.x1, t.x2) - 6} y={Math.min(t.y1, t.y2) - 6} width={Math.abs(t.x2 - t.x1) + 12} height={Math.abs(t.y2 - t.y1) + 12} {...selProps} />
            )}
          </g>
        );
      }
      case "text":
        return (
          <g key={s.id}>
            <text x={t.x} y={t.y} fill={t.color} fontSize={t.fontSize} fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700} stroke="rgba(255,255,255,0.85)" strokeWidth={Math.max(1, t.fontSize / 10)} paintOrder="stroke">
              {t.text}
            </text>
            {selProps && (
              <rect x={t.x - 6} y={t.y - t.fontSize - 6} width={Math.max(40, t.text.length * t.fontSize * 0.6) + 12} height={t.fontSize + 18} {...selProps} />
            )}
          </g>
        );
      case "pencil":
        return (
          <g key={s.id}>
            <polyline
              points={t.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke={t.color} strokeWidth={t.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
            />
          </g>
        );
      case "blur":
        return (
          <g key={s.id}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="rgba(0,0,0,0.28)" stroke={t.color} strokeWidth={2} strokeDasharray="6 4" />
            {selProps && <rect x={t.x - 6} y={t.y - 6} width={t.w + 12} height={t.h + 12} {...selProps} />}
          </g>
        );
    }
  };

  const renderDraft = (): React.ReactNode => {
    if (!draft || activeTool === "text") return null;
    if (activeTool === "pencil" && draft.points) {
      return (
        <polyline
          points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}
        />
      );
    }
    if (activeTool === "arrow") {
      const head = arrowHead(draft.start.x, draft.start.y, draft.current.x, draft.current.y, Math.max(14, strokeWidth * 4));
      return (
        <g opacity={0.9}>
          <line x1={draft.start.x} y1={draft.start.y} x2={draft.current.x} y2={draft.current.y} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
          <polygon points={head} fill={color} />
        </g>
      );
    }
    const r = normRect(draft.start, draft.current);
    if (activeTool === "ellipse") {
      return <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} fill="none" stroke={color} strokeWidth={strokeWidth} opacity={0.9} />;
    }
    return (
      <rect
        x={r.x} y={r.y} width={r.w} height={r.h} opacity={0.9}
        fill={activeTool === "blur" ? "rgba(0,0,0,0.28)" : activeTool === "crop" ? "rgba(59,130,246,0.15)" : "none"}
        stroke={activeTool === "crop" ? "#3b82f6" : color} strokeWidth={strokeWidth} strokeDasharray={activeTool === "blur" || activeTool === "crop" ? "6 4" : undefined}
      />
    );
  };

  // Part boundary offsets (stack pixels) for divider ticks.
  const boundaries: number[] = [];
  {
    let y = 0;
    for (const s of sizes) {
      y += s?.h ?? 600;
      boundaries.push(y);
    }
    boundaries.pop();
  }

  const stackWidth = zoom === "fit" ? `min(100%, ${dims.totalW}px)` : `${Math.max(1, Math.round(dims.totalW * zoom))}px`;

  return (
    <div className="overflow-auto rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-sm sm:p-6">
      <div className="flex min-h-[40vh] items-start justify-center rounded-xl bg-[#0a0a0a]/[0.02] p-2 sm:min-h-[60vh] sm:p-8">
        <div className="relative inline-block max-w-none" style={{ width: stackWidth, lineHeight: 0 }}>
          {images.map((url, i) => (
            <img
              key={`${i}-${url.slice(-16)}`}
              src={url}
              alt={`Capture part ${i + 1}`}
              className="block h-auto w-full"
              draggable={false}
              decoding="async"
              onLoad={(e) => {
                const img = e.currentTarget;
                setSizes((prev) => {
                  if (prev[i]?.w === img.naturalWidth && prev[i]?.h === img.naturalHeight) return prev;
                  const next = [...prev];
                  next[i] = { w: img.naturalWidth, h: img.naturalHeight };
                  return next;
                });
              }}
            />
          ))}
          {dims.ready && (
            <svg
              ref={svgRef}
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${dims.totalW} ${dims.totalH}`}
              preserveAspectRatio="none"
              style={{ cursor: toolDef?.cursor ?? "default", lineHeight: "normal" }}
              onMouseDown={onBackgroundDown}
              onMouseMove={onMove}
              onMouseUp={() => {
                finishDraft();
                finishMove();
              }}
              onMouseLeave={() => {
                finishDraft();
                finishMove();
              }}
            >
              {shapes.map((s) => (
                <g
                  key={s.id}
                  onMouseDown={(e) => beginMove(e, s.id)}
                  style={{ cursor: activeTool === "select" ? "move" : undefined }}
                >
                  {renderShape(s)}
                </g>
              ))}
              {renderDraft()}
              {boundaries.map((y) => (
                <line
                  key={y}
                  x1={0}
                  y1={y}
                  x2={dims.totalW}
                  y2={y}
                  stroke="rgba(59,130,246,0.5)"
                  strokeWidth={Math.max(2, dims.totalW / 800)}
                  strokeDasharray="12 8"
                  pointerEvents="none"
                />
              ))}
            </svg>
          )}
          {textAt && dims.ready && (
            <input
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText();
                if (e.key === "Escape") {
                  setTextAt(null);
                  setTextValue("");
                }
                e.stopPropagation();
              }}
              onBlur={commitText}
              placeholder="Type, Enter to place"
              className="absolute z-10 rounded-md border border-[hsl(var(--border))] bg-white px-2 py-1 text-sm shadow-lg outline-none"
              style={{
                left: `${(textAt.x / dims.totalW) * 100}%`,
                top: `${(textAt.y / dims.totalH) * 100}%`,
                color,
                fontSize: 14,
                lineHeight: "normal",
              }}
            />
          )}
        </div>
      </div>
      {selectedId && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={deleteSelected}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
          >
            Delete selected annotation (Del)
          </button>
        </div>
      )}
    </div>
  );
}
