import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalize, serialize } from "./serialize";
import { countNodes, findNode, pathToNode, replaceNode, walk } from "./tree";
import { validateDocument } from "./validate";
import { fastest, generateScene } from "./perf-support";

/**
 * P-001 P1/P7 — scaling exponents and hard limits.
 *
 * Two questions the aggregate tables cannot answer:
 *
 *   1. Wide trees scale ~800x for a 50x size increase while balanced trees
 *      scale ~17x. Is that quadratic, or a linear algorithm with a constant
 *      that degrades? Fitting an exponent over a doubling series answers it.
 *   2. Every traversal in tree.ts is recursive. At what depth does each one
 *      overflow the stack? A scene deeper than that is not slow, it throws.
 */

const OUT_DIR = join(process.cwd(), "perf");

/**
 * Least-squares exponent k in cost ~ n^k, over a doubling series.
 *
 * k≈1 is linear, k≈2 is quadratic. Fitting beats comparing two endpoints:
 * a single outlier at either end can make linear look quadratic.
 */
function fitExponent(points: readonly [number, number][]): number {
  const usable = points.filter(([n, t]) => n > 0 && t > 0);
  if (usable.length < 2) return NaN;
  const xs = usable.map(([n]) => Math.log(n));
  const ys = usable.map(([, t]) => Math.log(t));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }
  return numerator / denominator;
}

describe("scaling exponents", () => {
  it("fits an exponent to every traversal on wide and balanced trees", () => {
    const sizes = [5_000, 10_000, 20_000, 40_000, 80_000];
    const rows = [
      "### Measured scaling exponent (cost ~ n^k)",
      "",
      "Fitted by least squares over a doubling series. k≈1 linear, k≈2 quadratic.",
      "",
      "| Operation | Wide k | Balanced k | Verdict |",
      "| --- | --- | --- | --- |",
    ];

    const operations: [string, (scene: ReturnType<typeof generateScene>) => void][] =
      [
        [
          "findNode (worst case)",
          (s) => {
            findNode(s.document.root, s.ids[s.ids.length - 1]!);
          },
        ],
        [
          "pathToNode (worst case)",
          (s) => {
            pathToNode(s.document.root, s.ids[s.ids.length - 1]!);
          },
        ],
        [
          "replaceNode (worst case)",
          (s) => {
            replaceNode(s.document.root, s.ids[s.ids.length - 1]!, (n) => ({
              ...n,
              name: "x",
            }));
          },
        ],
        [
          "countNodes",
          (s) => {
            countNodes(s.document.root);
          },
        ],
        [
          "walk (full drain)",
          (s) => {
            for (const _ of walk(s.document.root)) {
              /* drain */
            }
          },
        ],
      ];

    for (const [name, run] of operations) {
      const measured: Record<string, number> = {};
      for (const shape of ["wide", "balanced"] as const) {
        const points: [number, number][] = sizes.map((size) => {
          const scene = generateScene(shape, size);
          return [size, fastest(3, () => run(scene))];
        });
        measured[shape] = fitExponent(points);
      }
      const wide = measured.wide!;
      const balanced = measured.balanced!;
      const verdict =
        wide > 1.6 ? "**QUADRATIC on wide**" : wide > 1.25 ? "superlinear" : "linear";
      rows.push(
        `| ${name} | ${wide.toFixed(2)} | ${balanced.toFixed(2)} | ${verdict} |`,
      );
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "scaling.md"), rows.join("\n") + "\n");
    console.log("\n" + rows.join("\n"));
    expect(rows.length).toBeGreaterThan(5);
  }, 600_000);
});

describe("recursion limits", () => {
  it("finds the depth at which each recursive function overflows", () => {
    // Every traversal in tree.ts and serialize.ts recurses per level. A deep
    // scene does not degrade gracefully — it throws RangeError. Operators
    // build deep rigs (a lower-third is a nested stack), so the ceiling is a
    // real constraint and needs to be a documented number, not a surprise.
    const probes: [string, (depth: number) => void][] = [
      [
        "findNode",
        (depth) => {
          const scene = generateScene("deep", depth);
          findNode(scene.document.root, scene.ids[scene.ids.length - 1]!);
        },
      ],
      [
        "walk",
        (depth) => {
          const scene = generateScene("deep", depth);
          for (const _ of walk(scene.document.root)) {
            /* drain */
          }
        },
      ],
      [
        "countNodes",
        (depth) => {
          const scene = generateScene("deep", depth);
          countNodes(scene.document.root);
        },
      ],
      [
        "replaceNode",
        (depth) => {
          const scene = generateScene("deep", depth);
          replaceNode(scene.document.root, scene.ids[scene.ids.length - 1]!, (n) => n);
        },
      ],
      [
        "pathToNode",
        (depth) => {
          const scene = generateScene("deep", depth);
          pathToNode(scene.document.root, scene.ids[scene.ids.length - 1]!);
        },
      ],
      [
        "serialize",
        (depth) => {
          serialize(generateScene("deep", depth).document);
        },
      ],
      [
        "canonicalize",
        (depth) => {
          canonicalize(generateScene("deep", depth).document);
        },
      ],
      [
        "validateDocument",
        (depth) => {
          validateDocument(generateScene("deep", depth).document);
        },
      ],
    ];

    const rows = [
      "### Maximum scene depth before RangeError",
      "",
      "Node 24, default stack. Binary search for the largest depth that",
      "completes without a stack overflow.",
      "",
      "| Function | Max depth | Notes |",
      "| --- | --- | --- |",
    ];

    for (const [name, run] of probes) {
      const survives = (depth: number): boolean => {
        try {
          run(depth);
          return true;
        } catch (error) {
          if (error instanceof RangeError) return false;
          throw error;
        }
      };

      // Exponential search up, then bisect.
      let low = 1;
      let high = 64;
      while (high <= 200_000 && survives(high)) {
        low = high;
        high *= 2;
      }
      if (high > 200_000) {
        rows.push(`| \`${name}\` | > 200,000 | no practical limit found |`);
        continue;
      }
      while (high - low > Math.max(8, low * 0.02)) {
        const middle = Math.floor((low + high) / 2);
        if (survives(middle)) low = middle;
        else high = middle;
      }
      rows.push(`| \`${name}\` | ~${low.toLocaleString("en-US")} | recursive |`);
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "limits.md"), rows.join("\n") + "\n");
    console.log("\n" + rows.join("\n"));
    expect(rows.length).toBeGreaterThan(5);
  }, 600_000);
});
