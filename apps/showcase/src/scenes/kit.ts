/**
 * Scene construction helpers.
 *
 * Twelve scenes of hand-written document boilerplate would drift: one would get
 * a different camera, another a different output size, and the showcase would
 * start proving inconsistent things. These builders keep every scene comparable.
 *
 * Nothing here is engine logic. It is authoring convenience over the public
 * scene format, exactly as an editor or an importer would be.
 */
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type AnimationClip,
  type SceneDocument,
  type SceneNode,
  type SceneToken,
  type SceneVariable,
  type TemplateDefinition,
} from "@bracketx/engine-scene";
import type { RuntimeValue } from "@bracketx/engine-runtime";

/**
 * The world is 17.78 x 10 units — 16:9 at an orthographic size of 5.
 *
 * Fixed across every scene so a position means the same thing in all of them,
 * and so the debug overlay's numbers are comparable between scenes.
 */
export const WORLD = { width: 17.78, height: 10 } as const;

/** The shared brand kit. One place, so a token change is visible everywhere. */
export const TOKENS: SceneToken[] = [
  { name: "color.primary", value: "#0B1F3A" },
  { name: "color.surface", value: "#12263F" },
  { name: "color.accent", value: "#E8B23A" },
  { name: "color.success", value: "#27AE60" },
  { name: "color.danger", value: "#C0392B" },
  { name: "color.info", value: "#2980B9" },
  { name: "color.text", value: "#F5F7FA" },
  { name: "space.sm", value: 0.1 },
  { name: "space.md", value: 0.25 },
];

let orderSeed = 0;

/**
 * A sibling order key.
 *
 * Deterministic per call sequence, and every scene builds from scratch, so the
 * same document always produces the same keys. Reset by `resetOrder`, which
 * `sceneDocument` calls — otherwise loading a scene twice would give different
 * keys and break the determinism the showcase is meant to prove.
 */
export function nextOrder(): string {
  orderSeed += 1;
  let key: string | null = null;
  for (let i = 0; i < orderSeed; i += 1) key = generateKeyBetween(key, null);
  return key!;
}

function resetOrder(): void {
  orderSeed = 0;
}

/** The camera. Always child zero, so paths are stable across scenes. */
export function camera(size = 5): SceneNode {
  return {
    id: "nod_cam",
    name: "Camera",
    // Lowest valid key: sibling order is by key, not by array position, and the
    // camera must sort first regardless of when it was constructed.
    order: "1",
    transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      {
        id: "cmp_cam",
        type: "camera",
        props: {
          projection: "orthographic",
          orthographicSize: size,
          near: 0.1,
          far: 100,
        },
      },
    ],
  };
}

export interface BoxOptions {
  readonly at?: readonly [number, number, number];
  readonly fill?: unknown;
  readonly extra?: Partial<SceneNode>;
}

/** A coloured rectangle. The only visual primitive the engine has today. */
export function box(
  id: string,
  width: number,
  height: number,
  options: BoxOptions = {},
): SceneNode {
  const suffix = id.startsWith("nod_") ? id.slice(4) : id;
  return {
    id,
    name: id,
    order: nextOrder(),
    transform: {
      position: options.at ?? [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    size: { width, height },
    components: [
      {
        id: `cmp_${suffix}`,
        type: "rect",
        props: {
          width,
          height,
          fill: options.fill ?? { $var: "color.primary" },
        },
      },
    ],
    ...options.extra,
  };
}

export interface DocumentOptions {
  readonly id: string;
  readonly name: string;
  readonly children: readonly SceneNode[];
  readonly variables?: readonly SceneVariable[];
  readonly animations?: readonly AnimationClip[];
  readonly template?: TemplateDefinition;
  readonly cameraSize?: number;
  readonly rootExtra?: Partial<SceneNode>;
}

export function sceneDocument(options: DocumentOptions): SceneDocument {
  // Reset first: a scene built twice must produce identical order keys, and the
  // showcase asserts exactly that.
  resetOrder();

  const cam = camera(options.cameraSize);
  const children = [cam, ...options.children.map(cloneWithOrder)];

  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: options.id,
    meta: {
      name: options.name,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: options.variables ?? [],
    assets: [],
    states: [],
    tokens: TOKENS,
    ...(options.animations ? { animations: options.animations } : {}),
    ...(options.template ? { template: options.template } : {}),
    root: {
      id: "nod_root",
      name: "Root",
      order: nextOrder(),
      transform: IDENTITY_TRANSFORM,
      size: { width: WORLD.width, height: WORLD.height },
      ...options.rootExtra,
      children,
    },
  };
}

/**
 * Children built before `sceneDocument` ran already have order keys.
 *
 * They are kept: a scene that assembles nodes in a helper and then passes them
 * in must not have its ordering silently rewritten.
 */
function cloneWithOrder(node: SceneNode): SceneNode {
  return node;
}

/** A variable declaration. Most scenes need three or four. */
export function variable(
  key: string,
  type: SceneVariable["type"],
  value: unknown,
  label?: string,
): SceneVariable {
  return {
    id: `var_${key}`,
    key,
    type,
    label: label ?? key,
    default: value,
  };
}

/**
 * Rows for the collection-driven scenes. Deterministic.
 *
 * The index signature is what makes a row a RuntimeValue: collections live in
 * runtime state, and runtime state is constrained to JSON-shaped data so it
 * stays canonicalizable and hashable for determinism (ENGINE_RUNTIME §5).
 */
export interface Row {
  readonly [key: string]: RuntimeValue;
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly color: string;
}

const TEAMS = [
  ["Alpha", "#C0392B"],
  ["Bravo", "#2980B9"],
  ["Charlie", "#27AE60"],
  ["Delta", "#8E44AD"],
  ["Echo", "#D35400"],
  ["Foxtrot", "#16A085"],
  ["Golf", "#2C3E50"],
  ["Hotel", "#7F8C8D"],
] as const;

export function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const [name, color] = TEAMS[i % TEAMS.length]!;
    return {
      id: `t${i + 1}`,
      name: `${name}${i >= TEAMS.length ? ` ${Math.floor(i / TEAMS.length) + 1}` : ""}`,
      score: (count - i) * 3,
      color,
    };
  });
}
