import { describe, test, expect } from "vitest";import { planFullPagePositions } from "../src/capture/planner/fullPagePlan";
import { planRangePositions, selectionRangeToTargets } from "../src/capture/planner/rangePlan";
import { calculateTotalTimeout } from "../src/capture/planner/adaptiveStep";
import { computeFullPageOcclusion, computeRangeOcclusion } from "../src/capture/planner/occlusion";
import {
  estimateMegapixels,
  fitsInOneCanvas,
  maxPartHeightCss,
  planSegments,
} from "../src/capture/planner/segments";
import {
  ALIGN_MAX_ERROR,
  bandDetail,
  bandMeanError,
  findBestAlignment,
} from "../src/capture/stitch/coordinateMath";
import { projectSlice, safeVerticalBand } from "../src/capture/stitch/coordinateMath";
// Compat barrels keep old import paths working:
import { calculatePositions, calculateRangePositions } from "../src/capture/captureUtils";

describe("unified planner entry points", () => {
  test("planFullPagePositions matches compat re-export", () => {
    expect(planFullPagePositions(50000, 800, 50000, 300, 320, 320)).toEqual(
      calculatePositions(50000, 800, 50000, 300, 320, 320)
    );
  });

  test("planRangePositions matches compat re-export", () => {
    expect(planRangePositions(100, 2500, 800, 5000, 40, 100, 50)).toEqual(
      calculateRangePositions(100, 2500, 800, 5000, 40, 100, 50)
    );
  });

  test("timeouts scale with chunks and clamp", () => {
    expect(calculateTotalTimeout(1)).toBe(15000);
    expect(calculateTotalTimeout(300)).toBeLessThanOrEqual(600000);
  });
});

describe("occlusion helpers", () => {
  test("full-page ignores narrow elements, clamps to 25%", () => {
    const els = [
      { top: -100, bottom: 60, left: 0, right: 1000 },
      { top: -100, bottom: 40, left: 0, right: 100 }, // too narrow for 1000px viewport
    ];
    const occ = computeFullPageOcclusion(els, 1000, 800);
    expect(occ.top).toBe(60);
    expect(occ.bottom).toBe(0);
    const huge = computeFullPageOcclusion(
      [{ top: -500, bottom: 500, left: 0, right: 1000 }],
      1000,
      800
    );
    expect(huge.top).toBeLessThanOrEqual(200); // 25% clamp
  });

  test("range ignores horizontally disjoint elements", () => {
    const els = [{ top: -100, bottom: 60, left: 900, right: 1200 }];
    expect(computeRangeOcclusion(els, 800, 0, 800)).toEqual({ top: 0, bottom: 0 });
    expect(computeRangeOcclusion(els, 800, 800, 1300).top).toBe(60);
  });
});

describe("coordinate math", () => {  test("projectSlice keeps srcH === dstH and maps origins", () => {
    const r = projectSlice({
      sliceDocLeft: 0,
      sliceDocRight: 800,
      sliceDocTop: 100,
      sliceDocBottom: 750,
      vpX: 0,
      vpY: 100,
      targetX: 0,
      targetY: 100,
      bmpWidth: 1000,
      bmpHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 800,
    });
    expect(r).not.toBeNull();
    expect(r!.srcH).toBe(r!.dstH);
    expect(r!.dstY).toBe(0);
  });

  test("safeVerticalBand keeps first chunk top at 0", () => {
    expect(safeVerticalBand(0, 800, 60, 40)).toEqual({ safeTop: 0, safeBottom: 760 });
    expect(safeVerticalBand(740, 800, 60, 40)).toEqual({ safeTop: 800, safeBottom: 1500 });
  });
});

describe("segment planner (auto-split)", () => {
  test("normal pages fit in one canvas", () => {
    expect(fitsInOneCanvas(1707, 8000, 1.5)).toBe(true);
    expect(planSegments(1707, 0, 8000, 1.5)).toHaveLength(1);
  });

  test("the reported 2561x74531 case splits instead of failing", () => {
    // 2561px wide at dpr 1.5 → per-part height ~69k? No: width dominates.
    // Use the chat-app shape: 1707css wide, dpr 1.5, ~50k css tall.
    const segs = planSegments(1707, 0, 49687, 1.5);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.length).toBeLessThanOrEqual(8);
    // Contiguous, gapless coverage:
    expect(segs[0]!.startY).toBe(0);
    expect(segs[segs.length - 1]!.endY).toBe(49687);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.startY).toBe(segs[i - 1]!.endY);
    }
    // Every part fits its own canvas:
    for (const s of segs) {
      expect(fitsInOneCanvas(1707, s.endY - s.startY, 1.5)).toBe(true);
    }
  });

  test("maxPartHeightCss respects all three limits", () => {
    const h = maxPartHeightCss(1707, 1.5);
    expect(h).toBeGreaterThan(0);
    expect(Math.round(h * 1.5)).toBeLessThanOrEqual(65535);
    expect(estimateMegapixels(1707, h, 1.5)).toBeLessThanOrEqual(268.435456);
    expect(h).toBeLessThanOrEqual(65000);
  });

  test("absurd ranges still throw PAGE_TOO_LARGE", () => {
    expect(() => planSegments(1707, 0, 600000, 1.5)).toThrow(/more than the 8-part limit/);
  });

  test("estimateMegapixels matches canvas math", () => {
    expect(estimateMegapixels(2561, 74531, 1)).toBeCloseTo(190.87, 0);
  });
});

describe("engine swappability seams", () => {
  test("capture router dispatches through the registry (override wins)", async () => {
    const { registerCaptureEngine, runCaptureEngine, listCaptureEngines } = await import(
      "../src/capture/engine/registry"
    );
    const stubResult = {
      id: "stub",
      type: "visible",
      dataUrl: "",
      createdAt: 0,
    };
    expect(listCaptureEngines()).toEqual([]);
    registerCaptureEngine("visible", async () => stubResult as never);
    await expect(runCaptureEngine("visible")).resolves.toBe(stubResult);
    await expect(runCaptureEngine("full-page")).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });

  test("stitcher factory is overridable and resettable", async () => {
    const mod = await import("../src/capture/stitch/canvasStitcher");
    const calls: unknown[] = [];
    mod.setStitcherFactory(((opts: unknown) => {
      calls.push(opts);
      return { stitch: async () => ({ blob: new Blob(), width: 1, height: 1, dataUrl: "" }) };
    }) as never);
    const out = await mod.createStitcher({
      chunks: [],
      viewportWidth: 800,
      viewportHeight: 600,
      dpr: 1,
      totalWidth: 800,
      totalHeight: 600,
    }).stitch();
    expect(calls).toHaveLength(1);
    expect(out.width).toBe(1);
    mod.resetStitcherFactory();
    // Default factory builds a real CanvasStitcher (empty chunks → STITCH_FAILED).
    await expect(
      mod.createStitcher({
        chunks: [],
        viewportWidth: 800,
        viewportHeight: 600,
        dpr: 1,
        totalWidth: 800,
        totalHeight: 600,
      }).stitch()
    ).rejects.toMatchObject({ code: "STITCH_FAILED" });
  });
});

describe("seam alignment math", () => {
  function stripe(width: number, height: number, fn: (x: number, y: number) => number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = fn(x, y);
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { data, width, height };
  }

  test("flat bands are untrusted", () => {
    const band = stripe(64, 28, () => 200);
    expect(bandDetail(band.data, band.width, band.height)).toBe(0);
    const region = stripe(64, 300, () => 200);
    const found = findBestAlignment(band, region, 0, 100);
    expect(found.matched).toBe(false);
    expect(found.y).toBe(100);
  });

  test("shifted content is found and corrected", () => {
    // Region: horizontal edge at y=150 (dark above, bright below).
    const region = stripe(64, 300, (_x, y) => (y < 150 ? 20 : 230));
    // Band: same edge at its row 10 → true canvas Y is 140.
    const band = stripe(64, 28, (_x, y) => (y < 10 ? 20 : 230));
    const found = findBestAlignment(band, region, 0, 148);
    expect(found.matched).toBe(true);
    expect(found.y).toBe(140);
    expect(found.error).toBeLessThanOrEqual(ALIGN_MAX_ERROR);
  });

  test("bandMeanError is Infinity outside the region", () => {
    const band = stripe(64, 28, (x) => x);
    const region = stripe(64, 100, (x) => x);
    expect(bandMeanError(band, region, 0, -50)).toBe(Infinity);
    expect(bandMeanError(band, region, 0, 500)).toBe(Infinity);
  });
});

describe("scroll-delta range model", () => {  test("range is scroll + viewport offsets (extend scrolls 5000px)", () => {
    // Box drawn at viewport top 200..600, scrolled 5000px during extend.
    const r = selectionRangeToTargets(200, 400, 0, 5000);
    expect(r.startY).toBe(200);
    expect(r.endY).toBe(5600);
    expect(r.endY - r.startY).toBe(5400);
  });

  test("no container-rect correction: nested offset must NOT be subtracted", () => {
    // Regression test for the left-extra/right-cropped + shifted-up bug:
    // the stitcher samples bitmap row (T − s) showing container row
    // (T − Rt), while the selected content is (S + b − Rt) — so T = S + b
    // is exactly right and any rect subtraction double-counts (off by Rt).
    // Chat thread at rect.top 150, box at viewport rows 8..854, scroll 3000:
    const r = selectionRangeToTargets(8, 846, 3000, 3000);
    expect(r.startY).toBe(3008);
    expect(r.endY).toBe(3854);
  });

  test("handles extending upward (end above start)", () => {
    const r = selectionRangeToTargets(100, 400, 2000, 1000);
    expect(r.startY).toBe(1100);
    expect(r.endY).toBe(2500);
  });
});

describe("checkAdvance (stuck-scroll state machine)", () => {
  test("advancing scroll resets the streak", async () => {
    const { checkAdvance } = await import("../src/capture/engine/types");
    expect(checkAdvance(800, 0, 0)).toEqual({ action: "ok", streak: 0 });
    expect(checkAdvance(800, undefined, 1)).toEqual({ action: "ok", streak: 0 });
  });

  test("first duplicate skips, second stops — never indexes by loop counter", async () => {
    const { checkAdvance } = await import("../src/capture/engine/types");
    // Regression: the loop compared chunks[i-1] by POSITION index, but skipped
    // iterations push nothing, so chunks[i-1] was undefined and reading .y
    // threw "Cannot read properties of undefined (reading 'y')". The check
    // now takes the last PUSHED y explicitly — simulate a skip then compare.
    const pushedY: number[] = [0]; // i=0 pushed
    // i=1 duplicates -> skip (nothing pushed)
    let r = checkAdvance(0, pushedY[pushedY.length - 1], 0);
    expect(r).toEqual({ action: "skip", streak: 1 });
    // i=2 compares against last pushed (0), NOT chunks[1] (undefined)
    r = checkAdvance(0, pushedY[pushedY.length - 1], r.streak);
    expect(r).toEqual({ action: "stop", streak: 2 });
  });
});

describe("snapChunkCoord (top-anchor rule)", () => {
  test("near-origin readings snap so the stitcher keeps top rows", async () => {
    const { snapChunkCoord } = await import("../src/capture/engine/captureLoop");
    expect(snapChunkCoord(0, 0)).toBe(0);
    expect(snapChunkCoord(0, 1)).toBe(0);
    expect(snapChunkCoord(0, 2)).toBe(0);
    expect(snapChunkCoord(0, 3)).toBe(3);
    expect(snapChunkCoord(500, 501)).toBe(501);
  });
});

describe("post-capture handoff (clipboard + download naming)", () => {
  test("copyBlobToClipboard resolves true on success, false on failure/empty", async () => {
    const { copyBlobToClipboard } = await import("../src/capture/clipboard");
    const blob = new Blob(["x"], { type: "image/png" });
    await expect(copyBlobToClipboard(blob, async () => {})).resolves.toBe(true);
    await expect(
      copyBlobToClipboard(blob, async () => {
        throw new Error("denied");
      })
    ).resolves.toBe(false);
    await expect(
      copyBlobToClipboard(new Blob([], { type: "image/png" }), async () => {})
    ).resolves.toBe(false);
  });

  test("copyCaptureToClipboard hands a data URL to the tab, with guards", async () => {
    const { copyCaptureToClipboard, COPY_IMAGE_MAX_CHARS } = await import("../src/capture/clipboard");
    const blob = new Blob(["x"], { type: "image/png" });
    const sent: Array<{ tabId: number; dataUrl: string }> = [];
    const sender = async (tabId: number, dataUrl: string) => {
      sent.push({ tabId, dataUrl });
      return true;
    };
    // Happy path: encodes and sends to the source tab.
    await expect(
      copyCaptureToClipboard("id-1", blob, 42, { encode: async () => "data:image/png;base64,eA==", sender })
    ).resolves.toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ tabId: 42, dataUrl: "data:image/png;base64,eA==" });
    expect(COPY_IMAGE_MAX_CHARS).toBeGreaterThan(1_000_000);
    // Missing blob / tab / failed send -> false, never throws.
    await expect(copyCaptureToClipboard("id-2", undefined, 42, { sender })).resolves.toBe(false);
    await expect(
      copyCaptureToClipboard("id-3", blob, undefined, { sender })
    ).resolves.toBe(false);
    await expect(
      copyCaptureToClipboard("id-4", blob, 42, {
        encode: async () => "data:image/png;base64,eA==",
        sender: async () => false,
      })
    ).resolves.toBe(false);
    // Oversized images skip the message transport (use Download instead).
    let oversizeSent = false;
    await expect(
      copyCaptureToClipboard("id-5", blob, 42, {
        encode: async () => `data:image/png;base64,${"A".repeat(COPY_IMAGE_MAX_CHARS)}`,
        sender: async () => {
          oversizeSent = true;
          return true;
        },
      })
    ).resolves.toBe(false);
    expect(oversizeSent).toBe(false);
  });

  test("encodeForClipboard returns null when unusable, sendCopyImage never throws", async () => {
    const { encodeForClipboard, sendCopyImage } = await import("../src/capture/clipboard");
    const blob = new Blob(["x"], { type: "image/png" });
    await expect(encodeForClipboard(blob, async () => "data:image/png;base64,eA==")).resolves.toBe(
      "data:image/png;base64,eA=="
    );
    await expect(encodeForClipboard(undefined)).resolves.toBeNull();
    await expect(encodeForClipboard(new Blob([]))).resolves.toBeNull();
    await expect(sendCopyImage(42, "data:image/png;base64,eA==", 1000, async () => true)).resolves.toBe(true);
    await expect(
      sendCopyImage(42, "data:image/png;base64,eA==", 1000, async () => {
        throw new Error("denied");
      })
    ).resolves.toBe(false);
  });

  test("downloadFilename stamps names and part suffixes", async () => {
    const { downloadFilename } = await import("../src/background/handlers/downloadHandler");
    const date = new Date(2024, 0, 2, 3, 4, 5);
    expect(downloadFilename(date)).toBe("screenx-20240102-030405.png");
    expect(downloadFilename(date, 2, 3)).toBe("screenx-20240102-030405-part2of3.png");
    expect(downloadFilename(date, undefined, 1)).toBe("screenx-20240102-030405.png");
  });

  test("buildChoiceToast offers Copy only when auto-copy failed", async () => {
    const { buildChoiceToast } = await import("../src/background/handlers/choiceToast");
    const base = { id: "abc", type: "visible" as const };
    const copied = buildChoiceToast(base, true);
    expect(copied.actions.map((a) => a.id)).toEqual(["open-editor", "download"]);
    expect(copied.sticky).toBe(true);
    const failed = buildChoiceToast(base, false);
    expect(failed.actions.map((a) => a.id)).toEqual(["open-editor", "copy", "download"]);
    expect(failed.message).toMatch(/unavailable/);
    const multi = buildChoiceToast({ ...base, groupId: "g", partTotal: 3 }, true);
    expect(multi.title).toMatch(/3 parts/);
    expect(multi.actions[0]).toMatchObject({ captureId: "abc", groupId: "g" });
  });
});
