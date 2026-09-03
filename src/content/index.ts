/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Content Script — ScreenX capture engine
 * Supports visible, full-page, and cross-scroll selected-area (horizontal START/END)
 */

console.debug("[ScreenX] content script loaded", {
  url: location.href,
  timestamp: Date.now(),
});

// Guard against double injection (for scripting fallback)
if ((window as unknown as { __screenXContentScriptLoaded?: boolean }).__screenXContentScriptLoaded) {
  console.debug("[ScreenX] content script already loaded, skipping");
} else {
  (window as unknown as { __screenXContentScriptLoaded: boolean }).__screenXContentScriptLoaded = true;

// ---------------------------------------------------------------------------
// ScrollController abstraction — unified for Full Page and Selected Area
// ---------------------------------------------------------------------------

interface ScrollController {
  element: Window | HTMLElement;
  getScrollTop(): number;
  setScrollTop(y: number): void;
  getScrollLeft(): number;
  setScrollLeft(x: number): void;
  getViewportHeight(): number;
  getViewportWidth(): number;
  getScrollHeight(): number;
  getScrollWidth(): number;
  getMaxScrollY(): number;
  getMaxScrollX(): number;
  describe(): string;
}

function getScrollController(): ScrollController {
  const docEl = document.documentElement;
  const body = document.body;

  const windowScrollHeight = Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, docEl.clientHeight);
  const windowViewportHeight = window.innerHeight;
  const windowScrollable = windowScrollHeight - windowViewportHeight;

  const candidates = Array.from(document.querySelectorAll("*")) as HTMLElement[];
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;
    const scrollableHeight = el.scrollHeight - el.clientHeight;
    if (scrollableHeight > 100 && el.clientHeight > window.innerHeight * 0.4) {
      const rect = el.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.6 && rect.height > window.innerHeight * 0.4) {
        if (scrollableHeight > bestScore) {
          bestScore = scrollableHeight;
          best = el;
        }
      }
    }
  }

  if (best && windowScrollable < 100 && bestScore > 200) {
    return {
      element: best,
      getScrollTop: () => best!.scrollTop,
      setScrollTop: (y: number) => {
        best!.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
        best!.scrollTop = y;
      },
      getScrollLeft: () => best!.scrollLeft,
      setScrollLeft: (x: number) => {
        best!.scrollTo({ left: x, behavior: "instant" as ScrollBehavior });
        best!.scrollLeft = x;
      },
      getViewportHeight: () => best!.clientHeight,
      getViewportWidth: () => best!.clientWidth,
      getScrollHeight: () => best!.scrollHeight,
      getScrollWidth: () => best!.scrollWidth,
      getMaxScrollY: () => Math.max(0, best!.scrollHeight - best!.clientHeight),
      getMaxScrollX: () => Math.max(0, best!.scrollWidth - best!.clientWidth),
      describe: () => `${best!.tagName.toLowerCase()}${best!.id ? "#" + best!.id : ""}${best!.className ? "." + String(best!.className).split(" ")[0] : ""}`,
    };
  }

  return {
    element: window,
    getScrollTop: () => window.scrollY,
    setScrollTop: (y: number) => {
      window.scrollTo({ left: window.scrollX, top: y, behavior: "instant" as ScrollBehavior });
      window.scrollTo(window.scrollX, y);
    },
    getScrollLeft: () => window.scrollX,
    setScrollLeft: (x: number) => {
      window.scrollTo({ left: x, top: window.scrollY, behavior: "instant" as ScrollBehavior });
      window.scrollTo(x, window.scrollY);
    },
    getViewportHeight: () => window.innerHeight,
    getViewportWidth: () => window.innerWidth,
    getScrollHeight: () => Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, docEl.clientHeight, window.innerHeight),
    getScrollWidth: () => Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, docEl.clientWidth, window.innerWidth),
    getMaxScrollY: () => Math.max(0, Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, docEl.clientHeight, window.innerHeight) - window.innerHeight),
    getMaxScrollX: () => Math.max(0, Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, docEl.clientWidth, window.innerWidth) - window.innerWidth),
    describe: () => "window",
  };
}

// Helper to get document Y in scroll-controller coordinates
function getSelectionDocumentY(e: MouseEvent): number {
  const controller = getScrollController();
  if (controller.element === window) {
    return e.clientY + window.scrollY;
  } else {
    const el = controller.element as HTMLElement;
    const rect = el.getBoundingClientRect();
    // clientY relative to viewport, convert to element content coordinate
    return (e.clientY - rect.top) + el.scrollTop;
  }
}

// ---------------------------------------------------------------------------
// Capture session state (full-page & selected-area)
// ---------------------------------------------------------------------------

let originalX = 0;
let originalY = 0;
let prepared = false;
let styleEl: HTMLStyleElement | null = null;
let scrollController: ScrollController | null = null;

function measurePage() {
  const controller = getScrollController();
  const viewportWidth = controller.getViewportWidth();
  const viewportHeight = controller.getViewportHeight();
  const totalWidth = controller.getScrollWidth();
  const totalHeight = controller.getScrollHeight();
  const scrollX = controller.getScrollLeft();
  const scrollY = controller.getScrollTop();
  const maxScrollY = controller.getMaxScrollY();
  const maxScrollX = controller.getMaxScrollX();
  const dpr = window.devicePixelRatio || 1;

  const docEl = document.documentElement;
  const body = document.body;
  const docWidth = Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0, window.innerWidth);
  const docHeight = Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, window.innerHeight);
  const finalTotalWidth = Math.max(totalWidth, docWidth, viewportWidth);
  const finalTotalHeight = Math.max(totalHeight, docHeight, viewportHeight);

  // Generically detect viewport occlusions (fixed/sticky elements)
  const fixedElements: { top: number; bottom: number; left: number; right: number }[] = [];
  try {
    const t0 = performance.now();
    const elementsToCheck = new Set<Element>();
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (let x = 10; x < vw; x += Math.max(50, vw / 4)) {
      const topEl = document.elementFromPoint(x, 10);
      if (topEl) elementsToCheck.add(topEl);
      const bottomEl = document.elementFromPoint(x, vh - 10);
      if (bottomEl) elementsToCheck.add(bottomEl);
    }
    
    const layoutEls = document.querySelectorAll('header, footer, nav, [class*="fixed" i], [class*="sticky" i], [style*="fixed" i], [style*="sticky" i]');
    for (let i = 0; i < layoutEls.length; i++) {
      const el = layoutEls[i];
      if (el) elementsToCheck.add(el);
    }

    for (const el of elementsToCheck) {
      if (performance.now() - t0 > 50) {
        console.warn('[ScreenX] Occlusion measurement timed out');
        break;
      }
      const htmlEl = el as HTMLElement;
      if (!htmlEl || htmlEl.nodeType !== Node.ELEMENT_NODE) continue;
      if (htmlEl.id && htmlEl.id.startsWith('__screenx')) continue;
      
      const style = window.getComputedStyle(htmlEl);
      if (style.position === 'fixed' || style.position === 'sticky') {
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        
        fixedElements.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right
        });
      }
    }
  } catch (e) {
    console.warn('[ScreenX] Failed to measure occlusions', e);
  }

  return {
    totalWidth: finalTotalWidth,
    totalHeight: finalTotalHeight,
    viewportWidth,
    viewportHeight,
    scrollX,
    scrollY,
    dpr,
    maxScrollY: Math.max(0, finalTotalHeight - viewportHeight),
    maxScrollX: Math.max(0, finalTotalWidth - viewportWidth),
    controllerType: controller.describe(),
    fixedElements
  };
}

function prepareCapture(): { ok: true } {
  if (prepared) return { ok: true as const };
  scrollController = getScrollController();
  originalX = scrollController.getScrollLeft();
  originalY = scrollController.getScrollTop();

  styleEl = document.createElement("style");
  styleEl.id = "__screenx_capture_style";
  styleEl.textContent = `
    html, body {
      scroll-behavior: auto !important;
      scroll-padding: 0 !important;
    }
    * {
      scroll-behavior: auto !important;
    }
    html.__screenx_capturing * {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
    }
  `;
  (document.head || document.documentElement).appendChild(styleEl);
  document.documentElement.classList.add("__screenx_capturing");
  prepared = true;
  console.debug("[ScreenX] prepareCapture", JSON.stringify({ originalX, originalY, controller: scrollController.describe() }));
  return { ok: true as const };
}

interface ScrollResult {
  requestedX: number;
  requestedY: number;
  actualX: number;
  actualY: number;
  attempts: number;
  settled: boolean;
}

async function scrollToAndSettle(x: number, y: number, maxAttempts = 3): Promise<ScrollResult> {
  if (!prepared) prepareCapture();
  if (!scrollController) scrollController = getScrollController();
  const controller = scrollController;
  
  // Temporarily disable scroll snapping and anchoring on the active root
  const el = controller.element;
  let originalScrollSnap = "";
  let originalOverflowAnchor = "";
  if (el instanceof HTMLElement && el.style) {
    originalScrollSnap = el.style.scrollSnapType;
    originalOverflowAnchor = el.style.overflowAnchor;
    el.style.scrollSnapType = "none";
    el.style.overflowAnchor = "none";
  }

  let attempts = 0;
  let actualX = 0;
  let actualY = 0;
  let settled = false;
  
  let maxScrollY = controller.getMaxScrollY();
  let maxScrollX = controller.getMaxScrollX();

  while (attempts < maxAttempts) {
    attempts++;
    
    // Recalculate max boundaries in case of layout shifts
    maxScrollY = controller.getMaxScrollY();
    maxScrollX = controller.getMaxScrollX();
    
    const clampedX = Math.max(0, Math.min(x, maxScrollX));
    const clampedY = Math.max(0, Math.min(y, maxScrollY));

    controller.setScrollTop(clampedY);
    controller.setScrollLeft(clampedX);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 80 + attempts * 50); // backoff
        });
      });
    });

    actualX = controller.getScrollLeft();
    actualY = controller.getScrollTop();

    if (Math.abs(actualX - clampedX) <= 2 && Math.abs(actualY - clampedY) <= 2) {
      settled = true;
      break;
    }
  }

  if (el instanceof HTMLElement && el.style) {
    el.style.scrollSnapType = originalScrollSnap;
    el.style.overflowAnchor = originalOverflowAnchor;
  }

  if (!settled) {
    const info = {
      requested: { x, y },
      actual: { x: actualX, y: actualY },
      controller: controller.describe(),
      scrollHeight: controller.getScrollHeight(),
      clientHeight: controller.getViewportHeight(),
      maxScrollY,
    };
    console.warn("[ScreenX] scroll position unstable", JSON.stringify(info));
    throw new Error(JSON.stringify({ 
      code: "SCROLL_POSITION_UNSTABLE", 
      message: `Failed to settle scroll position after ${attempts} attempts (requested y=${y}, actual y=${actualY})`,
      details: info 
    }));
  }

  return { requestedX: x, requestedY: y, actualX, actualY, attempts, settled };
}

function restoreCapture(): { ok: true } {
  removeProgressHud();
  document.documentElement.classList.remove("__screenx_capturing");

  try {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  } catch {
    // ignore
  }
  styleEl = null;

  if (prepared && scrollController) {
    try {
      scrollController.setScrollTop(originalY);
      scrollController.setScrollLeft(originalX);
    } catch {
      try {
        window.scrollTo(originalX, originalY);
      } catch {
        // ignore
      }
    }
  }
  prepared = false;
  scrollController = null;
  console.debug("[ScreenX] restoreCapture", JSON.stringify({ originalX, originalY }));
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Selected-area cross-scroll selection — TWO HORIZONTAL LINES, scroll unblocked
// ---------------------------------------------------------------------------

type SelectionModeState =
  | "IDLE"
  | "WAITING_FOR_START"
  | "WAITING_FOR_END"
  | "END_SET"
  | "CAPTURING"
  | "COMPLETED";

interface SelectionInternalState {
  state: SelectionModeState;
  startY: number | null;
  endY: number | null;
  previewLine: HTMLElement | null;
  startLine: HTMLElement | null;
  endLine: HTMLElement | null;
  hud: HTMLElement | null;
  captureButton: HTMLButtonElement | null;
  changeEndButton: HTMLButtonElement | null;
  cancelButton: HTMLButtonElement | null;
  keyHandler: ((e: KeyboardEvent) => void) | null;
  clickHandler: ((e: MouseEvent) => void) | null;
  mouseMoveHandler: ((e: MouseEvent) => void) | null;
  mouseEnterHandler: ((e: MouseEvent) => void) | null;
  mouseLeaveHandler: ((e: MouseEvent) => void) | null;
}

const selectionState: SelectionInternalState = {
  state: "IDLE",
  startY: null,
  endY: null,
  previewLine: null,
  startLine: null,
  endLine: null,
  hud: null,
  captureButton: null,
  changeEndButton: null,
  cancelButton: null,
  keyHandler: null,
  clickHandler: null,
  mouseMoveHandler: null,
  mouseEnterHandler: null,
  mouseLeaveHandler: null,
};

function detachPreviewListeners(): void {
  const s = selectionState;
  if (s.mouseMoveHandler) {
    document.removeEventListener("mousemove", s.mouseMoveHandler, true);
    s.mouseMoveHandler = null;
  }
  if (s.mouseEnterHandler) {
    document.removeEventListener("mouseenter", s.mouseEnterHandler, true);
    s.mouseEnterHandler = null;
  }
  if (s.mouseLeaveHandler) {
    document.removeEventListener("mouseleave", s.mouseLeaveHandler, true);
    s.mouseLeaveHandler = null;
  }
  if (s.previewLine) {
    try {
      s.previewLine.remove();
    } catch {
      // ignore
    }
    s.previewLine = null;
  }
}

function removeSelectionUI(): void {
  detachPreviewListeners();

  const s = selectionState;
  if (s.keyHandler) {
    document.removeEventListener("keydown", s.keyHandler, true);
    s.keyHandler = null;
  }
  if (s.clickHandler) {
    document.removeEventListener("click", s.clickHandler, true);
    s.clickHandler = null;
  }

  if (s.startLine) {
    try {
      s.startLine.remove();
    } catch {
      // ignore
    }
    s.startLine = null;
  }
  if (s.endLine) {
    try {
      s.endLine.remove();
    } catch {
      // ignore
    }
    s.endLine = null;
  }
  if (s.hud) {
    try {
      s.hud.remove();
    } catch {
      // ignore
    }
    s.hud = null;
  }

  s.captureButton = null;
  s.changeEndButton = null;
  s.cancelButton = null;
  s.startY = null;
  s.endY = null;
  s.state = "IDLE";
  document.documentElement.style.removeProperty("cursor");
}

function createHorizontalLine(y: number, label: string, color: string): HTMLElement {
  const line = document.createElement("div");
  line.style.cssText = `
    position: absolute;
    left: 0;
    top: ${y}px;
    width: 100%;
    height: 0;
    border-top: 2px dashed ${color};
    z-index: 2147483646;
    pointer-events: none;
    box-shadow: 0 0 8px rgba(0,0,0,0.15);
  `;
  const labelEl = document.createElement("div");
  labelEl.textContent = label;
  labelEl.style.cssText = `
    position: absolute;
    left: 50%;
    top: -14px;
    transform: translateX(-50%);
    background: ${color};
    color: white;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 10px;
    border-radius: 9999px;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    pointer-events: none;
  `;
  line.appendChild(labelEl);
  return line;
}

function createPreviewLine(labelContent: string, color: string): HTMLElement {
  const line = document.createElement("div");
  line.style.cssText = `
    position: fixed;
    left: 0;
    top: -100px;
    width: 100%;
    height: 0;
    border-top: 2px solid ${color};
    z-index: 2147483646;
    pointer-events: none;
    display: none;
  `;
  const label = document.createElement("div");
  label.textContent = labelContent;
  label.style.cssText = `
    position: absolute;
    left: 50%;
    top: -14px;
    transform: translateX(-50%);
    background: ${color};
    color: white;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 9999px;
    white-space: nowrap;
    pointer-events: none;
  `;
  line.appendChild(label);
  return line;
}

function attachPreviewListeners(labelContent: string, color: string): void {
  detachPreviewListeners();

  const previewLine = createPreviewLine(labelContent, color);
  (document.body || document.documentElement).appendChild(previewLine);
  selectionState.previewLine = previewLine;

  const mouseMoveHandler = (e: MouseEvent) => {
    if (!selectionState.previewLine) return;
    if (e.clientY < 0 || e.clientY > window.innerHeight || e.clientX < 0 || e.clientX > window.innerWidth) {
      selectionState.previewLine.style.display = "none";
      return;
    }
    selectionState.previewLine.style.display = "block";
    selectionState.previewLine.style.top = `${e.clientY}px`;
  };

  const mouseEnterHandler = (e: MouseEvent) => {
    if (selectionState.previewLine) {
      selectionState.previewLine.style.display = "block";
      selectionState.previewLine.style.top = `${e.clientY}px`;
    }
  };

  const mouseLeaveHandler = () => {
    if (selectionState.previewLine) {
      selectionState.previewLine.style.display = "none";
    }
  };

  document.addEventListener("mousemove", mouseMoveHandler, true);
  document.addEventListener("mouseenter", mouseEnterHandler, true);
  document.addEventListener("mouseleave", mouseLeaveHandler, true);

  selectionState.mouseMoveHandler = mouseMoveHandler;
  selectionState.mouseEnterHandler = mouseEnterHandler;
  selectionState.mouseLeaveHandler = mouseLeaveHandler;
}

interface ProgressPayload {
  mode?: string;
  stage?: string;
  percent?: number;
  currentChunk?: number;
  totalChunks?: number;
  [key: string]: unknown;
}

let uiRootHost: HTMLDivElement | null = null;
let uiShadowRoot: ShadowRoot | null = null;
let progressHud: HTMLDivElement | null = null;
let toastContainer: HTMLDivElement | null = null;

function ensureUiRoot(): ShadowRoot {
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

function cleanupUiRootIfEmpty(): void {
  if (uiShadowRoot) {
    const hasProgress = progressHud && progressHud.parentNode;
    const hasToasts = toastContainer && toastContainer.children.length > 0;
    if (!hasProgress && !hasToasts) {
      if (uiRootHost && uiRootHost.parentNode) {
        uiRootHost.parentNode.removeChild(uiRootHost);
      }
      uiRootHost = null;
      uiShadowRoot = null;
      progressHud = null;
      toastContainer = null;
    }
  }
}

function updateProgressHud(progress: ProgressPayload): void {
  const root = ensureUiRoot();
  if (!progressHud) {
    progressHud = document.createElement("div");
    progressHud.className = "hud-container";
    root.appendChild(progressHud);
  }
  progressHud.style.display = "block";

  const title = progress.mode === "selected-area" ? "Capturing selected area" : "Capturing screenshot";
  
  const percent = Math.min(100, Math.max(0, progress.percent || 0));
  
  let subtitle = "";
  if (progress.stage === "capturing" || progress.stage === "Capturing...") {
    subtitle = progress.currentChunk && progress.totalChunks
      ? `Capturing • ${progress.currentChunk} of ${progress.totalChunks}`
      : "Capturing…";
  } else if (progress.stage === "scrolling" || progress.stage === "Scrolling...") {
    subtitle = progress.currentChunk && progress.totalChunks
      ? `Scrolling page • ${progress.currentChunk} of ${progress.totalChunks}`
      : "Scrolling…";
  } else if (progress.stage === "stitching" || progress.stage === "Stitching...") {
    subtitle = "Stitching chunks…";
  } else if (progress.stage === "saving" || progress.stage === "Finalizing...") {
    subtitle = "Finalizing image…";
  } else if (progress.stage === "Preparing..." || progress.stage === "preparing") {
    subtitle = "Preparing capture…";
  } else if (progress.stage === "Processing..." || progress.stage === "processing") {
    subtitle = progress.currentChunk && progress.totalChunks
      ? `Processing • ${progress.currentChunk} of ${progress.totalChunks}`
      : "Processing…";
  } else {
    subtitle = progress.stage ? String(progress.stage) : "Processing…";
  }

  progressHud.innerHTML = `
    <div class="hud-header">
      <span class="hud-header-icon">✦</span>
      <span>ScreenX</span>
      <span style="color: rgba(255,255,255,0.4); margin: 0 8px;">|</span>
      <span style="color: #d4d4d8; font-weight: 500;">${title}</span>
    </div>
    <div class="hud-bar-bg">
      <div class="hud-bar-fill" style="width: ${percent}%;"></div>
    </div>
    <div class="hud-subtitle-row">
      <div class="hud-subtitle">${subtitle}</div>
      <div class="hud-percent">${percent}%</div>
    </div>
  `;
}

function hideProgressHud(): void {
  if (progressHud) {
    progressHud.style.display = "none";
  }
}

function showProgressHud(): void {
  if (progressHud) {
    progressHud.style.display = "block";
  }
}

function removeProgressHud(): void {
  if (progressHud && progressHud.parentNode) {
    progressHud.parentNode.removeChild(progressHud);
  }
  progressHud = null;
  cleanupUiRootIfEmpty();
}

// ---------------------------------------------------------------------------
// Toast UI system
// ---------------------------------------------------------------------------

interface ToastOptions {
  type: "success" | "error";
  message: string;
  title?: string;
}

function ensureToastContainer(): HTMLDivElement {
  const root = ensureUiRoot();
  if (!toastContainer || !toastContainer.parentNode) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    root.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(options: ToastOptions): void {
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

function createHud(): HTMLDivElement {
  const hud = document.createElement("div");
  hud.id = "__screenx_selection_hud";
  hud.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #18181b;
    color: #fafafa;
    padding: 12px 16px;
    border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    max-width: 92vw;
    pointer-events: auto;
  `;
  return hud;
}

function updateHudForStart(): void {
  const hud = selectionState.hud;
  if (!hud) return;
  hud.innerHTML = `
    <div style="font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px; justify-content:center;">
      <span style="width:8px;height:8px;border-radius:9999px;background:#22c55e;display:inline-block;"></span>
      Selected Area — Horizontal Range
    </div>
    <div style="margin-top:6px; color:#a1a1aa;">
      <b style="color:#fff;">Click</b> to set <span style="color:#22c55e; font-weight:600;">START</span> line
    </div>
    <div style="margin-top:6px; font-size:11px; color:#a1a1aa;">
      Scroll freely, then <b style="color:#fff;">Click</b> for <span style="color:#ef4444; font-weight:600;">END</span> &nbsp;•&nbsp;
      <b style="color:#fff; background:#27272a; padding:2px 6px; border-radius:6px;">Esc</b> to cancel
    </div>
  `;
}

function updateHudForEndPreview(): void {
  const hud = selectionState.hud;
  if (!hud || selectionState.startY === null) return;
  hud.innerHTML = `
    <div style="font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px; justify-content:center;">
      <span style="width:8px;height:8px;border-radius:9999px;background:#22c55e;display:inline-block;"></span>
      START at ${Math.round(selectionState.startY)}px — Click to set END
    </div>
    <div style="margin-top:6px; color:#a1a1aa;">
      Scroll freely, then <b style="color:#fff;">Click</b> for <span style="color:#ef4444; font-weight:600;">END</span>
    </div>
    <div style="margin-top:6px; font-size:11px; color:#a1a1aa;">
      <b style="color:#fff; background:#27272a; padding:2px 6px; border-radius:6px;">Esc</b> to cancel
    </div>
  `;
}

function updateHudForReady(): void {
  const hud = selectionState.hud;
  if (!hud || selectionState.startY === null || selectionState.endY === null) return;
  const sY = Math.min(selectionState.startY, selectionState.endY);
  const eY = Math.max(selectionState.startY, selectionState.endY);
  hud.innerHTML = `
    <div style="font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px; justify-content:center;">
      <span style="width:8px;height:8px;border-radius:9999px;background:#22c55e;display:inline-block;"></span>
      Range: ${Math.round(sY)}px → ${Math.round(eY)}px (${Math.round(Math.abs(eY - sY))}px)
    </div>
    <div style="margin-top:8px; display:flex; gap:8px; justify-content:center;">
      <button id="__screenx_capture_btn" style="background:#22c55e; color:white; border:none; padding:8px 14px; border-radius:8px; font-weight:600; cursor:pointer;">Capture Selected Area</button>
      <button id="__screenx_change_end_btn" style="background:#27272a; color:#fafafa; border:1px solid #3f3f46; padding:8px 12px; border-radius:8px; cursor:pointer;">Change END</button>
      <button id="__screenx_cancel_btn" style="background:transparent; color:#a1a1aa; border:1px solid #3f3f46; padding:8px 12px; border-radius:8px; cursor:pointer;">Cancel</button>
    </div>
    <div style="margin-top:6px; font-size:11px; color:#a1a1aa;">
      <b style="color:#fff; background:#27272a; padding:2px 6px; border-radius:6px;">Enter</b> to capture &nbsp;•&nbsp;
      <b style="color:#fff; background:#27272a; padding:2px 6px; border-radius:6px;">Esc</b> to cancel
    </div>
  `;

  const captureBtn = hud.querySelector("#__screenx_capture_btn") as HTMLButtonElement | null;
  const changeBtn = hud.querySelector("#__screenx_change_end_btn") as HTMLButtonElement | null;
  const cancelBtn = hud.querySelector("#__screenx_cancel_btn") as HTMLButtonElement | null;

  selectionState.captureButton = captureBtn;
  selectionState.changeEndButton = changeBtn;
  selectionState.cancelButton = cancelBtn;

  if (captureBtn) {
    captureBtn.addEventListener("click", () => triggerCapture());
  }
  if (changeBtn) {
    changeBtn.addEventListener("click", () => {
      // Reset END, return to WAITING_FOR_END
      if (selectionState.endLine) {
        try {
          selectionState.endLine.remove();
        } catch {
          // ignore
        }
        selectionState.endLine = null;
      }
      selectionState.endY = null;
      selectionState.state = "WAITING_FOR_END";
      attachPreviewListeners("click to set END", "rgba(239,68,68,0.9)");
      updateHudForEndPreview();
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => cancelSelectionMode());
  }
}

function triggerCapture(): void {
  if (selectionState.state === "CAPTURING" || selectionState.state === "COMPLETED") return;
  if (selectionState.startY === null || selectionState.endY === null || selectionState.state !== "END_SET") {
    if (selectionState.hud) {
      selectionState.hud.style.background = "#7f1d1d";
      const msg = selectionState.startY === null ? "Click to set START first" : "Click to set END first";
      selectionState.hud.innerHTML = `<div style="font-weight:600; color:#f87171;">${msg}</div>`;
      setTimeout(() => {
        if (selectionState.hud && selectionState.state !== "CAPTURING" && selectionState.state !== "COMPLETED") {
          selectionState.hud.style.background = "#0a0a0a";
          if (selectionState.startY === null) updateHudForStart();
          else if (selectionState.endY === null) updateHudForEndPreview();
          else updateHudForReady();
        }
      }, 900);
    }
    return;
  }

  let sY = Math.min(selectionState.startY, selectionState.endY);
  let eY = Math.max(selectionState.startY, selectionState.endY);
  const { totalHeight, totalWidth, viewportWidth } = measurePage();
  sY = Math.max(0, Math.min(sY, totalHeight - 1));
  eY = Math.max(sY + 10, Math.min(eY, totalHeight));

  if (eY - sY < 10) {
    if (selectionState.hud) {
      selectionState.hud.innerHTML = `<div style="font-weight:600; color:#f87171;">Range too small — choose further apart</div>`;
      setTimeout(() => {
        if (selectionState.hud && selectionState.state === "END_SET") {
          selectionState.hud.style.background = "#0a0a0a";
          updateHudForReady();
        }
      }, 800);
    }
    return;
  }

  selectionState.state = "CAPTURING";

  const width = Math.min(totalWidth, viewportWidth);
  const selection = { x: 0, width, startY: sY, endY: eY };

  // Remove all selection UI so the screenshot capture is 100% clean
  removeSelectionUI();
  selectionState.state = "COMPLETED";

  try {
    chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_COMPLETE", selection });
  } catch (e) {
    console.error("[ScreenX][SelectedArea] failed to send selection complete", e);
  }
}

function enterSelectionMode(): void {
  if (selectionState.state !== "IDLE") removeSelectionUI();
  selectionState.state = "WAITING_FOR_START";
  selectionState.startY = null;
  selectionState.endY = null;

  const hud = createHud();
  document.documentElement.appendChild(hud);
  selectionState.hud = hud;
  updateHudForStart();

  document.documentElement.style.cursor = "crosshair";

  attachPreviewListeners("click to set START", "rgba(34,197,94,0.9)");

  const keyHandler = (e: KeyboardEvent) => {
    if (selectionState.state === "IDLE" || selectionState.state === "CAPTURING" || selectionState.state === "COMPLETED") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelSelectionMode();
    } else if (e.key === "Enter" || e.key === "End") {
      if (selectionState.state === "END_SET") {
        e.preventDefault();
        e.stopPropagation();
        triggerCapture();
      }
    }
  };
  document.addEventListener("keydown", keyHandler, true);
  selectionState.keyHandler = keyHandler;

  const clickHandler = (e: MouseEvent) => {
    if (selectionState.state === "IDLE" || selectionState.state === "CAPTURING" || selectionState.state === "COMPLETED") return;
    // Ignore clicks on HUD buttons
    if (selectionState.hud && selectionState.hud.contains(e.target as Node)) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    const docY = getSelectionDocumentY(e);

    if (selectionState.state === "WAITING_FOR_START") {
      selectionState.state = "WAITING_FOR_END";
      selectionState.startY = docY;

      const startLine = createHorizontalLine(docY, "START", "#22c55e");
      (document.body || document.documentElement).appendChild(startLine);
      selectionState.startLine = startLine;

      attachPreviewListeners("click to set END", "rgba(239,68,68,0.9)");
      updateHudForEndPreview();
    } else if (selectionState.state === "WAITING_FOR_END") {
      selectionState.state = "END_SET";
      selectionState.endY = docY;

      const endLine = createHorizontalLine(docY, "END", "#ef4444");
      (document.body || document.documentElement).appendChild(endLine);
      selectionState.endLine = endLine;

      // Crucial: Remove preview line and mousemove/mouseenter/mouseleave listeners completely
      detachPreviewListeners();
      updateHudForReady();
    } else if (selectionState.state === "END_SET") {
      // User clicked on page to adjust END position
      const newEndY = docY;
      selectionState.endY = newEndY;
      if (selectionState.endLine) {
        selectionState.endLine.style.top = `${newEndY}px`;
      }
      updateHudForReady();
    }
  };
  document.addEventListener("click", clickHandler, true);
  selectionState.clickHandler = clickHandler;
}

function cancelSelectionMode(): void {
  removeSelectionUI();
  try {
    chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_CANCEL" });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;

  if (type === "PING_CONTENT") {
    sendResponse({ ok: true, url: location.href });
    return true;
  }

  (async () => {
    try {
      switch (type) {
        case "SCREENX_MEASURE_PAGE": {
          const m = measurePage();
          sendResponse(m);
          break;
        }
        case "SCREENX_PREPARE_CAPTURE": {
          const r = prepareCapture();
          sendResponse(r);
          break;
        }
        case "SCREENX_SCROLL_TO": {
          const { x, y } = message as { x: number; y: number };
          try {
            const r = await scrollToAndSettle(Number(x) || 0, Number(y) || 0);
            sendResponse({ ok: true, ...r });
          } catch (e) {
            sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }

        case "SCREENX_RESTORE_CAPTURE": {
          const r = restoreCapture();
          sendResponse(r);
          break;
        }
        case "SCREENX_START_SELECTION": {
          enterSelectionMode();
          sendResponse({ ok: true });
          break;
        }
        case "SCREENX_CANCEL_SELECTION": {
          cancelSelectionMode();
          try { chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_CANCEL" }); } catch {
          // ignore
        }
          sendResponse({ ok: true });
          break;
        }
        case "SCREENX_PROGRESS": {
          const p = (message as { progress?: ProgressPayload }).progress;
          if (p) {
            updateProgressHud(p);
          }
          sendResponse({ ok: true });
          break;
        }
        case "SCREENX_HIDE_PROGRESS": {
          hideProgressHud();
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
          sendResponse({ ok: true });
          break;
        }
        case "SCREENX_SHOW_PROGRESS": {
          showProgressHud();
          sendResponse({ ok: true });
          break;
        }
        case "SCREENX_TOAST": {
          const t = (message as { toast?: ToastOptions }).toast;
          if (t) {
            showToast(t);
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ error: `Unknown message type: ${type}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ScreenX] content handler error", JSON.stringify({ code: "CAPTURE_FAILED", message: msg }));
      try { sendResponse({ error: msg }); } catch {
          // ignore
        }
    }
  })();

  return true;
});

} // end guard
export {};
