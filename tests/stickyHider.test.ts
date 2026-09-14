import { describe, test, expect } from "vitest";
import {
  shouldHideCandidate,
  MAX_HIDE_WIDGET_PX,
  MAX_HIDE_TEXT_LEN,
  type HideCandidate,
} from "../src/content/dom/stickyHider";

const widget = (extra: Partial<HideCandidate> = {}): HideCandidate => ({
  width: 56,
  height: 56,
  textLength: 0,
  hasFormControl: false,
  hasMedia: false,
  ...extra,
});

describe("shouldHideCandidate (capture-as-is)", () => {
  test("tiny icon-only widget is hidden", () => {
    expect(shouldHideCandidate(widget())).toBe(true);
  });

  test("bar-sized elements are never hidden, even if content-free", () => {
    expect(shouldHideCandidate(widget({ width: 1200, height: 64 }))).toBe(false);
    expect(shouldHideCandidate(widget({ width: 300, height: 64 }))).toBe(false);
    expect(shouldHideCandidate(widget({ width: 60, height: MAX_HIDE_WIDGET_PX + 1 }))).toBe(false);
  });

  test("form fields are never hidden (Google Forms regression)", () => {
    // A sticky wrapper around a contact-number field: hiding the ancestor
    // would delete the field from every strip.
    expect(shouldHideCandidate(widget({ width: 600, height: 120, hasFormControl: true }))).toBe(false);
    expect(shouldHideCandidate(widget({ hasFormControl: true }))).toBe(false);
  });

  test("media elements are never hidden", () => {
    expect(shouldHideCandidate(widget({ hasMedia: true }))).toBe(false);
  });

  test("text-heavy elements are never hidden", () => {
    expect(shouldHideCandidate(widget({ textLength: MAX_HIDE_TEXT_LEN + 1 }))).toBe(false);
    expect(shouldHideCandidate(widget({ textLength: MAX_HIDE_TEXT_LEN }))).toBe(true);
  });
});
