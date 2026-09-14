import { describe, test, expect, afterEach } from "vitest";

type MockGlobals = Record<string, unknown>;
const g = globalThis as unknown as MockGlobals;
const ORIG = {
  document: g.document,
  getComputedStyle: g.getComputedStyle,
  window: (g as { window?: unknown }).window,
  HTMLElement: (g as { HTMLElement?: unknown }).HTMLElement,
};
afterEach(() => {
  g.document = ORIG.document;
  g.getComputedStyle = ORIG.getComputedStyle;
  (g as { window?: unknown }).window = ORIG.window;
  (g as { HTMLElement?: unknown }).HTMLElement = ORIG.HTMLElement;
});

describe("adaptive fade-trim regressions", () => {
  // Synthetic pixel buffers: every row a flat red value.
  function flatBuf(
    width: number,
    rows: number[]
  ): { data: Uint8ClampedArray; width: number; height: number } {
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((v, y) => {
      for (let x = 0; x < width; x++) {
        data[(y * width + x) * 4] = v;
      }
    });
    return { data, width, height: rows.length };
  }

  test("fade_none_identicalBuffers_measureZero", async () => {
    const { measureSeamFade } = await import("../src/capture/stitch/coordinateMath");
    const W = 64;
    const rows = new Array(40).fill(200);
    const head = flatBuf(W, rows);
    const canvas = flatBuf(W, rows);
    const f = measureSeamFade(head, canvas, 0, 0, -40, 40, 32);
    expect(f).toEqual({ top: 0, bottom: 0 });
  });

  test("fade_topGradient_measuresDepth", async () => {
    const { measureSeamFade } = await import("../src/capture/stitch/coordinateMath");
    const W = 64;
    // Canvas holds the crisp copy (all 200). Head's first 12 rows are faded (100).
    const head = flatBuf(W, [...new Array(12).fill(100), ...new Array(28).fill(200)]);
    const canvas = flatBuf(W, new Array(80).fill(200));
    const f = measureSeamFade(head, canvas, 0, 20, -20, 60, 32);
    expect(f).not.toBeNull();
    expect(f!.top).toBe(12);
    expect(f!.bottom).toBe(0);
  });

  test("fade_fullProbeDisagreement_untrustedNull", async () => {
    const { measureSeamFade } = await import("../src/capture/stitch/coordinateMath");
    const W = 64;
    const head = flatBuf(W, new Array(40).fill(50));
    const canvas = flatBuf(W, new Array(80).fill(200));
    // Every probed row disagrees: the strips do not really line up.
    expect(measureSeamFade(head, canvas, 0, 20, -20, 60, 32)).toBeNull();
  });

  test("fade_bottomTail_measuresBottom", async () => {
    const { measureSeamFade } = await import("../src/capture/stitch/coordinateMath");
    const W = 64;
    // Prev strip's last 8 rows (canvas rows 52..59) are faded; head matches elsewhere.
    const canvasRows = [...new Array(52).fill(200), ...new Array(8).fill(90), ...new Array(20).fill(200)];
    const head = flatBuf(W, new Array(40).fill(200));
    const canvas = flatBuf(W, canvasRows);
    // matchedY=20 (head row 0 at canvas 20), prev span [-20, 60).
    // The previous tail rows 52..59 map to head rows 32..39.
    const f = measureSeamFade(head, canvas, 0, 20, -20, 60, 32);
    expect(f).not.toBeNull();
    expect(f!.bottom).toBe(8);
    expect(f!.top).toBe(0);
  });

  test("fade_rowMeanAbsDiff_outOfRange_null", async () => {
    const { rowMeanAbsDiff } = await import("../src/capture/stitch/coordinateMath");
    const W = 16;
    const buf = { data: new Uint8ClampedArray(W * 4 * 4), width: W, height: 4 };
    expect(rowMeanAbsDiff(buf, -1, buf, 0)).toBeNull();
    expect(rowMeanAbsDiff(buf, 0, buf, 9)).toBeNull();
    expect(rowMeanAbsDiff(buf, 1, buf, 1)).toBe(0);
  });
});

describe("sticky-hide regressions", () => {
  test("hideBridge_staleContentScript_fallsBackInactive", async () => {
    // No chrome in node: sendToContent throws, so the helper must resolve
    // inactive rather than reject (callers fall back to occlusion trimming).
    const { hideStickyBarsForCapture, restoreStickyBarsForCapture } = await import(
      "../src/capture/client/stickyBars"
    );
    await expect(hideStickyBarsForCapture(undefined)).resolves.toEqual({ active: false, hidden: 0 });
    await expect(hideStickyBarsForCapture(123)).resolves.toEqual({ active: false, hidden: 0 });
    await expect(restoreStickyBarsForCapture(123)).resolves.toBeUndefined();
    await expect(restoreStickyBarsForCapture(undefined)).resolves.toBeUndefined();
  });

  test("hideDom_fixedBarHiddenAndRestored_othersSpared", async () => {
    // Minimal DOM fakes: instanceof HTMLElement must hold under node.
    class FakeStyle {
      props = new Map<string, string>();
      getPropertyValue(k: string): string {
        return this.props.get(k) ?? "";
      }
      getPropertyPriority(): string {
        return "";
      }
      setProperty(k: string, v: string): void {
        this.props.set(k, v);
      }
      removeProperty(k: string): void {
        this.props.delete(k);
      }
    }
    class FakeEl {
      id = "";
      style = new FakeStyle();
      pos = "static";
      rect = { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
      kids: FakeEl[] = [];
      contains(el: unknown): boolean {
        return this.kids.includes(el as FakeEl);
      }
      getBoundingClientRect(): {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
      } {
        return this.rect;
      }
    }
    const bar = new FakeEl();
    bar.pos = "fixed";
    const tall = new FakeEl();
    tall.pos = "fixed";
    tall.rect = { left: 0, top: 0, right: 100, bottom: 900, width: 100, height: 900 };
    const aside = new FakeEl();
    aside.pos = "fixed";
    aside.rect = { left: 900, top: 0, right: 1000, bottom: 40, width: 100, height: 40 };
    const plain = new FakeEl();
    (g as unknown as { HTMLElement: unknown }).HTMLElement = FakeEl;
    g.document = { querySelectorAll: () => [bar, tall, aside, plain] };
    g.getComputedStyle = (el: unknown) => {
      const f = el as FakeEl;
      return { position: f.pos, visibility: "visible", display: "block" };
    };
    (g as unknown as { window: unknown }).window = { innerWidth: 800, innerHeight: 800 };
    try {
      const { hideStickyBars, restoreStickyBars, hiddenStickyCount } = await import(
        "../src/content/dom/stickyHider"
      );
      // Band [0, 800]: bar overlaps, tall is a wrapper (spared), aside is
      // outside the band (spared), plain is static (spared).
      expect(hiddenStickyCount()).toBe(0);
      const n = hideStickyBars(0, 800, null);
      expect(n).toBe(1);
      expect(bar.style.props.get("visibility")).toBe("hidden");
      expect(tall.style.props.has("visibility")).toBe(false);
      expect(aside.style.props.has("visibility")).toBe(false);
      expect(hiddenStickyCount()).toBe(1);
      expect(restoreStickyBars()).toBe(1);
      expect(bar.style.props.has("visibility")).toBe(false);
      expect(hiddenStickyCount()).toBe(0);
    } finally {
      try {
        const mod = await import("../src/content/dom/stickyHider");
        mod.restoreStickyBars();
      } catch {
        // ignore
      }
    }
  });
});
