/**
 * Shared test fixtures.
 *
 * Re-exports the reconciler pieces the backend tests drive, plus a small
 * document builder. Kept separate so the test files themselves stay about the
 * behaviour under test rather than about scaffolding.
 */
import { generateKeyBetween } from "@bracketx/engine-scene";
import type { SceneDocument, SceneNode } from "@bracketx/engine-scene";

export {
  MockMirrorBackend,
  Reconciler,
  type InspectableMirrorBackend,
  type MaterialDescriptor,
  // Handles belong to the frozen MirrorBackend contract, not to this package.
  // Tests import them from there so a drift in the contract breaks the tests.
  type GeometryHandle,
  type MaterialHandle,
  type NodeHandle,
} from "@bracketx/engine-reconciler";

type Mutable = { children: SceneNode[] };

function node(id: string, order: string): SceneNode {
  return {
    id,
    name: id,
    order,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  };
}

/** Root with two children. Small enough to assert paths exactly. */
export function quadDescriptor(): SceneDocument {
  const first = generateKeyBetween(null, null);
  const second = generateKeyBetween(first, null);

  const root: SceneNode = {
    id: "nod_root",
    name: "root",
    order: generateKeyBetween(null, null),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    children: [],
  };
  (root as unknown as Mutable).children = [
    node("nod_a", first),
    node("nod_b", second),
  ];

  return {
    format: "bracketx.scene",
    version: 2,
    id: "scn_render",
    meta: {
      name: "Render",
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
    root,
  };
}
