import { ensureUiRoot, cleanupUiRootIfEmpty } from "./shadowHost.js";

export interface ToastOptions {
  type: "success" | "error";
  message: string;
  title?: string;
}

let toastContainer: HTMLDivElement | null = null;

export function ensureToastContainer(): HTMLDivElement {
  const root = ensureUiRoot();
  if (!toastContainer || !toastContainer.parentNode) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    root.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(options: ToastOptions): void {
  const container = ensureToastContainer();

  const toast = document.createElement("div");
  toast.className = "toast-item" + (options.type === "success" ? " toast-success" : " toast-error");
  const isSuccess = options.type === "success";
  const iconColor = isSuccess ? "#22c55e" : "#ef4444";
  const defaultTitle = isSuccess ? "Success" : "Error";
  const title = options.title || defaultTitle;

  const iconSvg = isSuccess
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

  toast.innerHTML = `
    <div style="flex-shrink: 0; margin-top: 1px;">
      ${iconSvg}
    </div>
    <div style="flex: 1; min-width: 0;">
      <div style="font-weight: 600; color: #fff; margin-bottom: 2px; font-size: 13.5px;">${title}</div>
      <div style="color: #a1a1aa; font-size: 12.5px; word-break: break-word;">${options.message}</div>
    </div>
    <button class="toast-close-btn" title="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
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
  removeTimer = setTimeout(dismiss, 5000);
}
