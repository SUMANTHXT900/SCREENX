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
      padding: 16px 24px;
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      width: 300px;
      pointer-events: auto;
      display: none;
      z-index: 10;
    }
    .hud-header {
      font-weight: 600;
      color: #fff;
      margin-bottom: 14px;
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
      max-width: 400px;
      z-index: 20;
    }
    .toast-item {
      background: #18181b;
      color: #fafafa;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      display: flex;
      align-items: flex-start;
      gap: 12px;
      pointer-events: auto;
      animation: toast-in 0.25s ease-out forwards;
      min-width: 260px;
      max-width: 380px;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    .toast-item.closing {
      animation: toast-out 0.2s ease-in forwards;
    }
    .toast-success { border-left: 4px solid #22c55e; }
    .toast-error { border-left: 4px solid #ef4444; }
    .toast-close-btn {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      padding: 2px;
      margin-left: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
    }
    .toast-close-btn:hover { background: #27272a; color: #fff; }
    
    @keyframes toast-in {
      from { transform: translateY(-12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes toast-out {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(-12px); opacity: 0; }
    }
  `;
  uiShadowRoot.appendChild(style);

  return uiShadowRoot;
}

export function cleanupUiRootIfEmpty(): void {
  if (uiShadowRoot) {
    const hasProgress = uiShadowRoot.querySelector('.hud-container');
    const hasToasts = uiShadowRoot.querySelector('.toast-container')?.children.length;
    if (!hasProgress && !hasToasts) {
      if (uiRootHost && uiRootHost.parentNode) {
        uiRootHost.parentNode.removeChild(uiRootHost);
      }
      uiRootHost = null;
      uiShadowRoot = null;
    }
  }
}
