import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../src/capture/client/contentBridge", () => ({
  sendProgress: vi.fn(),
  sendToContent: vi.fn(),
  sendToast: vi.fn(),
  hideProgressHud: vi.fn(),
  showProgressHud: vi.fn(),
  restoreCapture: vi.fn(),
}));

vi.mock("../src/capture/client/tabCaptureClient", () => ({
  captureVisibleTabThrottled: vi.fn(),
  waitThrottle: vi.fn(),
}));

import { executeCaptureLoop } from "../src/capture/engine/captureLoop";
import { sendToContent } from "../src/capture/client/contentBridge";
import { captureVisibleTabThrottled } from "../src/capture/client/tabCaptureClient";
import { checkAdvance } from "../src/capture/engine/types";

const scrollMock = vi.mocked(sendToContent);
const captureMock = vi.mocked(captureVisibleTabThrottled);

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).chrome = {
    tabs: { get: async (id: number) => ({ id, windowId: 1, active: true }) },
    runtime: {},
  };
});

describe("capture loop regressions", () => {
  test("loop_stallAbort_stopsEarly", async () => {
    scrollMock.mockResolvedValue({ ok: true, actualX: 0, actualY: 500 } as never);
    captureMock.mockResolvedValue("data:image/png;base64,AAA");
    const res = await executeCaptureLoop({
      tabId: 1,
      windowId: 1,
      mode: "full-page",
      positions: [0, 800, 1600],
      totalTimeout: 60000,
    });
    expect(res.stoppedEarly).toBe(true);
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0]!.y).toBe(500);
    expect(captureMock).toHaveBeenCalledTimes(1);
    // Pure unit contract behind it: skip once, stop on the second stall.
    expect(checkAdvance(500, 500, 0)).toMatchObject({ action: "skip", streak: 1 });
    expect(checkAdvance(500, 500, 1)).toMatchObject({ action: "stop", streak: 2 });
  });

  test("loop_unstableScroll_alignsAndContinues", async () => {
    scrollMock.mockResolvedValue({
      ok: false,
      error: JSON.stringify({ code: "SCROLL_POSITION_UNSTABLE", actualX: 0, actualY: 742 }),
    } as never);
    captureMock.mockResolvedValue("data:image/png;base64,AAA");
    const res = await executeCaptureLoop({
      tabId: 1,
      windowId: 1,
      mode: "full-page",
      positions: [742],
      totalTimeout: 60000,
    });
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0]!.y).toBe(742);
    expect(res.stoppedEarly).toBe(false);
  });
});
