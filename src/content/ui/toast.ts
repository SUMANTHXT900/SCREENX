import { ensureUiRoot, cleanupUiRootIfEmpty } from "./shadowHost.js";
import { dataUrlToBlobAsync, markLocalCopyDone } from "../clipboardWrite.js";

export interface ToastAction {
  id: "open-editor" | "copy" | "download";
  label: string;
  captureId: string;
  groupId?: string;
  dataUrl?: string;
  /** Grant nonce echoed back so the worker can verify the click (see events). */
  nonce?: string;
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

/** Button busy spinner (CSS animation in the shadow root — no SMIL). */
const SPINNER_SVG =
  '<svg class="toast-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>';

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
      ...(action.nonce ? { nonce: action.nonce } : {}),
    });
  } catch {
    // ignore — background may be unreachable
  }
}

/** HTML-escape for interpolated toast text (title/message are worker-supplied). */
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Strict data-URL allowlist for the thumbnail src (prefix checks are bypassable). */
function safeThumbUrl(url: string): string | null {
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ? url : null;
}

export function showToast(options: ToastOptions): void {
  if (options.sticky) dismissStickyToasts();
  const container = ensureToastContainer();

  const toast = document.createElement("div");
  const hasActions = !!options.actions && options.actions.length > 0;
  toast.className = "toast-item";
  // Screen-reader announcement: toasts are the sole capture-complete signal.
  toast.setAttribute("role", options.type === "error" ? "alert" : "status");
  if (options.sticky) toast.dataset.sticky = "1";
  const isSuccess = options.type === "success";
  const defaultTitle = isSuccess ? "Success" : "Error";
  const title = options.title || defaultTitle;

  // Choice toasts (capture complete) carry a status pill + optional
  // thumbnail. Plain toasts get an icon tile matching their tone.
  const copyAction = hasActions ? options.actions!.find((a) => a.id === "copy") : undefined;
  const thumbUrl =
    copyAction && typeof copyAction.dataUrl === "string" ? safeThumbUrl(copyAction.dataUrl) : null;
  // Pill reflects clipboard state: every choice toast is either already
  // copied (green) or still needs the Copy tap (amber).
  const copied = hasActions && !copyAction;
  const pill = hasActions
    ? `<span class="toast-pill ${copied ? "toast-pill--green" : "toast-pill--amber"}">${
        copied ? "On clipboard" : "Copy pending"
      }</span>`
    : "";

  const iconSvg = isSuccess
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="6" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  // Crop-corners mark — the tool's job, drawn crisply. No decorative stars.
  const brandSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V6a2 2 0 0 1 2-2h3"/><path d="M15 4h3a2 2 0 0 1 2 2v3"/><path d="M20 15v3a2 2 0 0 1-2 2h-3"/><path d="M9 20H6a2 2 0 0 1-2-2v-3"/></svg>`;

  toast.innerHTML = `
    <div class="toast-top">
      <div class="toast-icon ${hasActions ? "" : isSuccess ? "toast-icon--ok" : "toast-icon--err"}">
        ${hasActions ? brandSvg : iconSvg}
      </div>
      <div class="toast-head">
        <div class="toast-title-row">
          <div class="toast-title">${escText(title)}</div>
          ${pill}
        </div>
        <div class="toast-message">${escText(options.message)}</div>
      </div>
      ${
        options.sticky
          ? `<span class="toast-timer">
        <svg class="toast-timer-ring" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="4" y="4" width="24" height="24" class="toast-timer-track" />
          <rect x="4" y="4" width="24" height="24" class="toast-timer-fill" data-sx-timer-fill />
        </svg>
        <button class="toast-close-btn" title="Dismiss (auto-closes after 30s idle)" aria-label="Dismiss notification">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </span>`
          : `<button class="toast-close-btn" title="Dismiss" aria-label="Dismiss notification">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>`
      }
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

  // Keyboard dismiss: Escape while focus is inside the toast (page-level
  // keys are untouched — the listener lives on the toast root only).
  toast.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    }
  });

  const closeBtn = toast.querySelector("button");
  let removeTimer: ReturnType<typeof setTimeout> | null = null;
  let timerRaf: number | null = null;
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (removeTimer) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
    if (timerRaf !== null) {
      cancelAnimationFrame(timerRaf);
      timerRaf = null;
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

  // 30s idle countdown for sticky toasts: a depleting square ring hugging
  // the X (same brutalist geometry — no circles). Pauses while the tab is
  // hidden (don't punish pasting elsewhere) and restarts on Copy/Download
  // taps — only Editor/X close immediately. 24×24 rect → perimeter 96.
  const RING_C = 96;
  const IDLE_MS = 30_000;
  const ringFill = toast.querySelector<SVGCircleElement>("[data-sx-timer-fill]");
  let idleStart = 0;
  const stopTimer = () => {
    if (timerRaf !== null) {
      cancelAnimationFrame(timerRaf);
      timerRaf = null;
    }
  };
  const startTimer = () => {
    stopTimer();
    if (!ringFill || dismissed) return;
    idleStart = performance.now();
    let lastTick = 0;
    const tick = (now: number) => {
      if (dismissed) return;
      // rAF stalls while the tab is hidden: credit the gap back so the
      // countdown only runs while the user can actually see the toast.
      if (lastTick > 0) idleStart += Math.max(0, now - lastTick - 50);
      lastTick = now;
      const remaining = Math.max(0, IDLE_MS - (now - idleStart));
      ringFill.style.strokeDashoffset = String(RING_C * (1 - remaining / IDLE_MS));
      if (remaining <= 0) {
        dismiss();
        return;
      }
      timerRaf = requestAnimationFrame(tick);
    };
    ringFill.style.strokeDasharray = String(RING_C);
    ringFill.style.strokeDashoffset = "0";
    timerRaf = requestAnimationFrame(tick);
  };
  /** User did something — give them a fresh 30s. */
  const pokeTimer = () => {
    if (ringFill && !dismissed) startTimer();
  };
  if (options.sticky && ringFill) startTimer();

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

      /** Swap button content; returns a restore fn for the original. */
      const setBusy = (busyLabel: string): (() => void) => {
        const prevIcon = icon.innerHTML;
        const prevLabel = label.textContent;
        btn.disabled = true;
        icon.innerHTML = SPINNER_SVG;
        label.textContent = busyLabel;
        return () => {
          btn.disabled = false;
          icon.innerHTML = prevIcon;
          label.textContent = prevLabel ?? "";
        };
      };
      /** Flip the choice toast's pill to its copied state. */
      const markPillCopied = () => {
        const pill = toast.querySelector(".toast-pill");
        if (!pill) return;
        pill.classList.remove("toast-pill--amber");
        pill.classList.add("toast-pill--green");
        pill.textContent = "On clipboard";
      };

      btn.addEventListener("click", () => {
        // Copy / Download keep the toast OPEN (user may still want the other
        // action); only Open-in-Editor and the X dismiss it. Any tap pokes
        // the 30s idle timer for a fresh window.
        if (
          action.id === "copy" &&
          typeof action.dataUrl === "string" &&
          action.dataUrl.startsWith("data:image/")
        ) {
          // Second tap after a direct-write failure goes the worker route
          // (different bytes path — worth one shot, reported separately).
          if (btn.dataset.failed === "1") {
            pokeTimer();
            const restore = setBusy("Retrying…");
            sendCopyActionToWorker(action);
            setTimeout(restore, 2000);
            return;
          }
          pokeTimer();
          const restore = setBusy("Copying…");
          // Async chunked decode yields between 1 MiB slices so the spinner
          // above keeps animating on huge images instead of one long hitch.
          // markLocalCopyDone runs BEFORE write() so this in-gesture write
          // beats any in-flight background retry in slot ordering.
          void (async () => {
            try {
              const blob = await dataUrlToBlobAsync(action.dataUrl as string);
              markLocalCopyDone();
              await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
              markPillCopied();
              restore();
              label.textContent = "Copied ✓";
              setTimeout(() => {
                if (label.textContent === "Copied ✓") label.textContent = action.label;
              }, 2500);
            } catch {
              restore();
              btn.dataset.failed = "1";
              label.textContent = "Failed — tap to retry";
              sendCopyActionToWorker(action);
            }
          })();
          return;
        }
        if (action.id === "download") {
          pokeTimer();
          const restore = setBusy("Saving…");
          sendCopyActionToWorker(action);
          setTimeout(restore, 2000);
          return;
        }
        // open-editor (and any unknown action): done here, continue there.
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
