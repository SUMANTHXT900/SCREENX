import * as React from "react";
import { Library, Search, Loader2, ImageOff, Clock } from "lucide-react";
import {
  deleteCapture,
  deleteGroup,
  getCapture,
  getCapturesByGroup,
  listCaptureMeta,
  type CaptureMeta,
} from "@/storage/idb/capturesRepo";
import { buildDownloadFilename } from "@/storage/downloadName";
import { deleteHistoryEntry } from "@/storage/history/activityLog";
import { getEditorUrl, getGroupEditorUrl } from "@/capture";
import { toGroups, type Group } from "./groups";
import CaptureCard from "./components/CaptureCard";

const PAGE_SIZE = 24;

export default function WorkspaceApp(): React.JSX.Element {
  // Metadata only — blobs stay in IndexedDB until Open/Download/Thumbnail.
  // The old code materialized every blob into the list, which is what made
  // large libraries crawl before a single pixel was even painted.
  const [records, setRecords] = React.useState<CaptureMeta[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  // Deferred query: keystrokes stay instant while the grid filters a beat
  // behind on huge libraries instead of blocking the input.
  const deferredQuery = React.useDeferredValue(query);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCaptureMeta(200);
      setRecords(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = React.useMemo(() => toGroups(records), [records]);

  const filtered = React.useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      const f = g.first;
      return (
        (f.sourceTitle ?? "").toLowerCase().includes(q) ||
        (f.sourceUrl ?? "").toLowerCase().includes(q) ||
        f.type.includes(q) ||
        (g.count > 1 && "parts".includes(q))
      );
    });
  }, [groups, deferredQuery]);

  const shown = filtered.slice(0, visibleCount);

  const openGroup = React.useCallback((g: Group<CaptureMeta>) => {
    const url = g.count > 1 && g.first.groupId ? getGroupEditorUrl(g.first.groupId) : getEditorUrl(g.first.id);
    window.open(url, "_blank");
  }, []);

  const downloadBlob = React.useCallback(
    (
      blob: Blob,
      opts: { sourceUrl?: string; type: CaptureMeta["type"]; createdAt: number; partIndex?: number; partTotal?: number }
    ) => {
      const tmp = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = tmp;
        a.download = buildDownloadFilename({ ...opts, ext: "png" });
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(tmp);
          } catch {
            // ignore
          }
        }, 30_000);
      }
    },
    []
  );

  const downloadGroup = React.useCallback(
    (g: Group<CaptureMeta>) => {
      // Blobs fetched on demand — the grid itself holds no full-res data.
      void (async () => {
        try {
          if (g.count === 1) {
            const rec = await getCapture(g.first.id);
            if (!rec) throw new Error("Image no longer in storage.");
            downloadBlob(rec.blob, {
              sourceUrl: rec.sourceUrl,
              type: rec.type,
              createdAt: rec.createdAt,
            });
            return;
          }
          const parts = await getCapturesByGroup(g.key);
          parts.forEach((p, i) => {
            try {
              downloadBlob(p.blob, {
                sourceUrl: p.sourceUrl,
                type: p.type,
                createdAt: p.createdAt,
                partIndex: i + 1,
                partTotal: parts.length,
              });
            } catch {
              // ignore single failures
            }
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [downloadBlob]
  );

  const removeGroup = React.useCallback(async (g: Group<CaptureMeta>) => {
    try {
      if (g.count > 1) await deleteGroup(g.key);
      else await deleteCapture(g.first.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    // Image gone ⇒ its history line goes too (history never throws).
    for (const id of g.ids) {
      try {
        await deleteHistoryEntry(id);
      } catch {
        // ignore — best-effort
      }
    }
    setRecords((prev) => prev.filter((r) => !g.ids.includes(r.id)));
  }, []);

  const totalImages = records.length;

  return (
    <div className="nb-scope min-h-screen bg-[#FFF6E9] font-['Public_Sans',ui-sans-serif,system-ui,sans-serif] text-black antialiased">
      <header className="sticky top-0 z-10 border-b-[3px] border-black bg-[#FFFDF7]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-black text-white shadow-[3px_3px_0_#000]">
              <Library className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div>
              <div className="font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-[17px] font-extrabold tracking-tight">ScreenX — Workspace</div>
              <div className="font-mono text-[11px] text-black/60">
                {loading
                  ? "Loading…"
                  : `${groups.length} ${groups.length === 1 ? "item" : "items"} • ${totalImages} ${totalImages === 1 ? "image" : "images"} • IndexedDB`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
          <a
            href={typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("history.html") : "/history.html"}
            title="Open capture history"
            className="flex items-center gap-1.5 border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
          >
            <Clock className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="hidden sm:inline">History</span>
          </a>
          <label className="flex cursor-text items-center gap-2 border-2 border-black bg-white px-3 py-1.5 text-xs text-black/60 shadow-[2px_2px_0_#000] transition-all duration-100 focus-within:translate-x-[-1px] focus-within:translate-y-[-1px] focus-within:shadow-[3px_3px_0_#000] focus-within:text-black sm:min-w-56">
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Search title, URL, type…"
              className="w-full bg-transparent font-medium text-black outline-none placeholder:text-black/40"
            />
          </label>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading && (
          <div className="flex flex-col items-center justify-center border-[3px] border-black bg-[#FFFDF7] px-8 py-24 text-center shadow-[6px_6px_0_#000]">
            <Loader2 className="h-8 w-8 animate-spin" strokeWidth={2.25} />
            <p className="mt-3 text-sm font-bold">Loading workspace…</p>
          </div>
        )}
        {!loading && error && (
          <div className="border-2 border-black bg-[#F87171] p-6 text-center text-sm font-bold text-black shadow-[4px_4px_0_#000]">{error}</div>
        )}
        {!loading && !error && groups.length === 0 && (
          <div className="border-[3px] border-black bg-[#FFFDF7] p-12 text-center shadow-[6px_6px_0_#000]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-black bg-[#4ADE80]">
              <Library className="h-6 w-6 text-black" strokeWidth={2.25} />
            </div>
            <h1 className="mt-4 font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-xl font-extrabold tracking-tight">No saved screenshots yet</h1>
            <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-black/60">
              Captures persist automatically to IndexedDB. Capture from the popup, then find
              everything here. History stays separate and stores metadata only.
            </p>
          </div>
        )}
        {!loading && !error && groups.length > 0 && filtered.length === 0 && (
          <div className="border-[3px] border-black bg-[#FFFDF7] p-12 text-center shadow-[6px_6px_0_#000]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-black bg-[#FBBF24]">
              <ImageOff className="h-6 w-6 text-black" strokeWidth={2.25} />
            </div>
            <h1 className="mt-4 font-['Bricolage_Grotesque','Public_Sans',sans-serif] text-lg font-extrabold tracking-tight">No matches</h1>
            <p className="mt-2 text-sm font-medium text-black/60">Try a different search.</p>
          </div>
        )}
        {!loading && !error && shown.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((g) => (
                <CaptureCard
                  key={g.key}
                  group={g}
                  onOpen={openGroup}
                  onDownload={downloadGroup}
                  onDelete={removeGroup}
                />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="cursor-pointer border-2 border-black bg-white px-5 py-2 text-sm font-bold text-black shadow-[4px_4px_0_#000] transition-all duration-100 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_#000] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
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
