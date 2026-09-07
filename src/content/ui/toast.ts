import { ensureUiRoot, cleanupUiRootIfEmpty } from "./shadowHost.js";

export interface ToastAction {
  id: "open-editor" | "copy" | "download";
  label: string;
  captureId: string;
  groupId?: string;
  dataUrl?: string;
}

export interface ToastOptions {
  type: "success" | "error";
  message: string;
  title?: string;
  /** Action buttons; clicking one sends SCREENX_TOAST_ACTION + dismisses. */
  actions?: ToastAction[];
  /** When true the toast stays until acted on or dismissed. */
  sticky?: boolean;
}

let toastContainer: HTMLDivElement | null = null;

export function ensureToastContainer(): HTMLDivElement {
  const root = ensureUiRoot();
  if (!toastContainer || !toastContainer.isConnected) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    root.appendChild(toastContainer);
  }
  return toastContainer;
}

const ACTION_ICONS: Record<ToastAction["id"], string> = {  "open-editor":
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  copy:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  download:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
};

/** Only one sticky choice toast at a time — a new capture retires the old one. */
function dismissStickyToasts(): void {
  try {
    const root = ensureUiRoot();
    const container = root.querySelector(".toast-container");
    if (!container) return;
    for (const el of Array.from(container.querySelectorAll('.toast-item[data-sticky="1"]'))) {
      el.remove();
    }
    cleanupUiRootIfEmpty();
  } catch {
    // ignore
  }
}

/** Route a toast action to the background worker (round trip, no gesture). */
function sendCopyActionToWorker(action: ToastAction): void {
  try {
    chrome.runtime.sendMessage({
      type: "SCREENX_TOAST_ACTION",
      action: action.id,
      captureId: action.captureId,
      ...(action.groupId ? { groupId: action.groupId } : {}),
    });
  } catch {
    // ignore — background may be unreachable
  }
}

export function showToast(options: ToastOptions): void {
  if (options.sticky) dismissStickyToasts();
  const container = ensureToastContainer();

  const toast = document.createElement("div");
  const hasActions = !!options.actions && options.actions.length > 0;
  toast.className = "toast-item";
  if (options.sticky) toast.dataset.sticky = "1";
  const isSuccess = options.type === "success";
  const defaultTitle = isSuccess ? "Success" : "Error";
  const title = options.title || defaultTitle;

  // Choice toasts (capture complete) carry a status pill + optional
  // thumbnail. Plain toasts get an icon tile matching their tone.
  const copyAction = hasActions ? options.actions!.find((a) => a.id === "copy") : undefined;
  const thumbUrl =
    copyAction && typeof copyAction.dataUrl === "string" && copyAction.dataUrl.startsWith("data:image/")
      ? copyAction.dataUrl
      : null;
  // Pill reflects clipboard state: every choice toast is either already
  // copied (green) or still needs the Copy tap (amber).
  const copied = hasActions && !copyAction;
  const pill = hasActions
    ? `<span class="toast-pill ${copied ? "toast-pill--green" : "toast-pill--amber"}">${
        copied ? "Copied" : "Not copied yet"
      }</span>`
    : "";

  const iconSvg = isSuccess
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="6" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  const brandSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5L8 13.8 2 9.2h7.6z" fill="url(#sxg)"/><defs><linearGradient id="sxg" x1="2" y1="2" x2="22" y2="22"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs></svg>`;

  toast.innerHTML = `
    <div class="toast-top">
      <div class="toast-icon ${hasActions ? "" : isSuccess ? "toast-icon--ok" : "toast-icon--err"}">
        ${hasActions ? brandSvg : iconSvg}
      </div>
      <div class="toast-head">
        <div class="toast-title-row">
          <div class="toast-title">${title}</div>
          ${pill}
        </div>
        <div class="toast-message">${options.message}</div>
      </div>
      <button class="toast-close-btn" title="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    ${
      hasActions
        ? `<div class="toast-body">
        ${thumbUrl ? `<img class="toast-thumb" src="${thumbUrl}" alt="Screenshot preview" />` : ""}
        <div class="toast-actions" data-sx-actions></div>
      </div>`
        : ""
    }
  `;

  const closeBtn = toast.querySelector("button");
  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  const dismiss = () => {
    if (removeTimer) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
    toast.classList.add("closing");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      cleanupUiRootIfEmpty();
    }, 200);
  };

  if (closeBtn) {
    closeBtn.addEventListener("click", dismiss);
  }

  container.appendChild(toast);

  if (options.actions && options.actions.length > 0) {
    // Choice layout renders a [data-sx-actions] slot next to the thumbnail;
    // fall back to appending a wrap for any legacy markup without one.
    const slot = toast.querySelector("[data-sx-actions]");
    const wrap = document.createElement("div");
    wrap.className = "toast-actions";
    const primary = options.actions.filter((a) => a.id === "open-editor");
    const secondary = options.actions.filter((a) => a.id !== "open-editor");
    const makeButton = (action: ToastAction, cls: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.className = cls;
      btn.type = "button";
      const icon = document.createElement("span");
      icon.style.cssText = "display: inline-flex;";
      icon.innerHTML = ACTION_ICONS[action.id];
      const label = document.createElement("span");
      label.textContent = action.label;
      btn.append(icon, label);
      btn.addEventListener("click", () => {
        console.debug("[ScreenX] toast action clicked:", action.id, action.captureId);
        // Copy with pre-delivered bytes writes SYNCHRONOUSLY in this click:
        // transient activation only covers the synchronous part of a user
        // gesture, so any await before write() forfeits it.
        if (
          action.id === "copy" &&
          typeof action.dataUrl === "string" &&
          action.dataUrl.startsWith("data:image/")
        ) {
          try {
            const pending = fetch(action.dataUrl).then((res) => {
              if (!res.ok) throw new Error("decode-failed");
              return res.blob();
            });
            navigator.clipboard
              .write([new ClipboardItem({ "image/png": pending })])
              .then(
                () => {
                  console.debug("[ScreenX] toast Copy click: clipboard write ok=true");
                  dismiss();
                  showToast({
                    type: "success",
                    title: "Copied",
                    message: "Screenshot is on your clipboard — paste it anywhere.",
                  });
                },
                (e) => {
                  console.debug(
                    "[ScreenX] toast Copy click: direct write failed, falling back:",
                    e instanceof Error ? e.message : String(e)
                  );
                  sendCopyActionToWorker(action);
                  dismiss();
                }
              );
          } catch {
            sendCopyActionToWorker(action);
            dismiss();
          }
          return;
        }
        sendCopyActionToWorker(action);
        dismiss();
      });
      return btn;
    };
    for (const action of primary) {
      wrap.appendChild(makeButton(action, "toast-btn toast-btn-primary"));
    }
    if (secondary.length > 0) {
      const row = document.createElement("div");
      row.className = "toast-actions-row";
      for (const action of secondary) {
        row.appendChild(makeButton(action, "toast-btn toast-btn-secondary"));
      }
      wrap.appendChild(row);
    }
    if (slot) {
      slot.replaceWith(wrap);
    } else {
      toast.appendChild(wrap);
    }
  }

  if (!options.sticky) {
    removeTimer = setTimeout(dismiss, 5000);
  }
}
