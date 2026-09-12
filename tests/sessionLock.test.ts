import { describe, test, expect } from "vitest";
import { CaptureSession } from "../src/capture/engine/CaptureSession";

describe("CaptureSession", () => {
  test("double acquire throws CAPTURE_IN_PROGRESS, release re-arms", () => {
    const s = new CaptureSession("test");
    expect(s.isLocked).toBe(false);
    s.acquire();
    expect(s.isLocked).toBe(true);
    let code: string | undefined;
    try {
      s.acquire();
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe("CAPTURE_IN_PROGRESS");
    s.release();
    expect(s.isLocked).toBe(false);
    // No throw after release.
    s.acquire();
    s.release();
  });

  test("release on a free session is a safe no-op", () => {
    const s = new CaptureSession("test");
    expect(() => s.release()).not.toThrow();
    expect(s.isLocked).toBe(false);
  });
});
