import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGE_TYPES } from "../src/messaging/events";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("message protocol completeness", () => {
  test("every SCREENX_*/TRIGGER_*/PING_* literal in src is a known MESSAGE_TYPES value", () => {
    // Why: three live message types shipped outside the union, so
    // isExtensionMessage() returned false for real traffic (see report M-6).
    const known = new Set<string>(Object.values(MESSAGE_TYPES));
    const missing = new Map<string, string[]>();
    const lit = /"(SCREENX_[A-Z_]+|TRIGGER_[A-Z_]+|PING_[A-Z_]+)"/g;
    for (const file of tsFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf-8");
      let m: RegExpExecArray | null;
      while ((m = lit.exec(text)) !== null) {
        if (!known.has(m[1]!)) {
          const list = missing.get(m[1]!) ?? [];
          list.push(file);
          missing.set(m[1]!, list);
        }
      }
    }
    expect([...missing.entries()]).toEqual([]);
  });
});
