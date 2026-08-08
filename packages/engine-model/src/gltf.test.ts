/**
 * The glTF reader, against real files.
 *
 * The fixtures are Khronos's own sample assets — the reference files every
 * glTF implementation is checked against. Hand-written fixtures would test
 * this parser against my understanding of the format, which is the thing most
 * likely to be wrong.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseGltf } from "./gltf";
import { UnsupportedModel } from "./types";

const load = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../apps/studio/public/models/${name}`, import.meta.url))),
  );

describe("a plain box", () => {
  const model = parseGltf(load("Box.glb"));

  it("reads geometry that is actually a box", () => {
    expect(model.meshes.length).toBe(1);
    const mesh = model.meshes[0]!;
    // 24 vertices — six faces of four, because the corners carry per-face
    // normals and cannot be shared.
    expect(mesh.positions.length / 3).toBe(24);
    expect(mesh.indices!.length).toBe(36);
    expect(mesh.normals!.length).toBe(mesh.positions.length);
  });

  it("measures its bounds", () => {
    // The sample box is one unit, centred.
    expect(model.bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(model.bounds.max).toEqual([0.5, 0.5, 0.5]);
  });

  it("keeps the file's node hierarchy rather than flattening it", () => {
    // Box.glb is a parent node holding a mesh node — a real two-level tree,
    // and the reason this is not "one file, one mesh".
    expect(model.nodes.length).toBeGreaterThan(1);
    expect(model.roots.length).toBe(1);
    const root = model.nodes[model.roots[0]!]!;
    expect(root.children.length).toBeGreaterThan(0);
  });

  it("reads the material as Streamatrix's own vocabulary", () => {
    expect(model.materials.length).toBe(1);
    const material = model.materials[0]!;
    expect(material.baseColor[0]).toBeGreaterThan(0.5); // The sample is red.
    expect(material.baseColor[3]).toBe(1);
    expect(material.metallic).toBeGreaterThanOrEqual(0);
    expect(material.roughness).toBeGreaterThanOrEqual(0);
  });

  it("indexes every triangle inside the vertex array", () => {
    // An out-of-range index is how a mesh renders as a spray of triangles
    // across the scene, and it is exactly what a stride mistake produces.
    const mesh = model.meshes[0]!;
    const vertices = mesh.positions.length / 3;
    for (const index of mesh.indices!) expect(index).toBeLessThan(vertices);
  });
});

describe("a textured box", () => {
  const model = parseGltf(load("BoxTextured.glb"));

  it("reads UVs and carries the texture through still encoded", () => {
    const mesh = model.meshes[0]!;
    expect(mesh.uvs!.length / 2).toBe(mesh.positions.length / 3);
    expect(model.textures.length).toBeGreaterThan(0);
    // Encoded, not decoded: pixels are IF-005's business, not this package's.
    expect(model.textures[0]!.bytes.byteLength).toBeGreaterThan(0);
    expect(model.textures[0]!.mime).toContain("image/");
  });

  it("points its material at that texture", () => {
    expect(model.materials[0]!.baseColorTexture).toBe(0);
  });
});

describe("a model with interleaved data and several nodes", () => {
  const model = parseGltf(load("Duck.glb"));

  it("reads it without producing nonsense", () => {
    expect(model.meshes.length).toBeGreaterThan(0);
    const mesh = model.meshes[0]!;
    expect(mesh.positions.length).toBeGreaterThan(300);
    // Every position finite. A byteStride read as tight packing produces NaN
    // and Infinity long before it produces a visibly wrong duck.
    for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
  });

  it("has a camera node and a mesh node in one tree", () => {
    expect(model.nodes.length).toBeGreaterThan(1);
    expect(model.nodes.some((node) => node.mesh >= 0)).toBe(true);
  });

  it("gives every mesh a material the model actually declares", () => {
    for (const mesh of model.meshes) {
      expect(mesh.material).toBeLessThan(model.materials.length);
    }
  });
});

describe("what it refuses, and how loudly", () => {
  it("refuses a file that is not glTF at all", () => {
    expect(() => parseGltf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(UnsupportedModel);
  });

  it("names Draco rather than failing vaguely", () => {
    const json = JSON.stringify({
      asset: { version: "2.0" },
      extensionsRequired: ["KHR_draco_mesh_compression"],
    });
    expect(() => parseGltf(new TextEncoder().encode(json))).toThrow(/Draco/);
  });

  it("names meshopt rather than failing vaguely", () => {
    const json = JSON.stringify({
      asset: { version: "2.0" },
      extensionsRequired: ["EXT_meshopt_compression"],
    });
    expect(() => parseGltf(new TextEncoder().encode(json))).toThrow(/meshopt/);
  });

  it("refuses a model made of lines rather than importing an empty one", () => {
    // An import that silently yields no geometry is worse than a refusal: the
    // asset installs, previews as nothing, places as nothing, and nobody can
    // say why.
    const json = JSON.stringify({
      asset: { version: "2.0" },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }],
      accessors: [{ componentType: 5126, count: 2, type: "VEC3" }],
    });
    expect(() => parseGltf(new TextEncoder().encode(json))).toThrow(/triangle/);
  });

  it("refuses a model that points at a file beside it", () => {
    const json = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4, uri: "scene.bin" }],
    });
    expect(() => parseGltf(new TextEncoder().encode(json))).toThrow(/self-contained/);
  });
});
