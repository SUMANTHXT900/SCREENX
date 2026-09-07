import { describe, test, expect } from "vitest";
import { classifyClipboardTarget } from "../src/background/handlers/clipboardTarget";
import { buildChoiceToast } from "../src/background/handlers/choiceToast";
import { sendCopyImageReport } from "../src/capture/clipboard";

function installTabsStub(response: unknown): void {
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      sendMessage: (_tabId: number, _msg: unknown, cb: (res: unknown) => void) => {
        cb(response);
      },
    },
    runtime: {},
  };
}

const base = { id: "c1", type: "visible" as const, sourceTabId: 7 };

describe("classifyClipboardTarget", () => {
  test("https pages are writable", () => {
    expect(classifyClipboardTarget("https://example.com/a?b=1").kind).toBe("writable");
  });
  test("http pages are insecure (localhost excepted)", () => {
    expect(classifyClipboardTarget("http://example.com/").kind).toBe("insecure");
    expect(classifyClipboardTarget("http://localhost:3000/").kind).toBe("writable");
    expect(classifyClipboardTarget("http://127.0.0.1/x").kind).toBe("writable");
  });
  test("restricted schemes are blocked", () => {
    for (const url of [
      "chrome://extensions/",
      "chrome-extension://abcdef/popup.html",
      "edge://settings/",
      "about:blank",
      "view-source:https://example.com/",
      "devtools://devtools/bundled/inspector.html",
    ]) {
      expect(classifyClipboardTarget(url).kind).toBe("restricted");
    }
  });
  test("web store hosts are blocked", () => {
    expect(classifyClipboardTarget("https://chrome.google.com/webstore/x").kind).toBe("restricted");
    expect(classifyClipboardTarget("https://chromewebstore.google.com/detail/y").kind).toBe("restricted");
  });
  test("unknown/unparseable urls stay best-effort writable", () => {
    expect(classifyClipboardTarget(undefined).kind).toBe("writable");
    expect(classifyClipboardTarget("not a url at all %%").kind).toBe("writable");
  });
  test("file urls are writable", () => {
    expect(classifyClipboardTarget("file:///C:/shot.png").kind).toBe("writable");
  });
});

describe("buildChoiceToast copyNote", () => {
  test("reason-specific note replaces the generic message", () => {
    const t = buildChoiceToast(base, false, undefined, "Auto-copy missed (the tab wasn't focused) — tap Copy.");
    expect(t.message).toContain("tap Copy");
    expect(t.message).not.toContain("unavailable in this browser");
    // Copy action still offered as the retry path.
    expect(t.actions.some((a) => a.id === "copy")).toBe(true);
  });
  test("no note keeps the legacy generic message", () => {
    const t = buildChoiceToast(base, false);
    expect(t.message).toContain("Clipboard copy unavailable in this browser.");
  });
  test("copied=true ignores any note", () => {
    const t = buildChoiceToast(base, true, undefined, "stale note");
    expect(t.message).toContain("Copied to clipboard");
    expect(t.message).not.toContain("stale note");
    expect(t.actions.some((a) => a.id === "copy")).toBe(false);
  });
});

describe("sendCopyImageReport", () => {
  test("passes through ok + focus detail for retry decisions", async () => {
    installTabsStub({ ok: true, focused: true, transientActivation: false });
    const r = await sendCopyImageReport(7, "data:image/png;base64,eA==", 1000);
    expect(r).toEqual({ ok: true, focused: true, transientActivation: false });
  });
  test("refusal keeps focused=false so the handler retries", async () => {
    installTabsStub({ ok: false, error: "NotAllowedError", focused: false, transientActivation: false });
    const r = await sendCopyImageReport(7, "data:image/png;base64,eA==", 1000);
    expect(r.ok).toBe(false);
    expect(r.focused).toBe(false);
    expect(r.error).toContain("NotAllowedError");
  });
});
