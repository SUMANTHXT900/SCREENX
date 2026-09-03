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
  selection: RangeSelection;
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
  | TriggerSelectedAreaMessage;

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
  viewportWidth: number;
  viewportHeight: number;
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
