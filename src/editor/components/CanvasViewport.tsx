/**
 * Canvas viewport — stacked part images + ONE SVG annotation overlay
 * (plan: editor/components). Auto-split parts display as a single tall
 * image; all coordinates are stack pixels (part tops accumulate).
 */
import * as React from "react";
import { TOOLS } from "../tools";
import { useEditorStore, type Point, type Shape } from "../state/useEditorStore";
import { boxCorners, handleCursor, pencilBounds, resizeBox, type ResizeHandle } from "./geometry";

export type Zoom = "fit" | number;

function toImageCoords(svg: SVGSVGElement, clientX: number, clientY: number, totalW: number, totalH: number): Point {
  const r = svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(totalW, ((clientX - r.left) / r.width) * totalW)),
    y: Math.max(0, Math.min(totalH, ((clientY - r.top) / r.height) * totalH)),
  };
}

/** Min cursor travel (stack px) between pencil samples — kills jitter, tiny file. */
const PENCIL_MIN_STEP = 3;

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
    case "badge":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "pencil":
    case "highlight":
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
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const dragStart = React.useRef<{ x: number; y: number } | null>(null);
  // Active corner/endpoint resize: snapshot + live pointer (committed on up).
  const [resize, setResize] = React.useState<{
    id: string;
    handle: ResizeHandle | "p1" | "p2";
    start: Shape;
  } | null>(null);
  const [resizeCur, setResizeCur] = React.useState<Point | null>(null);

  const {
    activeTool, color, strokeWidth,
    shapes, selectedId, select,
    deleteSelected,
  } = useEditorStore();

  // New image set → clear transient UI (kept shapes belong to the stack).
  // Sizes are keyed by URL (not index): an App re-render or a crop revert
  // that keeps the same blobs must NOT wipe measurements — cached <img>s
  // never refire onLoad, and lost sizes collapse the stack to 1px wide.
  const urlsRef = React.useRef<string[]>([]);
  React.useEffect(() => {
    setSizes((prev) => {
      const byUrl = new Map<string, { w: number; h: number }>();
      urlsRef.current.forEach((u, i) => {
        const s = prev[i];
        if (s) byUrl.set(u, s);
      });
      return images.map((u) => byUrl.get(u) ?? null);
    });
    urlsRef.current = images;
    setDraft(null);
    setTextAt(null);
    setTextValue("");
    setEditingId(null);
    setDrag(null);
    setResize(null);
    setResizeCur(null);
  }, [images]);

  const recordSize = React.useCallback((i: number, w: number, h: number) => {
    if (!(w > 0 && h > 0)) return;
    setSizes((prev) => {
      if (prev[i]?.w === w && prev[i]?.h === h) return prev;
      const next = [...prev];
      next[i] = { w, h };
      return next;
    });
  }, []);

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
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
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
      setEditingId(null);
      return;
    }
    if (activeTool === "badge") {
      // Click-to-place step badge, auto-numbered by existing badge count.
      const st = useEditorStore.getState();
      const n = st.shapes.filter((s) => s.kind === "badge").length + 1;
      st.addShape({
        kind: "badge", id: st.newId(), color: st.color, strokeWidth: st.strokeWidth,
        x: p.x, y: p.y, n, fontSize: st.fontSize,
      });
      return;
    }
    if (activeTool === "pencil" || activeTool === "highlight") {
      setDraft({ start: p, current: p, points: [p] });
      return;
    }
    setDraft({ start: p, current: p });
  };

  const onMove = (e: React.MouseEvent) => {
    if (!dims.ready) return;
    const p = pt(e);
    if (draft) {
      setDraft((d) => {
        if (!d) return d;
        // Pencil: sample only past a min travel so slow moves don't pile
        // hundreds of identical points (jitter + export bloat).
        if (d.points) {
          const last = d.points[d.points.length - 1]!;
          if (Math.hypot(p.x - last.x, p.y - last.y) < PENCIL_MIN_STEP) return d;
          return { ...d, current: p, points: [...d.points, p] };
        }
        return { ...d, current: p };
      });
      return;
    }
    if (drag && dragStart.current) {
      const s = pt(e);
      setDrag({ ...drag, dx: s.x - dragStart.current.x, dy: s.y - dragStart.current.y, moved: true });
      return;
    }
    if (resize) {
      setResizeCur(pt(e));
    }
  };

  const finishDraft = () => {
    if (!draft) return;
    const st = useEditorStore.getState();
    const id = st.newId();
    const c = st.color;
    const sw = st.strokeWidth;
    if ((activeTool === "pencil" || activeTool === "highlight") && draft.points && draft.points.length >= 1) {
      // A bare click (single sample) becomes a dot, not a silent no-op.
      const pts = draft.points.length === 1 ? [draft.points[0]!, draft.points[0]!] : draft.points;
      if (activeTool === "highlight") {
        st.addShape({ kind: "highlight", id, color: c, strokeWidth: sw, points: pts, width: Math.max(sw * 3, 14) });
      } else {
        st.addShape({ kind: "pencil", id, color: c, strokeWidth: sw, points: pts });
      }
    } else if (activeTool === "rect" || activeTool === "blur" || activeTool === "crop" || activeTool === "ellipse") {
      const r = normRect(draft.start, draft.current);
      if (r.w >= 8 && r.h >= 8) {
        if (activeTool === "crop") {
          st.setPendingCrop(r);
          st.select(null);
        } else if (activeTool === "ellipse") {
          st.addShape({ kind: "ellipse", id, color: c, strokeWidth: sw, fill: st.fillNext ? c : null, ...r });
        } else if (activeTool === "blur") {
          st.addShape({ kind: "blur", id, color: c, strokeWidth: sw, ...r });
        } else {
          st.addShape({ kind: "rect", id, color: c, strokeWidth: sw, fill: st.fillNext ? c : null, ...r });
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

  const beginResize = (e: React.MouseEvent, id: string, handle: ResizeHandle | "p1" | "p2") => {
    if (activeTool !== "select" || !dims.ready) return;
    e.stopPropagation();
    const st = useEditorStore.getState();
    const target = st.shapes.find((s) => s.id === id);
    if (!target) return;
    select(id);
    setResize({ id, handle, start: target });
    setResizeCur(pt(e));
  };

  /** Live geometry during a resize drag (display only — committed on mouse-up). */
  const resizedGeometry = (s: Shape): Shape => {
    if (!resize || !resizeCur || resize.id !== s.id) return s;
    const { handle, start } = resize;
    if ((handle === "p1" || handle === "p2") && start.kind === "arrow") {
      const next =
        handle === "p1"
          ? { ...start, x1: resizeCur.x, y1: resizeCur.y }
          : { ...start, x2: resizeCur.x, y2: resizeCur.y };
      return next;
    }
    if (
      (start.kind === "rect" || start.kind === "ellipse" || start.kind === "blur") &&
      (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se")
    ) {
      return { ...start, ...resizeBox(start, handle, resizeCur) };
    }
    return s;
  };

  const finishResize = () => {
    if (!resize || !resizeCur) {
      setResize(null);
      setResizeCur(null);
      return;
    }
    const st = useEditorStore.getState();
    const next = resizedGeometry(resize.start);
    // Drop degenerate arrows (endpoints collapsed); boxes are min-clamped.
    if (next.kind === "arrow" && Math.hypot(next.x2 - next.x1, next.y2 - next.y1) < 10) {
      setResize(null);
      setResizeCur(null);
      return;
    }
    st.commit(st.shapes.map((s) => (s.id === resize.id ? next : s)));
    setResize(null);
    setResizeCur(null);
  };

  const commitText = () => {
    const raw = textValue.replace(/\s+$/, "");
    if (textAt && raw.trim()) {
      const st = useEditorStore.getState();
      const lines = raw.split("\n").map((l) => l.slice(0, 280)).slice(0, 12).join("\n");
      if (editingId) {
        // Re-commit an existing shape (double-click edit) with undo history.
        st.commit(st.shapes.map((s) => (s.id === editingId && s.kind === "text" ? { ...s, text: lines } : s)));
      } else {
        st.addShape({
          kind: "text", id: st.newId(), color: st.color, strokeWidth: st.strokeWidth,
          x: textAt.x, y: textAt.y, text: lines, fontSize: st.fontSize,
        });
      }
    }
    setTextAt(null);
    setTextValue("");
    setEditingId(null);
  };

  /** Double-click a text shape (select tool) to edit it in place. */
  const beginEditText = (e: React.MouseEvent, s: Extract<Shape, { kind: "text" }>) => {
    if (activeTool !== "select" || !dims.ready) return;
    e.stopPropagation();
    select(s.id);
    setEditingId(s.id);
    setTextAt({ x: s.x, y: s.y });
    setTextValue(s.text);
  };

  const renderShape = (s: Shape): React.ReactNode => {
    const moved = drag && drag.id === s.id ? translateShape(s, drag.dx, drag.dy) : s;
    const t = resizedGeometry(moved);
    const sel = s.id === selectedId;
    const selProps = sel
      ? { stroke: "#3b82f6", strokeWidth: Math.max(2, (s.kind === "highlight" ? s.width : s.strokeWidth) / 2), strokeDasharray: "8 6", fill: "none" as const, pointerEvents: "none" as const }
      : null;
    switch (t.kind) {
      case "rect":
        return (
          <g key={s.id}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={t.fill ?? "none"} stroke={t.color} strokeWidth={t.strokeWidth} />
            {selProps && <rect x={t.x - 6} y={t.y - 6} width={t.w + 12} height={t.h + 12} {...selProps} />}
          </g>
        );
      case "ellipse":
        return (
          <g key={s.id}>
            <ellipse cx={t.x + t.w / 2} cy={t.y + t.h / 2} rx={t.w / 2} ry={t.h / 2} fill={t.fill ?? "none"} stroke={t.color} strokeWidth={t.strokeWidth} />
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
      case "text": {
        const lines = t.text.split("\n");
        const lh = t.fontSize * 1.2;
        return (
          <g key={s.id} onDoubleClick={(e) => beginEditText(e, t)}>
            <text x={t.x} y={t.y} fill={t.color} fontSize={t.fontSize} fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700} stroke="rgba(255,255,255,0.85)" strokeWidth={Math.max(1, t.fontSize / 10)} paintOrder="stroke">
              {lines.map((ln, i) => (
                <tspan key={i} x={t.x} dy={i === 0 ? 0 : lh}>{ln}</tspan>
              ))}
            </text>
            {selProps && (
              <rect x={t.x - 6} y={t.y - t.fontSize - 6} width={Math.max(40, Math.max(...lines.map((l) => l.length), 1) * t.fontSize * 0.6) + 12} height={t.fontSize + (lines.length - 1) * lh + 18} {...selProps} />
            )}
          </g>
        );
      }
      case "pencil": {
        const b = pencilBounds(t.points);
        return (
          <g key={s.id}>
            <polyline
              points={t.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke={t.color} strokeWidth={t.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
            />
            {selProps && <rect x={b.x - 6 - t.strokeWidth} y={b.y - 6 - t.strokeWidth} width={b.w + 12 + t.strokeWidth * 2} height={b.h + 12 + t.strokeWidth * 2} {...selProps} />}
          </g>
        );
      }
      case "highlight": {
        const b = pencilBounds(t.points);
        return (
          <g key={s.id}>
            <polyline
              points={t.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke={t.color} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" opacity={0.45}
            />
            {selProps && <rect x={b.x - 6 - t.width} y={b.y - 6 - t.width} width={b.w + 12 + t.width * 2} height={b.h + 12 + t.width * 2} {...selProps} />}
          </g>
        );
      }
      case "badge": {
        const r = Math.max(14, t.fontSize * 0.72);
        return (
          <g key={s.id}>
            <circle cx={t.x} cy={t.y} r={r} fill={t.color} stroke="#fff" strokeWidth={Math.max(2, r / 7)} />
            <text x={t.x} y={t.y} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={t.fontSize} fontWeight={800} fontFamily="ui-sans-serif, system-ui, sans-serif" pointerEvents="none">
              {t.n}
            </text>
            {selProps && <rect x={t.x - r - 6} y={t.y - r - 6} width={r * 2 + 12} height={r * 2 + 12} {...selProps} />}
          </g>
        );
      }
      case "blur":
        // True WYSIWYG is painted by HTML backdrop-blur overlays below (same
        // 12px radius the exporter uses) — the SVG keeps only the outline.
        return (
          <g key={s.id}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke={t.color} strokeWidth={2} strokeDasharray="6 4" />
            {selProps && <rect x={t.x - 6} y={t.y - 6} width={t.w + 12} height={t.h + 12} {...selProps} />}
          </g>
        );
    }
  };

  /**
   * Resize affordances for the selected shape (select tool only): corner
   * squares on boxes, endpoint dots on arrows. Sized in stack px so they
   * stay grabbable at any zoom; stopPropagation keeps them out of beginMove.
   */
  const renderHandles = (s: Shape): React.ReactNode => {
    if (s.id !== selectedId || activeTool !== "select" || !dims.ready) return null;
    const t = resize && resize.id === s.id && resizeCur ? resizedGeometry(s) : s;
    const hs = Math.max(14, Math.min(dims.totalW, dims.totalH) / 60);
    const common = {
      fill: "#fff",
      stroke: "#000",
      strokeWidth: Math.max(2, hs / 7),
    };
    if (t.kind === "rect" || t.kind === "ellipse" || t.kind === "blur") {
      return (
        <g key={`${s.id}-handles`}>
          {boxCorners(t).map((c) => (
            <rect
              key={c.handle}
              x={c.x - hs / 2}
              y={c.y - hs / 2}
              width={hs}
              height={hs}
              {...common}
              style={{ cursor: handleCursor(c.handle) }}
              onMouseDown={(e) => beginResize(e, s.id, c.handle)}
            />
          ))}
        </g>
      );
    }
    if (t.kind === "arrow") {
      return (
        <g key={`${s.id}-handles`}>
          {(
            [
              { h: "p1" as const, x: t.x1, y: t.y1 },
              { h: "p2" as const, x: t.x2, y: t.y2 },
            ]
          ).map((p) => (
            <circle
              key={p.h}
              cx={p.x}
              cy={p.y}
              r={hs / 2}
              {...common}
              style={{ cursor: handleCursor(p.h) }}
              onMouseDown={(e) => beginResize(e, s.id, p.h)}
            />
          ))}
        </g>
      );
    }
    return null;
  };

  const renderDraft = (): React.ReactNode => {
    if (!draft || activeTool === "text" || activeTool === "badge") return null;
    if ((activeTool === "pencil" || activeTool === "highlight") && draft.points) {
      const w = activeTool === "highlight" ? Math.max(strokeWidth * 3, 14) : strokeWidth;
      return (
        <polyline
          points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={activeTool === "highlight" ? 0.45 : 0.9}
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
    <div className="overflow-auto border-[3px] border-black bg-[#FFFDF7] p-3 shadow-[6px_6px_0_#000] sm:p-6">
      <div className="flex min-h-[40vh] items-start justify-center border-2 border-black/15 bg-white p-2 sm:min-h-[60vh] sm:p-8">
        <div className="relative inline-block max-w-none" style={{ width: stackWidth, lineHeight: 0 }}>
          {images.map((url, i) => (
            <img
              key={`${i}-${url.slice(-16)}`}
              src={url}
              alt={`Capture part ${i + 1}`}
              className="block h-auto w-full"
              draggable={false}
              decoding="async"
              ref={(el) => {
                // Cached images never refire onLoad — recover synchronously.
                if (el && el.complete && el.naturalWidth > 0) recordSize(i, el.naturalWidth, el.naturalHeight);
              }}
              onLoad={(e) => {
                const img = e.currentTarget;
                recordSize(i, img.naturalWidth, img.naturalHeight);
              }}
            />
          ))}
          {dims.ready && (
            <svg              ref={svgRef}
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${dims.totalW} ${dims.totalH}`}
              preserveAspectRatio="none"
              style={{ cursor: toolDef?.cursor ?? "default", lineHeight: "normal" }}
              onMouseDown={onBackgroundDown}
              onMouseMove={onMove}
              onMouseUp={() => {
                finishDraft();
                finishMove();
                finishResize();
              }}
              onMouseLeave={() => {
                finishDraft();
                finishMove();
                finishResize();
              }}
            >
              {shapes.map((s) => (
                <g
                  key={s.id}
                  onMouseDown={(e) => beginMove(e, s.id)}
                  style={{ cursor: activeTool === "select" ? "move" : undefined }}
                >
                  {renderShape(s)}
                  {renderHandles(s)}
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
          {/* True blur preview: backdrop-filter over the region blurs exactly
              what the exporter blurs (12px over base pixels). HTML, because
              SVG has no reliable backdrop-filter. Drag previews included. */}
          {dims.ready &&
            shapes.flatMap((s) => {
              const live = drag && drag.id === s.id ? translateShape(s, drag.dx, drag.dy) : s;
              if (live.kind !== "blur") return [];
              return [
                <div
                  key={live.id}
                  style={{
                    position: "absolute",
                    left: `${(live.x / dims.totalW) * 100}%`,
                    top: `${(live.y / dims.totalH) * 100}%`,
                    width: `${(live.w / dims.totalW) * 100}%`,
                    height: `${(live.h / dims.totalH) * 100}%`,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    pointerEvents: "none",
                  }}
                />,
              ];
            })}
          {textAt && dims.ready && (
            <textarea
              autoFocus
              rows={3}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                // Enter commits, Shift+Enter makes a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                }
                if (e.key === "Escape") {
                  setTextAt(null);
                  setTextValue("");
                  setEditingId(null);
                }
                e.stopPropagation();
              }}
              onBlur={commitText}
              placeholder={editingId ? "Edit text, Enter to apply" : "Type, Enter to place (Shift+Enter newline)"}
              className="absolute z-10 border-2 border-black bg-white px-2 py-1 text-sm font-medium shadow-[4px_4px_0_#000] outline-none"
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
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={deleteSelected}
            className="cursor-pointer border-2 border-black bg-[#F87171] px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
          >
            Delete selected annotation (Del)
          </button>
        </div>
      )}
    </div>
  );
}
