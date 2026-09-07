/**
 * System-notification fallback for the post-capture choice.
 *
 * In-page toasts are invisible when the user isn't looking at the tab
 * (DevTools focused, another window on top) and impossible when no content
 * script is listening. This fallback uses chrome.notifications so a finished
 * capture is ALWAYS announced somewhere the user can see it. Buttons mirror
 * the toast: Open Editor + Download.
 */
import { buildChoiceToast, type ChoiceInput } from "./choiceToast";
import { downloadCapture } from "./downloadHandler";
import { openEditorForToastAction } from "./toastActions";

interface NotificationTarget {
  captureId: string;
  groupId?: string;
}

const targets = new Map<string, NotificationTarget>();

function forget(notificationId: string): void {
  targets.delete(notificationId);
  try {
    chrome.notifications.clear(notificationId);
  } catch {
    // ignore
  }
}

/** Show the choice as a system notification. Never throws. */
export async function notifyChoiceFallback(
  result: ChoiceInput,
  copied: boolean,
  copyNote?: string
): Promise<void> {
  try {
    const toast = buildChoiceToast(result, copied, undefined, copyNote);
    const id = await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `ScreenX — ${toast.title}`,
      message: toast.message,
      buttons: [{ title: "Open Editor" }, { title: "Download" }],
      priority: 2,
    });
    if (typeof id === "string" && id) {
      targets.set(id, { captureId: result.id, groupId: result.groupId });
      console.debug("[ScreenX] choice notification shown:", id);
    }
  } catch (e) {
    console.debug(
      "[ScreenX] choice notification failed:",
      e instanceof Error ? e.message : String(e)
    );
  }
}

export function wireNotificationClicks(): void {
  try {
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      const target = targets.get(notificationId);
      if (!target) return;
      forget(notificationId);
      if (buttonIndex === 0) {
        console.debug("[ScreenX] notification action → open editor", target.captureId);
        void openEditorForToastAction(target.captureId, target.groupId).then(
          () => console.debug("[ScreenX] notification action → editor opened"),
          (e) => console.error("[ScreenX] notification action → editor open failed:", e instanceof Error ? e.message : String(e))
        );
      } else {
        console.debug("[ScreenX] notification action → download started", target.captureId);
        void downloadCapture(target.captureId);
      }
    });
    chrome.notifications.onClosed.addListener((notificationId) => {
      targets.delete(notificationId);
    });
  } catch {
    // ignore — notifications unavailable
  }
}
