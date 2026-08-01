import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
} from "@bracketx/engine-scene";

/**
 * A representative scene for benchmarks.
 *
 * Shared with the test suite so both measure the same thing — a benchmark and a
 * test that disagree about what a "50-row scene" is produce numbers that cannot
 * be compared to assertions.
 */
export function makeBenchScene(id: string, rows = 3): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: `scn_${id}`,
    meta: {
      name: id,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [
      {
        id: "var_rows",
        key: "rows",
        type: "string",
        label: "Rows",
        default: Array.from({ length: rows }, (_, i) => ({
          id: `r${i}`,
          color: "#123456",
        })),
      },
    ],
    assets: [],
    states: [],
    animations: [
      {
        id: "anm_move",
        name: "Move",
        duration: 1,
        tracks: [
          {
            target: "nod_list",
            path: "transform.position.0",
            keyframes: [
              { time: 0, value: -4 },
              { time: 1, value: 0 },
            ],
          },
        ],
      },
    ],
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [
        {
          id: "nod_cam",
          name: "Camera",
          order: "1",
          transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
          components: [
            {
              id: "cmp_cam",
              type: "camera",
              props: {
                projection: "orthographic",
                orthographicSize: 5,
                near: 0.1,
                far: 100,
              },
            },
          ],
        },
        {
          id: "nod_list",
          name: "List",
          order: "V",
          transform: IDENTITY_TRANSFORM,
          size: { width: 6, height: 6 },
          layout: { mode: "vertical", gap: 0.1, align: "stretch" },
          repeat: { source: "rows", as: "row", key: "id", limit: 100 },
          children: [
            {
              id: "nod_row",
              name: "Row",
              order: generateKeyBetween(null, null),
              transform: IDENTITY_TRANSFORM,
              size: { width: 6, height: 0.5 },
              components: [
                {
                  id: "cmp_row",
                  type: "rect",
                  props: { width: 6, height: 0.5, fill: { $var: "row.color" } },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

