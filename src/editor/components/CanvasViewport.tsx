/**
 * Canvas viewport — stacked part images + ONE SVG annotation overlay
 * (plan: editor/components). Auto-split parts display as a single tall
 * image; all coordinates are stack pixels (part tops accumulate).
 */
import * as React from "react";
import { TOOLS, type AnnotationTool } from "../tools";
import { useEditorStore, type CropRect, type Point, type Shape } from "../state/useEditorStore";
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
    case "redact":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "arrow":
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case "text":
    case "badge":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "pencil":
    case "highlight":
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    default:
      // Forward-compat: unknown kinds pass through instead of undefined.
      return s;
  }
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const p1 = `${x2 - size * Math.cos(ang - Math.PI / 7)},${y2 - size * Math.sin(ang - Math.PI / 7)}`;
  const p2 = `${x2 - size * Math.cos(ang + Math.PI / 7)},${y2 - size * Math.sin(ang + Math.PI / 7)}`;
  return `${x2},${y2} ${p1} ${p2}`;
}

interface Draft {
  /** Tool active at mousedown — hotkey/tool switches mid-drag must not reclassify the gesture. */
  tool: AnnotationTool;
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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = React.useState<({ w: number; h: number } | null)[]>(() => images.map(() => null));
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [textAt, setTextAt] = React.useState<Point | null>(null);
  const [textValue, setTextValue] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const dragStart = React.useRef<{ x: number; y: number } | null>(null);
  const textAreaRef = React.useRef<HTMLTextAreaElement>(null);
  /**
   * Placement guard: mirrors composer/draft ownership outside React state so
   * the click-backup below can tell "already opened by mousedown" from "fresh
   * click". Shape: {kind, at} — stale after 500ms so a later legit click
   * is never swallowed.
   */
  const lastPlaceRef = React.useRef<{ kind: "text" | "badge"; at: number; x: number; y: number } | null>(null);
  // Active corner/endpoint resize: snapshot + live pointer (committed on up).
  const [resize, setResize] = React.useState<{
    id: string;
    handle: ResizeHandle | "p1" | "p2" | "tse";
    start: Shape;
    origin: Point;
  } | null>(null);
  const [resizeCur, setResizeCur] = React.useState<Point | null>(null);

  // Granular subscriptions: the canvas skips re-renders for store slices it
  // never displays (undo depth, pending-crop edits from other surfaces, …).
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const color = useEditorStore((s) => s.color);
  const strokeWidth = useEditorStore((s) => s.strokeWidth);
  const shapes = useEditorStore((s) => s.shapes);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const pendingCrop = useEditorStore((s) => s.pendingCrop);

  /**
   * Adjustable crop overlay: mirrors store pendingCrop into draggable local
   * state (corner grips + body move, dimmed mask outside). Committed back on
   * mouse-up; Cancel/Esc/Apply clear the store box and the overlay follows.
   */
  const [cropBox, setCropBox] = React.useState<CropRect | null>(null);
  const [cropDrag, setCropDrag] = React.useState<
    { mode: "move" | ResizeHandle; origin: Point; start: CropRect } | null
  >(null);
  React.useEffect(() => {
    setCropBox(pendingCrop ? { ...pendingCrop } : null);
    setCropDrag(null);
  }, [pendingCrop]);

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

  // Text composer lifecycle (see composing flag in the store).
  React.useEffect(() => {
    // An open box belongs to the text tool: switching tools abandons it
    // (committing a stale anchor would misplace the text).
    if (activeTool !== "text") {
      setTextAt(null);
      setTextValue("");
      setEditingId(null);
      useEditorStore.getState().setComposing(false);
      return;
    }
    const st = useEditorStore.getState();
    st.setComposing(textAt !== null);
    if (textAt) textAreaRef.current?.focus();
    return () => {
      useEditorStore.getState().setComposing(false);
    };
  }, [textAt, activeTool]);

  const toolDef = TOOLS.find((t) => t.id === activeTool);

  // Delete key removes the selected shape (not while typing).
  // Escape disarms (hides handles) without losing the outline selection.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const st = useEditorStore.getState();
      // Composer open anywhere: Delete/Backspace belong to potential typing.
      if (st.composing) {
        if (e.key === "Escape") {
          setTextAt(null);
          setTextValue("");
          setEditingId(null);
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && useEditorStore.getState().selectedId) {
        e.preventDefault();
        useEditorStore.getState().deleteSelected();
      }
      // Escape clears selection (+ any unapplied crop); Delete is above.
      if (e.key === "Escape") {
        useEditorStore.getState().select(null);
        // Also drop an unapplied crop box (same key the Cancel button uses).
        useEditorStore.getState().setPendingCrop(null);
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
    if (!dims.ready) {
      return;
    }
    // Focus freeze: a canvas mousedown's DEFAULT action moves browser focus
    // (stealing it from the open text composer → blur → empty commit → the
    // box dies ~3ms after opening). Nothing on this canvas wants native
    // focus, selection, or drag (all disabled), so swallow the default.
    // This is what made single clicks "never open" the box while long
    // presses (no second mousedown) survived.
    e.preventDefault();
    // Universal deselect: only empty-canvas presses arrive here — shape,
    // handle, and crop-grip presses all stop-propagate — so clearing is safe
    // in ANY tool, not just Select.
    select(null);
    if (activeTool === "select") {
      return;
    }
    const p = pt(e);
    if (activeTool === "text") {
      // An open composer wins: clicking elsewhere must not wipe uncommitted text.
      if (textAt) {
        return;
      }
      openComposerRaw(p);
      return;
    }
    if (activeTool === "badge") {
      placeBadgeRaw(p);
      return;
    }
    if (activeTool === "pencil" || activeTool === "highlight") {
      setDraft({ tool: activeTool, start: p, current: p, points: [p] });
      return;
    }
    setDraft({ tool: activeTool, start: p, current: p });
  };

  /**
   * Click backup for click-to-place tools: if a mousedown was swallowed
   * anywhere upstream (overlay quirks, handler races), the click still
   * places. Guarded by lastPlaceRef so a normal mousedown+click pair (the
   * click always follows its mousedown within ~500ms at the same spot)
   * places exactly once — while a genuinely fresh click still goes through.
   */
  const onBackgroundClick = (e: React.MouseEvent) => {
    if (!dims.ready) return;
    if (activeTool !== "text" && activeTool !== "badge") return;
    // Shape clicks bubble here too — only empty canvas places.
    const t = e.target as Element | null;
    if (t && t !== svgRef.current) return;
    const p = pt(e);
    const last = lastPlaceRef.current;
    if (
      last &&
      Date.now() - last.at < 500 &&
      Math.hypot(p.x - last.x, p.y - last.y) < 12
    ) {
      return;
    }
    // Backup path (mousedown was swallowed upstream) — the placement log
    // line this emits is identical, so console presence alone can't tell
    // primary from backup; the absence of a preceding mousedown line can.
    if (activeTool === "text") openComposerRaw(p);
    else placeBadgeRaw(p);
  };

  /** Open the text composer (unguarded — the click backup owns the guard). */
  const openComposerRaw = (p: Point) => {
    lastPlaceRef.current = { kind: "text", at: Date.now(), x: p.x, y: p.y };
    setTextAt(p);
    setTextValue("");
    setEditingId(null);
  };

  /** Place a step badge (unguarded — the click backup owns the guard). */
  const placeBadgeRaw = (p: Point) => {
    // Click-to-place step badge, numbered one past the highest existing
    // badge so deletes/undos never produce duplicates.
    const st = useEditorStore.getState();
    const n = st.shapes.reduce((m, s) => (s.kind === "badge" ? Math.max(m, s.n) : m), 0) + 1;
    const id = st.newId();
    lastPlaceRef.current = { kind: "badge", at: Date.now(), x: p.x, y: p.y };
    st.addShape({
      kind: "badge", id, color: st.color, strokeWidth: st.strokeWidth,
      x: p.x, y: p.y, n, fontSize: st.fontSize,
    });
    st.setTool("select");
    st.select(id);
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
      return;
    }
    if (cropDrag && cropBox) {
      const p = pt(e);
      const dx = p.x - cropDrag.origin.x;
      const dy = p.y - cropDrag.origin.y;
      if (cropDrag.mode === "move") {
        const w = cropDrag.start.w;
        const h = cropDrag.start.h;
        setCropBox({
          ...cropBox,
          x: Math.min(Math.max(0, cropDrag.start.x + dx), Math.max(0, dims.totalW - w)),
          y: Math.min(Math.max(0, cropDrag.start.y + dy), Math.max(0, dims.totalH - h)),
        });
      } else {
        const r = resizeBox(cropDrag.start, cropDrag.mode, p);
        setCropBox({
          ...cropBox,
          x: Math.min(Math.max(0, r.x), dims.totalW - 8),
          y: Math.min(Math.max(0, r.y), dims.totalH - 8),
          w: r.w,
          h: r.h,
        });
      }
    }
  };

  const finishDraft = () => {
    if (!draft) return;
    // Classify by the tool at mousedown, NOT the live activeTool (a hotkey
    // mid-drag must not turn a rect drag into an arrow, etc.).
    const tool = draft.tool;
    const st = useEditorStore.getState();
    const id = st.newId();
    const c = st.color;
    const sw = st.strokeWidth;
    // Discrete placements select the new shape and hand back to Select:
    // empty clicks must deselect in ANY tool, which only works if placement
    // doesn't strand the user in a draw tool. Handles stay click-gated, so
    // nothing pops up uninvited.
    const place = (shape: Shape) => {
      st.addShape(shape);
      st.setTool("select");
      st.select(shape.id);
    };
    if ((tool === "pencil" || tool === "highlight") && draft.points && draft.points.length >= 1) {
      // A bare click (single sample) becomes a dot, not a silent no-op.
      const pts = draft.points.length === 1 ? [draft.points[0]!, draft.points[0]!] : draft.points;
      if (tool === "highlight") {
        place({ kind: "highlight", id, color: c, strokeWidth: sw, points: pts, width: Math.max(sw * 3, 14) });
      } else {
        place({ kind: "pencil", id, color: c, strokeWidth: sw, points: pts });
      }
    } else if (tool === "rect" || tool === "blur" || tool === "redact" || tool === "crop" || tool === "ellipse") {
      const r = normRect(draft.start, draft.current);
      if (r.w >= 8 && r.h >= 8) {
        if (tool === "crop") {
          st.setPendingCrop(r);
          st.select(null);
          st.setTool("select");
        } else if (tool === "ellipse") {
          place({ kind: "ellipse", id, color: c, strokeWidth: sw, fill: st.fillNext ? c : null, ...r });
        } else if (tool === "blur") {
          place({ kind: "blur", id, color: c, strokeWidth: sw, ...r });
        } else if (tool === "redact") {
          place({ kind: "redact", id, color: c, strokeWidth: sw, ...r });
        } else {
          place({ kind: "rect", id, color: c, strokeWidth: sw, fill: st.fillNext ? c : null, ...r });
        }
      } else {
              // ignore
      }
    } else if (tool === "arrow") {
      const dx = draft.current.x - draft.start.x;
      const dy = draft.current.y - draft.start.y;
      if (Math.hypot(dx, dy) >= 10) {
        place({
          kind: "arrow", id, color: c, strokeWidth: sw,
          x1: draft.start.x, y1: draft.start.y, x2: draft.current.x, y2: draft.current.y,
        });
      } else {
              // ignore
      }
    }
    setDraft(null);
  };

  const beginMove = (e: React.MouseEvent, id: string) => {
    // Move works in ANY tool once pressed on a shape: drawing a new shape
    // always starts from empty canvas, never from atop an old one.
    // Stop FIRST: the press must never leak to the background deselect,
    // even when a guard below bails out.
    e.stopPropagation();
    if (!dims.ready) return;
    select(id);
    const p = pt(e);
    dragStart.current = p;
    setDrag({ id, dx: 0, dy: 0, moved: false });
  };

  /** Single click selects (outline + handles); the drag itself moves. */
  const pressShape = (e: React.MouseEvent, id: string) => {
    select(id);
    beginMove(e, id);
  };

  const finishMove = () => {
    if (drag?.moved) {
      const st = useEditorStore.getState();
      // Guard: the shape may have been deleted mid-drag (Del key).
      if (st.shapes.some((s) => s.id === drag.id)) {
        st.commit(st.shapes.map((s) => (s.id === drag.id ? translateShape(s, drag.dx, drag.dy) : s)));
      } else {
              // ignore
      }
    }
    setDrag(null);
    dragStart.current = null;
  };

  const beginResize = (e: React.MouseEvent, id: string, handle: ResizeHandle | "p1" | "p2" | "tse") => {
    // Resize handles only exist on the selected shape (see renderHandles).
    // Stop first (same reasoning as beginMove).
    e.stopPropagation();
    if (!dims.ready) return;
    const st = useEditorStore.getState();
    const target = st.shapes.find((s) => s.id === id);
    if (!target) return;
    select(id);
    setResize({ id, handle, start: target, origin: pt(e) });
    setResizeCur(pt(e));
  };

  /** Live geometry during a resize drag (display only — committed on mouse-up). */
  const resizedGeometry = (s: Shape): Shape => {
    if (!resize || !resizeCur || resize.id !== s.id) return s;
    const { handle, start, origin } = resize;
    if ((handle === "p1" || handle === "p2") && start.kind === "arrow") {
      const next =
        handle === "p1"
          ? { ...start, x1: resizeCur.x, y1: resizeCur.y }
          : { ...start, x2: resizeCur.x, y2: resizeCur.y };
      return next;
    }
    if (
      (start.kind === "rect" || start.kind === "ellipse" || start.kind === "blur" || start.kind === "redact") &&
      (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se")
    ) {
      return { ...start, ...resizeBox(start, handle, resizeCur) };
    }
    if (handle === "tse" && start.kind === "text") {
      // Text "resize" scales the font: drag down-right to grow, up-left to
      // shrink (4px travel per font px, clamped 8–160, committed with undo).
      // Toolbar slider stays the precise path; the handle is the fast one.
      const size = Math.min(160, Math.max(8, Math.round(start.fontSize + (resizeCur.x - origin.x + (resizeCur.y - origin.y)) / 4)));
      return { ...start, fontSize: size };
    }
    return s;
  };

  const beginCropDrag = (e: React.MouseEvent, mode: "move" | ResizeHandle) => {
    if (!cropBox || !dims.ready) return;
    e.stopPropagation();
    setCropDrag({ mode, origin: pt(e), start: { ...cropBox } });
  };

  const finishCropDrag = () => {
    if (!cropDrag || !cropBox) {
      setCropDrag(null);
      return;
    }
    // Commit adjusted box (rounded, min-clamped); stays open for Apply.
    const st = useEditorStore.getState();
    st.setPendingCrop({
      x: Math.round(cropBox.x),
      y: Math.round(cropBox.y),
      w: Math.max(8, Math.round(cropBox.w)),
      h: Math.max(8, Math.round(cropBox.h)),
    });
    setCropDrag(null);
  };

  /**
   * Crop overlay: dimmed mask with a hole over the crop box, white outline,
   * corner grips to resize, drag-the-box to move. Rendered topmost so it
   * reads above shapes; shapes stay visible dimmed underneath.
   */
  const renderCropOverlay = (): React.ReactNode => {
    if (!cropBox || !dims.ready) return null;
    const W = dims.totalW;
    const H = dims.totalH;
    const hs = Math.max(14, Math.min(W, H) / 60);
    const d = `M0,0 H${W} V${H} H0 Z M${cropBox.x},${cropBox.y} h${cropBox.w} v${cropBox.h} h${-cropBox.w} Z`;
    return (
      <g key="crop-overlay">
        <path d={d} fillRule="evenodd" fill="rgba(0,0,0,0.45)" pointerEvents="none" />
        <rect
          x={cropBox.x}
          y={cropBox.y}
          width={cropBox.w}
          height={cropBox.h}
          fill="none"
          stroke="#fff"
          strokeWidth={Math.max(2, W / 800)}
          style={{ cursor: "move" }}
          onMouseDown={(e) => beginCropDrag(e, "move")}
        />
        {boxCorners(cropBox).map((c) => (
          <rect
            key={c.handle}
            x={c.x - hs / 2}
            y={c.y - hs / 2}
            width={hs}
            height={hs}
            fill="#fff"
            stroke="#000"
            strokeWidth={Math.max(2, hs / 7)}
            style={{ cursor: handleCursor(c.handle) }}
            onMouseDown={(e) => beginCropDrag(e, c.handle)}
          />
        ))}
      </g>
    );
  };
  const finishResize = () => {
    if (!resize || !resizeCur) {
      setResize(null);
      setResizeCur(null);
      return;
    }
    const st = useEditorStore.getState();
    // Guard: deleted mid-resize → drop silently instead of resurrecting.
    if (!st.shapes.some((s) => s.id === resize.id)) {
      setResize(null);
      setResizeCur(null);
      return;
    }
    const next = resizedGeometry(resize.start);
    // Drop degenerate arrows (endpoints collapsed); skip no-op commits (a
    // plain click on a handle shouldn't pollute undo history).
    if (next.kind === "arrow" && Math.hypot(next.x2 - next.x1, next.y2 - next.y1) < 10) {
      setResize(null);
      setResizeCur(null);
      return;
    }
    if (next.kind === "text" && resize.start.kind === "text" && next.fontSize === resize.start.fontSize) {
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
        st.setTool("select");
        st.select(editingId);
      } else {
        const id = st.newId();
        st.addShape({
          kind: "text", id, color: st.color, strokeWidth: st.strokeWidth,
          x: textAt.x, y: textAt.y, text: lines, fontSize: st.fontSize,
        });
        st.setTool("select");
        st.select(id);
      }
    } else if (textAt) {
          // ignore
    }
    setTextAt(null);
    setTextValue("");
    setEditingId(null);
  };

  /** Double-click a text shape to edit it in place. */
  const beginEditText = (s: Extract<Shape, { kind: "text" }>) => {
    if (activeTool !== "select" || !dims.ready) return;
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
          </g>
        );
      }
      case "text": {
        const lines = t.text.split("\n");
        const lh = t.fontSize * 1.2;
        return (
          <g key={s.id} onDoubleClick={() => beginEditText(t)}>
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
      case "redact":
        // Opaque blackout: fills solid #000 in preview AND export — unlike
        // blur, nothing shows through. Ever.
        return (
          <g key={s.id}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="#000" stroke="#000" strokeWidth={2} />
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
    // Selection == handles, always (Figma/Canva rule). They clear with the
    // selection itself (empty click / Escape / Delete / tool switch).
    if (s.id !== selectedId || !dims.ready) return null;
    // Handles track the LIVE geometry: the in-progress move offset AND any
    // resize preview — never the stale committed position. (Static handles
    // during a drag were the reported "handles left behind" bug.)
    const moved = drag && drag.id === s.id ? translateShape(s, drag.dx, drag.dy) : s;
    const t = resize && resize.id === s.id && resizeCur ? resizedGeometry(moved) : moved;
    const hs = Math.max(14, Math.min(dims.totalW, dims.totalH) / 60);
    const common = {
      fill: "#fff",
      stroke: "#000",
      strokeWidth: Math.max(2, hs / 7),
    };
    if (t.kind === "rect" || t.kind === "ellipse" || t.kind === "blur" || t.kind === "redact") {
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
    // Text/pencil/highlight/badge get move + select, but no box handles:
    // text sizes via its SE font handle below + the toolbar slider.
    if (t.kind === "text") {
      // Single SE handle at the estimated box corner (same estimate as the
      // selection outline in renderShape): drag to scale the font live.
      const lines = t.text.split("\n");
      const estW = Math.max(40, Math.max(...lines.map((l) => l.length), 1) * t.fontSize * 0.6);
      return (
        <g key={`${s.id}-handles`}>
          <rect
            key="tse"
            x={t.x + estW - hs / 2}
            y={t.y - hs / 2}
            width={hs}
            height={hs}
            fill="#4ADE80"
            stroke="#000"
            strokeWidth={Math.max(2, hs / 7)}
            style={{ cursor: "nwse-resize" }}
            onMouseDown={(e) => beginResize(e, s.id, "tse")}
          />
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
    // Text/pencil/highlight/badge get move + select, but no box handles:
    // text sizes via its SE handle above + the toolbar slider.
    return null;
  };

  // Memoized derivations (rebuilt only when their inputs change — not on
  // every unrelated render such as tool/color/selection changes).
  const draftPointsAttr = React.useMemo(
    () => draft?.points?.map((p) => `${p.x},${p.y}`).join(" ") ?? null,
    [draft]
  );
  const blurOverlays = React.useMemo(
    () =>
      !(dims.ready && shapes.some((s) => s.kind === "blur"))
        ? null
        : shapes.flatMap((s) => {
            const moved = drag && drag.id === s.id ? translateShape(s, drag.dx, drag.dy) : s;
            const live = resize && resize.id === s.id && resizeCur ? resizedGeometry(moved) : moved;
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
          }),
    // resizedGeometry is a per-render closure over resize/resizeCur (both
    // listed) — naming it here would recompute every render and void the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dims, shapes, drag, resize, resizeCur]
  );
  const renderDraft = (): React.ReactNode => {
    if (!draft || draft.tool === "text" || draft.tool === "badge") return null;
    if ((draft.tool === "pencil" || draft.tool === "highlight") && draft.points) {
      const w = draft.tool === "highlight" ? Math.max(strokeWidth * 3, 14) : strokeWidth;
      return (
        <polyline
          points={draftPointsAttr ?? ""}
          fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={draft.tool === "highlight" ? 0.45 : 0.9}
        />
      );
    }
    if (draft.tool === "arrow") {
      const head = arrowHead(draft.start.x, draft.start.y, draft.current.x, draft.current.y, Math.max(14, strokeWidth * 4));
      return (
        <g opacity={0.9}>
          <line x1={draft.start.x} y1={draft.start.y} x2={draft.current.x} y2={draft.current.y} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
          <polygon points={head} fill={color} />
        </g>
      );
    }
    const r = normRect(draft.start, draft.current);
    if (draft.tool === "ellipse") {
      return <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} fill="none" stroke={color} strokeWidth={strokeWidth} opacity={0.9} />;
    }
    if (draft.tool === "redact") {
      return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#000" opacity={0.9} />;
    }
    return (
      <rect
        x={r.x} y={r.y} width={r.w} height={r.h} opacity={0.9}
        fill={draft.tool === "blur" ? "rgba(0,0,0,0.28)" : draft.tool === "crop" ? "rgba(59,130,246,0.15)" : "none"}
        stroke={draft.tool === "crop" ? "#3b82f6" : color} strokeWidth={strokeWidth} strokeDasharray={draft.tool === "blur" || draft.tool === "crop" ? "6 4" : undefined}
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

  /**
   * Wrapper-level deselect: anything that is NOT inside a shape (image
   * padding, gaps) clears the selection in ANY tool. Shape hits are
   * identified structurally (not by fragile target-identity checks), and
   * text inputs are skipped so composer clicks don't deselect mid-type.
   * Right-click on empty canvas additionally reverts to the Select tool.
   */
  const onWrapperDown = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t || t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    if (typeof (t as Element).closest === "function" && (t as Element).closest("[data-sx-shape]")) return;
    // Same focus freeze as the svg handler: padding clicks must not blur an
    // open composer either. (The textarea stop-props its own presses, so its
    // focus path is untouched.)
    e.preventDefault();
    // Clicks inside the svg already ran the svg handler (which stop-props or
    // handles) — only fill the gaps it can't see: padding around the image.
    if (svgRef.current && svgRef.current.contains(t)) return;
    if ((activeTool === "text" || activeTool === "badge") && dims.ready && containerRef.current) {
      // Padding click with a place tool: clamp into the image and place.
      // (Covers any case where the svg itself never saw the mousedown.)
      const r = containerRef.current.getBoundingClientRect();
      const p = {
        x: Math.max(0, Math.min(dims.totalW, ((e.clientX - r.left) / r.width) * dims.totalW)),
        y: Math.max(0, Math.min(dims.totalH, ((e.clientY - r.top) / r.height) * dims.totalH)),
      };
      if (activeTool === "text") openComposerRaw(p);
      else placeBadgeRaw(p);
      return;
    }
    select(null);
  };

  const onWrapperContextMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && typeof (t as Element).closest === "function" && (t as Element).closest("[data-sx-shape]")) return;
    e.preventDefault();
    select(null);
    setTool("select");
  };

  return (
    <div className="overflow-auto border-[3px] border-black bg-[#FFFDF7] p-3 shadow-[6px_6px_0_#000] sm:p-6">
      {/* justify-start + m-auto (NOT justify-center): a centered flex child
          wider than the scrollport overflows symmetrically and its left half
          becomes unreachable by scrolling. Auto margins center small canvases
          and keep zoomed ones fully reachable. select-none: rapid clicks must
          never trigger native text/image selection (blue wash). */}
      <div
        className="flex min-h-[40vh] select-none items-start justify-start border-2 border-black/15 bg-white p-2 sm:min-h-[60vh] sm:p-8"
        onMouseDown={onWrapperDown}
        onContextMenu={onWrapperContextMenu}
      >
        <div ref={containerRef} className="relative m-auto block max-w-none" style={{ width: stackWidth, lineHeight: 0 }}>
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
              onClick={onBackgroundClick}
              onMouseUp={() => {
                finishDraft();
                finishMove();
                finishResize();
                finishCropDrag();
              }}
              onMouseLeave={() => {
                finishDraft();
                finishMove();
                finishResize();
                finishCropDrag();
              }}
            >
              {shapes.map((s) => (
                <g
                  key={s.id}
                  data-sx-shape="1"
                  onMouseDown={(e) => pressShape(e, s.id)}
                  // Pressed shape: outline follows the click; drag moves it.
                  style={{ cursor: "move" }}
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
              {renderCropOverlay()}
            </svg>
          )}
          {/* True blur preview: backdrop-filter over the region blurs exactly
              what the exporter blurs (12px over base pixels). HTML, because
              SVG has no reliable backdrop-filter. Follows live drag AND
              resize — the effect box and its outline are one unit. */}
          {blurOverlays}
          {/* Text composer: ALWAYS mounted while the canvas is ready (hidden
              when closed) — mount timing can therefore never fail an open.
              Visibility is pure state (textAt), never mount/unmount. */}
          {dims.ready && (
            <textarea
              ref={textAreaRef}
              rows={3}
              value={textValue}
              aria-label={editingId ? "Edit annotation text" : "Type annotation text"}
              onChange={(e) => setTextValue(e.target.value)}
              // Belt-and-braces: the composer must never bubble presses to
              // canvas handlers (which would deselect/reset around it).
              onMouseDown={(e) => e.stopPropagation()}
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
                display: textAt ? undefined : "none",
                left: `${((textAt?.x ?? 0) / dims.totalW) * 100}%`,
                top: `${((textAt?.y ?? 0) / dims.totalH) * 100}%`,
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
