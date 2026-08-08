/**
 * A real model file, all the way to geometry on a backend.
 *
 * ============================================================================
 * WHAT THIS PROVES, AND WHY IT IS THE LOAD-BEARING TEST
 * ============================================================================
 * The claim being made is not "we can parse glTF". It is that a model asset
 * travels the whole Streamatrix pipeline — registry, codec, provider,
 * projector, MirrorBackend — with no renderer learning what glTF is and no
 * part of the content system holding a renderer object.
 *
 * So this test starts with the bytes of a Khronos sample file and ends by
 * asserting on what the BACKEND received: a geometry with the model's own
 * vertex count, and a material with the model's own colour. If that holds, the
 * boundary is real. If it needed a renderer import to pass, it would not be.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MirrorGraph,
  MockMirrorBackend,
  Projector,
  Reconciler,
  EMPTY_VARIABLES,
} from "@bracketx/engine-reconciler";
import type { SceneDocument, SceneNode } from "@bracketx/engine-scene";

import { AssetRegistry, MemoryAssetStore } from "@bracketx/engine-assets";
import { GLTF_CODEC, RegistryModelProvider } from "./assets";

const bytesOf = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../apps/studio/public/models/${name}`, import.meta.url))),
  );

const ASSET_ID = "ast_model_box";

/**
 * A backend that remembers what it was asked to create.
 *
 * The whole question is what the RENDERER receives, so the assertions read the
 * descriptors rather than a snapshot summary. Wrapping the mock rather than
 * writing a new one keeps every contract check the mock already enforces.
 */
function recording() {
  const backend = new MockMirrorBackend();
  const geometries: { positions: number; indices: number }[] = [];
  const materials: unknown[] = [];
  const createGeometry = backend.createGeometry.bind(backend);
  const createMaterial = backend.createMaterial.bind(backend);
  backend.createGeometry = (descriptor) => {
    geometries.push({
      positions: descriptor.positions.length,
      indices: descriptor.indices?.length ?? 0,
    });
    return createGeometry(descriptor);
  };
  backend.createMaterial = (descriptor) => {
    materials.push(descriptor);
    return createMaterial(descriptor);
  };
  return { backend, geometries, materials };
}

function project(node: SceneNode, provider: RegistryModelProvider) {
  const { backend, geometries, materials } = recording();
  const mirror = new MirrorGraph(backend);
  const projector = new Projector(mirror, backend, undefined, undefined, provider);
  projector.build(documentWith(node), EMPTY_VARIABLES);
  return { mirror, geometries, materials };
}

function meshNode(id: string, assetId: string, extra: Record<string, unknown> = {}): SceneNode {
  return {
    id,
    order: "a1",
    name: id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      {
        id: `c_${id}`,
        type: "meshRenderer",
        props: { primitive: { shape: "asset", assetId, mesh: 0 }, ...extra },
      },
    ],
  } as unknown as SceneNode;
}

function documentWith(node: SceneNode): SceneDocument {
  return {
    id: "doc_model",
    format: "streamatrix.scene",
    version: 1,
    world: { output: { width: 1920, height: 1080, fps: 60 } },
    assets: [],
    variables: [],
    root: {
      id: "root",
      order: "a0",
      name: "Root",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      children: [node],
    },
  } as unknown as SceneDocument;
}

describe("a model asset reaches the backend as geometry", () => {
  let registry: AssetRegistry;
  let provider: RegistryModelProvider;

  beforeAll(async () => {
    registry = new AssetRegistry(new MemoryAssetStore());
    registry.addCodec(GLTF_CODEC);

    const bytes = bytesOf("Box.glb");
    const now = new Date().toISOString();
    registry.register({
      id: ASSET_ID,
      kind: "model",
      hash: "h_box",
      mime: "model/gltf-binary",
      name: "Box",
      origin: "user",
      bytes: bytes.byteLength,
      createdAt: now,
      updatedAt: now,
      tags: [],
      collections: [],
      favorite: false,
      metadata: {},
    });
    await registry.store.put("h_box", bytes);
    await registry.resolve(ASSET_ID);
    provider = new RegistryModelProvider(registry);
  });

  it("recognises the file by its own magic number, not its name", () => {
    expect(GLTF_CODEC.probe(bytesOf("Box.glb"))).toBe(true);
    expect(GLTF_CODEC.probe(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
  });

  it("decodes to a model the provider can serve", () => {
    expect(provider.meshCount(ASSET_ID)).toBe(1);
    const mesh = provider.mesh(ASSET_ID, 0);
    expect(mesh).toBeDefined();
    expect(mesh!.positions.length / 3).toBe(24);
    expect(mesh!.indices!.length).toBe(36);
  });

  it("records what the product needs to place it, in the asset's metadata", () => {
    const record = registry.record(ASSET_ID)!;
    // Measured, not guessed: a 40-metre stadium and a 4-centimetre badge must
    // both arrive at a usable size, and the only way to know is to have read it.
    expect(record.metadata?.width).toBeCloseTo(1, 3);
    expect(record.metadata?.height).toBeCloseTo(1, 3);
    expect(record.metadata?.vertices).toBe(24);
  });

  it("returns nothing for a mesh the model does not have", () => {
    // A miss must be a miss. Returning an empty mesh would draw nothing while
    // reporting success, which is the failure mode this pipeline refuses.
    expect(provider.mesh(ASSET_ID, 99)).toBeUndefined();
    expect(provider.mesh("ast_nonexistent", 0)).toBeUndefined();
  });

  /**
   * THE ONE THAT PROVES THE BOUNDARY.
   *
   * The projector is handed a document whose mesh names an ASSET, and the
   * renderer is asked for real geometry. Nothing in this file imports three or
   * Babylon, and nothing in the reconciler imports engine-model.
   */
  it("projects an asset-backed mesh onto the backend", () => {
    const { mirror, geometries } = project(meshNode("n_box", ASSET_ID), provider);

    expect(mirror.get("n_box")?.attachment.kind, "no geometry was attached").toBe("mesh");
    // The MODEL own vertex count, on the backend. Not a placeholder cube.
    const geometry = geometries.find((entry) => entry.positions === 24 * 3);
    expect(geometry, "the backend did not receive the model own vertices").toBeDefined();
    expect(geometry!.indices).toBe(36);
  });

  it("uses the file own material until the designer states one", () => {
    const { materials } = project(meshNode("n_box", ASSET_ID), provider);

    // Box.glb is red and lit. An imported asset that arrives grey and flat has
    // lost the thing that made it worth importing.
    const pbr = materials.find(
      (material) => (material as { kind?: string }).kind === "pbr",
    ) as { baseColor: number[] } | undefined;
    expect(pbr, "the model material did not survive the pipeline").toBeDefined();
    expect(pbr!.baseColor[0]).toBeGreaterThan(pbr!.baseColor[1]!);
  });

  it("lets an authored material override the file own", () => {
    const { materials } = project(
      meshNode("n_box", ASSET_ID, {
        material: { kind: "unlit", color: "#00ff00", transparent: false },
      }),
      provider,
    );
    // The Inspector edits the same props a generated cube has, so assigning a
    // Streamatrix material to an imported asset is not a special case.
    const unlit = materials.find((material) => (material as { kind?: string }).kind === "unlit");
    expect(unlit, "the authored material was ignored").toBeDefined();
  });

  it("draws nothing, rather than a placeholder, when the model has not loaded", () => {
    const { mirror, geometries } = project(meshNode("n_missing", "ast_not_installed"), provider);

    // The node SURVIVES — its place in the tree, its transform and its name —
    // and simply draws nothing. A stand-in cube for a sponsor product is the
    // kind of thing that reaches air.
    expect(mirror.get("n_missing")).toBeDefined();
    expect(mirror.get("n_missing")?.attachment.kind).toBe("none");
    expect(geometries.length, "something was drawn for a model that is not there").toBe(0);
  });

  it("refuses a format it cannot read instead of importing an empty asset", async () => {
    const fresh = new AssetRegistry(new MemoryAssetStore());
    fresh.addCodec(GLTF_CODEC);
    // Valid glTF JSON that declares Draco. Parsing must fail loudly.
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: "2.0" },
        extensionsRequired: ["KHR_draco_mesh_compression"],
      }),
    );
    await expect(GLTF_CODEC.decode(bytes, "model/gltf+json")).rejects.toThrow(/Draco/);
    void fresh;
  });

  it("never makes the reconciler depend on a model format", () => {
    // The architectural claim, as an assertion. If engine-reconciler ever
    // imports engine-model, the port has been bypassed and the next format
    // becomes a change to projection.
    const source = readFileSync(
      fileURLToPath(new URL("../../engine-reconciler/src/projection.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("engine-model");
    expect(source).not.toContain("gltf");
  });

  void Reconciler;
});
