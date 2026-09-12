import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Directories whose code can execute in the service worker (or is bundled
// into worker-reachable chunks). UI pages (popup/editor/workspace/history)
// have a DOM and may use dynamic import() freely.
const WORKER_DIRS = ["background", "capture", "storage", "messaging", "content", "state", "types", "utils"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("worker code never uses dynamic import()", () => {
  test("no import() expressions in worker-reachable modules", () => {
    // Why: Vite wraps dynamic import() in __vitePreload, whose DOM calls
    // (document/window) throw inside the service worker and mask the real
    // outcome — this silently broke history recording (see finalize.ts).
    const offenders: string[] = [];
    for (const dir of WORKER_DIRS) {
      for (const file of tsFiles(join(root, "src", dir))) {
        const lines = readFileSync(file, "utf-8").split("\n");
        lines.forEach((line, i) => {
          const stripped = line.trim();
          if (stripped.startsWith("//") || stripped.startsWith("*")) return;
          if (/[^.\w]import\s*\(/.test(line)) {
            offenders.push(`${file}:${i + 1}: ${stripped}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
