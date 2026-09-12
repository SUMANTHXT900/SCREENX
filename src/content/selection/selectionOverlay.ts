/**
 * Selection overlay — dim sheet, drag box, bottom handle, coach-mark hint,
 * size label, and drawing guides (plan: content/selection/selectionOverlay.ts).
 * Mounted in the shadow host so page CSS can never restyle it. The box is a
 * FIXED window on the screen (viewport coordinates); content scrolls behind
 * it during handle drags.
 */
import { ensureUiRoot, cleanupUiRootIfEmpty, pinUiRoot, unpinUiRoot } from "../ui/shadowHost";
import type { SelectionBox } from "./SelectionStateMachine";

export interface OverlayRefs {
  dim: HTMLDivElement;
  box: HTMLDivElement;
  handle: HTMLDivElement;
  handleTop: HTMLDivElement;
  hint: HTMLDivElement;
  label: HTMLDivElement;
  guideV: HTMLDivElement;
  guideH: HTMLDivElement;
}

let refs: OverlayRefs | null = null;
let styleEl: HTMLStyleElement | null = null;
let reviewBar: HTMLDivElement | null = null;
let cornerXBtn: HTMLButtonElement | null = null;
/** Tab-trap registration (root outlives overlays — must be removed explicitly). */
let trapReg: { root: ShadowRoot; fn: (e: Event) => void } | null = null;

const ACCENT = "#4ADE80";

const DIM_CSS = `
  position: fixed;
  inset: 0;
  background: rgba(8,8,10,0.55);
  cursor: crosshair;
  pointer-events: auto;
  z-index: 1;
  animation: __sxFadeIn 0.18s ease-out;
`;

const BOX_CSS = `
  position: fixed;
  display: none;
  border: 1.5px solid ${ACCENT};
  background: rgba(74,222,128,0.08);
  box-shadow: 0 0 0 9999px rgba(8,8,10,0.55);
  pointer-events: none;
  z-index: 2;
`;

const CORNER_CSS = `
  position: absolute;
  width: 16px;
  height: 16px;
  border: 0 solid #ffffff;
  filter: drop-shadow(0 1px 4px rgba(0,0,0,0.6));
  pointer-events: none;
`;

const HANDLE_CSS = `
  position: absolute;
  left: 50%;
  bottom: -15px;
  transform: translateX(-50%);
  width: 88px;
  height: 28px;
  border-radius: 0;
  background: #4ADE80;
  border: 2px solid #000;
  box-shadow: 3px 3px 0 #000;
  cursor: ns-resize;
  pointer-events: auto;
  display: none;
`;

const HANDLE_TOP_CSS = `
  position: absolute;
  left: 50%;
  top: -15px;
  transform: translateX(-50%);
  width: 88px;
  height: 28px;
  border-radius: 0;
  background: #4ADE80;
  border: 2px solid #000;
  box-shadow: 3px 3px 0 #000;
  cursor: ns-resize;
  pointer-events: auto;
  display: none;
`;

const HANDLE_CHEVRON_UP_CSS = `
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 6px solid #000;
  pointer-events: none;
`;

const HANDLE_INNER_CSS = `
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  pointer-events: none;
`;

const HANDLE_DOT_CSS = `
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: #000;
  pointer-events: none;
`;

const HINT_CSS = `
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  background: #FFFDF7;
  color: #000;
  padding: 10px 16px;
  border-radius: 0;
  border: 3px solid #000;
  box-shadow: 5px 5px 0 #000;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
  pointer-events: none;
  white-space: nowrap;
  animation: __sxSlideDown 0.22s ease-out;
`;

const LABEL_CSS = `
  position: fixed;
  display: none;
  z-index: 3;
  background: #000;
  color: #4ADE80;
  border: 2px solid #000;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 0;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 3px 3px 0 rgba(0,0,0,0.55);
`;

const GUIDE_CSS = `
  position: fixed;
  display: none;
  background-image: linear-gradient(to right, rgba(74,222,128,0.8) 55%, transparent 45%);
  background-size: 9px 1px;
  background-repeat: repeat-x;
  pointer-events: none;
  z-index: 2;
`;

const STYLE_TAG_ID = "__screenx_selection_css";

const CORNER_X_CSS = `
  position: fixed;
  top: 16px;
  right: 16px;
  width: 34px;
  height: 34px;
  border-radius: 0;
  background: #FFFDF7;
  border: 2px solid #000;
  color: #000;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 3px 3px 0 #000;
`;

const REVIEW_BAR_CSS = `
  position: fixed;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 5;
  background: #FFFDF7;
  border: 3px solid #000;
  padding: 8px;
  padding-left: 14px;
  border-radius: 0;
  box-shadow: 5px 5px 0 #000;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #000;
  pointer-events: auto;
  white-space: nowrap;
  animation: __sxSlideDown 0.18s ease-out;
`;

const REVIEW_BTN_PRIMARY_CSS = `
  background: #000;
  color: #fff;
  border: 2px solid #000;
  box-shadow: 3px 3px 0 rgba(0,0,0,0.35);
  padding: 8px 16px;
  border-radius: 0;
  font-weight: 800;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
`;

const REVIEW_BTN_GHOST_CSS = `
  background: #fff;
  color: #000;
  border: 2px solid #000;
  box-shadow: 3px 3px 0 #000;
  padding: 8px 14px;
  border-radius: 0;
  font-weight: 700;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
`;

const MINI_HINT_CSS = `
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const KEYFRAMES_CSS = `
  @keyframes __sxFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes __sxSlideDown {
    from { opacity: 0; transform: translate(-50%, -10px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes __sxHandleBounce {
    0%, 100% { margin-bottom: 0; }
    50% { margin-bottom: 7px; }
  }
  @keyframes __sxHandleGlow {
    0%, 100% { box-shadow: 3px 3px 0 #000, 0 0 0 0 rgba(74,222,128,0.6); }
    50% { box-shadow: 3px 3px 0 #000, 0 0 0 9px rgba(74,222,128,0); }
  }
  .__sx-handle-pulse {
    animation: __sxHandleBounce 1.15s ease-in-out infinite, __sxHandleGlow 1.6s ease-out infinite !important;
  }
  .__sx-handle-done {
    background: #52525b !important;
    animation: none !important;
  }
  @media (prefers-reduced-motion: reduce) {
    div, button { animation: none !important; }
  }
`;

function ensureStyle(root: ShadowRoot): void {
  if (root.getElementById(STYLE_TAG_ID)) return;
  styleEl = document.createElement("style");
  styleEl.id = STYLE_TAG_ID;
  styleEl.textContent = KEYFRAMES_CSS;
  root.appendChild(styleEl);
}

function makeCorner(positionCss: string, bordersCss: string): HTMLDivElement {
  const c = document.createElement("div");
  c.style.cssText = `${CORNER_CSS} ${positionCss} ${bordersCss}`;
  return c;
}

export function mountOverlay(onCancel: () => void): OverlayRefs {
  destroyOverlay();
  const root = ensureUiRoot();
  ensureStyle(root);

  const dim = document.createElement("div");
  dim.style.cssText = DIM_CSS;
  // Dialog semantics: focus moves here on mount, Tab stays inside, stage
  // hints announce via the live region (see hint below).
  dim.setAttribute("role", "dialog");
  dim.setAttribute("aria-modal", "true");
  dim.setAttribute("aria-label", "Select screenshot area");

  const box = document.createElement("div");
  box.style.cssText = BOX_CSS;
  // Snagit-style corner brackets ride on the box for free (children need no
  // per-frame positioning of their own).
  box.appendChild(makeCorner("top: -2px; left: -2px;", "border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 5px;"));
  box.appendChild(makeCorner("top: -2px; right: -2px;", "border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 5px;"));
  box.appendChild(makeCorner("bottom: -2px; left: -2px;", "border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 5px;"));
  box.appendChild(makeCorner("bottom: -2px; right: -2px;", "border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 5px;"));

  const handle = document.createElement("div");
  handle.style.cssText = HANDLE_CSS;
  handle.title = "Drag down to extend through scrolling content";
  const grip = document.createElement("div");
  grip.style.cssText = HANDLE_INNER_CSS;
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("div");
    dot.style.cssText = HANDLE_DOT_CSS;
    grip.appendChild(dot);
  }
  // Down chevron (pure CSS triangle) — the handle only ever moves downward.
  const chevron = document.createElement("div");
  chevron.style.cssText = `
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid #000;
    pointer-events: none;
  `;
  grip.appendChild(chevron);
  handle.appendChild(grip);
  box.appendChild(handle);

  const handleTop = document.createElement("div");
  handleTop.style.cssText = HANDLE_TOP_CSS;
  handleTop.title = "Drag up to extend through content above";
  const gripTop = document.createElement("div");
  gripTop.style.cssText = HANDLE_INNER_CSS;
  const chevronUp = document.createElement("div");
  chevronUp.style.cssText = HANDLE_CHEVRON_UP_CSS;
  gripTop.appendChild(chevronUp);
  handleTop.appendChild(gripTop);
  box.appendChild(handleTop);

  const hint = document.createElement("div");
  hint.style.cssText = HINT_CSS;
  hint.setAttribute("aria-live", "polite");

  const label = document.createElement("div");
  label.style.cssText = LABEL_CSS;

  const guideV = document.createElement("div");
  guideV.style.cssText = `${GUIDE_CSS} top: 0; bottom: 0; width: 1px; background-image: linear-gradient(to bottom, rgba(74,222,128,0.8) 55%, transparent 45%); background-size: 1px 9px; background-repeat: repeat-y;`;

  const guideH = document.createElement("div");
  guideH.style.cssText = `${GUIDE_CSS} left: 0; right: 0; height: 1px;`;

  dim.appendChild(box);
  root.appendChild(dim);
  root.appendChild(hint);
  root.appendChild(label);
  root.appendChild(guideV);
  root.appendChild(guideH);

  cornerXBtn = document.createElement("button");
  cornerXBtn.style.cssText = CORNER_X_CSS;
  cornerXBtn.title = "Cancel selection (Esc)";
  cornerXBtn.setAttribute("aria-label", "Cancel selection");
  cornerXBtn.textContent = "✕";
  cornerXBtn.addEventListener("click", () => onCancel());
  root.appendChild(cornerXBtn);

  // Move keyboard/screen-reader context into the overlay; Tab cycles among
  // overlay buttons only (page behind the dim is unreachable by keyboard).
  // Review-bar buttons mount later — the trap queries live on each Tab.
  // Registered on the shadow root (covers dim + corner button + review bar),
  // removed in destroyOverlay (root outlives overlays — shared with toasts).
  trapReg = {
    root,
    fn: (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "Tab") return;
      try {
        const scope = ensureUiRoot();
        const items = Array.from(scope.querySelectorAll("button")).filter(
          (b) => b instanceof HTMLElement && !b.hasAttribute("disabled") && scope.contains(b)
        ) as HTMLElement[];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = scope.activeElement ?? document.activeElement;
        if (ke.shiftKey && (active === first || !scope.contains(active))) {
          ke.preventDefault();
          ke.stopPropagation();
          last.focus();
        } else if (!ke.shiftKey && active === last) {
          ke.preventDefault();
          ke.stopPropagation();
          first.focus();
        }
      } catch {
        // ignore — trap is best-effort
      }
    },
  };
  root.addEventListener("keydown", trapReg.fn, true);
  try {
    cornerXBtn.focus();
  } catch {
    // ignore
  }

  refs = { dim, box, handle, handleTop, hint, label, guideV, guideH };
  // Pin AFTER refs is set: pairs with the unpin in destroyOverlay, so a
  // pending shadow-host cleanup can never yank a live overlay (see pinUiRoot).
  pinUiRoot();
  return refs;
}

export function getOverlay(): OverlayRefs | null {
  return refs;
}

export function destroyOverlay(): void {
  if (trapReg) {
    try {
      trapReg.root.removeEventListener("keydown", trapReg.fn, true);
    } catch {
      // ignore
    }
    trapReg = null;
  }
  if (refs) {
    for (const el of [refs.dim, refs.hint, refs.label, refs.guideV, refs.guideH]) {
      try {
        el.remove();
      } catch {
        // ignore
      }
    }
    refs = null;
    // Paired with the pin in mountOverlay (guarded by refs so stray destroys
    // can't drive the count negative — unpinUiRoot also clamps at 0).
    unpinUiRoot();
  }
  if (reviewBar) {
    try {
      reviewBar.remove();
    } catch {
      // ignore
    }
    reviewBar = null;
  }
  if (cornerXBtn) {
    try {
      cornerXBtn.remove();
    } catch {
      // ignore
    }
    cornerXBtn = null;
  }
  try {
    styleEl?.remove();
  } catch {
    // ignore
  }
  styleEl = null;
  cleanupUiRootIfEmpty();
}

/** Hide the dim sheet momentarily (e.g. for elementFromPoint lookups). */
export function peekThrough(): () => void {
  if (!refs) return () => {};
  const prev = refs.dim.style.pointerEvents;
  refs.dim.style.pointerEvents = "none";
  return () => {
    try {
      if (refs) refs.dim.style.pointerEvents = prev || "auto";
    } catch {
      // ignore
    }
  };
}

export function paintBox(r: OverlayRefs, box: SelectionBox | null): void {
  if (!box) {
    r.box.style.display = "none";
    return;
  }
  r.box.style.display = "block";
  r.box.style.left = `${box.left}px`;
  r.box.style.top = `${box.top}px`;
  r.box.style.width = `${box.width}px`;
  r.box.style.height = `${box.height}px`;
}

export function setHandleVisible(r: OverlayRefs, visible: boolean): void {
  r.handle.style.display = visible ? "block" : "none";
  r.handleTop.style.display = visible ? "block" : "none";
}

/** Attention pulse + bounce until the user grabs the handle. */
export function setHandlePulse(r: OverlayRefs, pulsing: boolean): void {
  try {
    r.handle.classList.toggle("__sx-handle-pulse", pulsing);
  } catch {
    // ignore
  }
}

export type SelectionStage = 1 | 2 | 3;

const STAGE_STEPS = ["Select", "Extend", "Release"] as const;

/** Three-step coach mark; active step highlighted, past steps checked. */
export function setOverlayStage(r: OverlayRefs, stage: SelectionStage, trailing?: string): void {
  r.hint.textContent = "";
  STAGE_STEPS.forEach((label, i) => {
    const n = i + 1;
    const dot = document.createElement("span");
    const done = n < stage;
    const active = n === stage;
    dot.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 0;
      font-size: 11px;
      font-weight: 800;
      margin-right: 6px;
      vertical-align: -4px;
      background: ${done ? "#000" : active ? ACCENT : "#fff"};
      color: ${done ? "#4ADE80" : active ? "#000" : "rgba(0,0,0,0.45)"};
      border: 2px solid #000;
    `;
    dot.textContent = done ? "✓" : String(n);
    const text = document.createElement("span");
    text.style.cssText = `color: ${active ? "#000" : "rgba(0,0,0,0.5)"}; font-weight: ${active ? "800" : "500"}; margin-right: 14px;`;
    text.textContent = label;
    r.hint.append(dot, text);
  });
  if (trailing) {
    const t = document.createElement("div");
    t.style.cssText = "margin-top: 5px; font-size: 12px; color: rgba(0,0,0,0.6);";
    t.textContent = trailing;
    r.hint.append(t);
  }
  const esc = document.createElement("div");
  esc.style.cssText = "margin-top: 6px; font-size: 11px; color: rgba(0,0,0,0.55);";
  esc.textContent = "Press ";
  const key = document.createElement("span");
  key.style.cssText = `
    background: #fff;
    border: 2px solid #000;
    padding: 1px 7px;
    border-radius: 0;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #000;
  `;
  key.textContent = "Esc";
  esc.append(key, " to cancel anytime");
  r.hint.append(esc);
}

/** @deprecated Prefer setOverlayStage; kept for error paths. */
export function setOverlayHint(r: OverlayRefs, message: string): void {
  r.hint.textContent = "";
  r.hint.append(message + "  ·  ");
  const key = document.createElement("span");
  key.style.cssText = `
    background: #fff;
    border: 2px solid #000;
    padding: 2px 6px;
    border-radius: 0;
    font-weight: 700;
  `;
  key.textContent = "Esc";
  r.hint.append(key, " to cancel");
}

export function setOverlayHintError(r: OverlayRefs, message: string): void {
  r.hint.textContent = message;
}

export function paintLabel(
  r: OverlayRefs,
  box: SelectionBox | null,
  extra?: string
): void {
  if (!box) {
    r.label.style.display = "none";
    return;
  }
  r.label.style.display = "block";
  r.label.style.left = `${box.left}px`;
  r.label.style.top = `${box.top >= 26 ? box.top - 24 : box.top + box.height + 6}px`;
  r.label.textContent =
    `${Math.round(box.width)} × ${Math.round(box.height)}${extra ? `  ·  ${extra}` : ""}`;
}

/** Compact one-line pill used after stage 1 so the hint stops covering content. */
export function showMiniHint(r: OverlayRefs, text: string): void {
  r.hint.textContent = "";
  const row = document.createElement("span");
  row.style.cssText = MINI_HINT_CSS;
  const dot = document.createElement("span");
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    background: #22c55e;
    display: inline-block;
  `;
  const msg = document.createElement("span");
  msg.textContent = text;
  row.append(dot, msg);
  r.hint.append(row);
}

/** Neutral busy state (e.g. while settle-waits run before capture fires). */
export function setOverlayBusy(r: OverlayRefs, message: string): void {
  r.hint.textContent = "";
  const row = document.createElement("span");
  row.style.cssText = MINI_HINT_CSS;
  const dot = document.createElement("span");
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    background: #000;
    display: inline-block;
    animation: __sxHandleGlow 1.2s ease-out infinite;
  `;
  const msg = document.createElement("span");
  msg.textContent = message;
  row.append(dot, msg);
  r.hint.append(row);
}

export interface ReviewCallbacks {
  onCapture: () => void;
  onAdjust: () => void;
  onCancel: () => void;
}

function placeReviewBar(bar: HTMLDivElement, box: SelectionBox | null): void {
  const BAR_H = 56;
  let top: number;
  if (box && box.top + box.height + 12 + BAR_H < window.innerHeight) {
    top = box.top + box.height + 12;
  } else if (box) {
    top = Math.max(12, box.top - 12 - BAR_H);
  } else {
    top = window.innerHeight - BAR_H - 16;
  }
  const left = box ? Math.max(12, Math.min(box.left, window.innerWidth - 280)) : 12;
  bar.style.top = `${Math.round(top)}px`;
  bar.style.left = `${Math.round(left)}px`;
}

/** Review beat: explicit Capture / Adjust choice instead of instant fire. */
export function showReviewBar(
  r: OverlayRefs,
  box: SelectionBox | null,
  cb: ReviewCallbacks
): void {
  hideReviewBar();
  const root = r.dim.getRootNode() as ShadowRoot | Document;
  const host = root instanceof ShadowRoot ? root : document.body;
  const bar = document.createElement("div");
  bar.style.cssText = REVIEW_BAR_CSS;

  const label = document.createElement("span");
  label.style.cssText = "color: rgba(0,0,0,0.65); padding-right: 4px; font-weight: 700;";
  label.textContent = box
    ? `${Math.round(box.width)} × ${Math.round(box.height)}`
    : "Review selection";

  const captureBtn = document.createElement("button");
  captureBtn.style.cssText = REVIEW_BTN_PRIMARY_CSS;
  captureBtn.textContent = "✓ Capture";
  captureBtn.addEventListener("click", () => cb.onCapture());

  const adjustBtn = document.createElement("button");
  adjustBtn.style.cssText = REVIEW_BTN_GHOST_CSS;
  adjustBtn.textContent = "Adjust";
  adjustBtn.addEventListener("click", () => cb.onAdjust());

  bar.append(label, captureBtn, adjustBtn);
  placeReviewBar(bar, box);
  host.appendChild(bar);
  reviewBar = bar;
  void r;
}

export function hideReviewBar(): void {
  if (reviewBar) {
    try {
      reviewBar.remove();
    } catch {
      // ignore
    }
    reviewBar = null;
  }
}

export function moveReviewBar(r: OverlayRefs, box: SelectionBox | null): void {
  if (reviewBar) placeReviewBar(reviewBar, box);
  void r;
}

/** Grey out the handle once the scrollable end is reached. */
export function setHandleExhausted(r: OverlayRefs, exhausted: boolean): void {
  try {
    r.handle.classList.toggle("__sx-handle-done", exhausted);
    if (exhausted) r.handle.classList.remove("__sx-handle-pulse");
  } catch {
    // ignore
  }
}
/** Design-tool crosshair guides tracking the cursor while drawing. */
export function setGuides(r: OverlayRefs, x: number | null, y: number | null): void {
  if (x === null || y === null) {
    r.guideV.style.display = "none";
    r.guideH.style.display = "none";
    return;
  }
  r.guideV.style.display = "block";
  r.guideV.style.left = `${x}px`;
  r.guideH.style.display = "block";
  r.guideH.style.top = `${y}px`;
}
