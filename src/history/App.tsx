import * as React from "react";
import { Clock, Loader2, Trash2, Monitor, ScrollText, Crop } from "lucide-react";
import { clearHistory, listHistory, type HistoryEntry } from "@/storage/history/activityLog";

const TYPE_META = {
  visible: { label: "Visible", Icon: Monitor },
  "full-page": { label: "Full Page", Icon: ScrollText },
  "selected-area": { label: "Selected", Icon: Crop },
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
    <div className="min-h-screen bg-[#fcfcfc] text-[hsl(var(--foreground))]">
      <header className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-[hsl(var(--foreground))] ring-1 ring-[hsl(var(--border))]">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">ScreenX — History</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">Activity metadata only • no image blobs</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[hsl(var(--secondary))] px-3 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
              {loading ? "…" : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
            </span>
            {!loading && entries.length > 0 && (
              <button
                type="button"
                onClick={() => void clear()}
                className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs hover:bg-[hsl(var(--secondary))]"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white px-8 py-24 text-center shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--muted-foreground))]" />
            <p className="mt-3 text-sm font-medium">Loading history…</p>
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))]">
              <Clock className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">No activity yet</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              Capture events (time, type, source tab) are logged here automatically — without
              storing blobs. Separate from Workspace by design.
            </p>
          </div>
        )}
        {!loading && entries.length > 0 && (
          <ol className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-sm">
            {entries.map((e, i) => {
              const meta = TYPE_META[e.type] ?? TYPE_META.visible;
              return (
                <li
                  key={e.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i === entries.length - 1 ? "" : "border-b border-[hsl(var(--border))]"}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--secondary))]">
                    <meta.Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {e.sourceTitle ?? hostOf(e.sourceUrl)}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                      {meta.label}
                      {e.partTotal != null && e.partTotal > 1 ? ` • part ${e.partIndex}/${e.partTotal}` : ""} • {hostOf(e.sourceUrl)}
                      {e.width ? ` • ${e.width}×${e.height}` : ""} • id {e.id.slice(0, 8)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
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
