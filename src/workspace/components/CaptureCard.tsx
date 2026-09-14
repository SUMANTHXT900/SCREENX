/**
 * Workspace gallery card. Memoized: grid re-renders (search keystrokes,
 * pagination) must not re-render every card — thumbnails cache per record id
 * inside ThumbImg, so re-renders would only churn React, never pixels.
 */
import * as React from "react";
import { Download, ExternalLink, Monitor, ScrollText, Crop, Trash2 } from "lucide-react";
import type { CaptureMeta } from "@/storage/idb/capturesRepo";
import type { Group } from "../groups";
import ThumbImg from "./ThumbImg";

const TYPE_META = {
  visible: { label: "Visible", Icon: Monitor, tile: "bg-[#4ADE80]" },
  "full-page": { label: "Full Page", Icon: ScrollText, tile: "bg-[#FBBF24]" },
  "selected-area": { label: "Selected", Icon: Crop, tile: "bg-[#60A5FA]" },
} as const;

interface Props {
  group: Group<CaptureMeta>;
  /** Stable group-scoped actions — same identities across renders so memo holds. */
  onOpen: (g: Group<CaptureMeta>) => void;
  onDownload: (g: Group<CaptureMeta>) => void;
  onDelete: (g: Group<CaptureMeta>) => void;
}

function CaptureCard({ group, onOpen, onDownload, onDelete }: Props): React.JSX.Element {
  const record = group.first;
  const partCount = group.count > 1 ? group.count : undefined;
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
      className="group border-[3px] border-black bg-[#FFFDF7] shadow-[4px_4px_0_#000]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "320px 260px" }}
    >
      <button
        type="button"
        onClick={() => onOpen(group)}
        className="relative block aspect-video w-full cursor-pointer overflow-hidden border-b-[3px] border-black bg-black/5"
        title={partCount ? `Open all ${partCount} parts in editor` : "Open in editor"}
      >
        <ThumbImg
          recordId={record.id}
          alt={record.sourceTitle ?? "Screenshot"}
          className="h-full w-full object-cover object-top transition-transform duration-100 group-hover:scale-[1.01]"
        />
        {partCount != null && (
          <span className="absolute right-2 top-2 border-2 border-black bg-[#FBBF24] px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">
            {partCount} parts
          </span>
        )}
      </button>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex shrink-0 items-center gap-1 border-2 border-black px-1.5 py-0.5 text-[11px] font-bold text-black ${meta.tile}`}>
            <meta.Icon className="h-3 w-3" strokeWidth={2.5} />
            {meta.label}
          </span>
          {record.groupId && record.partTotal != null && record.partTotal > 1 && (
            <span className="shrink-0 border-2 border-black bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">
              {record.partIndex}/{record.partTotal}
            </span>
          )}
          <span className="truncate text-xs font-bold text-black" title={record.sourceTitle ?? host}>
            {record.sourceTitle ?? host}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-black/60">
          <span>{new Date(record.createdAt).toLocaleString()}</span>
          <span>{record.width ? `${record.width}×${record.height}` : ""}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(group)}
            className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1 border-2 border-black bg-black px-2 py-1.5 text-xs font-bold text-white shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_#000] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
          >
            <ExternalLink className="h-3 w-3" strokeWidth={2.5} /> Open
          </button>
          <button
            type="button"
            onClick={() => onDownload(group)}
            className="inline-flex cursor-pointer items-center justify-center border-2 border-black bg-white p-1.5 text-black shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:bg-[#60A5FA] hover:shadow-[4px_4px_0_#000] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
            title={partCount != null ? `Download all ${partCount} parts` : "Download PNG"}
            aria-label={partCount != null ? `Download all ${partCount} parts` : "Download screenshot"}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => void onDelete(group)}
            className="inline-flex cursor-pointer items-center justify-center border-2 border-black bg-[#F87171] p-1.5 text-black shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_#000] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
            title={partCount != null ? `Delete all ${partCount} parts` : "Delete"}
            aria-label={partCount != null ? `Delete all ${partCount} parts` : "Delete screenshot"}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(CaptureCard);
