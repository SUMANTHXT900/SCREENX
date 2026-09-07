/**
 * Content bridge — type-safe wrapper around the content script (plan: capture/client/contentBridge.ts).
 * Single source for sendToContent / sendProgress / toast / HUD helpers.
 * Re-exports the shared messaging client so capture code has one import path.
 */
export {
  CONTENT_TIMEOUT_MS,
  sendToContent,
  sendProgress,
  sendToast,
  hideProgressHud,
  showProgressHud,
  restoreCapture,
} from "@/messaging/client";
export type { ExtensionMessage } from "@/messaging/events";
