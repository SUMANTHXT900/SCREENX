import { describe, test, expect } from "vitest";
import { buildDownloadFilename, captureFileBase, hostSlug } from "../src/storage/downloadName";

describe("download filenames", () => {
  test("source + date only, no dashes, no time", () => {
    const name = buildDownloadFilename({
      sourceUrl: "https://github.com/anomalyco/opencode",
      type: "full-page",
      createdAt: new Date(2026, 8, 12, 22, 15, 42).getTime(),
    });
    expect(name).toBe("githubcom_12sep26.png");
  });

  test("part marker kept so split parts stay distinguishable", () => {
    const name = buildDownloadFilename({
      sourceUrl: "https://example.com/x",
      type: "visible",
      createdAt: new Date(2026, 0, 2, 3, 4, 5).getTime(),
      partIndex: 2,
      partTotal: 3,
    });
    expect(name).toBe("examplecom_02jan26_p2of3.png");
  });

  test("missing url falls back to capture", () => {
    const name = buildDownloadFilename({ createdAt: new Date(2026, 0, 2, 3, 4, 5).getTime() });
    expect(name).toBe("capture_02jan26.png");
  });

  test("hostSlug strips everything but letters and digits", () => {
    expect(hostSlug("http://localhost:5173/app")).toBe("localhost");
    expect(hostSlug("https://sub.example.co.uk/p")).toBe("subexamplecouk");
    expect(hostSlug(undefined)).toBe("capture");
    expect(hostSlug("not a url")).toBe("capture");
  });

  test("captureFileBase is ext-less but otherwise identical", () => {
    const base = captureFileBase({
      sourceUrl: "https://github.com/x",
      type: "selected-area",
      createdAt: new Date(2026, 8, 12, 22, 15, 42).getTime(),
    });
    expect(base).toBe("githubcom_12sep26");
  });

  test("custom ext", () => {
    const name = buildDownloadFilename({
      sourceUrl: "https://example.com",
      type: "visible",
      createdAt: new Date(2026, 0, 2, 3, 4, 5).getTime(),
      ext: "jpg",
    });
    expect(name).toBe("examplecom_02jan26.jpg");
  });

  test("hostile ext falls back to png (no traversal)", () => {
    const mk = (ext: string) =>
      buildDownloadFilename({
        sourceUrl: "https://example.com",
        type: "visible",
        createdAt: new Date(2026, 0, 2, 3, 4, 5).getTime(),
        ext,
      });
    expect(mk("../evil")).toBe("examplecom_02jan26.png");
    expect(mk(".jpg")).toBe("examplecom_02jan26.jpg");
    expect(mk("JPEG")).toBe("examplecom_02jan26.jpeg");
    expect(mk("")).toBe("examplecom_02jan26.png");
  });
});
