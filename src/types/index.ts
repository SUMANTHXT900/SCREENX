/**
 * Shared extension types — barrel (Stage 1 split).
 * Domain models live in capture.ts / storage.ts.
 * UI payload types (ToastOptions, ProgressPayload, RangeSelection) are
 * single-sourced in src/messaging/events.ts and re-exported below.
 * See src/types/ui.ts for documentation.
 */

export * from "./capture";
export * from "./storage";

// Messaging protocol (single source lives in src/messaging)
export * from "../messaging";

// Stubs for future steps (WorkspaceItem, HistoryEntry, EditorDocument remain planned)
