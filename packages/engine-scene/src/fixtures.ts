/**
 * Deterministic document fixtures for tests.
 *
 * Uses the sequential id factory so a fixture compares equal against a
 * committed snapshot across runs — a document whose ids change every run
 * cannot be golden-tested.
 */
import { createSequentialIdFactory, type IdFactory } from "./ids";
import { generateKeyBetween } from "./order";
import { IDENTITY_TRANSFORM, SCENE_FORMAT_ID, SCENE_FORMAT_VERSION } from "./types";
import type { SceneDocument, SceneNode } from "./types";

const FIXED_TIME = "2026-08-01T00:00:00.000Z";

export function makeNode(
  id: string,
  order: string,
  overrides: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name: id,
    order,
    transform: IDENTITY_TRANSFORM,
    ...overrides,
  };
}

export interface FixtureOptions {
  readonly ids?: IdFactory;
}

/**
 * An order key that sorts after every existing child of `parent`.
 *
 * Tests need this because order keys are deterministic: calling
 * `generateKeyBetween(null, null)` twice returns the same key, and inserting
 * it under a parent that already has children is now rejected as a duplicate.
 */
export function nextOrderKey(parent: SceneNode): string {
  const children = parent.children ?? [];
  const last = children.length > 0 ? children[children.length - 1]!.order : null;
  return generateKeyBetween(last, null);
}

/** Root with two children, no components. */
export function makeDocument(options: FixtureOptions = {}): SceneDocument {
  const ids = options.ids ?? createSequentialIdFactory();
  const rootId = ids("node");
  const a = ids("node");
  const b = ids("node");
  const keyA = generateKeyBetween(null, null);
  const keyB = generateKeyBetween(keyA, null);

  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: ids("scene"),
    meta: {
      name: "Fixture",
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
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
    root: makeNode(rootId, generateKeyBetween(null, null), {
      name: "Root",
      children: [makeNode(a, keyA), makeNode(b, keyB)],
    }),
  };
}

/** Root, one child carrying a text component bound to a variable. */
export function makeTextDocument(): SceneDocument {
  const ids = createSequentialIdFactory();
  const base = makeDocument({ ids });
  const fontId = ids("asset");
  const nodeId = ids("node");
  const componentId = ids("component");
  const variableId = ids("variable");

  return {
    ...base,
    assets: [
      { id: fontId, kind: "font", name: "Inter.woff2", hash: "sha256:test" },
    ],
    variables: [
      {
        id: variableId,
        key: "playerName",
        type: "string",
        label: "Player Name",
        default: "ALEX RIVERA",
      },
    ],
    root: {
      ...base.root,
      children: [
        makeNode(nodeId, generateKeyBetween(null, null), {
          name: "Player Name",
          components: [
            {
              id: componentId,
              type: "text",
              props: {
                content: { $var: "playerName" },
                font: { assetId: fontId, size: 48 },
                color: "#FFFFFF",
                fit: { mode: "shrink", minSize: 24 },
              },
            },
          ],
        }),
      ],
    },
  };
}
