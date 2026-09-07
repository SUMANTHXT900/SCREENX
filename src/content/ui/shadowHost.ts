let uiRootHost: HTMLDivElement | null = null;
let uiShadowRoot: ShadowRoot | null = null;

export function ensureUiRoot(): ShadowRoot {
  if (uiShadowRoot) return uiShadowRoot;

  uiRootHost = document.createElement("div");
  uiRootHost.id = "__screenx_ui_root";
  uiRootHost.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
  `;
  (document.body || document.documentElement).appendChild(uiRootHost);

  uiShadowRoot = uiRootHost.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .hud-container {
      position: absolute;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 15, 17, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #fafafa;
      padding: 12px 18px;
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      width: 440px;
      /* Constant-HUD contract: must render within HUD_RESERVE_PX (120px) so the
         stitcher can discard exactly this band. Fixed height + clipped. */
      max-height: 96px;
      overflow: hidden;
      pointer-events: auto;
      visibility: hidden;
      z-index: 10;
    }
    .hud-header {
      font-weight: 600;
      color: #fff;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      font-size: 14px;
      letter-spacing: 0.2px;
    }
    .hud-header-icon {
      background: linear-gradient(135deg, #60a5fa, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-right: 8px;
      font-size: 16px;
    }
    .hud-bar-bg {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      height: 6px;
      width: 100%;
      overflow: hidden;
      margin-bottom: 8px;
      position: relative;
    }
    .hud-bar-fill {
      height: 100%;
      border-radius: 9999px;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899, #3b82f6);
      background-size: 300% 100%;
      animation: gradient-shift 2s linear infinite;
      transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .hud-subtitle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .hud-subtitle {
      color: #a1a1aa;
      font-size: 12px;
      font-weight: 500;
    }
    .hud-percent {
      color: #e4e4e7;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    @keyframes gradient-shift {
      0% { background-position: 100% 0; }
      100% { background-position: -200% 0; }
    }
    .toast-container {
      position: absolute;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      width: 372px;
      max-width: calc(100vw - 48px);
      z-index: 20;
    }
    /* Shared card language with the progress HUD: dark glass, hairline
       border, soft depth. Toasts and HUD read as one family. */
    .toast-item {
      background: rgba(15, 15, 17, 0.82);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      color: #fafafa;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      padding: 13px 14px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      pointer-events: auto;
      animation: toast-in 0.24s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      min-width: 260px;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    .toast-item.closing {
      animation: toast-out 0.18s ease-in forwards;
    }
    .toast-top {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .toast-icon {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(96,165,250,0.22), rgba(168,85,247,0.22));
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .toast-icon--ok {
      background: rgba(34, 197, 94, 0.14);
      border-color: rgba(34, 197, 94, 0.3);
    }
    .toast-icon--err {
      background: rgba(239, 68, 68, 0.14);
      border-color: rgba(239, 68, 68, 0.3);
    }
    .toast-head {
      flex: 1;
      min-width: 0;
      padding-top: 1px;
    }
    .toast-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .toast-title {
      font-weight: 600;
      color: #fff;
      font-size: 13.5px;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toast-pill {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.02em;
      padding: 2px 8px;
      border-radius: 9999px;
      line-height: 1.5;
    }
    .toast-pill::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 9999px;
      background: currentColor;
    }
    .toast-pill--green {
      color: #4ade80;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.25);
    }
    .toast-pill--amber {
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.25);
    }
    .toast-message {
      color: #a1a1aa;
      font-size: 12.5px;
      margin-top: 5px;
      word-break: break-word;
    }
    .toast-body {
      display: flex;
      gap: 12px;
      margin-top: 12px;
    }
    .toast-thumb {
      flex-shrink: 0;
      width: 64px;
      height: 64px;
      border-radius: 12px;
      object-fit: cover;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.04);
    }
    .toast-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .toast-actions-row { display: flex; gap: 8px; width: 100%; }
    .toast-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: -0.005em;
      cursor: pointer;
      border: 1px solid transparent;
      transition: filter 0.15s ease, background 0.15s ease, transform 0.05s ease;
    }
    .toast-btn:active { transform: scale(0.98); }
    .toast-btn svg { flex-shrink: 0; }
    .toast-btn-primary {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #fff;
      width: 100%;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    .toast-btn-primary:hover { filter: brightness(1.12); }
    .toast-btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      color: #fafafa;
      border-color: rgba(255, 255, 255, 0.09);
      flex: 1;
      font-weight: 500;
    }
    .toast-btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }
    .toast-close-btn {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      padding: 4px;
      margin: -2px -4px 0 0;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
      flex-shrink: 0;
    }
    .toast-close-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    
    @keyframes toast-in {
      from { transform: translateY(-12px) scale(0.98); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    @keyframes toast-out {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(-12px); opacity: 0; }
    }
  `;
  uiShadowRoot.appendChild(style);

  return uiShadowRoot;
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Pin count for shadow-root residents the emptiness check cannot see.
 * Toasts/HUD are detectable via selectors, but the selection overlay uses
 * inline styles with no marker classes — so it pins explicitly on mount and
 * unpins on destroy. Without this, a stale 300ms cleanup timer (armed by an
 * earlier toast/HUD dismiss) fires after the overlay mounts, yanks the whole
 * host, and leaves selection state stranded (invisible UI + stuck crosshair).
 */
let pinCount = 0;

export function pinUiRoot(): void {
  pinCount++;
}

export function unpinUiRoot(): void {
  pinCount = Math.max(0, pinCount - 1);
  cleanupUiRootIfEmpty();
}

export function cleanupUiRootIfEmpty(): void {
  // Debounce: a dismiss animation + new toast mount can both touch the root
  // within the same event loop. Removing the root mid-sequence causes the
  // next ensureToastContainer() to detect a stale container as live (the old
  // parentNode is the detached shadow root, which is non-null). Waiting a
  // tick ensures the new toast is mounted before we decide to remove.
  if (cleanupTimer !== null) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    if (!uiShadowRoot) return;
    if (pinCount > 0) return;
    const hasProgress = uiShadowRoot.querySelector('.hud-container');
    const toastContainer = uiShadowRoot.querySelector('.toast-container');
    const hasToasts = toastContainer && toastContainer.children.length > 0;
    if (!hasProgress && !hasToasts) {
      if (uiRootHost && uiRootHost.parentNode) {
        uiRootHost.parentNode.removeChild(uiRootHost);
      }
      uiRootHost = null;
      uiShadowRoot = null;
    }
  }, 300);
}
