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
    /* Neobrutalist cards: cream paper, thick black borders, hard offset
       shadows, sharp corners, max 3 solid accents (emerald/amber/red).
       Toasts must read on ANY webpage, so no translucency here. */
    .toast-item {
      background: #FFFDF7;
      color: #000;
      border-radius: 0;
      border: 3px solid #000;
      padding: 13px 14px;
      box-shadow: 6px 6px 0 #000;
      pointer-events: auto;
      animation: toast-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      min-width: 260px;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    .toast-item.closing {
      animation: toast-out 0.15s ease-in forwards;
    }
    @media (prefers-reduced-motion: reduce) {
      .toast-item { animation: none; }
      .toast-item.closing { animation: none; opacity: 0; }
    }
    .toast-top {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .toast-icon {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      border-radius: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #4ADE80;
      border: 2px solid #000;
    }
    .toast-icon--ok {
      background: #000;
      border-color: #000;
    }
    .toast-icon--err {
      background: #F87171;
      border-color: #000;
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
      font-weight: 800;
      color: #000;
      font-size: 14px;
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
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 8px 2px 7px;
      border-radius: 0;
      border: 2px solid #000;
      line-height: 1.5;
      color: #000;
    }
    .toast-pill::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 9999px;
      background: currentColor;
    }
    .toast-pill--green {
      background: #4ADE80;
    }
    .toast-pill--amber {
      background: #FBBF24;
    }
    .toast-message {
      color: rgba(0, 0, 0, 0.65);
      font-size: 12.5px;
      font-weight: 500;
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
      border-radius: 0;
      object-fit: cover;
      border: 2px solid #000;
      background: #fff;
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
      border-radius: 0;
      padding: 9px 12px;
      font-size: 13px;
      font-weight: 700;
      font-family: inherit;
      letter-spacing: -0.005em;
      cursor: pointer;
      border: 2px solid #000;
      box-shadow: 3px 3px 0 #000;
      transition: transform 100ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 100ms cubic-bezier(0.4, 0, 0.2, 1), background-color 100ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .toast-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #000; }
    .toast-btn:focus-visible { outline: 2px solid #000; outline-offset: 2px; }
    .toast-btn svg { flex-shrink: 0; }
    .toast-btn-primary {
      background: #4ADE80;
      color: #000;
      width: 100%;
    }
    .toast-btn-primary:hover { background: #22c55e; }
    .toast-btn-secondary {
      background: #fff;
      color: #000;
      flex: 1;
      font-weight: 700;
    }
    .toast-btn-secondary:hover { background: #000; color: #fff; }
    .toast-close-btn {
      background: #fff;
      border: 2px solid #000;
      color: #000;
      cursor: pointer;
      padding: 3px;
      margin: -2px -4px 0 0;
      border-radius: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
      flex-shrink: 0;
    }
    .toast-close-btn:hover { background: #EF4444; border-color: #000; color: #fff; }
    .toast-close-btn:active { transform: translate(1px, 1px); }
    .toast-close-btn:focus-visible { outline: 2px solid #000; outline-offset: 2px; }
    /* 30s idle countdown: a square ring hugging the X button — same
       brutalist geometry as the button itself (sharp, black, offset). */
    .toast-timer {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      margin: -5px -9px -5px 0;
    }
    .toast-timer-ring {
      position: absolute;
      inset: 0;
      overflow: visible;
      /* Critical: the ring overlays the X button — without this it swallows
         every hover/click and the button feels dead. */
      pointer-events: none;
    }
    .toast-timer-track {
      fill: none;
      stroke: rgba(0, 0, 0, 0.14);
      stroke-width: 2.5;
    }
    .toast-timer-fill {
      fill: none;
      stroke: #000;
      stroke-width: 2.5;
    }
    .toast-timer .toast-close-btn {
      margin: 0;
    }
    /* Button busy state (Copying… / Saving…): dimmed but alive. */
    .toast-btn:disabled {
      cursor: wait;
      opacity: 0.75;
    }
    .toast-spinner {
      animation: __sxSpin 0.8s linear infinite;
    }
    @keyframes __sxSpin {
      to { transform: rotate(360deg); }
    }
    
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
