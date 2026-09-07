/**
 * Workspace gallery card.
 */
import { Download, ExternalLink, Monitor, ScrollText, Crop, Trash2 } from "lucide-react";
import type { CaptureRecord } from "@/storage/idb/capturesRepo";

const TYPE_META = {
  visible: { label: "Visible", Icon: Monitor },
  "full-page": { label: "Full Page", Icon: ScrollText },
  "selected-area": { label: "Selected", Icon: Crop },
} as const;

interface Props {
  record: CaptureRecord;
  objectUrl: string;
  /** >1 when this card covers an auto-split group (cover = first part). */
  partCount?: number;
  onOpen: (id: string) => void;
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function CaptureCard({ record, objectUrl, partCount, onOpen, onDownload, onDelete }: Props): React.JSX.Element {
  const meta = TYPE_META[record.type] ?? TYPE_META.visible;
  const host = (() => {
    try {
      return record.sourceUrl ? new URL(record.sourceUrl).hostname : "unknown host";
    } catch {
      return "unknown host";
    }
  })();

  return (
    <div
      className="group overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-sm transition hover:shadow-md"
      style={{ contentVisibility: "auto", containIntrinsicSize: "320px 260px" }}
    >
      <button
        type="button"
        onClick={() => onOpen(record.id)}
        className="relative block aspect-video w-full cursor-pointer overflow-hidden bg-[#0a0a0a]/[0.04]"
        title={partCount ? `Open all ${partCount} parts in editor` : "Open in editor"}
      >
        <img
          src={objectUrl}
          alt={record.sourceTitle ?? "Screenshot"}
          className="h-full w-full object-cover object-top transition group-hover:scale-[1.01]"
          loading="lazy"
          decoding="async"
        />
        {partCount != null && (
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
            {partCount} parts
          </span>
        )}
      </button>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-[11px] font-medium">
            <meta.Icon className="h-3 w-3" />
            {meta.label}
          </span>
          {record.groupId && record.partTotal != null && record.partTotal > 1 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">
              {record.partIndex}/{record.partTotal}
            </span>
          )}
          <span className="truncate text-xs text-[hsl(var(--muted-foreground))]" title={record.sourceTitle ?? host}>
            {record.sourceTitle ?? host}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
          <span>{new Date(record.createdAt).toLocaleString()}</span>
          <span className="font-mono">{record.width ? `${record.width}×${record.height}` : ""}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpen(record.id)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[hsl(var(--primary))] px-2 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </button>
          <button
            type="button"
            onClick={() => onDownload(record.id)}
            className="inline-flex items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-white p-1.5 hover:bg-[hsl(var(--secondary))]"
            title={partCount != null ? `Download all ${partCount} parts` : "Download PNG"}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(record.id)}
            className="inline-flex items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-white p-1.5 text-red-500 hover:bg-red-50"
            title={partCount != null ? `Delete all ${partCount} parts` : "Delete"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
