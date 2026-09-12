# ScreenX Privacy Policy

**Effective:** 12 September 2026
**TL;DR: ScreenX works 100% offline. Your screenshots and data never leave your device — there are no servers, no accounts, no analytics, and no telemetry.**

## 1. Single purpose

ScreenX captures screenshots of web pages you choose (visible area, full page, or a selected region), lets you annotate them, and saves them locally. Every data practice below exists solely to provide that functionality.

## 2. What we collect (on your device only)

All collection is user-initiated — ScreenX does nothing until you press a capture button or shortcut.

| Data | Why | Where it lives |
|---|---|---|
| Screenshot pixels (whatever is visible on your screen, which may include personal content) | The product itself — capture, annotate, save | IndexedDB, on your device |
| Page URL, page title, image dimensions, capture time | Organize Workspace/History; meaningful filenames | IndexedDB + `chrome.storage.local` |
| Your annotations (shapes, text, crops) | Editor drafts so work survives reloads | `chrome.storage.local` |
| Settings (export format, quality) | Remember your export preferences | `chrome.storage.local` |
| Capture history (metadata only, no image blobs; max 200 entries) | History view | `chrome.storage.local` |
| Pending-capture pointers, your current selection wait | Survive service-worker restarts mid-capture | `chrome.storage.session` (cleared when the browser closes) |

## 3. What we never do

- **No transmission.** Nothing is uploaded, synced, or sent anywhere. There is no backend.
- **No analytics or telemetry.** No usage tracking, no crash reporting, no cookies.
- **No advertising.** Your data is never used for ads and never shared with advertisers or data brokers.
- **No human review.** Nobody can see your screenshots — they exist only in your browser profile.
- **No account.** No sign-in, no identifiers, nothing to link captures to you.

## 4. Limited-use commitment

User data (screenshots and page metadata) is used **only** to provide ScreenX's single purpose described above. We do not transfer it to anyone except (a) as required by law, (b) for security purposes such as investigating abuse, or (c) as part of a merger, acquisition, or asset sale — and since everything is stored locally on your device, even those cases involve no data held by us.

## 5. System integrations (still local)

- **Clipboard:** on capture, the image is written to *your operating system's clipboard* (auto-copy) so you can paste immediately; the Copy button does the same on demand. Clipboard content never leaves your machine through ScreenX.
- **Downloads:** saving writes the file to *your* downloads folder only.
- **Notifications:** capture Toasts/notifications are rendered locally by your browser.

## 6. Retention and deletion — you are in control

- **Workspace:** captures persist until you delete them (per image or per group).
- **History:** rolling log of the 200 most recent captures; per-entry Delete and Clear erase lines permanently (deleted lines are tombstoned so sync never resurrects them).
- **Session data:** pending pointers and selection markers expire automatically (minutes) and vanish when the browser closes.
- **Full wipe:** removing the extension deletes all of the above — Chrome clears extension storage on uninstall.

## 7. Permissions — why each one is needed

| Permission | Used for |
|---|---|
| `activeTab` | Capture the page you invoke ScreenX on; show toasts there |
| `storage` | Persist captures, history, settings, drafts (local + session) |
| `scripting` | Inject the capture/selection overlay content script into the active tab |
| `clipboardWrite` | Write screenshots to your clipboard without requiring a click each time (auto-copy after capture) |
| `downloads` | Save screenshots to your downloads folder |
| `notifications` | Fallback announcements when a capture finishes while its tab isn't visible |

No host permissions are requested — ScreenX cannot read your browsing history or run on pages you never invoke it on.

## 8. Security

With no transmission, there is nothing to intercept. At rest, data is protected by your operating system account and Chrome profile storage. Your screenshots are as private as your browser profile — anyone with access to your unlocked device or Chrome profile could view them, so lock your screen accordingly.

## 9. Changes to this policy

If data practices ever change, this file will be updated with a new effective date, and significant changes will be disclosed in the release notes. The current version always lives at [`PRIVACY.md`](https://github.com/SUMANTHXT900/SCREENX/blob/main/PRIVACY.md).

## 10. Contact

Questions or concerns: open an issue at <https://github.com/SUMANTHXT900/SCREENX/issues>.
