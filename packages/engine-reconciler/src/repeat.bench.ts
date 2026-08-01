import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
} from "@bracketx/engine-scene";
import { bench, describe } from "vitest";

import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import type { VariableSource } from "./resolve";

/**
 * Collection benchmarks. Project Alpha A2 / Phase 4.
 *
 * The claim under test: re-expansion is O(change), not O(collection).
 *
 * A leaderboard reordering, or one row's score updating, must not cost what
 * rebuilding the whole list costs. If it does, keyed identity is not earning
 * its complexity and the design is wrong.
 *
 * Run: pnpm --filter @bracketx/engine-reconciler bench
 */

function rosterDocument(): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_bench",
    meta: {
      name: "Bench",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [],
    states: [],
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      children: [
        {
          id: "nod_list",
          name: "List",
          order: generateKeyBetween(null, null),
          transform: IDENTITY_TRANSFORM,
          repeat: { source: "rows", as: "row", key: "id" },
          children: [
            {
              id: "nod_row",
              name: "Row",
              order: generateKeyBetween(null, null),
              transform: IDENTITY_TRANSFORM,
              components: [
                {
                  id: "cmp_row",
                  type: "rect",
                  props: {
                    width: 4,
                    height: 0.4,
                    fill: { $var: "row.color" },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

interface Row {
  id: string;
  color: string;
}

function rows(count: number, tint = 0): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = ((i * 37 + tint) % 255).toString(16).padStart(2, "0");
    out.push({ id: `r${i}`, color: `#${value}${value}${value}` });
  }
  return out;
}

function harness(count: number) {
  const values: Record<string, unknown> = { rows: rows(count) };
  const variables: VariableSource = { read: (key) => values[key] };
  const backend = new MockMirrorBackend();
  const reconciler = new Reconciler(backend);
  reconciler.build(rosterDocument(), variables);
  return { values, variables, reconciler };
}

for (const size of [16, 64, 256]) {
  describe(`collection of ${size}`, () => {
    const reorder = harness(size);
    const single = harness(size);
    const grow = harness(size);
    const rebuild = harness(size);

    let flip = 0;

    bench("reorder, all survive", () => {
      // The case keyed identity exists for. Should create and destroy nothing.
      const current = reorder.values.rows as Row[];
      reorder.values.rows = [...current].reverse();
      reorder.reconciler.invalidateVariables(["rows"], reorder.variables);
    });

    bench("one item's value changes", () => {
      // A score updating in place. One instance re-resolves; the rest must not.
      const current = [...(single.values.rows as Row[])];
      flip = (flip + 1) % 255;
      current[0] = { id: "r0", color: `#${flip.toString(16).padStart(2, "0")}0000` };
      single.values.rows = current;
      single.reconciler.invalidateVariables(["rows"], single.variables);
    });

    bench("append one item", () => {
      const current = grow.values.rows as Row[];
      grow.values.rows = [...current, { id: `x${current.length}`, color: "#ffffff" }];
      grow.reconciler.invalidateVariables(["rows"], grow.variables);
    });

    bench("full replace, no identity survives", () => {
      // The worst case, and the baseline the others are judged against.
      flip = (flip + 1) % 1000;
      rebuild.values.rows = rows(size, flip).map((row) => ({
        ...row,
        id: `${row.id}-${flip}`,
      }));
      rebuild.reconciler.invalidateVariables(["rows"], rebuild.variables);
    });
  });
}

describe("build cost by collection size", () => {
  for (const size of [16, 64, 256]) {
    bench(`build ${size} instances`, () => {
      harness(size);
    });
  }
});
