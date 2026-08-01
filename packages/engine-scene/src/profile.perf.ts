import { Session } from "node:inspector/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyOperation,
  applyTransaction,
  makeSetProp,
  type SceneOperation,
} from "./operations";
import { canonicalize, serialize } from "./serialize";
import { generateKeyBetween } from "./order";
import {
  countNodes,
  findNode,
  insertChild,
  parentOf,
  pathToNode,
  removeNode,
  replaceNode,
  walk,
} from "./tree";
import { validateDocument } from "./validate";
import { IDENTITY_TRANSFORM } from "./types";
import type { SceneDocument, SceneNode } from "./types";
import {
  changedNodeCount,
  fastest,
  gcAvailable,
  generateScene,
  measureAllocation,
} from "./perf-support";

/**
 * P-001 P1 — full performance audit of engine-scene.
 *
 * Produces two artefacts under perf/:
 *   - engine-scene.cpuprofile  (open in Chrome DevTools for the flame graph)
 *   - hotspots.md              (self-contained top-of-stack table)
 *
 * This is a MEASUREMENT run, not a test of behaviour. It asserts only that the
 * profile was actually captured — its output is the report, and every figure
 * quoted in ENGINE_SCENE_PERFORMANCE_REPORT.md comes from here.
 *
 * Run: pnpm --filter @bracketx/engine-scene perf
 */

const OUT_DIR = join(process.cwd(), "perf");

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}

/** An order key sorting after every current child of `parent`. */
function keyAfterLast(parent: SceneNode): string {
  const children = parent.children ?? [];
  const last = children.length > 0 ? children[children.length - 1]!.order : null;
  return generateKeyBetween(last, null);
}

/**
 * The workload under the profiler. Deliberately mirrors real editor usage.
 *
 * The deep shape is built at 500, not 10,000, for two reasons measured in
 * limits.perf.ts: validateDocument overflows the stack past depth ~1,344, and
 * pathToNode is O(depth²) in allocation, so a deep chain would spend the whole
 * profile inside one function and bury every other hotspot.
 */
function workload(): void {
  for (const shape of ["wide", "deep", "balanced", "mixed"] as const) {
    const size = shape === "deep" ? 500 : 10_000;
    const scene = generateScene(shape, size);
    let document = scene.document;

    // Reads
    for (let i = 0; i < 50; i += 1) {
      findNode(document.root, scene.ids[(i * 97) % scene.ids.length]!);
    }
    for (let i = 0; i < 20; i += 1) {
      pathToNode(document.root, scene.ids[(i * 331) % scene.ids.length]!);
      parentOf(document.root, scene.ids[(i * 131) % scene.ids.length]!);
    }
    countNodes(document.root);
    for (const _ of walk(document.root)) {
      /* drain */
    }

    // Edits — the operation path, which is what the pipeline actually runs.
    for (let i = 0; i < 100; i += 1) {
      const id = scene.ids[(i * 7 + 1) % scene.ids.length]!;
      document = applyOperation(
        document,
        makeSetProp(document, id, "name", `renamed-${i}`),
      );
    }

    // Structural edits
    for (let i = 0; i < 20; i += 1) {
      const child: SceneNode = {
        id: `nod_new_${shape}_${i}`,
        name: "new",
        order: keyAfterLast(document.root),
        transform: IDENTITY_TRANSFORM,
      };
      document = applyOperation(document, {
        type: "node.insert",
        parentId: document.root.id,
        node: child,
      });
    }

    // Serialization and validation
    serialize(document);
    canonicalize(document);
    validateDocument(document);
  }
}

describe("CPU profile", () => {
  it("captures a profile of the whole engine-scene surface", async () => {
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 100 });
    await session.post("Profiler.start");

    workload();

    const { profile } = await session.post("Profiler.stop");
    session.disconnect();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "engine-scene.cpuprofile"),
      JSON.stringify(profile),
    );

    // Aggregate self-time by function. hitCount is samples where that frame
    // was on TOP of the stack, so this is self time, not inclusive time —
    // which is what identifies a hotspot rather than a caller of one.
    const nodes = profile.nodes as ProfileNode[];
    const totalHits = nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
    const bySite = new Map<string, { hits: number; url: string }>();

    for (const node of nodes) {
      const hits = node.hitCount ?? 0;
      if (hits === 0) continue;
      const { functionName, url, lineNumber } = node.callFrame;
      // Only our own code; Node internals are not actionable here.
      if (!url.includes("engine-scene")) continue;
      const file = url.slice(url.lastIndexOf("/") + 1);
      const key = `${functionName || "(anonymous)"} — ${file}:${lineNumber + 1}`;
      const existing = bySite.get(key);
      if (existing) existing.hits += hits;
      else bySite.set(key, { hits, url });
    }

    const ranked = [...bySite.entries()]
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, 25);

    const lines = [
      "# engine-scene CPU profile — self time",
      "",
      `Total samples: ${totalHits} (sampling interval 100µs)`,
      "",
      "Self time means the function was on top of the stack — it is the",
      "function doing the work, not merely calling something slow.",
      "",
      "| Rank | Function | Samples | % of engine-scene |",
      "| --- | --- | --- | --- |",
    ];
    const ourTotal = ranked.reduce((sum, [, v]) => sum + v.hits, 0);
    ranked.forEach(([key, value], index) => {
      const share = ((value.hits / ourTotal) * 100).toFixed(1);
      lines.push(`| ${index + 1} | \`${key}\` | ${value.hits} | ${share}% |`);
    });

    writeFileSync(join(OUT_DIR, "hotspots.md"), lines.join("\n") + "\n");

    console.log("\n" + lines.slice(6).join("\n"));
    expect(totalHits).toBeGreaterThan(0);
    expect(ranked.length).toBeGreaterThan(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// P1 — per-operation cost, measured
// ---------------------------------------------------------------------------

describe("operation cost by scene size", () => {
  it("measures every public operation across sizes and shapes", () => {
    const rows: string[] = [];
    const sizes = [1_000, 10_000, 50_000];

    rows.push("### Read operations (ms per call)");
    rows.push("");
    rows.push("| Operation | Shape | 1k | 10k | 50k | Scaling 1k→50k |");
    rows.push("| --- | --- | --- | --- | --- | --- |");

    const readOps: [string, (d: SceneDocument, ids: readonly string[]) => void][] =
      [
        ["findNode (last id)", (d, ids) => { findNode(d.root, ids[ids.length - 1]!); }],
        ["pathToNode (last id)", (d, ids) => { pathToNode(d.root, ids[ids.length - 1]!); }],
        ["parentOf (last id)", (d, ids) => { parentOf(d.root, ids[ids.length - 1]!); }],
        ["countNodes", (d) => { countNodes(d.root); }],
        ["walk (full drain)", (d) => { for (const _ of walk(d.root)) { /* drain */ } }],
      ];

    for (const [name, run] of readOps) {
      for (const shape of ["wide", "balanced"] as const) {
        const measured = sizes.map((size) => {
          const scene = generateScene(shape, size);
          return fastest(5, () => run(scene.document, scene.ids));
        });
        const ratio = measured[0]! > 0 ? measured[2]! / measured[0]! : NaN;
        rows.push(
          `| ${name} | ${shape} | ${measured[0]!.toFixed(4)} | ` +
            `${measured[1]!.toFixed(4)} | ${measured[2]!.toFixed(4)} | ` +
            `${ratio.toFixed(1)}× |`,
        );
      }
    }

    rows.push("");
    rows.push("### Write operations (ms per call)");
    rows.push("");
    rows.push("| Operation | Shape | 1k | 10k | 50k | Scaling 1k→50k |");
    rows.push("| --- | --- | --- | --- | --- | --- |");

    const writeOps: [
      string,
      (d: SceneDocument, ids: readonly string[]) => void,
    ][] = [
      [
        "replaceNode (deepest)",
        (d, ids) => {
          replaceNode(d.root, ids[ids.length - 1]!, (n) => ({ ...n, name: "x" }));
        },
      ],
      [
        "node.setProp (op path)",
        (d, ids) => {
          applyOperation(d, {
            type: "node.setProp",
            nodeId: ids[ids.length - 1]!,
            path: "name",
            value: "x",
            previousValue: null,
          });
        },
      ],
      [
        "node.insert (op path)",
        (d) => {
          applyOperation(d, {
            type: "node.insert",
            parentId: d.root.id,
            node: {
              id: "nod_bench_insert",
              name: "n",
              order: keyAfterLast(d.root),
              transform: IDENTITY_TRANSFORM,
            },
          });
        },
      ],
      [
        "insertChild (tree fn)",
        (d) => {
          insertChild(d.root, d.root.id, {
            id: "nod_bench_child",
            name: "n",
            order: keyAfterLast(d.root),
            transform: IDENTITY_TRANSFORM,
          });
        },
      ],
      [
        "removeNode (deepest)",
        (d, ids) => {
          removeNode(d.root, ids[ids.length - 1]!);
        },
      ],
    ];

    for (const [name, run] of writeOps) {
      for (const shape of ["wide", "balanced"] as const) {
        const measured = sizes.map((size) => {
          const scene = generateScene(shape, size);
          return fastest(5, () => run(scene.document, scene.ids));
        });
        const ratio = measured[0]! > 0 ? measured[2]! / measured[0]! : NaN;
        rows.push(
          `| ${name} | ${shape} | ${measured[0]!.toFixed(4)} | ` +
            `${measured[1]!.toFixed(4)} | ${measured[2]!.toFixed(4)} | ` +
            `${ratio.toFixed(1)}× |`,
        );
      }
    }

    rows.push("");
    rows.push("### Whole-document operations (ms per call)");
    rows.push("");
    rows.push("| Operation | 1k | 10k | 50k | Scaling 1k→50k |");
    rows.push("| --- | --- | --- | --- | --- |");

    const docOps: [string, (d: SceneDocument) => void][] = [
      ["serialize", (d) => { serialize(d); }],
      ["canonicalize", (d) => { canonicalize(d); }],
      ["validateDocument", (d) => { validateDocument(d); }],
    ];

    for (const [name, run] of docOps) {
      const measured = sizes.map((size) => {
        const scene = generateScene("balanced", size);
        return fastest(3, () => run(scene.document));
      });
      const ratio = measured[0]! > 0 ? measured[2]! / measured[0]! : NaN;
      rows.push(
        `| ${name} | ${measured[0]!.toFixed(4)} | ${measured[1]!.toFixed(4)} | ` +
          `${measured[2]!.toFixed(4)} | ${ratio.toFixed(1)}× |`,
      );
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "operations.md"), rows.join("\n") + "\n");
    console.log("\n" + rows.join("\n"));
    expect(rows.length).toBeGreaterThan(10);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// P8 — memory and structural sharing
// ---------------------------------------------------------------------------

describe("memory", () => {
  it("measures allocation and structural sharing per edit", () => {
    const rows: string[] = [
      "### Allocation per edit",
      "",
      gcAvailable
        ? "Measured with --expose-gc; retained bytes are post-collection."
        : "**--expose-gc unavailable — retained figures omitted as unsound.**",
      "",
      "| Scene | Shape | Nodes rebuilt | Total nodes | Rebuilt % | Bytes/edit |",
      "| --- | --- | --- | --- | --- | --- |",
    ];

    for (const shape of ["wide", "deep", "balanced", "mixed"] as const) {
      // findNode overflows past depth ~8,832 (limits.perf.ts), so the deep
      // shape is measured at sizes it can actually survive.
      const sizes = shape === "deep" ? [1_000, 4_000] : [10_000, 50_000];
      for (const size of sizes) {
        const scene = generateScene(shape, size);
        const target = scene.ids[Math.floor(scene.ids.length / 2)]!;
        const operation: SceneOperation = {
          type: "node.setProp",
          nodeId: target,
          path: "name",
          value: "changed",
          previousValue: null,
        };

        const after = applyOperation(scene.document, operation);
        const rebuilt = changedNodeCount(scene.document.root, after.root);

        const sample = measureAllocation(20, () =>
          applyOperation(scene.document, operation),
        );

        rows.push(
          `| ${size.toLocaleString("en-US")} | ${shape} | ${rebuilt} | ${size} | ` +
            `${((rebuilt / size) * 100).toFixed(1)}% | ` +
            `${Math.round(sample.allocatedBytes).toLocaleString("en-US")} |`,
        );
      }
    }

    rows.push("");
    rows.push("### Transaction replay");
    rows.push("");
    rows.push("| Scene | Ops | Total ms | ms/op |");
    rows.push("| --- | --- | --- | --- |");

    for (const size of [1_000, 10_000, 50_000]) {
      const scene = generateScene("balanced", size);
      const operations: SceneOperation[] = [];
      for (let i = 0; i < 50; i += 1) {
        operations.push({
          type: "node.setProp",
          nodeId: scene.ids[(i * 13) % scene.ids.length]!,
          path: "name",
          value: `n${i}`,
          previousValue: null,
        });
      }
      const total = fastest(3, () => {
        applyTransaction(scene.document, {
          id: "txn_perf",
          label: "perf",
          actorId: "usr_perf",
          operations,
        });
      });
      rows.push(
        `| ${size.toLocaleString("en-US")} | 50 | ${total.toFixed(3)} | ` +
          `${(total / 50).toFixed(4)} |`,
      );
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "memory.md"), rows.join("\n") + "\n");
    console.log("\n" + rows.join("\n"));
    expect(rows.length).toBeGreaterThan(5);
  }, 600_000);
});
