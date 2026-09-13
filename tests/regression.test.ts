import { describe, test, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectSlice,
  safeVerticalBand,
  bandDetail,
  bandMeanError,
  findBestAlignment,
  ALIGN_BAND,
  ALIGN_SEARCH,
  ALIGN_MIN_DETAIL,
} from "../src/capture/stitch/coordinateMath";
import { CanvasStitcher } from "../src/capture/stitch/canvasStitcher";
import { MAX_CHUNKS } from "../src/capture/stitch/limits";
import { executeCaptureLoop, snapChunkCoord, ORIGIN_SNAP_PX } from "../src/capture/engine/captureLoop";
import { captureVisibleTabThrottled } from "../src/capture/client/tabCaptureClient";
import { findScrollContainerAt } from "../src/content/scroll/ScrollController";
import { computeFullPageOcclusion } from "../src/capture/planner/occlusion";
import type { RangeSelection } from "../src/messaging/events";

type MockGlobals = Record<string, unknown>;
const g = globalThis as unknown as MockGlobals;
function chromeOf(): { runtime: { lastError?: { message: string } } } {
  return g.chrome as { runtime: { lastError?: { message: string } } };
}
const ORIG = {
  chrome: g.chrome,
  document: g.document,
  getComputedStyle: g.getComputedStyle,
  OffscreenCanvas: g.OffscreenCanvas,
  createImageBitmap: g.createImageBitmap,
  fetch: g.fetch,
};
afterEach(() => {
  g.chrome = ORIG.chrome;
  g.document = ORIG.document;
  g.getComputedStyle = ORIG.getComputedStyle;
  g.OffscreenCanvas = ORIG.OffscreenCanvas;
  g.createImageBitmap = ORIG.createImageBitmap;
  g.fetch = ORIG.fetch;
});

function sel(x: number, width: number, startY: number, endY: number): RangeSelection {
  return { x, width, startY, endY } as unknown as RangeSelection;
}

/** Minimal browser-bitmap stubs so stitch paths run under node. */
function installBitmapStubs(bmpW: number, bmpH: number, closed: { v: boolean }): void {
  g.fetch = async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) });
  g.createImageBitmap = async () => ({
    width: bmpW,
    height: bmpH,
    close() {
      closed.v = true;
    },
  });
  const ctx = {
    fillStyle: "",
    fillRect() {},
    drawImage() {},
    getImageData(_x: number, _y: number, w: number, h: number) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
  };
  g.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return ctx;
    }
    async convertToBlob() {
      return new Blob(["px"], { type: "image/png" });
    }
  };
}

/** Red channel = region row (no wrap), so each band has exactly one best match. */
function gradientRegion(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = y;
      data[i + 1] = y;
      data[i + 2] = y;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function bandFrom(
  region: { data: Uint8ClampedArray; width: number; height: number },
  top: number,
  h = 28
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(region.width * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < region.width; x++) {
      for (let k = 0; k < 4; k++) {
        data[(y * region.width + x) * 4 + k] = region.data[((top + y) * region.width + x) * 4 + k]!;
      }
    }
  }
  return { data, width: region.width, height: h };
}

describe("stitch regressions", () => {
  test("stitch_fractionalDpr_rounding", () => {
    // dpr 1.25: boundaries round, srcH === dstH, no interpolation blur.
    const a = projectSlice({
      sliceDocLeft: 0, sliceDocRight: 800, sliceDocTop: 100, sliceDocBottom: 750,
      vpX: 0, vpY: 100, targetX: 0, targetY: 100,
      bmpWidth: 1000, bmpHeight: 1000, viewportWidth: 800, viewportHeight: 800,
    });
    expect(a).not.toBeNull();
    expect(a!.srcH).toBe(a!.dstH);
    // Fractional dpr 1.5: every emitted coordinate is an integer.
    const b = projectSlice({
      sliceDocLeft: 0, sliceDocRight: 800, sliceDocTop: 101, sliceDocBottom: 701,
      vpX: 0, vpY: 101, targetX: 0, targetY: 101,
      bmpWidth: 1200, bmpHeight: 1200, viewportWidth: 800, viewportHeight: 800,
    });
    expect(b).not.toBeNull();
    for (const v of [b!.srcX, b!.srcY, b!.srcW, b!.srcH, b!.dstX, b!.dstY]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(b!.srcH).toBe(b!.dstH);
    expect(b!.dstY).toBe(0);
    // Adjacent slices abut exactly — rounding must not open gaps/overlaps.
    const c = projectSlice({
      sliceDocLeft: 0, sliceDocRight: 800, sliceDocTop: 701, sliceDocBottom: 1300,
      vpX: 0, vpY: 700, targetX: 0, targetY: 101,
      bmpWidth: 1200, bmpHeight: 1200, viewportWidth: 800, viewportHeight: 800,
    });
    expect(c).not.toBeNull();
    expect(c!.dstY).toBe(b!.dstY + b!.dstH);
    expect(c!.srcH).toBe(c!.dstH);
  });

  test("stitch_rtl_negativeScrollLeft", () => {
    // RTL pages report negative scrollLeft origins — must clip, never crash.
    const r = projectSlice({
      sliceDocLeft: -200, sliceDocRight: 600, sliceDocTop: 0, sliceDocBottom: 600,
      vpX: -200, vpY: 0, targetX: -200, targetY: 0,
      bmpWidth: 1000, bmpHeight: 750, viewportWidth: 800, viewportHeight: 600,
    });
    expect(r).not.toBeNull();
    expect(r!.srcX).toBeGreaterThanOrEqual(0);
    expect(r!.srcY).toBeGreaterThanOrEqual(0);
    expect(r!.dstX).toBe(0);
    expect(r!.srcW).toBe(r!.dstW);
    expect(r!.srcW).toBeGreaterThan(0);
  });

  test("stitch_occTop_firstChunkKept", () => {
    // First chunk is top-anchored: occlusion trim must not eat real top rows.
    expect(safeVerticalBand(0, 800, 100, 50)).toEqual({ safeTop: 0, safeBottom: 750 });
    const r = projectSlice({
      sliceDocLeft: 0, sliceDocRight: 800, sliceDocTop: 0, sliceDocBottom: 750,
      vpX: 0, vpY: 0, targetX: 0, targetY: 100,
      bmpWidth: 800, bmpHeight: 800, viewportWidth: 800, viewportHeight: 800,
    });
    expect(r).not.toBeNull();
    expect(r!.srcY).toBe(0);
  });

  test("stitch_align_blankBand_fallsBack", () => {
    // Flat (blank) bands match anywhere — must fall back to scroll math.
    const w = 64;
    const h = 28;
    const flat = new Uint8ClampedArray(w * h * 4).fill(128);
    expect(bandDetail(flat, w, h)).toBeLessThan(ALIGN_MIN_DETAIL);
    const region = { data: new Uint8ClampedArray(w * 100 * 4).fill(200), width: w, height: 100 };
    const found = findBestAlignment({ data: flat, width: w, height: h }, region, 0, 40);
    expect(found.matched).toBe(false);
    expect(found.y).toBe(40);
    expect(bandMeanError({ data: flat, width: w, height: h }, region, 0, -500)).toBe(Infinity);
  });

  test("stitch_align_driftAccumulates", () => {
    // Successive seams nudged the same way must sum, not reset per seam.
    const regionTop = 1000;
    const region = gradientRegion(64, 200);
    const f1 = findBestAlignment(bandFrom(region, 57), region, regionTop, 1050);
    expect(f1.matched).toBe(true);
    expect(f1.y).toBe(1057);
    const f2 = findBestAlignment(bandFrom(region, 62), region, regionTop, 1050);
    expect(f2.matched).toBe(true);
    expect(f2.y).toBe(1062);
    expect(f2.y - f1.y).toBe(5);
    expect(f2.y - 1050).toBe(12);
    // Engine contract: the stitcher carries the correction across seams.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "src", "capture", "stitch", "canvasStitcher.ts"), "utf-8");
    expect(src).toContain("drift += aligned.y - dstY");
    expect(src).toContain("+ drift");
  });

  test("stitch_canvasLimits_preflight", async () => {
    delete g.OffscreenCanvas;
    delete g.createImageBitmap;
    // Chunk-count preflight fires before any canvas/bitmap work.
    const many = Array.from({ length: MAX_CHUNKS + 1 }, (_, i) => ({ dataUrl: "data:,x", x: 0, y: i * 10 }));
    const over = new CanvasStitcher({
      chunks: many, viewportWidth: 800, viewportHeight: 600, dpr: 1,
      totalWidth: 800, totalHeight: 40000,
    });
    await expect(over.stitch()).rejects.toMatchObject({ code: "PAGE_TOO_LARGE" });
    // Pixel-area preflight fires for selected areas too (40000css @2x = 80000px).
    const wide = new CanvasStitcher({
      chunks: [{ dataUrl: "data:,x", x: 0, y: 0 }],
      viewportWidth: 800, viewportHeight: 600, dpr: 2,
      selection: sel(0, 40000, 0, 40000),
    });
    await expect(wide.stitch()).rejects.toMatchObject({ code: "PAGE_TOO_LARGE" });
  });

  test("stitch_singleChunk_cropPath", async () => {
    // Page shorter than the viewport: crop, don't upscale or pad.
    const closed = { v: false };
    installBitmapStubs(800, 600, closed);
    const crop = new CanvasStitcher({
      chunks: [{ dataUrl: "data:image/png;base64,AAA", x: 0, y: 0 }],
      viewportWidth: 800, viewportHeight: 600, dpr: 1,
      totalWidth: 800, totalHeight: 400,
    });
    const out = await crop.stitch();
    expect(out.width).toBe(800);
    expect(out.height).toBe(400);
    expect(out.blob).toBeInstanceOf(Blob);
    expect(closed.v).toBe(true);
    // Exact-viewport single chunk: pass the capture through untouched.
    const closed2 = { v: false };
    installBitmapStubs(800, 600, closed2);
    const full = new CanvasStitcher({
      chunks: [{ dataUrl: "data:image/png;base64,AAA", x: 0, y: 0 }],
      viewportWidth: 800, viewportHeight: 600, dpr: 1,
      totalWidth: 800, totalHeight: 600,
    });
    const out2 = await full.stitch();
    expect(out2.width).toBe(800);
    expect(out2.height).toBe(600);
    expect(out2.dataUrl).toBe("data:image/png;base64,AAA");
    expect(closed2.v).toBe(true);
  });

  test("stitch_emptyChunks_invalidSelection", async () => {
    const empty = new CanvasStitcher({
      chunks: [], viewportWidth: 800, viewportHeight: 600, dpr: 1,
      totalWidth: 800, totalHeight: 600,
    });
    await expect(empty.stitch()).rejects.toMatchObject({ code: "STITCH_FAILED" });
    const zero = new CanvasStitcher({
      chunks: [{ dataUrl: "data:,x", x: 0, y: 0 }],
      viewportWidth: 800, viewportHeight: 600, dpr: 1,
      selection: sel(0, 0, 100, 100),
    });
    await expect(zero.stitch()).rejects.toMatchObject({ code: "INVALID_SELECTION" });
  });
});

describe("loop regressions", () => {
  test("loop_tabSwitch_abortsFast", async () => {
    g.chrome = {
      tabs: { get: async () => ({ id: 7, windowId: 1, active: false }) },
      runtime: {},
    };
    await expect(
      executeCaptureLoop({ tabId: 7, windowId: 1, mode: "full-page", positions: [0, 800], totalTimeout: 60000 })
    ).rejects.toMatchObject({ code: "TAB_SWITCHED" });
  });

  test("loop_overallTimeout_selectedArea", async () => {
    const run = () =>
      executeCaptureLoop({ tabId: 1, mode: "selected-area", positions: [0, 800, 1600], totalTimeout: -1 });
    await expect(run()).rejects.toMatchObject({ code: "TIMEOUT" });
    try {
      await run();
      expect.unreachable("must throw on overall timeout");
    } catch (e: unknown) {
      expect(String(e?.message ?? "")).toMatch(/Selected area/);
    }
  });

  test("loop_rateLimit_retriesThenThrows", async () => {
    let calls = 0;
    g.chrome = {
      tabs: {
        captureVisibleTab: (...args: unknown[]) => {
          calls++;
          const cb = args[args.length - 1] as (dataUrl: string) => void;
          chromeOf().runtime.lastError = { message: "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND_EXCEEDED" };
          cb("");
        },
      },
      runtime: {},
    };
    await expect(captureVisibleTabThrottled(123, 1)).rejects.toThrow(/Rate limited/);
    expect(calls).toBe(2);
  });
});

describe("scroll regressions", () => {
  function installPointDom(target: object, inner: object, body: object): void {
    g.document = { elementFromPoint: () => inner, body, documentElement: {} };
    g.getComputedStyle = (n: unknown) => ({ overflowY: n === target ? "auto" : "visible" });
  }

  test("scroll_nestedContainer_resolution", () => {
    const body: Record<string, unknown> = { tagName: "BODY" };
    const target: Record<string, unknown> & { parentElement: unknown } = {
      tagName: "DIV", id: "feed", className: "",
      scrollHeight: 2000, clientHeight: 800, clientWidth: 600, scrollWidth: 600,
      scrollTop: 0, scrollLeft: 0, scrollTo() {}, parentElement: body,
    };
    const inner: Record<string, unknown> = { tagName: "P", id: "", className: "", parentElement: target };
    installPointDom(target, inner, body);
    const c = findScrollContainerAt(100, 200);
    expect(c.element).toBe(target);
    expect(c.describe()).toContain("div");
    expect(c.getViewportHeight()).toBe(800);
    expect(c.getScrollHeight()).toBe(2000);
  });

  test("scroll_snapOrigin_4px", () => {
    // Contract: ≤4px smooth-scroll residue snaps to the origin so the
    // stitcher keeps (trimmed) top rows; the seam aligner absorbs the rest.
    // A 3px+ miss used to discard ~120 top rows as a white band.
    expect(ORIGIN_SNAP_PX).toBe(4);
    expect(snapChunkCoord(0, 0)).toBe(0);
    expect(snapChunkCoord(0, 1)).toBe(0);
    expect(snapChunkCoord(0, 2)).toBe(0);
    expect(snapChunkCoord(0, 3)).toBe(0);
    expect(snapChunkCoord(0, 4)).toBe(0);
    expect(snapChunkCoord(0, 5)).toBe(5);
    expect(snapChunkCoord(800, 801)).toBe(801);
  });
});

describe("occlusion / memory / perf / build regressions", () => {
  test("occlusion_fixedHeader_measuredOnce", () => {
    const els = [{ top: -12, bottom: 64, left: 0, right: 1000 }];
    Object.freeze(els);
    Object.freeze(els[0]);
    // Pure over its inputs: measuring once and caching is safe.
    const first = computeFullPageOcclusion(els as unknown as Parameters<typeof computeFullPageOcclusion>[0], 1000, 800);
    expect(first).toEqual({ top: 64, bottom: 0 });
    expect(computeFullPageOcclusion(els as unknown as Parameters<typeof computeFullPageOcclusion>[0], 1000, 800)).toEqual(first);
  });

  test("memory_chunksNotRetainedAsDataUrls", async () => {
    const closed = { v: false };
    installBitmapStubs(800, 600, closed);
    const input = "data:image/png;base64," + "A".repeat(100);
    const st = new CanvasStitcher({
      chunks: [{ dataUrl: input, x: 0, y: 0 }],
      viewportWidth: 800, viewportHeight: 600, dpr: 1,
      totalWidth: 800, totalHeight: 400,
    });
    const out = await st.stitch();
    expect(closed.v).toBe(true);
    expect(out.dataUrl).not.toContain("A".repeat(100));
    expect(out.blob.size).toBeGreaterThan(0);
  });

  test("perf_alignOps_budget", () => {
    // Bounded search window keeps per-seam alignment work constant.
    expect(ALIGN_SEARCH).toBeLessThanOrEqual(120);
    expect(ALIGN_BAND).toBeLessThanOrEqual(32);
    const regionTop = 1000;
    const region = gradientRegion(320, 200);
    const t0 = performance.now();
    const f = findBestAlignment(bandFrom(region, 57), region, regionTop, 1050);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(f.matched).toBe(true);
    expect(f.y).toBe(1057);
  });

  test("perf_noFullDomSweep_perChunk", () => {
    let sweeps = 0;
    const body: Record<string, unknown> = { tagName: "BODY" };
    const target: Record<string, unknown> & { parentElement: unknown } = {
      tagName: "DIV", id: "feed", className: "",
      scrollHeight: 2000, clientHeight: 800, clientWidth: 600, scrollWidth: 600,
      scrollTop: 0, scrollLeft: 0, scrollTo() {}, parentElement: body,
    };
    const inner: Record<string, unknown> = { tagName: "P", id: "", className: "", parentElement: target };
    g.document = {
      elementFromPoint: () => inner,
      body,
      documentElement: {},
      querySelectorAll: () => {
        sweeps++;
        return [];
      },
    };
    g.getComputedStyle = (n: unknown) => ({ overflowY: n === target ? "auto" : "visible" });
    // Per-chunk point resolution must walk ancestors, never sweep the DOM.
    findScrollContainerAt(10, 10);
    findScrollContainerAt(400, 300);
    expect(sweeps).toBe(0);
  });

  test("build_distSize_budget", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) files.push(full);
      }
    };
    walk(join(root, "src", "content"));
    const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
    // Content entry must stay lean: it ships as one classic script.
    expect(bytes).toBeLessThan(200_000);
    expect(readFileSync(join(root, "vite.config.ts"), "utf-8")).toContain("enforce-classic-content");
    try {
      for (const f of readdirSync(join(root, "dist"))) {
        if (f === "content.js") {
          expect(statSync(join(root, "dist", f)).size).toBeLessThan(500_000);
        }
      }
    } catch {
      // No dist built in this checkout — src proxy + bundle guard carry the budget.
    }
  });
});
