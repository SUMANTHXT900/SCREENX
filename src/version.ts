/**
 * Single source of truth for the build identity shown in the UI.
 *
 * Bump BOTH on every shipped change + give it a funny codename tied to the
 * change (redcross = red X button, talkbox = text-tool fix, ...). The popup
 * AND editor header render this, so a glance tells whether a tab runs the
 * latest build or a stale one (extension pages do NOT auto-reload — an old
 * editor.html tab keeps old JS until manually reloaded).
 *
 * Keep manifest.json `version` in sync manually (Chrome requires it there).
 */
export const APP_VERSION = "0.1.24";
export const APP_CODENAME = "courier";

export function buildTag(proto?: number): string {
  const base = `v${APP_VERSION}-${APP_CODENAME}`;
  return proto === undefined ? base : `${base} · proto ${proto}`;
}
