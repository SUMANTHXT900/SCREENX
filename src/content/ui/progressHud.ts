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
let barFill: HTMLDivElement | null = null;
let subtitleEl: HTMLDivElement | null = null;
let percentEl: HTMLDivElement | null = null;
let titleEl: HTMLSpanElement | null = null;
// Last rendered text signature — identical updates skip DOM writes entirely,
// so rapid duplicate messages can never shimmer the HUD.
let lastTextKey = "";

function subtitleFor(progress: ProgressPayload): string {
  const counts =
    progress.currentChunk && progress.totalChunks
      ? ` • ${progress.currentChunk} of ${progress.totalChunks}`
      : "";
  if (progress.stage === "capturing" || progress.stage === "Capturing...") {
    return `Capturing${counts}`;
  } else if (progress.stage === "scrolling" || progress.stage === "Scrolling...") {
    return `Scrolling${counts}`;
  } else if (progress.stage === "stitching" || progress.stage === "Stitching...") {
    return "Stitching chunks…";
  } else if (progress.stage === "saving" || progress.stage === "Finalizing...") {
    return "Finalizing image…";
  } else if (progress.stage === "Preparing..." || progress.stage === "preparing") {
    return "Preparing capture…";
  } else if (progress.stage === "Processing..." || progress.stage === "processing") {
    return `Processing${counts}`;
  }
  return progress.stage ? String(progress.stage) : "Processing…";
}

function ensureHud(): HTMLDivElement | null {
  if (progressHud && progressHud.isConnected) return progressHud;
  try {
    const root = ensureUiRoot();
    progressHud = document.createElement("div");
    progressHud.className = "hud-container";
    // Static skeleton once — updates below only touch text/width, so CSS
    // animations never restart and layout never thrashes.
    // Roomy two-line layout: the reserve constrains HEIGHT (top band rows),
    // never width — so text gets full measure instead of ellipsis.
    progressHud.innerHTML = `
      <div class="hud-header">
        <span class="hud-header-icon">✦</span>
        <span>ScreenX</span>
        <span style="color: rgba(255,255,255,0.4); margin: 0 8px;">|</span>
        <span data-sx-title style="color: #d4d4d8; font-weight: 500;"></span>
        <span data-sx-percent style="margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; padding-left: 16px;"></span>
      </div>
      <div class="hud-bar-bg">
        <div class="hud-bar-fill" style="width: 0%;"></div>
      </div>
      <div class="hud-subtitle-row">
        <div class="hud-subtitle" data-sx-subtitle style="white-space: nowrap;"></div>
      </div>
    `;
    root.appendChild(progressHud);
    barFill = progressHud.querySelector(".hud-bar-fill");
    subtitleEl = progressHud.querySelector("[data-sx-subtitle]");
    percentEl = progressHud.querySelector("[data-sx-percent]");
    titleEl = progressHud.querySelector("[data-sx-title]");
    lastTextKey = "";
    progressHud.style.visibility = "visible";
  } catch {
    progressHud = null;
  }
  return progressHud;
}

export function updateProgressHud(progress: ProgressPayload): void {
  const hud = ensureHud();
  if (!hud || !barFill || !subtitleEl || !percentEl || !titleEl) return;

  const title = progress.mode === "selected-area" ? "Capturing selected area" : "Capturing screenshot";
  const percent = Math.min(100, Math.max(0, progress.percent || 0));
  const subtitle = subtitleFor(progress);

  // Text nodes only re-write on real change; the bar width eases via CSS.
  // Visibility is NEVER touched here — hide/show messages own it, so updates
  // can neither blink the HUD nor resurrect it mid-exposure.
  const key = `${title}|${subtitle}|${progress.currentChunk ?? ""}|${progress.totalChunks ?? ""}`;
  if (key !== lastTextKey) {
    lastTextKey = key;
    titleEl.textContent = title;
    subtitleEl.textContent = subtitle;
  }
  const width = `${percent}%`;
  if (barFill.style.width !== width) barFill.style.width = width;
  const label = `${percent}%`;
  if (percentEl.textContent !== label) percentEl.textContent = label;
}

export function hideProgressHud(): void {
  // visibility (not display): no layout shift, animations keep running, and
  // hidden content is still excluded from screenshots.
  if (progressHud) {
    progressHud.style.visibility = "hidden";
  }
}

export function showProgressHud(): void {
  if (progressHud) {
    progressHud.style.visibility = "visible";
  }
}

export function removeProgressHud(): void {
  if (progressHud && progressHud.parentNode) {
    progressHud.parentNode.removeChild(progressHud);
  }
  progressHud = null;
  barFill = null;
  subtitleEl = null;
  percentEl = null;
  titleEl = null;
  lastTextKey = "";
  cleanupUiRootIfEmpty();
}
