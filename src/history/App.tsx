import * as React from "react";
import { Clock, Library, Loader2, Search, Trash2, Monitor, ScrollText, Crop } from "lucide-react";
import { clearHistory, deleteHistoryEntry, listHistory, listTombstones, logHistoryEntry, reconcileHistory, type HistoryEntry } from "@/storage/history/activityLog";
import { listCaptureMeta } from "@/storage/idb/capturesRepo";

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

const PAGE_SIZE = 50;

function hostOf(url: string | undefined): string {
  if (!url) return "unknown host";
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown host";
  }
}

/** Memoized row: filter keystrokes re-render the list shell, not every row. */
const HistoryRow = React.memo(function HistoryRow({
  entry,
  onDelete,
}: {
  entry: HistoryEntry;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const meta = TYPE_META[entry.type] ?? TYPE_META.visible;
  return (
    <li className="flex items-center gap-3 border-b-2 border-black/10 px-4 py-3 last:border-b-0">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center border-2 border-black ${meta.tile}`}>
        <meta.Icon className="h-4 w-4 text-black" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{entry.sourceTitle ?? hostOf(entry.sourceUrl)}</div>
        <div className="truncate font-mono text-[11px] text-black/60">
          {meta.label}
          {entry.partTotal != null && entry.partTotal > 1 ? ` • part ${entry.partIndex}/${entry.partTotal}` : ""} •{" "}
          {hostOf(entry.sourceUrl)}
          {entry.width ? ` • ${entry.width}×${entry.height}` : ""} • id {entry.id.slice(0, 8)}
        </div>
      </div>
      <span className="hidden shrink-0 font-mono text-[11px] text-black/60 sm:inline">
        {new Date(entry.createdAt).toLocaleString()}
      </span>
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        title="Delete this entry"
        aria-label={`Delete history entry ${entry.id.slice(0, 8)}`}
        className="shrink-0 cursor-pointer border-2 border-black bg-white p-1.5 shadow-[2px_2px_0_#000] transition-all duration-100 hover:bg-[#F87171] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </li>
  );
});

export default function HistoryApp(): React.JSX.Element {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Workspace is the source of truth: backfill log lines for images that
        // predate logging (or were missed) and drop orphans — the two views
        // stay in sync by construction. Tombstoned ids (user-deleted) are
        // never backfilled, so deletes stick.
        const [log, records, tombstoned] = await Promise.all([
          listHistory(),
          // Metadata only — history never touches blobs; listing full records
          // here deserialized every image for nothing on large libraries.
          listCaptureMeta(200).catch(() => []),
          listTombstones(),
        ]);
        const { visible, backfill } = reconcileHistory(log, records, tombstoned);
        // Parallel best-effort backfill: sequential awaits made first load
        // crawl when many pre-logging captures needed lines.
        await Promise.allSettled(backfill.map((entry) => logHistoryEntry(entry)));
        if (!cancelled) {
          setEntries(visible);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [query, setQuery] = React.useState("");
  const clear = React.useCallback(async () => {
    try {
      await clearHistory(entries.map((e) => e.id));
      setEntries([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [entries]);
  const removeOne = React.useCallback(async (id: string) => {
    try {
      await deleteHistoryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Deferred filter: typing stays instant while a long list filters behind.
  const deferredQuery = React.useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();
  const filtered = React.useMemo(
    () =>
      q
        ? entries.filter((e) => {
            const typeLabel = TYPE_META[e.type]?.label ?? e.type;
            return (
              typeLabel.toLowerCase().includes(q) ||
              (e.sourceTitle ?? "").toLowerCase().includes(q) ||
              hostOf(e.sourceUrl).toLowerCase().includes(q)
            );
          })
        : entries,
    [entries, q]
  );
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="nb-scope min-h-screen bg-[#FFF6E9] font-['Public_Sans',ui-sans-serif,system-ui,sans-serif] text-black antialiased">
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
            <label className="hidden items-center gap-1.5 border-2 border-black bg-white px-2 py-1 shadow-[2px_2px_0_#000] transition-all duration-100 focus-within:translate-x-[-1px] focus-within:translate-y-[-1px] focus-within:shadow-[3px_3px_0_#000] sm:flex">
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder="Filter title, URL, type…"
                aria-label="Filter history"
                className="w-36 bg-transparent font-mono text-[11px] font-bold text-black outline-none placeholder:text-black/40"
              />
            </label>
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
        {!loading && error && (
          <div className="border-2 border-black bg-[#F87171] p-6 text-center text-sm font-bold text-black shadow-[4px_4px_0_#000]">
            History couldn't load: {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
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
        {!loading && entries.length > 0 && filtered.length === 0 && (
          <div className="border-[3px] border-black bg-[#FFFDF7] p-12 text-center shadow-[6px_6px_0_#000]">
            <h1 className="font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-xl font-extrabold tracking-tight">
              No matches for “{query.trim()}”
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-black/60">
              Try a different title, host, or type (Visible / Full Page / Selected).
            </p>
          </div>
        )}
        {!loading && visible.length > 0 && (
          <>
            <ol className="border-[3px] border-black bg-[#FFFDF7] shadow-[6px_6px_0_#000]">
              {visible.map((e) => (
                <HistoryRow key={e.id} entry={e} onDelete={removeOne} />
              ))}
            </ol>
            {visibleCount < filtered.length && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="cursor-pointer border-2 border-black bg-white px-4 py-2 text-xs font-bold shadow-[3px_3px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                >
                  Show more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
