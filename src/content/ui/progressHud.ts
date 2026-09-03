import { ensureUiRoot, cleanupUiRootIfEmpty } from "./shadowHost.js";

export interface ProgressPayload {
  mode?: string;
  stage?: string;
  percent?: number;
  currentChunk?: number;
  totalChunks?: number;
  [key: string]: unknown;
}

let progressHud: HTMLDivElement | null = null;

export function updateProgressHud(progress: ProgressPayload): void {
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

export function hideProgressHud(): void {
  if (progressHud) {
    progressHud.style.display = "none";
  }
}

export function showProgressHud(): void {
  if (progressHud) {
    progressHud.style.display = "block";
  }
}

export function removeProgressHud(): void {
  if (progressHud && progressHud.parentNode) {
    progressHud.parentNode.removeChild(progressHud);
  }
  progressHud = null;
  cleanupUiRootIfEmpty();
}
