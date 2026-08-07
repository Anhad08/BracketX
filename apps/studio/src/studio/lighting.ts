/**
 * Lighting a scene, as a broadcaster thinks about it.
 *
 * ============================================================================
 * A LOOK, NOT SIX NUMBERS
 * ============================================================================
 * Lighting a set properly means choosing positions, angles, colour
 * temperatures and relative intensities for three or four sources. That is a
 * craft, and it is not one a person building a lower third at 14:50 for a
 * 15:00 transmission has time to practise.
 *
 * So the unit here is a LOOK — Studio, Dramatic, Soft, Flat — and every one of
 * them compiles to ordinary light nodes. Not a special lighting object, not a
 * mode: the same nodes somebody could have placed by hand, which means the
 * timeline can animate them, the layer tree lists them, the gizmos move them
 * and deleting one does exactly what deleting a light should do.
 *
 * That is the same bargain the animation presets make ("a preset compiles to
 * ordinary keyframes and then stops existing"), and it is made here for the
 * same reason: a generated thing that stays special is a thing the rest of the
 * product has to know about forever.
 *
 * ============================================================================
 * EXPOSURE AND SHADOWS ARE NOT LIGHTS
 * ============================================================================
 * They live on the document's environment (ADR-013 amendment 3), because they
 * are properties of the PICTURE rather than of anything standing in the scene.
 * Turning shadows on does not move a light, and raising exposure does not make
 * the key brighter — it makes the photograph brighter, which is a different
 * decision and one an operator makes last.
 */
import {
  childrenOf,
  generateKeyBetween,
  makeSetDocProp,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";

import { orderAfterLast, transaction } from "./editing";
import type { IdFactory } from "./ids";

export interface LightPlacement {
  readonly name: string;
  readonly kind: "ambient" | "directional" | "point" | "spot";
  readonly intensity: number;
  readonly color: string;
  /** Ambient lights ignore both. A light points down its own −Z. */
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

export interface Look {
  readonly id: string;
  /** What a person calls it. Never a lighting-engineering term. */
  readonly label: string;
  /** One line, shown under the picker. Says what it looks like. */
  readonly hint: string;
  readonly lights: readonly LightPlacement[];
  /** Shadows suit a set and flatter almost nothing else. */
  readonly shadows: boolean;
}

/** A key light aimed at the origin from above and in front. */
const KEY: LightPlacement = {
  name: "Key",
  kind: "directional",
  intensity: 2.2,
  color: "#FFF6EC",
  position: [3.5, 4, 5],
  rotation: [-32, 32, 0],
};

const FILL: LightPlacement = {
  name: "Fill",
  kind: "ambient",
  intensity: 0.55,
  color: "#DDE6FF",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

/**
 * The looks.
 *
 * Four, and no more, because a picker with twelve entries is one nobody reads.
 * They are ordered by how safe they are rather than by how impressive: Studio
 * first because it flatters everything, Flat last because it is the one that
 * deliberately gives up modelling.
 */
export const LOOKS: readonly Look[] = [
  {
    id: "studio",
    label: "Studio",
    hint: "Even and flattering. The safe answer.",
    shadows: true,
    lights: [
      KEY,
      FILL,
      {
        name: "Back",
        kind: "directional",
        intensity: 1.1,
        color: "#E8F0FF",
        // Behind and above, separating the subject from the background — the
        // light that makes a set read as a set rather than as a sticker.
        position: [-3, 4.5, -4],
        rotation: [-38, -150, 0],
      },
    ],
  },
  {
    id: "dramatic",
    label: "Dramatic",
    hint: "Hard key, deep shadow. Sport and titles.",
    shadows: true,
    lights: [
      { ...KEY, intensity: 3.6, color: "#FFFFFF" },
      { ...FILL, intensity: 0.16 },
    ],
  },
  {
    id: "soft",
    label: "Soft",
    hint: "Broad and shadowless. News and straps.",
    shadows: false,
    lights: [
      { ...KEY, intensity: 1.3, color: "#FFFFFF" },
      { ...FILL, intensity: 1.05 },
    ],
  },
  {
    id: "flat",
    label: "Flat",
    hint: "No modelling at all. Colours exactly as designed.",
    shadows: false,
    // One ambient and nothing else. Every face receives the same light, which
    // is what a designer means when they say the plate must be THAT blue.
    lights: [{ ...FILL, intensity: 1.6 }],
  },
];

export const DEFAULT_LOOK = LOOKS[0]!;

export function lookById(id: string): Look | undefined {
  return LOOKS.find((look) => look.id === id);
}

// ---------------------------------------------------------------------------
// Reading the scene
// ---------------------------------------------------------------------------

export interface SceneLight {
  readonly nodeId: string;
  readonly name: string;
  readonly kind: string;
  readonly intensity: number;
}

/** Every light in the document, in tree order. */
export function lightsOf(document: SceneDocument): readonly SceneLight[] {
  const out: SceneLight[] = [];
  const visit = (node: SceneNode): void => {
    for (const component of node.components ?? []) {
      if (component.type !== "light") continue;
      const props = component.props as { kind?: unknown; intensity?: unknown };
      out.push({
        nodeId: node.id,
        name: node.name,
        kind: typeof props.kind === "string" ? props.kind : "directional",
        intensity: typeof props.intensity === "number" ? props.intensity : 1,
      });
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(document.root);
  return out;
}

/**
 * The look the scene is currently wearing, or null.
 *
 * Matched on the RIG rather than remembered in a field: the lights are
 * ordinary nodes and a designer may move, dim or delete one, at which point the
 * scene genuinely is not wearing "Dramatic" any more. A picker that went on
 * claiming it was would be lying about the picture.
 */
export function lookOf(document: SceneDocument): Look | null {
  const lights = lightsOf(document);
  return (
    LOOKS.find(
      (look) =>
        look.lights.length === lights.length &&
        look.lights.every((wanted, index) => {
          const found = lights[index];
          return (
            found !== undefined &&
            found.name === wanted.name &&
            found.kind === wanted.kind &&
            Math.abs(found.intensity - wanted.intensity) < 1e-6
          );
        }),
    ) ?? null
  );
}

export function exposureOf(document: SceneDocument): number {
  const value = document.world?.environment?.exposure;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

export function shadowsOn(document: SceneDocument): boolean {
  return document.world?.environment?.shadows === true;
}

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

/** The insert operations for a look's rig, under `parentId`. */
export function lightNodeOperations(
  document: SceneDocument,
  parentId: string,
  look: Look,
  ids: IdFactory,
): readonly SceneOperation[] {
  const operations: SceneOperation[] = [];
  let order = orderAfterLast(document, parentId);
  for (const placement of look.lights) {
    operations.push({
      type: "node.insert",
      parentId,
      node: {
        id: ids("node"),
        order,
        name: placement.name,
        transform: {
          position: [...placement.position],
          rotation: [...placement.rotation],
          scale: [1, 1, 1],
        },
        components: [
          {
            id: ids("component"),
            type: "light",
            props: {
              kind: placement.kind,
              color: placement.color,
              intensity: placement.intensity,
            },
          },
        ],
      },
    });
    order = generateKeyBetween(order, null);
  }
  return operations;
}

/**
 * Puts a look on the scene, replacing whatever rig was there.
 *
 * REPLACES rather than adds. Adding is what a naive implementation does and it
 * is why a scene ends up with nine lights and a designer wondering why
 * everything is blown out — pressing four looks in a row must leave the fourth
 * one's lighting, not all four.
 *
 * The shadow switch travels with the look, because the two are one aesthetic
 * decision: Dramatic without shadows is not dramatic, and Soft with them is
 * not soft. It remains separately adjustable afterwards.
 */
export function applyLook(
  document: SceneDocument,
  look: Look,
  ids: IdFactory,
): Transaction | null {
  const operations: SceneOperation[] = [];

  // Removals first, and computed against the document as it stands, because
  // every removal names the node it took for its own inverse.
  for (const light of lightsOf(document)) {
    const node = findNode(document.root, light.nodeId);
    const parentId = parentIdOf(document.root, light.nodeId);
    if (node === null || parentId === null) continue;
    operations.push({
      type: "node.remove",
      nodeId: light.nodeId,
      previousParentId: parentId,
      previousNode: node,
    });
  }

  operations.push(...lightNodeOperations(document, document.root.id, look, ids));
  operations.push(environmentOperation(document, { shadows: look.shadows }));

  return operations.length === 0 ? null : transaction(`Lighting: ${look.label}`, operations);
}

export function setExposure(document: SceneDocument, exposure: number): Transaction {
  // Clamped rather than validated. A field somebody typed "0" into must not
  // turn the picture black with no way back except undo, and a negative
  // exposure has no meaning at all. A non-number — an emptied field — leaves
  // the picture alone rather than blanking it.
  const clamped = Number.isFinite(exposure)
    ? Math.min(4, Math.max(0.05, exposure))
    : exposureOf(document);
  return transaction("Exposure", [environmentOperation(document, { exposure: clamped })]);
}

export function setShadows(document: SceneDocument, on: boolean): Transaction {
  return transaction(on ? "Shadows on" : "Shadows off", [
    environmentOperation(document, { shadows: on }),
  ]);
}

/**
 * One operation that writes the WHOLE environment block.
 *
 * ==========================================================================
 * WHY NOT A PATH INTO IT
 * ==========================================================================
 * `world.environment.exposure` is the obvious path and it throws on every
 * document that has never had an environment — which is every flat graphic
 * ever saved, and was the first thing the tests found. There is nothing at
 * `world.environment` to traverse into.
 *
 * Writing the object whole also keeps `ambient`, `iblAssetId` and `background`
 * intact, and inverts cleanly: the previous value is the previous block,
 * including its absence.
 */
function environmentOperation(
  document: SceneDocument,
  patch: { readonly exposure?: number; readonly shadows?: boolean },
): SceneOperation {
  return makeSetDocProp(document, "world.environment", {
    ...(document.world?.environment ?? {}),
    ...patch,
  });
}

// ---------------------------------------------------------------------------

function findNode(node: SceneNode, id: string): SceneNode | null {
  if (node.id === id) return node;
  for (const child of childrenOf(node)) {
    const found = findNode(child, id);
    if (found !== null) return found;
  }
  return null;
}

function parentIdOf(node: SceneNode, id: string): string | null {
  for (const child of childrenOf(node)) {
    if (child.id === id) return node.id;
    const found = parentIdOf(child, id);
    if (found !== null) return found;
  }
  return null;
}
