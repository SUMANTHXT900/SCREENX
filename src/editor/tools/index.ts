/**
 * Editor tools — annotation tool definitions (plan: editor/tools/).
 */
import {
  ArrowUpRight,
  Circle,
  Crop,
  Droplet,
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
  | "blur"
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
  { id: "blur", label: "Blur / redact", cursor: "crosshair", Icon: Droplet },
  { id: "crop", label: "Crop", cursor: "crosshair", Icon: Crop },
];

export const STROKE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#111111", "#ffffff"];
