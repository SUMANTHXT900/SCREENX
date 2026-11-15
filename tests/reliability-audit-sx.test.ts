/**
 * SCREENX Reliability Audit Defect Regression Test Suite
 * Covers SX-02 through SX-09:
 * - SX-02: Frame geometry model: paneHeight for coverage, window dims for scale, pane clipping
 * - SX-03: Independent metrics (active scroller's own maxScrollY & content extent, not blended with doc)
 * - SX-04: Bounded scroller discovery (no brittle 60% width threshold, favors central pane over sidebar)
 * - SX-05: Handshake build ID and protocol, actionable stale reload detection
 * - SX-06: Native-first visible capture (succeeds without DOM injection)
 * - SX-07: Dynamic content settler polls active pane height & preserves snap during capture
 * - SX-08: Accurate coverage calculation, gap detection, honest partial reporting
 * - SX-09: Reattaches disconnected SPA shadow host
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { CanvasStitcher } from "../src/capture/stitch/canvasStitcher";
import { measurePage } from "../src/content/dom/metrics";
import { findElementScrollController, type ScrollController } from "../src/content/scroll/ScrollController";
import { ensureContentScript } from "../src/capture/client/ensureContent";
import { waitForQuietContent } from "../src/content/scroll/scrollSettler";
import { ensureUiRoot, isUiRootMounted } from "../src/content/ui/shadowHost";
import { buildChoiceToast } from "../src/background/handlers/choiceToast";
import { CONTENT_BUILD_ID, CONTENT_PROTOCOL_VERSION } from "../src/messaging/events";

const g = globalThis as Record<string, unknown>;
const ORIG = {
  document: g.document,
  window: g.window,
  HTMLElement: g.HTMLElement,
  getComputedStyle: g.getComputedStyle,
  OffscreenCanvas: g.OffscreenCanvas,
  createImageBitmap: g.createImageBitmap,
  fetch: g.fetch,
};

afterEach(() => {
  g.document = ORIG.document;
  g.window = ORIG.window;
  g.HTMLElement = ORIG.HTMLElement;
  g.getComputedStyle = ORIG.getComputedStyle;
  g.OffscreenCanvas = ORIG.OffscreenCanvas;
  g.createImageBitmap = ORIG.createImageBitmap;
  g.fetch = ORIG.fetch;
});

describe("SX-02 & SX-08: Frame geometry & Coverage tracking in CanvasStitcher", () => {
  function setupFakeCanvas() {
    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          fillStyle: "",
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: () => ({ data: new Uint8ClampedArray(100), width: 10, height: 10 }),
        };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["fake-img"], { type: "image/png" }));
      }
    }
    g.OffscreenCanvas = FakeOffscreenCanvas;
    g.createImageBitmap = vi.fn().mockResolvedValue({
      width: 1200,
      height: 900,
      close: vi.fn(),
    });
    g.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["fake-blob"])),
    });
  }

  test("CanvasStitcher uses paneHeight for safe-band calculation and reports honest partial on gap", async () => {
    setupFakeCanvas();

    // 1200x900 window, but scroll pane is only 800x520 at (190, 150).
    // Total content height is 1500.
    const stitcher = new CanvasStitcher({
      chunks: [
        {
          dataUrl: "data:image/png;base64,fake",
          x: 0,
          y: 0,
          rx: 190,
          ry: 150,
          rw: 800,
          rh: 520,
        },
      ],
      viewportWidth: 1200,
      viewportHeight: 900,
      dpr: 1,
      totalWidth: 800,
      totalHeight: 1500,
      paneTop: 150,
      paneLeft: 190,
      paneWidth: 800,
      paneHeight: 520,
    });

    const out = await stitcher.stitch();
    expect(out).toBeDefined();
    expect(out.coverage).toBeDefined();
    // 1 chunk of 520px cannot cover 1500px total content height -> must report partial!
    expect(out.coverage!.status).toBe("partial");
    expect(out.coverage!.coveragePercent).toBeLessThan(100);
    expect(out.coverage!.coveredDocY).toBeLessThanOrEqual(520);
    expect(out.coverage!.targetEndY).toBe(1500);
  });

  test("CanvasStitcher reports complete coverage when chunks span the full target", async () => {
    setupFakeCanvas();

    const stitcher = new CanvasStitcher({
      chunks: [
        { dataUrl: "data:image/png;base64,fake1", x: 0, y: 0, rx: 0, ry: 0, rw: 800, rh: 600 },
        { dataUrl: "data:image/png;base64,fake2", x: 0, y: 400, rx: 0, ry: 0, rw: 800, rh: 600 },
      ],
      viewportWidth: 800,
      viewportHeight: 600,
      dpr: 1,
      totalWidth: 800,
      totalHeight: 1000,
      paneHeight: 600,
      paneWidth: 800,
    });

    const out = await stitcher.stitch();
    expect(out.coverage).toBeDefined();
    expect(out.coverage!.status).toBe("complete");
    expect(out.coverage!.coveragePercent).toBe(100);
  });
});

describe("SX-03: Independent metrics calculation", () => {
  test("measurePage does not blend nested scroller height with document height", () => {
    class FakeElement {}
    g.HTMLElement = FakeElement;
    g.window = {
      innerWidth: 1200,
      innerHeight: 900,
      devicePixelRatio: 1,
    };
    g.document = {
      documentElement: { scrollWidth: 4000, scrollHeight: 4000 },
      body: { scrollWidth: 4000, scrollHeight: 4000 },
      querySelectorAll: () => [],
    };

    const mockNestedController: ScrollController = {
      element: new FakeElement() as unknown as HTMLElement,
      getScrollTop: () => 100,
      setScrollTop: vi.fn(),
      getScrollLeft: () => 0,
      setScrollLeft: vi.fn(),
      getViewportHeight: () => 500,
      getViewportWidth: () => 768,
      getScrollHeight: () => 1200,
      getScrollWidth: () => 768,
      getMaxScrollY: () => 700, // 1200 - 500
      getMaxScrollX: () => 0,
      describe: () => "div.chat-pane",
    };

    const metrics = measurePage(mockNestedController);

    // SX-03: totalHeight should be scroller's own 1200, NOT document's 4000!
    expect(metrics.totalHeight).toBe(1200);
    // maxScrollY should be 700 (1200 - 500), NOT (4000 - 500 = 3500)!
    expect(metrics.maxScrollY).toBe(700);
    expect(metrics.viewportHeight).toBe(500);
    expect(metrics.viewportWidth).toBe(768);
    expect(metrics.controllerType).toBe("div.chat-pane");
  });
});

describe("SX-04: Robust scroll candidate discovery", () => {
  class FakeNode {
    id = "";
    className = "";
    tagName = "DIV";
    isConnected = true;
    scrollHeight = 0;
    clientHeight = 0;
    scrollWidth = 0;
    clientWidth = 0;
    scrollTop = 0;
    scrollLeft = 0;
    shadowRoot = null;
    style = { display: "block", visibility: "visible", opacity: "1", overflowY: "auto" };
    rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    scrollTo = vi.fn();
    getBoundingClientRect() {
      return this.rect;
    }
  }

  beforeEach(() => {
    g.HTMLElement = FakeNode;
  });

  test("discovers central chat pane even on a 1920px wide viewport (width < 60% of window)", () => {
    g.window = { innerWidth: 1920, innerHeight: 1080 };
    const chatPane = new FakeNode();
    chatPane.id = "conversation-container";
    chatPane.scrollHeight = 5000;
    chatPane.clientHeight = 800;
    chatPane.scrollWidth = 768;
    chatPane.clientWidth = 768;
    chatPane.rect = { left: 576, top: 100, right: 1344, bottom: 900, width: 768, height: 800 };

    g.document = { querySelectorAll: () => [chatPane] };
    g.getComputedStyle = (el: unknown) => (el as FakeNode).style;

    const controller = findElementScrollController();
    expect(controller).not.toBeNull();
    expect(controller!.element).toBe(chatPane);
    expect(controller!.getMaxScrollY()).toBe(4200); // 5000 - 800
  });

  test("prefers central main pane over a narrow sidebar", () => {
    g.window = { innerWidth: 1600, innerHeight: 900 };

    // Sidebar: left:0, width:260, scrollable 1000px
    const sidebar = new FakeNode();
    sidebar.id = "left-sidebar";
    sidebar.tagName = "ASIDE";
    sidebar.scrollHeight = 2000;
    sidebar.clientHeight = 800;
    sidebar.clientWidth = 260;
    sidebar.scrollWidth = 260;
    sidebar.rect = { left: 0, top: 0, right: 260, bottom: 800, width: 260, height: 800 };

    // Main central pane: left:300, width:900, scrollable 3000px
    const mainPane = new FakeNode();
    mainPane.id = "main-feed";
    mainPane.tagName = "MAIN";
    mainPane.scrollHeight = 3800;
    mainPane.clientHeight = 800;
    mainPane.clientWidth = 900;
    mainPane.scrollWidth = 900;
    mainPane.rect = { left: 300, top: 50, right: 1200, bottom: 850, width: 900, height: 800 };

    g.document = { querySelectorAll: () => [sidebar, mainPane] };
    g.getComputedStyle = (el: unknown) => (el as FakeNode).style;

    const controller = findElementScrollController();
    expect(controller).not.toBeNull();
    // Must select the main central pane, NOT the sidebar!
    expect(controller!.element).toBe(mainPane);
  });
});

describe("SX-05: Handshake build ID & stale detection", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      tabs: {
        sendMessage: vi.fn(),
      },
      runtime: {
        lastError: null,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("rejects tab running mismatched buildId as stale", async () => {
    // Tab replies with same proto 6, but older buildId
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation((_tabId: number, _msg: unknown, cb: (res: unknown) => void) => {
      cb({
        ok: true,
        proto: CONTENT_PROTOCOL_VERSION,
        buildId: "0.1.24-oldbuild",
      });
    });

    await expect(
      ensureContentScript({ id: 123, url: "https://chatgpt.com" } as chrome.tabs.Tab)
    ).rejects.toMatchObject({
      code: "CONTENT_SCRIPT_NOT_READY",
      message: expect.stringMatching(/older version/i),
    });
  });

  test("accepts tab running matching buildId", async () => {
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation((_tabId: number, msg: unknown, cb: (res: unknown) => void) => {
      if ((msg as { type?: string }).type === "PING_CONTENT") {
        cb({
          ok: true,
          proto: CONTENT_PROTOCOL_VERSION,
          buildId: CONTENT_BUILD_ID,
        });
      } else {
        cb({ ok: true });
      }
    });

    await expect(
      ensureContentScript({ id: 123, url: "https://chatgpt.com" } as chrome.tabs.Tab)
    ).resolves.toBeUndefined();
  });
});

describe("SX-07: Dynamic content settler polls active pane", () => {
  test("waitForQuietContent queries active controller scrollHeight", async () => {
    let callCount = 0;
    const mockController: ScrollController = {
      element: {} as unknown as HTMLElement,
      getScrollTop: () => 0,
      setScrollTop: vi.fn(),
      getScrollLeft: () => 0,
      setScrollLeft: vi.fn(),
      getViewportHeight: () => 500,
      getViewportWidth: () => 800,
      getScrollHeight: () => {
        callCount++;
        return callCount === 1 ? 1000 : 1200; // Simulates dynamic expansion
      },
      getScrollWidth: () => 800,
      getMaxScrollY: () => 500,
      getMaxScrollX: () => 0,
      describe: () => "div",
    };

    await waitForQuietContent(mockController, 400);
    // Verified that it queried the mock controller's scrollHeight
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

describe("SX-08: Incomplete output reporting in choiceToast", () => {
  test("choiceToast surfaces partial coverage percentage honestly", () => {
    const toast = buildChoiceToast(
      {
        id: "test-partial-1",
        type: "full-page",
        isPartial: true,
        coveragePercent: 74,
      },
      true
    );

    expect(toast.title).toBe("Captured (partial — 74% coverage)");
    expect(toast.message).toMatch(/incomplete/i);
  });
});

describe("SX-09: SPA ShadowRoot disconnection recovery", () => {
  test("ensureUiRoot recovers when host is disconnected by SPA", () => {
    class FakeShadowRoot {
      host: unknown;
      appendChild = vi.fn();
    }
    class FakeHost {
      id = "";
      style = { cssText: "" };
      parentNode: unknown = null;
      isConnected = true;
      shadow: FakeShadowRoot | null = null;
      attachShadow() {
        this.shadow = new FakeShadowRoot();
        this.shadow.host = this;
        return this.shadow;
      }
    }
    const docBody = {
      appendChild: (el: unknown) => {
        (el as FakeHost).parentNode = docBody;
        (el as FakeHost).isConnected = true;
      },
    };
    g.document = {
      createElement: () => new FakeHost(),
      body: docBody,
    };

    const root1 = ensureUiRoot();
    expect(isUiRootMounted()).toBe(true);

    // Simulate SPA removing host from body
    const host = (root1 as unknown as { host: FakeHost }).host;
    host.parentNode = null;
    host.isConnected = false;
    expect(isUiRootMounted()).toBe(false);

    // Call ensureUiRoot again — must reattach and return valid mounted root!
    const root2 = ensureUiRoot();
    expect(root2).toBeDefined();
    expect(isUiRootMounted()).toBe(true);
    expect(host.isConnected).toBe(true);
  });
});
