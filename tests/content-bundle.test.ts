import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "src", "content");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function readVersion(source: string, label: string): number {
  const match = source.match(/(?:export\s+)?const\s+CONTENT_PROTOCOL_VERSION\s*=\s*(\d+)/);
  expect(match, `${label} must define CONTENT_PROTOCOL_VERSION`).not.toBeNull();
  return Number(match![1]);
}

describe("content bundle stays classic-script safe", () => {
  test("no value imports escape src/content (would code-split content.js)", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(contentDir)) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        const stripped = line.trim();
        if (!stripped.startsWith("import")) return;
        if (stripped.startsWith("import type")) return;
        // Intra-content relative imports bundle inline — fine. Anything
        // reaching outside src/content becomes a shared chunk + `import`.
        const m = stripped.match(/from\s*["']([^"']+)["']/);
        if (!m) return;
        const spec = m[1]!;
        const escapes =
          spec.startsWith("@/") ||
          spec.startsWith("@messaging") ||
          (spec.includes("..") && !spec.startsWith("../scroll") && !spec.startsWith("../dom") &&
            !spec.startsWith("../ui") && !spec.startsWith("../selection") && !spec.startsWith("./"));
        if (escapes) offenders.push(`${file}:${i + 1}: ${stripped}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test("content protocol literal matches the canonical constant", () => {
    const contentIndex = readFileSync(join(contentDir, "index.ts"), "utf-8");
    const events = readFileSync(join(root, "src", "messaging", "events.ts"), "utf-8");
    expect(readVersion(contentIndex, "src/content/index.ts")).toBe(readVersion(events, "src/messaging/events.ts"));
  });
});
