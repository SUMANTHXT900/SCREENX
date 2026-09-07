/**
 * Capture session — concurrency lock (plan: capture/engine/CaptureSession.ts).
 * Replaces the duplicated fullPageLock / selectedAreaLock.
 */
import { CaptureError } from "@/types/capture";

export class CaptureSession {
  private locked = false;
  constructor(private readonly label = "capture") {}

  acquire(): void {
    if (this.locked) {
      throw new CaptureError(
        "CAPTURE_IN_PROGRESS",
        "A capture is already running. Please wait for it to finish before starting another."
      );
    }
    this.locked = true;
  }

  release(): void {
    this.locked = false;
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

/** Shared singleton sessions per capture mode (preserves old per-mode lock semantics). */
export const fullPageSession = new CaptureSession("full-page");
export const selectedAreaSession = new CaptureSession("selected-area");

/**
 * Global in-memory session — one lock for ALL capture modes in this JS
 * context. Use together with the cross-context storage lock in globalLock.ts:
 * acquire the memory lock first (fast fail), then the storage lock.
 */
export const globalSession = new CaptureSession("global");
