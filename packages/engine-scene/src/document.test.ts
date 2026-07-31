import { describe, expect, it } from "vitest";

import {
  makeDocument,
  makeNode,
  makeTextDocument,
  nextOrderKey,
} from "./fixtures";
import {
  createIdFactory,
  createSequentialIdFactory,
  hasKind,
  isValidId,
} from "./ids";
import { generateKeyBetween } from "./order";
import { applyOperation } from "./operations";
import {
  SerializationError,
  canonicalize,
  deserialize,
  serialize,
} from "./serialize";
import { childrenOf, countNodes, findNode, walk } from "./tree";
import { SCENE_FORMAT_VERSION } from "./types";
import { assertValidDocument, validateDocument } from "./validate";

describe("identifiers", () => {
  it("generates kind-prefixed ids", () => {
    const ids = createIdFactory();
    expect(hasKind(ids("node"), "node")).toBe(true);
    expect(hasKind(ids("scene"), "scene")).toBe(true);
    expect(isValidId(ids("component"))).toBe(true);
  });

  it("does not collide across many generations", () => {
    const ids = createIdFactory();
    const generated = new Set(
      Array.from({ length: 20_000 }, () => ids("node")),
    );
    expect(generated.size).toBe(20_000);
  });

  it("is deterministic when the random source is", () => {
    // Injectable randomness exists so fixtures compare against committed
    // snapshots; a document whose ids change per run cannot be golden-tested.
    const fixed = () => new Uint8Array(16).fill(7);
    expect(createIdFactory(fixed)("node")).toBe(createIdFactory(fixed)("node"));
  });

  it("rejects malformed ids", () => {
    expect(isValidId("nod")).toBe(false);
    expect(isValidId("unknown_abc")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(42)).toBe(false);
  });
});

describe("tree traversal", () => {
  it("walks parents before children", () => {
    const document = makeDocument();
    const visited = [...walk(document.root)].map((n) => n.id);
    expect(visited[0]).toBe(document.root.id);
    expect(visited).toHaveLength(3);
  });

  it("counts every node", () => {
    expect(countNodes(makeDocument().root)).toBe(3);
  });

  it("sorts children defensively when a document arrives unsorted", () => {
    // Readers re-sort rather than trust the array — SCENE_FORMAT §6.2.
    const a = makeNode("nod_a", "b");
    const b = makeNode("nod_b", "a");
    const parent = makeNode("nod_p", "a", { children: [a, b] });
    expect(childrenOf(parent).map((n) => n.id)).toEqual(["nod_b", "nod_a"]);
  });

  it("returns null for a missing node", () => {
    expect(findNode(makeDocument().root, "nod_missing")).toBeNull();
  });
});

describe("serialization", () => {
  it("round-trips a document", () => {
    const document = makeDocument();
    expect(canonicalize(deserialize(serialize(document)))).toBe(
      canonicalize(document),
    );
  });

  it("produces identical canonical bytes regardless of key order", () => {
    const document = makeDocument();
    const shuffled = {
      root: document.root,
      states: document.states,
      format: document.format,
      assets: document.assets,
      id: document.id,
      variables: document.variables,
      version: document.version,
      world: document.world,
      meta: document.meta,
    } as typeof document;
    expect(canonicalize(shuffled)).toBe(canonicalize(document));
  });

  it("rounds floats to 5 decimals", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const next = applyOperation(document, {
      type: "node.setProp",
      nodeId: target.id,
      path: "transform.position",
      value: [1.2345678901, 0, 0],
      previousValue: [0, 0, 0],
    });
    expect(canonicalize(next)).toContain("1.23457");
  });

  it("rejects NaN and Infinity rather than repairing them", () => {
    const document = makeDocument();
    const broken = {
      ...document,
      world: { ...document.world, output: { width: NaN, height: 1080, fps: 60 } },
    } as typeof document;
    expect(() => serialize(broken)).toThrow(SerializationError);
  });

  it("omits undefined but preserves null", () => {
    // SCENE_FORMAT §12: null means explicitly absent; unset is omitted. The
    // two are never interchangeable.
    const document = { ...makeDocument(), extra: null, dropped: undefined };
    const output = canonicalize(document as never);
    expect(output).toContain('"extra":null');
    expect(output).not.toContain("dropped");
  });

  it("refuses a newer document version rather than reading it partially", () => {
    // SCENE_FORMAT §3: round-tripping unknown fields is only safe when the
    // overall structure is understood. A partial read that then saves would
    // destroy fields it did not recognise.
    const future = JSON.stringify({
      ...makeDocument(),
      version: SCENE_FORMAT_VERSION + 1,
    });
    expect(() => deserialize(future)).toThrow(/newer than the supported/);
  });

  it("refuses an older version with no migration registered", () => {
    const old = JSON.stringify({ ...makeDocument(), version: 1 });
    expect(() => deserialize(old)).toThrow(/requires migration/);
  });

  it("rejects a document that is not the scene format", () => {
    expect(() => deserialize(JSON.stringify({ format: "something.else" }))).toThrow(
      SerializationError,
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => deserialize("{ not json")).toThrow(SerializationError);
  });
});

describe("forward compatibility", () => {
  it("round-trips an unknown component type byte-for-byte", () => {
    // SCENE_FORMAT §13 rules 1-3. Opening a document in an older client and
    // saving must never destroy work.
    const document = makeDocument();
    const withPlugin = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_plugin", nextOrderKey(document.root), {
        components: [
          {
            id: "cmp_future",
            type: "future.particleSystem",
            props: { emitRate: 500, nested: { deep: true } },
          },
        ],
      }),
    });

    const restored = deserialize(serialize(withPlugin));
    expect(canonicalize(restored)).toBe(canonicalize(withPlugin));
    const component = findNode(restored.root, "nod_plugin")!.components![0]!;
    expect(component.type).toBe("future.particleSystem");
    expect(component.props).toEqual({ emitRate: 500, nested: { deep: true } });
  });

  it("round-trips unknown node fields", () => {
    const document = makeDocument();
    const withExtra = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_extra", nextOrderKey(document.root), {
        futureField: { anything: [1, 2, 3] },
      } as never),
    });
    const restored = deserialize(serialize(withExtra));
    expect(findNode(restored.root, "nod_extra")).toMatchObject({
      futureField: { anything: [1, 2, 3] },
    });
  });

  it("warns about an unknown component rather than rejecting it", () => {
    const document = makeDocument();
    const withPlugin = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_plugin", nextOrderKey(document.root), {
        components: [{ id: "cmp_future", type: "future.thing", props: {} }],
      }),
    });
    const result = validateDocument(withPlugin);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("unknown-component");
  });
});

describe("validation", () => {
  it("accepts a well-formed document", () => {
    const result = validateDocument(makeDocument());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts the text fixture, warnings aside", () => {
    expect(validateDocument(makeTextDocument()).valid).toBe(true);
  });

  it("rejects duplicate node ids", () => {
    const document = makeDocument();
    const duplicate = makeNode(
      childrenOf(document.root)[0]!.id,
      generateKeyBetween("z", null),
    );
    const broken = {
      ...document,
      root: { ...document.root, children: [...childrenOf(document.root), duplicate] },
    };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "duplicate-id",
    );
  });

  it("rejects unsorted children", () => {
    const document = makeDocument();
    const broken = {
      ...document,
      root: {
        ...document.root,
        children: [...childrenOf(document.root)].reverse(),
      },
    };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "unsorted-children",
    );
  });

  it("rejects duplicate order keys among siblings", () => {
    const document = makeDocument();
    const [a] = childrenOf(document.root);
    const clash = makeNode("nod_clash", a!.order);
    const broken = {
      ...document,
      root: { ...document.root, children: [a!, clash] },
    };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "duplicate-order",
    );
  });

  it("rejects a binding to an undeclared variable", () => {
    const document = makeTextDocument();
    const broken = { ...document, variables: [] };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "unresolved-binding",
    );
  });

  it("rejects text without a fit mode", () => {
    // SCENE_FORMAT §7.2: unbounded text is a visible on-air failure, so fit
    // is required rather than defaulted.
    const document = makeTextDocument();
    const node = childrenOf(document.root)[0]!;
    const component = node.components![0]!;
    const { fit: _dropped, ...rest } = component.props as Record<string, unknown>;
    const broken = {
      ...document,
      root: {
        ...document.root,
        children: [
          { ...node, components: [{ ...component, props: rest }] },
        ],
      },
    } as typeof document;
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "text-fit",
    );
  });

  it("rejects more than one camera on a node", () => {
    const document = makeDocument();
    const camera = {
      id: "cmp_cam",
      type: "camera" as const,
      props: { projection: "perspective" as const, near: 0.1, far: 1000 },
    };
    const broken = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_cams", generateKeyBetween("z", null), {
        components: [camera, { ...camera, id: "cmp_cam2" }],
      }),
    });
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "camera",
    );
  });

  it("rejects a defaultCameraId that is not a node", () => {
    const document = makeDocument();
    const broken = {
      ...document,
      world: { ...document.world, defaultCameraId: "nod_missing" },
    };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "unresolved-camera",
    );
  });

  it("rejects a wrong-handed world", () => {
    const document = makeDocument();
    const broken = {
      ...document,
      world: { ...document.world, handedness: "left" as never },
    };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain("world");
  });

  it("rejects non-finite numbers", () => {
    const document = makeDocument();
    const broken = {
      ...document,
      world: { ...document.world, output: { width: 1920, height: Infinity, fps: 60 } },
    };
    expect(validateDocument(broken).errors.map((e) => e.code)).toContain(
      "non-finite",
    );
  });

  it("warns, but does not fail, on a missing asset", () => {
    const document = makeTextDocument();
    const result = validateDocument({ ...document, assets: [] });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("missing-asset");
  });

  it("assertValidDocument throws with every error listed", () => {
    const document = makeDocument();
    const broken = { ...document, version: 99 };
    expect(() => assertValidDocument(broken)).toThrow(/is invalid/);
  });

  it("assertValidDocument returns warnings for a valid document", () => {
    const warnings = assertValidDocument({ ...makeTextDocument(), assets: [] });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("fixtures are deterministic", () => {
  it("produces identical documents across runs", () => {
    expect(canonicalize(makeDocument())).toBe(canonicalize(makeDocument()));
  });

  it("uses sequential ids", () => {
    const ids = createSequentialIdFactory();
    expect(ids("node")).toBe("nod_0001");
    expect(ids("node")).toBe("nod_0002");
    expect(ids("scene")).toBe("scn_0001");
  });
});
