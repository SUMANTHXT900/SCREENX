/**
 * Capture domain types — single source of truth.
 * Split from src/types/index.ts (Stage 1).
 */

export type CaptureType = "visible" | "full-page" | "selected-area";

export interface CaptureResult {
  id: string;
  type: CaptureType;
  /** dataUrl is kept for in-memory use (capture service); for persistence prefer Blob via IndexedDB */
  dataUrl: string;
  blob?: Blob;
  createdAt: number;
  sourceTabId?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  width?: number;
  height?: number;
  /** Oversized captures auto-split into parts sharing a groupId. Absent for single-image captures. */
  groupId?: string;
  /** 1-based part index within the group (present only when groupId is set). */
  partIndex?: number;
  /** Total parts in the group (present only when groupId is set). */
  partTotal?: number;
  /** Scrolling stopped advancing mid-capture; the result is a partial run. */
  stoppedEarly?: boolean;
}

export type CaptureErrorCode =
  | "UNSUPPORTED_TYPE"
  | "NO_ACTIVE_TAB"
  | "RESTRICTED_PAGE"
  | "CAPTURE_FAILED"
  | "HANDOFF_FAILED"
  | "PERMISSION_DENIED"
  | "CONTENT_UNAVAILABLE"
  | "CONTENT_SCRIPT_NOT_READY"
  | "STITCH_FAILED"
  | "TIMEOUT"
  | "PAGE_TOO_LARGE"
  | "USER_CANCELLED"
  | "STORAGE_FAILED"
  | "INVALID_SELECTION"
  | "SCROLL_POSITION_UNSTABLE"
  | "CAPTURE_IN_PROGRESS"
  | "TAB_SWITCHED";

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptureError";
    this.code = code;
  }
}
