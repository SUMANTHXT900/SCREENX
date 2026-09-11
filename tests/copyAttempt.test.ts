import { describe, test, expect, beforeEach } from "vitest";

interface StubState {
  focusedWindow?: number;
  activeTab?: number;
  tabUrl: string;
  tabWindow: number;
  /** Queue of COPY_IMAGE responses. */
  copyResponses: Array<{ ok: boolean; focused?: boolean; error?: string }>;
  sent: Array<{ tabId: number; seq?: number }>;
}

function installChromeStub(state: StubState): void {
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      get: async (tabId: number) => ({ id: tabId, url: state.tabUrl, windowId: state.tabWindow }),
      update: async (tabId: number, props: { active?: boolean }) => {
        if (props.active) state.activeTab = tabId;
      },
      sendMessage: (tabId: number, msg: { seq?: number }, cb: (res: unknown) => void) => {
        state.sent.push({ tabId, seq: (msg as { seq?: number }).seq });
        cb(state.copyResponses.length > 0 ? state.copyResponses.shift() : { ok: false, error: "no-stub-response" });
      },
    },
    windows: {
      update: async (windowId: number, props: { focused?: boolean }) => {
        if (props.focused) state.focusedWindow = windowId;
      },
    },
    runtime: {},
  };
}

const baseState = (): StubState => ({
  tabUrl: "https://example.com/",
  tabWindow: 11,
  copyResponses: [],
  sent: [],
});

describe("copyAttempt helper", () => {
  beforeEach(() => {
    installChromeStub(baseState());
  });

  test("readTab returns url + windowId", async () => {
    const { readTab } = await import("../src/background/handlers/copyAttempt");
    await expect(readTab(7)).resolves.toEqual({ url: "https://example.com/", windowId: 11 });
  });

  test("focusTabForCopy focuses window then activates tab", async () => {
    const state = baseState();
    installChromeStub(state);
    const { focusTabForCopy } = await import("../src/background/handlers/copyAttempt");
    await focusTabForCopy(7, 11);
    expect(state.focusedWindow).toBe(11);
    expect(state.activeTab).toBe(7);
  });

  test("first-try success focuses and stops", async () => {
    const state = baseState();
    state.copyResponses = [{ ok: true, focused: true }];
    installChromeStub(state);
    const { attemptCopyWithFocus } = await import("../src/background/handlers/copyAttempt");
    const r = await attemptCopyWithFocus(7, "data:image/png;base64,eA==", 11, "test");
    expect(r.copied).toBe(true);
    expect(r.attempts).toBe(1);
    expect(state.focusedWindow).toBe(11);
    expect(state.sent).toHaveLength(1);
    expect(typeof state.sent[0]!.seq).toBe("number");
  });

  test("unfocused failure retries; focused refusal stops", async () => {
    const state = baseState();
    state.copyResponses = [
      { ok: false, focused: false, error: "NotAllowedError" },
      { ok: true, focused: true },
    ];
    installChromeStub(state);
    const { attemptCopyWithFocus } = await import("../src/background/handlers/copyAttempt");
    const r = await attemptCopyWithFocus(7, "data:image/png;base64,eA==", 11, "test");
    expect(r.copied).toBe(true);
    expect(r.attempts).toBe(2);
    expect(state.sent).toHaveLength(2);
  });

  test("focused refusal does not retry", async () => {
    const state = baseState();
    state.copyResponses = [
      { ok: false, focused: true, error: "NotAllowedError" },
      { ok: true, focused: true },
    ];
    installChromeStub(state);
    const { attemptCopyWithFocus } = await import("../src/background/handlers/copyAttempt");
    const r = await attemptCopyWithFocus(7, "data:image/png;base64,eA==", 11, "test");
    expect(r.copied).toBe(false);
    expect(r.attempts).toBe(1);
    expect(state.sent).toHaveLength(1);
  });
});
