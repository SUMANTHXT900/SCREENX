/**
 * Clipboard target classification — pure (no chrome APIs), tested in
 * tests/clipboardTarget.test.ts.
 *
 * A content-script clipboard write needs a secure context AND a focused
 * document owned by a normal page. Classify the capture tab URL up front so
 * the handler skips doomed auto-copy attempts (instead of failing loudly)
 * and the choice toast can say WHY copy needs attention.
 */
export type ClipboardTargetKind = "writable" | "insecure" | "restricted";

export interface ClipboardTarget {
  kind: ClipboardTargetKind;
  /** Short human reason, used in debug logs. */
  reason: string;
}

const RESTRICTED_SCHEMES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "brave://",
  "opera://",
  "vivaldi://",
  "about:",
  "chrome-search://",
  "view-source:",
  "devtools://",
];

/** Hosts where Chrome blocks content-script injection entirely. */
const BLOCKED_HOSTS = ["chrome.google.com", "chromewebstore.google.com"];

function reasonFor(kind: ClipboardTargetKind, detail: string): ClipboardTarget {
  return { kind, reason: detail };
}

export function classifyClipboardTarget(url: string | undefined): ClipboardTarget {
  // Unknown tab (closed mid-flight, no URL yet): preserve today's best-effort
  // behavior and attempt the write — it fails gracefully to the Copy button.
  if (!url) return reasonFor("writable", "unknown-url-best-effort");

  const lower = url.toLowerCase();
  for (const scheme of RESTRICTED_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return reasonFor("restricted", `restricted-scheme:${scheme}`);
    }
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable — attempt best-effort as today.
    return reasonFor("writable", "unparseable-url-best-effort");
  }

  if (BLOCKED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return reasonFor("restricted", `blocked-host:${parsed.hostname}`);
  }

  // navigator.clipboard is undefined in content scripts on plain http
  // (localhost is a secure context — writable). Keep https/file/app schemes
  // on the writable path.
  if (parsed.protocol === "http:") {
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return reasonFor("writable", "localhost-secure-context");
    }
    return reasonFor("insecure", "http-no-secure-context");
  }

  return reasonFor("writable", "secure-context");
}
