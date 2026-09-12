/**
 * Download filenames — short and meaningful: `<source>_<date>[<parts>].<ext>`
 * e.g. `githubcom_12sep26.png`. No dashes, no time, no mode — just where
 * and when. Pure (no chrome APIs) — shared by the background download
 * handler, the editor export, and the workspace gallery.
 * Tested in tests/downloadName.test.ts.
 */
import type { CaptureType } from "@/types/capture";

export interface DownloadNameInput {
  sourceUrl?: string;
  /** Accepted for backwards compatibility; no longer part of the name. */
  type?: CaptureType | string;
  createdAt?: number;
  partIndex?: number;
  partTotal?: number;
  /** Extension without dot. Defaults to "png". */
  ext?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Date only: `12sep26` (DDmmmYY). */
export function stampFor(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}${MONTHS[date.getMonth()]}${String(date.getFullYear()).slice(2)}`;
}

/** Host → bare slug, letters+digits only (`sub.example.com` → `subexamplecom`). */
export function hostSlug(url: string | undefined): string {
  if (!url) return "capture";
  try {
    const slug = new URL(url).hostname.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    return slug || "capture";
  } catch {
    return "capture";
  }
}

export function buildDownloadFilename(input: DownloadNameInput): string {
  const date = new Date(input.createdAt ?? Date.now());
  // Multi-part captures share one stamp, so keep a tiny part marker —
  // otherwise the parts save as identical names and ordering is lost.
  const suffix =
    input.partTotal && input.partTotal > 1 && input.partIndex
      ? `_p${input.partIndex}of${input.partTotal}`
      : "";
  // Extension allowlist: blocks directory traversal via a hostile `ext`.
  const rawExt = (input.ext || "png").replace(/^\./, "").toLowerCase();
  const ext = rawExt === "png" || rawExt === "jpg" || rawExt === "jpeg" || rawExt === "webp" ? rawExt : "png";
  return `${hostSlug(input.sourceUrl)}_${stampFor(date)}${suffix}.${ext}`;
}

/** Extension-less base for flows that append the ext at save time (editor export). */
export function captureFileBase(input: Omit<DownloadNameInput, "ext" | "partIndex" | "partTotal">): string {
  return buildDownloadFilename({ ...input, ext: "png" }).replace(/\.png$/, "");
}
