/**
 * Choice-toast content builder — pure (no chrome APIs), shared by the
 * in-page toast, the active-tab fallback, and the system-notification
 * fallback. Tested in tests/modular.test.ts.
 */
import type { CaptureType } from "@/types/capture";
import type { ToastAction } from "@/messaging/events";

/** Minimal shape the choice toast needs (CaptureResult and CaptureRecord both fit). */
export interface ChoiceInput {
  id: string;
  type: CaptureType;
  groupId?: string;
  partIndex?: number;
  partTotal?: number;
  stoppedEarly?: boolean;
  sourceTabId?: number;
}

function choiceToast(
  result: ChoiceInput,
  copied: boolean,
  copyNote?: string
): { title: string; message: string } {
  const multi = (result.partTotal ?? 0) > 1;
  const early = result.stoppedEarly === true;
  const title = early ? "Captured (stopped early)" : multi ? `Captured ${result.partTotal} parts` : "Screenshot captured";
  const earlyNote = early ? "Scrolling stopped advancing — saved everything up to that point. " : "";
  // copied=true: the UX contract — image is already on the clipboard.
  // copied=false: say WHY, so the user knows whether to tap Copy (focus miss)
  // or skip straight to Download/Editor (page can't be written to).
  const clip = copied
    ? "Copied to clipboard — paste it anywhere."
    : (copyNote ?? "Clipboard copy unavailable in this browser.");
  const rest = multi ? " Part 1 below; all parts are in Workspace." : " Saved to Workspace.";
  return { title, message: `${earlyNote}${clip}${rest}` };
}

export function buildChoiceToast(
  result: ChoiceInput,
  copied: boolean,
  copyDataUrl?: string,
  copyNote?: string
): {
  type: "success";
  title: string;
  message: string;
  actions: ToastAction[];
  sticky: boolean;
} {
  const group = result.groupId ? { groupId: result.groupId } : {};
  const actions: ToastAction[] = [
    { id: "open-editor", label: "Open in Editor", captureId: result.id, ...group },
    ...(!copied
      ? [
          {
            id: "copy" as const,
            label: "Copy",
            captureId: result.id,
            ...group,
            // Pre-delivered bytes: the click handler writes synchronously in
            // the gesture (transient activation only covers that window).
            // Absent when oversized — the button then uses the SW round trip.
            ...(copyDataUrl ? { dataUrl: copyDataUrl } : {}),
          },
        ]
      : []),
    { id: "download", label: "Download", captureId: result.id, ...group },
  ];
  const { title, message } = choiceToast(result, copied, copyNote);
  return { type: "success" as const, title, message, actions, sticky: true };
}
