/**
 * ScreenX Messaging Protocol & Event Definitions
 * Discriminated union of all extension messages and their payload contracts.
 */

// ── Shared Payload Types ─────────────────────────────────────────────

export interface RangeSelection {
  x: number;
  width: number;
  startY: number;
  endY: number;
}

export interface ToastAction {
  id: "open-editor" | "copy" | "download";
  label: string;
  captureId: string;
  groupId?: string;
  /**
   * Pre-encoded PNG data URL for the Copy button, so the click handler can
   * write to the clipboard synchronously (transient activation only survives
   * the synchronous part of a user gesture). Absent when oversized — the
   * button then falls back to the service-worker round trip.
   */
  dataUrl?: string;
}

export interface ToastOptions {
  type: "success" | "error";
  message: string;
  title?: string;
  /** Action buttons rendered in the toast (content sends SCREENX_TOAST_ACTION on click). */
  actions?: ToastAction[];
  /** When true the toast stays until acted on or dismissed (no auto-dismiss). */
  sticky?: boolean;
}

export interface ToastActionMessage {
  type: "SCREENX_TOAST_ACTION";
  action: ToastAction["id"];
  captureId: string;
  groupId?: string;
}

export interface ProgressPayload {
  mode?: string;
  stage?: string;
  percent?: number;
  currentChunk?: number;
  totalChunks?: number;
  [key: string]: unknown;
}

// ── Protocol version ────────────────────────────────────────────────
// Bump when the content protocol changes shape. ensureContentScript refuses
// stale content scripts (open tabs keep running pre-update code that even
// re-injection cannot replace — the double-inject guard skips it), telling
// the user to reload the tab instead of failing cryptically.
export const CONTENT_PROTOCOL_VERSION = 5;

// ── Message Type Constants ──────────────────────────────────────────
export const MESSAGE_TYPES = {
  MEASURE_PAGE: "SCREENX_MEASURE_PAGE",
  PREPARE_CAPTURE: "SCREENX_PREPARE_CAPTURE",
  SCROLL_TO: "SCREENX_SCROLL_TO",
  PROGRESS: "SCREENX_PROGRESS",
  TOAST: "SCREENX_TOAST",
  HIDE_PROGRESS: "SCREENX_HIDE_PROGRESS",
  SHOW_PROGRESS: "SCREENX_SHOW_PROGRESS",
  RESTORE_CAPTURE: "SCREENX_RESTORE_CAPTURE",
  START_SELECTION: "SCREENX_START_SELECTION",
  CANCEL_SELECTION: "SCREENX_CANCEL_SELECTION",
  SELECTION_COMPLETE: "SCREENX_SELECTION_COMPLETE",
  SELECTION_CANCEL: "SCREENX_SELECTION_CANCEL",
  PING_CONTENT: "PING_CONTENT",
  TRIGGER_SELECTED_AREA: "TRIGGER_SELECTED_AREA",
  TRIGGER_CAPTURE: "TRIGGER_CAPTURE",
  RESOLVE_CONTAINER: "SCREENX_RESOLVE_CONTAINER",
  TOAST_ACTION: "SCREENX_TOAST_ACTION",
  COPY_IMAGE: "SCREENX_COPY_IMAGE",
} as const;

export type MessageTypeValue = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

// ── Individual Message Interfaces ───────────────────────────────────

export interface MeasurePageMessage {
  type: "SCREENX_MEASURE_PAGE";
}

export interface PrepareCaptureMessage {
  type: "SCREENX_PREPARE_CAPTURE";
}

export interface ScrollToMessage {
  type: "SCREENX_SCROLL_TO";
  x: number;
  y: number;
}

export interface ProgressMessage {
  type: "SCREENX_PROGRESS";
  progress: ProgressPayload;
}

export interface ToastMessage {
  type: "SCREENX_TOAST";
  toast: ToastOptions;
}

export interface HideProgressMessage {
  type: "SCREENX_HIDE_PROGRESS";
}

export interface ShowProgressMessage {
  type: "SCREENX_SHOW_PROGRESS";
}

export interface RestoreCaptureMessage {
  type: "SCREENX_RESTORE_CAPTURE";
}

export interface StartSelectionMessage {
  type: "SCREENX_START_SELECTION";
}

export interface CancelSelectionMessage {
  type: "SCREENX_CANCEL_SELECTION";
}

export interface SelectionCompleteMessage {
  type: "SCREENX_SELECTION_COMPLETE";
  selection: RegionSelection;
}

/**
 * User selection in scroll-delta form (viewport box + live scroll readings).
 * Unlike absolute document coordinates, this cannot go stale between clicks:
 * the range derives from scroll positions, and the stitcher verifies every
 * strip against actual pixels.
 *
 * Frames: the box travels in VIEWPORT px (also used to resolve the scroll
 * container). startY/endY/x are derived capture-side by selectionRangeToTargets
 * (scroll + viewport offsets, no rect correction — see its invariant). x is
 * document px because the loop pins horizontal scroll to 0 every strip.
 */
export interface RegionSelection {
  boxLeft: number;
  boxTop: number;
  boxWidth: number;
  boxHeight: number;
  startScrollTop: number;
  endScrollTop: number;
  x: number;
  width: number;
}

export interface SelectionCancelMessage {
  type: "SCREENX_SELECTION_CANCEL";
}

export interface PingContentMessage {
  type: "PING_CONTENT";
}

export interface TriggerSelectedAreaMessage {
  type: "TRIGGER_SELECTED_AREA";
}

export interface TriggerCaptureMessage {
  type: "TRIGGER_CAPTURE";
  captureType: "visible" | "full-page" | "selected-area";
}

export interface ResolveContainerMessage {
  type: "SCREENX_RESOLVE_CONTAINER";
  /** Viewport point (CSS px) whose scroll container should drive capture. */
  x: number;
  y: number;
}

export interface CopyImageMessage {
  type: "SCREENX_COPY_IMAGE";
  /** PNG data URL to write to the clipboard (JSON-safe transport). */
  dataUrl: string;
  /**
   * Wall-clock ordering token (Date.now() at send). The content script drops
   * writes older than the newest seen, so a stale auto-copy retry can never
   * overwrite a newer capture's image. Absent = accept (back-compat).
   */
  seq?: number;
}

export interface CopyImageResponse {
  ok: boolean;
  error?: string;
  focused?: boolean;
  transientActivation?: boolean;
}

// ── Discriminated Union ─────────────────────────────────────────────

export type ExtensionMessage =
  | MeasurePageMessage
  | PrepareCaptureMessage
  | ScrollToMessage
  | ProgressMessage
  | ToastMessage
  | HideProgressMessage
  | ShowProgressMessage
  | RestoreCaptureMessage
  | StartSelectionMessage
  | CancelSelectionMessage
  | SelectionCompleteMessage
  | SelectionCancelMessage
  | PingContentMessage
  | TriggerSelectedAreaMessage
  | TriggerCaptureMessage
  | ResolveContainerMessage
  | CopyImageMessage
  | ToastActionMessage;

export type ExtensionMessageType = ExtensionMessage["type"];

// Convenience Aliases
export type ScreenXMessage = ExtensionMessage;
export type ScreenXEvent = ExtensionMessage;

// ── Response Definitions ────────────────────────────────────────────

export interface FixedElementBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MeasureResponse {
  totalWidth: number;
  totalHeight: number;
  /** Scroll-container viewport (drives scroll ranges/positions). */
  viewportWidth: number;
  viewportHeight: number;
  /**
   * True window viewport (drives BITMAP mapping — captureVisibleTab always
   * photographs the whole window, so scale MUST use these, never the
   * controller dims above, or every strip mis-scales on nested pages).
   */
  winViewportWidth: number;
  winViewportHeight: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
  maxScrollY: number;
  maxScrollX: number;
  controllerType?: string;
  fixedElements?: FixedElementBox[];
}

export interface ScrollToResponse {
  ok: boolean;
  actualX?: number;
  actualY?: number;
  error?: string;
}

export interface PingResponse {
  ok: boolean;
  url?: string;
  /** Content protocol version — see CONTENT_PROTOCOL_VERSION. */
  proto?: number;
}

export interface GenericSuccessResponse {
  ok: boolean;
  error?: string;
}

// ── Type Guard ──────────────────────────────────────────────────────

export function isExtensionMessage(msg: unknown): msg is ExtensionMessage {
  if (typeof msg !== "object" || msg === null || !("type" in msg)) {
    return false;
  }
  const type = (msg as { type: unknown }).type;
  return typeof type === "string" && Object.values(MESSAGE_TYPES).includes(type as MessageTypeValue);
}
