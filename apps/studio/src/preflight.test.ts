/**
 * The pre-air check, against a real SceneHost.
 *
 * These tests build an actual host with an actual reconciler and read the
 * findings back out of the projection. There is no mocked overflow anywhere:
 * the text provider shapes (crudely, but as a function of content and box) and
 * the check reports what the projection recorded.
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
  type SceneVariable,
} from "@bracketx/engine-scene";
import { SceneHost } from "@bracketx/engine-host";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import type {
  TextDraw,
  TextProvider,
  TextRequest,
} from "@bracketx/engine-reconciler";

import { preflight } from "./studio/preflight";

/**
 * A provider that decides fit from content length against the box, which is
 * the same *shape* of decision the real shaper makes — a function of the
 * content and the box, not of the node.
 */
class TinyShaper implements TextProvider {
  #revision = 1;

  draw(request: TextRequest): TextDraw | null {
    // The request's box arrives in LAYOUT PIXELS (units x pixelsPerUnit) and
    // `size` is the font size in that same space — so a glyph is roughly
    // 0.6 x size wide. Crude, but in the right units, which the first version
    // of this test was not.
    const needed = request.content.length * request.size * 0.6;
    const overflowed = needed > request.box.width;
    const truncated = overflowed && request.fit.mode === "truncate";
    return {
      batches: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
          uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          page: 0,
        },
      ],
      pxRange: 4,
      atlasKeys: ["k"],
      truncated,
      overflowed,
      brokeWithoutOpportunity: false,
      resolvedSize: request.size,
    };
  }

  pages() {
    return [{ width: 4, height: 4, pixels: new Uint8Array(64), revision: this.#revision }];
  }
  flushDirty() {
    return [];
  }
  pin(): void {}
  unpin(): void {}
}

const TIME = "2026-01-01T00:00:00.000Z";

function textNode(
  id: string,
  order: string,
  name: string,
  content: string,
  boxWidth: number,
): SceneNode {
  return {
    id,
    name,
    order,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width: boxWidth, height: 0.3 },
    components: [
      {
        id: `cmp_${id}`,
        type: "text",
        props: {
          content,
          font: { assetId: "font_a", size: 36 },
          color: "#ffffff",
          fit: { mode: "overflow" },
        },
      },
    ],
    children: [],
  } as unknown as SceneNode;
}

function documentWith(
  nodes: readonly SceneNode[],
  extra: Partial<SceneDocument> = {},
): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scene_preflight",
    meta: { name: "Preflight", createdAt: TIME, updatedAt: TIME },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 50 },
      pixelsPerUnit: 100,
    },
    variables: [],
    assets: [{ id: "font_a", kind: "font", uri: "font_a" }],
    states: [],
    root: {
      id: "node_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [],
      children: nodes,
    },
    ...extra,
  } as unknown as SceneDocument;
}

function hostFor(document: SceneDocument, withText = true): SceneHost {
  const host = new SceneHost(new MockMirrorBackend(), {
    defaultOutput: true,
    ...(withText ? { text: new TinyShaper() } : {}),
  });
  host.load(document);
  return host;
}

describe("text findings come from the shaper, named by node", () => {
  it("names the layer that overflowed", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const host = hostFor(
      documentWith([
        textNode("n_short", a, "Presenter", "Bea Lam", 2),
        textNode("n_long", b, "Correspondent", "Konstantinos Papadopoulos", 1),
      ]),
    );

    const report = preflight(host);
    const overflow = report.issues.filter((i) => i.kind === "overflow");
    expect(overflow).toHaveLength(1);
    // The author-facing NAME, not the node id — the whole point of the join.
    expect(overflow[0]!.label).toBe("Correspondent");
    expect(overflow[0]!.nodeId).toBe("n_long");
    expect(report.clear).toBe(false);
  });

  it("is clear when everything fits", () => {
    const a = generateKeyBetween(null, null);
    const host = hostFor(documentWith([textNode("n", a, "Presenter", "Bea Lam", 4)]));
    const report = preflight(host);
    expect(report.issues).toEqual([]);
    expect(report.clear).toBe(true);
  });

  it("re-checks after an edit, because it reads the projection", () => {
    const a = generateKeyBetween(null, null);
    const host = hostFor(documentWith([textNode("n", a, "Presenter", "Bea Lam", 2)]));
    expect(preflight(host).clear).toBe(true);

    // Lengthen the content through a real operation.
    host.apply({
      id: "txn_1",
      label: "Set content",
      actorId: "test",
      operations: [
        {
          // Paths are relative to the NODE and address plain objects and
          // arrays — `components.0.props.content`. There is no componentId on
          // the operation; property-path.ts is explicit about the grammar.
          type: "node.setProp",
          nodeId: "n",
          path: "components.0.props.content",
          value: "Konstantinos Papadopoulos",
          previousValue: "Bea Lam",
        },
      ],
    });

    const after = preflight(host);
    expect(after.issues.map((i) => i.kind)).toContain("overflow");
    expect(after.issues[0]!.label).toBe("Presenter");
  });
});

describe("the report states what it could not check", () => {
  it("reports text as unchecked when there is no provider", () => {
    const a = generateKeyBetween(null, null);
    const host = hostFor(documentWith([textNode("n", a, "Presenter", "x".repeat(80), 1)]), false);

    const report = preflight(host);
    // Volume Four C34 — silently green about something never looked at is worse
    // than no report at all.
    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0]).toMatch(/no text provider/);
    expect(report.clear).toBe(false);
    expect(report.issues.filter((i) => i.kind === "overflow")).toEqual([]);
  });

  it("is not clear with no document loaded", () => {
    const host = new SceneHost(new MockMirrorBackend(), { defaultOutput: true });
    const report = preflight(host);
    expect(report.clear).toBe(false);
    expect(report.unchecked[0]).toMatch(/No document/);
  });
});

describe("required content fields gate air", () => {
  const VARS: readonly SceneVariable[] = [
    { id: "v_name", key: "talent.name", type: "string", label: "Name", default: "" },
  ];

  it("reports a required field that is empty", () => {
    const a = generateKeyBetween(null, null);
    const host = hostFor(
      documentWith([textNode("n", a, "Presenter", "Bea Lam", 4)], {
        variables: VARS,
        template: {
          id: "tpl",
          name: "Lower Third",
          parameters: [
            { key: "talent.name", type: "string", label: "Name", required: true },
          ],
        },
      }),
    );

    const report = preflight(host);
    const missing = report.issues.filter((i) => i.kind === "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.label).toBe("Name");
    expect(missing[0]!.nodeId).toBeUndefined();
  });
});

describe("issues are ordered by effect on air", () => {
  it("puts overflow before a missing field", () => {
    const a = generateKeyBetween(null, null);
    const host = hostFor(
      documentWith([textNode("n", a, "Presenter", "Konstantinos Papadopoulos", 1)], {
        variables: [
          { id: "v", key: "talent.name", type: "string", label: "Name", default: "" },
        ],
        template: {
          id: "tpl",
          name: "Lower Third",
          parameters: [{ key: "talent.name", type: "string", label: "Name", required: true }],
        },
      }),
    );
    expect(preflight(host).issues.map((i) => i.kind)).toEqual(["overflow", "missing"]);
  });
});
