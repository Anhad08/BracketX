/**
 * Text layout facts, attributed to the node that produced them.
 *
 * The pre-flight the Studio Blueprint asks for needs to name the layer that
 * overflowed, not merely know that one did. `TextDraw` already reports
 * `overflowed`, but a draw is keyed by content — `TextRequest` is
 * JSON-stringified as a cache signature, so it deliberately carries no node id.
 *
 * These tests pin the two properties that makes workable:
 *   1. the projection attributes each draw's facts to its node, and
 *   2. two nodes with identical text still SHARE one draw.
 *
 * The second is the reason the id could not simply be added to the request.
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import type { TextDraw, TextProvider, TextRequest } from "./text-provider";

/**
 * A provider that overflows any content longer than 12 characters and counts
 * how many times it was asked. The threshold is arbitrary; what matters is
 * that it is a function of content, exactly as real shaping is.
 */
class CountingTextProvider implements TextProvider {
  requests: TextRequest[] = [];
  #revision = 1;

  draw(request: TextRequest): TextDraw | null {
    this.requests.push(request);
    const overflowed = request.content.length > 12;
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
      atlasKeys: ["a"],
      truncated: false,
      overflowed,
      brokeWithoutOpportunity: false,
      resolvedSize: overflowed ? 24 : 32,
    };
  }

  pages() {
    return [
      { width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 4), revision: this.#revision },
    ];
  }

  /* The atlas never changes here, so nothing is ever dirty and pinning is a
     no-op. Implemented rather than stubbed away because TextProvider is the
     seam the projector actually calls, and a partial mock would be testing a
     different interface from the one that ships. */
  flushDirty() {
    return [];
  }

  pin(): void {}
  unpin(): void {}
}

const TIME = "2026-01-01T00:00:00.000Z";

function textNode(id: string, order: string, content: string): SceneNode {
  return {
    id,
    name: content,
    order,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      {
        id: `cmp_${id}`,
        type: "text",
        props: {
          content,
          font: { assetId: "font_a", size: 32 },
          color: "#ffffff",
          fit: { mode: "overflow" },
        },
      },
    ],
    children: [],
  } as unknown as SceneNode;
}

function documentWith(nodes: readonly SceneNode[]): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scene_facts",
    meta: { name: "Facts", createdAt: TIME, updatedAt: TIME },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 50 },
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
  } as unknown as SceneDocument;
}

function project(document: SceneDocument, text: CountingTextProvider) {
  const backend = new MockMirrorBackend();
  const reconciler = new Reconciler(backend, { text });
  reconciler.build(document);
  return reconciler.projector;
}

describe("text facts are attributed to their node", () => {
  it("names the node that overflowed, not merely that one did", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const text = new CountingTextProvider();
    const projection = project(
      documentWith([
        textNode("node_short", a, "Bea Lam"),
        textNode("node_long", b, "Konstantinos Papadopoulos"),
      ]),
      text,
    );

    const facts = projection.textFacts();
    expect(facts.get("node_short")?.overflowed).toBe(false);
    expect(facts.get("node_long")?.overflowed).toBe(true);
  });

  it("reports the resolved size, which differs when the text was shrunk", () => {
    const a = generateKeyBetween(null, null);
    const text = new CountingTextProvider();
    const projection = project(
      documentWith([textNode("node_long", a, "Konstantinos Papadopoulos")]),
      text,
    );
    expect(projection.textFacts().get("node_long")?.resolvedSize).toBe(24);
  });

  it("returns an empty map for a document with no text", () => {
    const text = new CountingTextProvider();
    const projection = project(documentWith([]), text);
    expect(projection.textFacts().size).toBe(0);
  });
});

describe("where caching actually happens", () => {
  it("the projector draws once PER NODE, not once per distinct content", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const text = new CountingTextProvider();
    project(
      documentWith([textNode("node_a", a, "ARSENAL"), textNode("node_b", b, "ARSENAL")]),
      text,
    );

    // Pinned because it corrects a wrong assumption. The projector's `#texts`
    // map is a per-node CHANGE DETECTOR — "has this node's request altered
    // since last frame" — not a content-addressed cache. Identical content in
    // two nodes therefore produces two draws here.
    //
    // Content-level sharing is real but lives one layer down, in engine-text:
    // `layoutKey(spec, stack)` is the cache key, and its doc comment notes that
    // two nodes differing only in alignment share one layout. So the cost of a
    // second identical node is a provider call, not a second shaping pass.
    expect(text.requests.map((r) => r.content)).toEqual(["ARSENAL", "ARSENAL"]);
  });

  it("still attributes the shared draw to BOTH nodes", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const text = new CountingTextProvider();
    const projection = project(
      documentWith([
        textNode("node_a", a, "Konstantinos Papadopoulos"),
        textNode("node_b", b, "Konstantinos Papadopoulos"),
      ]),
      text,
    );

    const facts = projection.textFacts();
    expect(facts.get("node_a")?.overflowed).toBe(true);
    expect(facts.get("node_b")?.overflowed).toBe(true);
  });
});
