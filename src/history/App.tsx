import * as React from "react";
import { Clock, Library, Loader2, Trash2, Monitor, ScrollText, Crop } from "lucide-react";
import { clearHistory, listHistory, type HistoryEntry } from "@/storage/history/activityLog";

function workspaceUrl(): string {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) return chrome.runtime.getURL("workspace.html");
  } catch {
    // ignore
  }
  return "workspace.html";
}

const TYPE_META = {
  visible: { label: "Visible", Icon: Monitor, tile: "bg-[#4ADE80]" },
  "full-page": { label: "Full Page", Icon: ScrollText, tile: "bg-[#FBBF24]" },
  "selected-area": { label: "Selected", Icon: Crop, tile: "bg-[#60A5FA]" },
} as const;

function hostOf(url: string | undefined): string {
  if (!url) return "unknown host";
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown host";
  }
}

export default function HistoryApp(): React.JSX.Element {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listHistory();
      if (!cancelled) {
        setEntries(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clear = React.useCallback(async () => {
    await clearHistory();
    setEntries([]);
  }, []);

  return (
    <div className="min-h-screen bg-[#FFF6E9] font-['Public_Sans',ui-sans-serif,system-ui,sans-serif] text-black antialiased">
      <header className="sticky top-0 z-10 border-b-[3px] border-black bg-[#FFFDF7]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-black text-white shadow-[3px_3px_0_#000]">
              <Clock className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div>
              <div className="font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-[17px] font-extrabold tracking-tight">
                History
              </div>
              <div className="font-mono text-[11px] text-black/60">
                Activity metadata only · no image blobs
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="border-2 border-black bg-white px-2.5 py-1 font-mono text-[11px] font-bold shadow-[2px_2px_0_#000]">
              {loading ? "…" : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
            </span>
            {!loading && entries.length > 0 && (
              <button
                type="button"
                onClick={() => void clear()}
                className="inline-flex cursor-pointer items-center gap-1.5 border-2 border-black bg-[#F87171] px-2.5 py-1 font-mono text-[11px] font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} /> Clear
              </button>
            )}
            <a
              href={workspaceUrl()}
              className="inline-flex cursor-pointer items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1 font-mono text-[11px] font-bold shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000]"
            >
              <Library className="h-3.5 w-3.5" strokeWidth={2.5} /> Workspace
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading && (
          <div className="flex flex-col items-center justify-center border-[3px] border-black bg-[#FFFDF7] px-8 py-24 text-center shadow-[6px_6px_0_#000]">
            <Loader2 className="h-8 w-8 animate-spin" strokeWidth={2.25} />
            <p className="mt-3 text-sm font-bold">Loading history…</p>
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="border-[3px] border-black bg-[#FFFDF7] p-12 text-center shadow-[6px_6px_0_#000]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-black bg-[#4ADE80]">
              <Clock className="h-6 w-6 text-black" strokeWidth={2.25} />
            </div>
            <h1 className="mt-4 font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-xl font-extrabold tracking-tight">
              No activity yet
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-black/60">
              Capture events (time, type, source tab) are logged here automatically — without
              storing blobs. Separate from Workspace by design.
            </p>
          </div>
        )}
        {!loading && entries.length > 0 && (
          <ol className="border-[3px] border-black bg-[#FFFDF7] shadow-[6px_6px_0_#000]">
            {entries.map((e) => {
              const meta = TYPE_META[e.type] ?? TYPE_META.visible;
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 border-b-2 border-black/10 px-4 py-3 last:border-b-0"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center border-2 border-black ${meta.tile}`}
                  >
                    <meta.Icon className="h-4 w-4 text-black" strokeWidth={2.25} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {e.sourceTitle ?? hostOf(e.sourceUrl)}
                    </div>
                    <div className="truncate font-mono text-[11px] text-black/60">
                      {meta.label}
                      {e.partTotal != null && e.partTotal > 1 ? ` • part ${e.partIndex}/${e.partTotal}` : ""} • {hostOf(e.sourceUrl)}
                      {e.width ? ` • ${e.width}×${e.height}` : ""} • id {e.id.slice(0, 8)}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-black/60">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
