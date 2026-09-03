/**
 * Shared extension types — Step 1 expanded.
 * Future models (WorkspaceItem, HistoryEntry, EditorDocument) remain stubs.
 */

// ── Capture ──────────────────────────────────────────────────────────

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
  | "SCROLL_POSITION_UNSTABLE";

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptureError";
    this.code = code;
  }
}

// ── Handoff ──────────────────────────────────────────────────────────

/** Key stored in chrome.storage.session: `screenx:pending:<id>` */
export type PendingCaptureId = string;

export type PendingCapture = CaptureResult;

export interface ExtensionMessage {
  type: string;
  payload?: unknown;
}

export interface ToastOptions {
  type: "success" | "error";
  message: string;
  title?: string;
}

export interface ProgressPayload {
  mode?: string;
  stage?: string;
  percent?: number;
  currentChunk?: number;
  totalChunks?: number;
  [key: string]: unknown;
}

// ── Stubs for future steps ──────────────────────────────────────────

export type ScreenshotId = string;

export interface Timestamped {
  createdAt: number;
  updatedAt: number;
}
