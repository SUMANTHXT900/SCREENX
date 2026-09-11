import * as React from "react";
import { Library, Search, Loader2, ImageOff } from "lucide-react";
import {
  deleteCapture,
  deleteGroup,
  listCaptures,
  type CaptureRecord,
} from "@/storage/idb/capturesRepo";
import { getEditorUrl, getGroupEditorUrl } from "@/capture";
import CaptureCard from "./components/CaptureCard";

interface Group {
  key: string;
  first: CaptureRecord;
  count: number;
  ids: string[];
}

function toGroups(records: CaptureRecord[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of records) {
    const key = r.groupId ?? r.id;
    const g = map.get(key);
    if (g) {
      g.ids.push(r.id);
      // Keep earliest-created part first for stable cover + ordering.
      if (r.createdAt < g.first.createdAt) g.first = r;
      g.count += 1;
    } else {
      map.set(key, { key, first: r, count: 1, ids: [r.id] });
    }
  }
  return [...map.values()].sort((a, b) => b.first.createdAt - a.first.createdAt);
}

const PAGE_SIZE = 24;

export default function WorkspaceApp(): React.JSX.Element {
  const [records, setRecords] = React.useState<CaptureRecord[]>([]);
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCaptures(200);
      setRecords(list);
      // Only thumbnail the group cover — full parts load on demand in the editor.
      const covers = new Set(toGroups(list).map((g) => g.first.id));
      setUrls((prev) => {
        for (const u of Object.values(prev)) {
          try {
            URL.revokeObjectURL(u);
          } catch {
            // ignore
          }
        }
        const next: Record<string, string> = {};
        for (const r of list) {
          if (!covers.has(r.id)) continue;
          try {
            next[r.id] = URL.createObjectURL(r.blob);
          } catch {
            // ignore single failures
          }
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    return () => {
      setUrls((prev) => {
        for (const u of Object.values(prev)) {
          try {
            URL.revokeObjectURL(u);
          } catch {
            // ignore
          }
        }
        return {};
      });
    };
  }, [refresh]);

  const groups = React.useMemo(() => toGroups(records), [records]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
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
  }, [groups, query]);

  const shown = filtered.slice(0, visibleCount);

  const openGroup = React.useCallback((g: Group) => {
    const url = g.count > 1 && g.first.groupId ? getGroupEditorUrl(g.first.groupId) : getEditorUrl(g.first.id);
    window.open(url, "_blank");
  }, []);

  const downloadGroup = React.useCallback(
    (g: Group) => {
      // Reuse the cover URL for singles; groups download every part file.
      const downloadOne = (id: string, suffix: string) => {
        const url = urls[id];
        if (!url) return;
        const a = document.createElement("a");
        a.href = url;
        a.download = `screenx-${id.slice(0, 8)}${suffix}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      if (g.count === 1) {
        downloadOne(g.first.id, "");
        return;
      }
      // Parts beyond the cover need blob URLs — fetch records on demand.
      void (async () => {
        const { getCapturesByGroup } = await import("@/storage/idb/capturesRepo");
        try {
          const parts = await getCapturesByGroup(g.key);
          const tmp: string[] = [];
          parts.forEach((p, i) => {
            try {
              const u = URL.createObjectURL(p.blob);
              tmp.push(u);
              const a = document.createElement("a");
              a.href = u;
              a.download = `screenx-${p.id.slice(0, 8)}-part${i + 1}of${parts.length}.png`;
              document.body.appendChild(a);
              a.click();
              a.remove();
            } catch {
              // ignore single failures
            }
          });
          setTimeout(() => {
            for (const u of tmp) {
              try {
                URL.revokeObjectURL(u);
              } catch {
                // ignore
              }
            }
          }, 30_000);
        } catch {
          // fall back to cover only
          downloadOne(g.first.id, "");
        }
      })();
    },
    [urls]
  );

  const removeGroup = React.useCallback(
    async (g: Group) => {
      try {
        if (g.count > 1) await deleteGroup(g.key);
        else await deleteCapture(g.first.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setRecords((prev) => prev.filter((r) => !g.ids.includes(r.id)));
      setUrls((prev) => {
        const next = { ...prev };
        for (const id of g.ids) {
          const u = next[id];
          if (u) {
            try {
              URL.revokeObjectURL(u);
            } catch {
              // ignore
            }
            delete next[id];
          }
        }
        return next;
      });
    },
    []
  );

  const totalImages = records.length;

  return (
    <div className="min-h-screen bg-[#FFF6E9] font-['Public_Sans',ui-sans-serif,system-ui,sans-serif] text-black antialiased">
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
              {shown.map((g) =>
                urls[g.first.id] ? (
                  <CaptureCard
                    key={g.key}
                    record={g.first}
                    objectUrl={urls[g.first.id]!}
                    partCount={g.count > 1 ? g.count : undefined}
                    onOpen={() => openGroup(g)}
                    onDownload={() => downloadGroup(g)}
                    onDelete={() => void removeGroup(g)}
                  />
                ) : null
              )}
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
