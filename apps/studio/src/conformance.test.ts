/**
 * C1 and C2, as a ratchet rather than a memo.
 *
 * The stylesheets predate the scale, so this does NOT assert zero violations —
 * it asserts the number never goes up. A design system that cannot fail a
 * review is decoration; one that fails on day one is deleted by the second
 * engineer who hits it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Nine steps. Zero is always legal; so is a 1px hairline. */
const SPACING = new Set([0, 1, 4, 8, 12, 16, 24, 32, 48, 64, 96]);
/** Six sizes. */
const TYPE = new Set([9, 11, 13, 14, 20, 30]);

const SHEETS = ["shell.css", "styles.css"] as const;

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

/** The root font size, for resolving rem. */
const ROOT_PX = 16;

/**
 * Every off-scale length in a declaration whose property matches.
 *
 * Scanned over the WHOLE stylesheet rather than line by line. A line-anchored
 * regex misses `.foo { font-size: 22px; }` — the one-line rule — which is how
 * the first version of this test reported four violations as zero. A ratchet
 * that under-counts is worse than no ratchet: it certifies the debt it cannot
 * see.
 *
 * `rem` is resolved rather than skipped, so `1.25rem` is recognised as 20px and
 * passes while `1.125rem` is caught as the 18px it renders at.
 */
export function offScale(
  css: string,
  properties: RegExp,
  allowed: ReadonlySet<number>,
): readonly string[] {
  // Comments first: a commented-out declaration is not a declaration.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const match of source.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const property = match[1];
    const value = match[2];
    if (property === undefined || value === undefined) continue;
    if (!properties.test(property)) continue;
    // A var() reference is by definition on the scale.
    if (value.includes("var(")) continue;
    for (const length of value.matchAll(/(-?\d*\.?\d+)(px|rem)/g)) {
      const raw = Number(length[1]);
      const px = Math.abs(length[2] === "rem" ? raw * ROOT_PX : raw);
      if (!allowed.has(px)) found.push(`${property}: ${length[0]}`);
    }
  }
  return found;
}

describe("Design OS conformance", () => {
  it("C1 — spacing does not drift further off the nine steps", () => {
    const violations = SHEETS.flatMap((sheet) =>
      offScale(read(sheet), /^(padding|margin|gap|row-gap|column-gap)(-|$)/, SPACING),
    );
    // ZERO, and it stays zero. Every spacing value in the product is now one of
    // the nine steps. The thirty-five that were here were all 2px and 3px —
    // values between the steps, which is exactly what "there is no value
    // between them" forbids.
    expect(violations, violations.join(" · ")).toEqual([]);
  });

  it("C2 — type does not drift further off the six sizes", () => {
    const violations = SHEETS.flatMap((sheet) =>
      offScale(read(sheet), /^font-size$/, TYPE),
    );
    // ZERO, and it stays zero. Every type size in the product is now one of the
    // six, with its bound tracking. This is the first check to reach the
    // standard rather than merely stop retreating from it.
    expect(violations, violations.join(" · ")).toEqual([]);
  });

  it("declares all nine spacing steps and all six type sizes", () => {
    const shell = read("shell.css");
    for (const step of ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8", "--s9"]) {
      expect(shell).toContain(`${step}:`);
    }
    for (const size of ["--t-display", "--t-title", "--t-head", "--t-body", "--t-small", "--t-micro"]) {
      expect(shell).toContain(`${size}:`);
    }
  });
});
