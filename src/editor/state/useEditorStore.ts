/**
 * Editor state — annotation shapes + undo/redo (plan: editor/state via zustand).
 * Coordinates are in natural image pixels.
 */
import { create } from "zustand";
import type { AnnotationTool } from "../tools";

export interface Point {
  x: number;
  y: number;
}

interface ShapeBase {
  id: string;
  color: string;
  strokeWidth: number;
}

export interface RectShape extends ShapeBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Solid fill (color) or null for outline only. */
  fill: string | null;
}

export interface EllipseShape extends ShapeBase {
  kind: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Solid fill (color) or null for outline only. */
  fill: string | null;
}

export interface ArrowShape extends ShapeBase {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextShape extends ShapeBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export interface PencilShape extends ShapeBase {
  kind: "pencil";
  points: Point[];
}

export interface HighlightShape extends ShapeBase {
  kind: "highlight";
  points: Point[];
  /** Rendered stroke width (derived from strokeWidth at creation). */
  width: number;
}

export interface BadgeShape extends ShapeBase {
  kind: "badge";
  x: number;
  y: number;
  /** Step number (auto-incremented at placement). */
  n: number;
  fontSize: number;
}

export interface BlurShape extends ShapeBase {
  kind: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactShape extends ShapeBase {
  /** Opaque blackout — unlike blur, nothing shows through. Ever. */
  kind: "redact";
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Shape = RectShape | EllipseShape | ArrowShape | TextShape | PencilShape | HighlightShape | BadgeShape | BlurShape | RedactShape;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

interface EditorStore {
  activeTool: AnnotationTool;
  color: string;
  strokeWidth: number;
  fontSize: number;
  /** New rects/ellipses start filled with the current color. */
  fillNext: boolean;
  shapes: Shape[];
  past: Shape[][];
  future: Shape[][];
  selectedId: string | null;
  pendingCrop: CropRect | null;
  /**
   * True while the text composer (textarea) is open. Global hotkeys must
   * stand down — otherwise typing letters like R/O/A/T/P hijacks the tools.
   */
  composing: boolean;
  setComposing: (on: boolean) => void;
  setTool: (t: AnnotationTool) => void;
  setColor: (c: string) => void;
  setStrokeWidth: (w: number) => void;
  setFontSize: (s: number) => void;
  setFillNext: (on: boolean) => void;
  select: (id: string | null) => void;
  commit: (next: Shape[]) => void;
  /** Add a fully-formed shape (build id via newId(), colors from the store). */
  addShape: (s: Shape) => void;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  /**
   * Restyle the SELECTED shape (color/stroke/font) WITH undo history.
   * No-op when nothing is selected — callers fall back to the defaults.
   */
  restyleSelected: (patch: Partial<Shape>) => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  setPendingCrop: (c: CropRect | null) => void;
  reset: () => void;
  newId: () => string;
}

const CAP = 100;

export const useEditorStore = create<EditorStore>()((set) => ({
  activeTool: "select",
  color: "#ef4444",
  strokeWidth: 4,
  fontSize: 28,
  fillNext: false,
  shapes: [],
  past: [],
  future: [],
  selectedId: null,
  pendingCrop: null,
  composing: false,
  setComposing: (on) => set({ composing: on }),
  setTool: (t) => set({ activeTool: t, selectedId: null }),
  setColor: (c) => set({ color: c }),
  setStrokeWidth: (w) => set({ strokeWidth: w }),
  setFontSize: (s) => set({ fontSize: s }),
  setFillNext: (on) => set({ fillNext: on }),
  select: (id) => set({ selectedId: id }),
  commit: (next) =>
    set((st) => ({
      shapes: next,
      past: [...st.past.slice(-(CAP - 1)), st.shapes],
      future: [],
    })),
  addShape: (s) =>
    set((st) => ({
      shapes: [...st.shapes, s],
      past: [...st.past.slice(-(CAP - 1)), st.shapes],
      future: [],
      selectedId: s.id,
    })),
  updateShape: (id, patch) =>
    set((st) => ({
      shapes: st.shapes.map((sh) => (sh.id === id ? ({ ...sh, ...patch } as Shape) : sh)),
    })),
  restyleSelected: (patch) =>
    set((st) => {
      if (!st.selectedId) return st;
      if (!st.shapes.some((sh) => sh.id === st.selectedId)) return st;
      return {
        shapes: st.shapes.map((sh) => (sh.id === st.selectedId ? ({ ...sh, ...patch } as Shape) : sh)),
        past: [...st.past.slice(-(CAP - 1)), st.shapes],
        future: [],
      };
    }),
  deleteSelected: () =>
    set((st) => {
      if (!st.selectedId) return st;
      const next = st.shapes.filter((sh) => sh.id !== st.selectedId);
      return {
        shapes: next,
        past: [...st.past.slice(-(CAP - 1)), st.shapes],
        future: [],
        selectedId: null,
      };
    }),
  undo: () =>
    set((st) => {
      if (st.past.length === 0) return st;
      const prev = st.past[st.past.length - 1]!;
      return {
        shapes: prev,
        past: st.past.slice(0, -1),
        future: [st.shapes, ...st.future].slice(0, CAP),
        selectedId: null,
      };
    }),
  redo: () =>
    set((st) => {
      if (st.future.length === 0) return st;
      const [next, ...rest] = st.future;
      return {
        shapes: next!,
        past: [...st.past, st.shapes].slice(-CAP),
        future: rest,
        selectedId: null,
      };
    }),
  setPendingCrop: (c) => set({ pendingCrop: c }),
  reset: () =>
    set({
      shapes: [],
      past: [],
      future: [],
      selectedId: null,
      pendingCrop: null,
      activeTool: "select",
      composing: false,
    }),
  newId: () => uid(),
}));
