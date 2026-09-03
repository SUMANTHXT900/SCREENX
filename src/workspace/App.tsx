import { Library, Search } from "lucide-react";

export default function WorkspaceApp(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[#fcfcfc] text-[hsl(var(--foreground))]">
      <header className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[hsl(var(--primary))] text-white">
              <Library className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">ScreenX — Workspace</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                Saved screenshots • IndexedDB in next steps
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] sm:flex">
            <Search className="h-3.5 w-3.5" />
            Search — soon
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))]">
            <Library className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">No saved screenshots yet</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Workspace will persist explicitly saved captures via IndexedDB. History stays separate and
            stores metadata only. Foundation routing via <code className="rounded bg-[hsl(var(--secondary))] px-1 py-0.5 font-mono text-xs">workspace.html</code> is ready.
          </p>
        </div>
      </main>
    </div>
  );
}
