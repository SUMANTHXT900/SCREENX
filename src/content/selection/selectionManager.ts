import { getSelectionDocumentY } from "../dom/scrollController.js";
import { measurePage } from "../dom/occlusion.js";

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

export function triggerCapture(): void {
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

  removeSelectionUI();
  selectionState.state = "COMPLETED";

  try {
    chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_COMPLETE", selection });
  } catch (e) {
    console.error("[ScreenX][SelectedArea] failed to send selection complete", e);
  }
}

export function enterSelectionMode(): void {
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

      detachPreviewListeners();
      updateHudForReady();
    } else if (selectionState.state === "END_SET") {
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

export function cancelSelectionMode(): void {
  removeSelectionUI();
  try {
    chrome.runtime.sendMessage({ type: "SCREENX_SELECTION_CANCEL" });
  } catch {
    // ignore
  }
}
