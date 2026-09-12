import { describe, test, expect } from "vitest";
import { toGroups } from "../src/workspace/groups";
import type { CaptureRecord } from "../src/storage/idb/capturesRepo";

const rec = (id: string, extra: Partial<CaptureRecord> = {}): CaptureRecord =>
  ({
    id,
    blob: new Blob(["x"]),
    type: "visible",
    createdAt: 100,
    ...extra,
  }) as CaptureRecord;

describe("toGroups", () => {
  test("singles stay solo, newest first", () => {
    const groups = toGroups([rec("a", { createdAt: 100 }), rec("b", { createdAt: 300 }), rec("c", { createdAt: 200 })]);
    expect(groups.map((g) => g.key)).toEqual(["b", "c", "a"]);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });

  test("parts fold into one group with earliest cover", () => {
    const groups = toGroups([
      rec("p2", { groupId: "g", createdAt: 102, partIndex: 2, partTotal: 3 }),
      rec("p1", { groupId: "g", createdAt: 101, partIndex: 1, partTotal: 3 }),
      rec("p3", { groupId: "g", createdAt: 103, partIndex: 3, partTotal: 3 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.first.id).toBe("p1");
    expect(groups[0]!.ids).toEqual(["p2", "p1", "p3"]);
  });

  test("same-ms ties break toward lowest partIndex (tight auto-split loop)", () => {
    const groups = toGroups([
      rec("p2", { groupId: "g", createdAt: 100, partIndex: 2, partTotal: 2 }),
      rec("p1", { groupId: "g", createdAt: 100, partIndex: 1, partTotal: 2 }),
    ]);
    expect(groups[0]!.first.id).toBe("p1");
  });
});
