/**
 * Editor tools — annotation tool definitions (plan: editor/tools/).
 */
import {
  ArrowUpRight,
  Circle,
  Crop,
  Droplet,
  EyeOff,
  Hash,
  Highlighter,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from "lucide-react";

export type AnnotationTool =
  | "select"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "pencil"
  | "highlight"
  | "badge"
  | "blur"
  | "redact"
  | "crop";

export interface ToolDef {
  id: AnnotationTool;
  label: string;
  cursor: string;
  Icon: typeof Square;
}

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select / move", cursor: "default", Icon: MousePointer2 },
  { id: "rect", label: "Rectangle", cursor: "crosshair", Icon: Square },
  { id: "ellipse", label: "Ellipse", cursor: "crosshair", Icon: Circle },
  { id: "arrow", label: "Arrow", cursor: "crosshair", Icon: ArrowUpRight },
  { id: "text", label: "Text", cursor: "text", Icon: Type },
  { id: "pencil", label: "Pencil", cursor: "crosshair", Icon: Pencil },
  { id: "highlight", label: "Highlighter", cursor: "crosshair", Icon: Highlighter },
  { id: "badge", label: "Step badge", cursor: "copy", Icon: Hash },
  { id: "blur", label: "Blur", cursor: "crosshair", Icon: Droplet },
  { id: "redact", label: "Redact (opaque)", cursor: "crosshair", Icon: EyeOff },
  { id: "crop", label: "Crop", cursor: "crosshair", Icon: Crop },
];

export const STROKE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#111111", "#ffffff"];
