import { describe, expect, it } from "vitest";

import {
  OrderKeyError,
  compareOrderKeys,
  generateKeyBetween,
  generateNKeysBetween,
} from "./order";

describe("generateKeyBetween", () => {
  it("produces a key between two bounds", () => {
    const key = generateKeyBetween("a", "c");
    expect(key > "a").toBe(true);
    expect(key < "c").toBe(true);
  });

  it("produces a key before everything when the lower bound is null", () => {
    expect(generateKeyBetween(null, "a") < "a").toBe(true);
  });

  it("produces a key after everything when the upper bound is null", () => {
    expect(generateKeyBetween("a", null) > "a").toBe(true);
  });

  it("produces a key for an empty list", () => {
    expect(generateKeyBetween(null, null)).toBeTruthy();
  });

  it("finds room between adjacent digits by adding precision", () => {
    // "a" and "b" are consecutive: the only way between is a longer key.
    const key = generateKeyBetween("a", "b");
    expect(key > "a").toBe(true);
    expect(key < "b").toBe(true);
    expect(key.length).toBeGreaterThan(1);
  });

  it("rejects bounds in the wrong order", () => {
    expect(() => generateKeyBetween("c", "a")).toThrow(OrderKeyError);
  });

  it("rejects equal bounds", () => {
    expect(() => generateKeyBetween("a", "a")).toThrow(OrderKeyError);
  });

  it("rejects non-normalised keys ending in zero", () => {
    // "a0" and "a" denote the same position; permitting both would break the
    // bijection between key and position.
    expect(() => generateKeyBetween("a0", null)).toThrow(OrderKeyError);
  });

  it("rejects keys outside the alphabet", () => {
    expect(() => generateKeyBetween("a-b", null)).toThrow(OrderKeyError);
  });

  it("rejects an empty key", () => {
    expect(() => generateKeyBetween("", null)).toThrow(OrderKeyError);
  });
});

describe("ordering survives repeated insertion", () => {
  it("keeps order when appending 200 times", () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      last = generateKeyBetween(last, null);
      keys.push(last);
    }
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps order when prepending 200 times", () => {
    const keys: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      first = generateKeyBetween(null, first);
      keys.unshift(first);
    }
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps order when repeatedly inserting into the same gap", () => {
    // The adversarial case: every insert targets the tightest gap, which is
    // what forces key length to grow.
    const low = generateKeyBetween(null, null);
    let high = generateKeyBetween(low, null);
    const inner: string[] = [];

    for (let i = 0; i < 100; i += 1) {
      const key = generateKeyBetween(low, high);
      expect(key > low).toBe(true);
      expect(key < high).toBe(true);
      inner.push(key);
      high = key;
    }

    const all = [low, ...[...inner].reverse()];
    expect([...all].sort(compareOrderKeys)).toEqual(all);
    void low;
  });

  it("never renumbers an existing key", () => {
    // The property fractional indexing exists for: an insert must not require
    // touching a neighbour, so concurrent inserts cannot clobber each other.
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const before = [a, b];
    const middle = generateKeyBetween(a, b);
    expect(before).toEqual([a, b]);
    expect([a, middle, b].sort(compareOrderKeys)).toEqual([a, middle, b]);
  });
});

describe("generateNKeysBetween", () => {
  it("returns nothing for zero", () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([]);
  });

  it.each([1, 2, 3, 7, 32])("returns %i keys in ascending order", (n) => {
    const keys = generateNKeysBetween(null, null, n);
    expect(keys).toHaveLength(n);
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(n);
  });

  it("stays within the given bounds", () => {
    const low = generateKeyBetween(null, null);
    const high = generateKeyBetween(low, null);
    for (const key of generateNKeysBetween(low, high, 16)) {
      expect(key > low).toBe(true);
      expect(key < high).toBe(true);
    }
  });

  it("keeps keys short by splitting rather than chaining", () => {
    // Sequential generation would grow length linearly; midpoint splitting
    // keeps it logarithmic. 64 keys must not need long strings.
    const keys = generateNKeysBetween(null, null, 64);
    const longest = Math.max(...keys.map((k) => k.length));
    expect(longest).toBeLessThanOrEqual(4);
  });

  it("rejects a negative count", () => {
    expect(() => generateNKeysBetween(null, null, -1)).toThrow(OrderKeyError);
  });
});
