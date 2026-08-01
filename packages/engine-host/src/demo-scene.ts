/**
 * A lower third, authored entirely in SCENE_FORMAT v2.
 *
 * This is the Phase 2.6 proof object. Nothing here is a renderer fixture or a
 * test double — it is a real `SceneDocument` that validates, serializes,
 * round-trips, and can be persisted. If the engine draws it, the engine draws
 * its own format.
 *
 * The shape is deliberately a lower third rather than an abstract cube: it
 * exercises hierarchy (a group moving its children), the camera-as-component
 * model, variable bindings driving a visible property, and premultiplied alpha
 * over a transparent background — which is what actually goes on air.
 *
 * Units are metres, Y-up, right-handed (SCENE_FORMAT §5). The orthographic
 * camera is sized so one world unit is convenient to reason about: with
 * `orthographicSize: 5` the visible height is 10 units.
 */
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

const FIXED_TIME = "2026-08-01T00:00:00.000Z";

/** Sequential sibling keys. Appending is what an author actually does. */
function keys(count: number): string[] {
  const out: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < count; i += 1) {
    previous = generateKeyBetween(previous, null);
    out.push(previous);
  }
  return out;
}

export interface DemoSceneOptions {
  /** Output resolution. Defaults to 1080p. */
  readonly width?: number;
  readonly height?: number;
}

export function makeDemoScene(options: DemoSceneOptions = {}): SceneDocument {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  const rootKeys = keys(2);
  const barKeys = keys(3);

  const camera: SceneNode = {
    id: "nod_camera",
    name: "Camera",
    order: rootKeys[0]!,
    transform: {
      // Pulled back along +Z, looking down -Z at the origin — SCENE_FORMAT §5.
      position: [0, 0, 10],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    components: [
      {
        id: "cmp_camera",
        type: "camera",
        props: {
          projection: "orthographic",
          orthographicSize: 5,
          near: 0.1,
          far: 100,
        },
      },
    ],
  };

  /**
   * The group exists to prove hierarchy composes: its children are authored at
   * the origin and the group's transform is what places them on screen. If
   * world matrices were not composing, the bars would render centred.
   */
  const lowerThird: SceneNode = {
    id: "nod_lowerThird",
    name: "Lower Third",
    order: rootKeys[1]!,
    transform: {
      position: [-2.5, -2.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    children: [
      {
        id: "nod_backing",
        name: "Backing Bar",
        order: barKeys[0]!,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        components: [
          {
            id: "cmp_backing",
            type: "rect",
            props: { width: 6, height: 1.4, fill: "#0B1F3A" },
          },
        ],
      },
      {
        id: "nod_accent",
        name: "Accent",
        order: barKeys[1]!,
        transform: {
          // Left edge of the backing bar, slightly forward so depth sorting
          // is exercised rather than assumed.
          position: [-2.85, 0, 0.01],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        components: [
          {
            id: "cmp_accent",
            type: "rect",
            // Bound to a variable so the live path has something visible to
            // drive: setVariable("accentColor", …) must repaint exactly this.
            props: { width: 0.3, height: 1.4, fill: { $var: "accentColor" } },
          },
        ],
      },
      {
        id: "nod_namePlate",
        name: "Name Plate",
        order: barKeys[2]!,
        transform: {
          position: [0, -0.9, 0.01],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        components: [
          {
            id: "cmp_namePlate",
            type: "rect",
            props: { width: 6, height: 0.35, fill: "#E8B23A" },
          },
        ],
      },
    ],
  };

  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_demoLowerThird",
    meta: {
      name: "Demo Lower Third",
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width, height, fps: 60 },
    },
    variables: [
      {
        id: "var_accent",
        key: "accentColor",
        type: "color",
        label: "Accent Colour",
        default: "#E8B23A",
      },
    ],
    assets: [],
    states: [],
    root: {
      ...IDENTITY_TRANSFORM_NODE,
      children: [camera, lowerThird],
    },
  };
}

const IDENTITY_TRANSFORM_NODE: SceneNode = {
  id: "nod_root",
  name: "Root",
  order: generateKeyBetween(null, null),
  transform: IDENTITY_TRANSFORM,
};
