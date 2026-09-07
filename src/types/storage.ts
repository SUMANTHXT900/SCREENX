/**
 * Storage domain types.
 * Split from src/types/index.ts (Stage 1).
 */
import type { CaptureResult } from "./capture";

/** Key stored in chrome.storage.session: `screenx:pending:<id>` */
export type PendingCaptureId = string;

export type PendingCapture = CaptureResult;

export type ScreenshotId = string;

export interface Timestamped {
  createdAt: number;
  updatedAt: number;
}
