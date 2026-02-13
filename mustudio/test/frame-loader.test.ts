import { describe, expect, it } from "bun:test";
import { loadBatchWithRetryOnTotalFailure } from "../src/see/lib/frame-loader";

describe("loadBatchWithRetryOnTotalFailure", () => {
  it("retries once when every item fails on the first attempt", async () => {
    const calls = new Map<number, number>();

    const results = await loadBatchWithRetryOnTotalFailure(
      [1, 2, 3],
      async (item) => {
        const next = (calls.get(item) ?? 0) + 1;
        calls.set(item, next);
        if (next === 1) {
          throw new Error(`temporary failure for ${item}`);
        }
        return item * 10;
      }
    );

    expect(results.map((result) => result.value)).toEqual([10, 20, 30]);
    expect(results.map((result) => result.error)).toEqual([null, null, null]);
    expect(calls.get(1)).toBe(2);
    expect(calls.get(2)).toBe(2);
    expect(calls.get(3)).toBe(2);
  });

  it("does not retry when at least one item succeeds", async () => {
    const calls = new Map<number, number>();

    const results = await loadBatchWithRetryOnTotalFailure(
      [1, 2, 3],
      async (item) => {
        const next = (calls.get(item) ?? 0) + 1;
        calls.set(item, next);
        if (item === 1) return 10;
        throw new Error(`permanent failure for ${item}`);
      }
    );

    expect(results.map((result) => result.value)).toEqual([10, null, null]);
    expect(results[1]?.error).toContain("permanent failure for 2");
    expect(results[2]?.error).toContain("permanent failure for 3");
    expect(calls.get(1)).toBe(1);
    expect(calls.get(2)).toBe(1);
    expect(calls.get(3)).toBe(1);
  });
});
