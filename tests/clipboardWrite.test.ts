import { describe, test, expect } from "vitest";
import {
  claimCopySlot,
  dataUrlToBlob,
  dataUrlToBlobAsync,
  lastSeenCopySeq,
  markLocalCopyDone,
} from "../src/content/clipboardWrite";

function pngDataUrl(bytes: number[]): string {
  const bin = String.fromCharCode(...bytes);
  return `data:image/png;base64,${btoa(bin)}`;
}

describe("dataUrlToBlob", () => {
  test("round-trips bytes with the PNG type", () => {
    const bytes = [137, 80, 78, 71, 0, 1, 2, 3, 255];
    const blob = dataUrlToBlob(pngDataUrl(bytes));
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(bytes.length);
  });

  test("preserves the declared mime type", () => {
    const blob = dataUrlToBlob("data:image/jpeg;base64,/w==");
    expect(blob.type).toBe("image/jpeg");
  });

  test("rejects non-image, malformed, and non-base64 inputs", () => {
    expect(() => dataUrlToBlob("data:text/plain;base64,aGk=")).toThrow("bad-image");
    expect(() => dataUrlToBlob("not-a-data-url")).toThrow("bad-image");
    expect(() => dataUrlToBlob("data:image/png,nocomma-here" as string)).toThrow();
    expect(() => dataUrlToBlob("data:image/png,%89PNG")).toThrow("unsupported-encoding");
    expect(() => dataUrlToBlob("data:image/png;base64,!!!")).toThrow("decode-failed");
  });

  test("async variant matches sync output, including strict rejections", async () => {
    const bytes = [137, 80, 78, 71, 10, 20, 30];
    const url = pngDataUrl(bytes);
    const [a, b] = await Promise.all([dataUrlToBlobAsync(url), Promise.resolve(dataUrlToBlob(url))]);
    expect(a.type).toBe(b.type);
    expect(a.size).toBe(b.size);
    await expect(dataUrlToBlobAsync("data:image/png;base64,!!!")).rejects.toThrow("decode-failed");
    await expect(dataUrlToBlobAsync("nope")).rejects.toThrow("bad-image");
  });
});

describe("claimCopySlot ordering", () => {
  test("newer seq wins; older is superseded; missing seq accepts", () => {
    const base = lastSeenCopySeq();
    expect(claimCopySlot(base + 10)).toBe(true);
    expect(claimCopySlot(base + 5)).toBe(false);
    expect(claimCopySlot(base + 10)).toBe(true); // equal = same-ms retry, allow
    expect(claimCopySlot(undefined)).toBe(true);
    expect(lastSeenCopySeq()).toBe(base + 10);
  });

  test("in-gesture local write beats in-flight background retries", () => {
    const base = lastSeenCopySeq();
    markLocalCopyDone(base + 100);
    expect(claimCopySlot(base + 50)).toBe(false);
    expect(claimCopySlot(base + 100)).toBe(true);
  });
});
