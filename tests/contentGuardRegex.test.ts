import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Extract the enforce-classic-content regex from vite.config.ts so the test tracks the plugin. */
function pluginRegex(): RegExp {
  const text = readFileSync(join(root, "vite.config.ts"), "utf-8");
  const m = text.match(/if \(\/(.+?)\/\.test\(chunk\.code\)\)/);
  if (!m) throw new Error("enforce-classic-content regex not found in vite.config.ts");
  return new RegExp(m[1]!);
}

describe("classic-content guard regex", () => {
  const cases: Array<[string, boolean]> = [
    ['import{a}from"./x.js";', true], // minified named import
    ['import"./x.js";', true], // side-effect import (the historical gap)
    ['import def from"./x.js";', true], // default import
    ['import*as ns from"./x.js";', true], // namespace import
    [";import{a}from'y';", true],
    ["}import{a}from'y';", true],
    ["const important = 1;", false], // lookalike word
    ["import.meta.url;", false], // metadata access is not a module split
    ["// import { x } from 'y';", false], // comment (leading // breaks the anchor)
  ];
  test.each(cases)("`%s` → flagged=%s", (code, flagged) => {
    expect(pluginRegex().test(code)).toBe(flagged);
  });
});
