/**
 * Camera memory — the workspace half.
 *
 * `studio-specification.html` §03: "Camera memory — Per graphic, restored on
 * open, including zoom step and centre."
 *
 * ZOOM AND CENTRE. Not orbit, not orientation, not projection. Turning the
 * camera in 3D writes `transform.position` and `transform.rotation` onto the
 * camera NODE, which is content and already persists with the scene;
 * remembering it here as well would make two sources of truth for where the
 * camera points, one of which goes to air.
 *
 * These tests are about the STORE: that it survives a round trip, that a
 * corrupt one cannot break the editor, and that nothing a renderer knows about
 * can get into it.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE,
  WORKSPACE_KEY,
  loadWorkspace,
  saveWorkspace,
  type Workspace,
} from "./studio/workspace";

/** A store that behaves like `localStorage` without being it. */
function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
    raw: values,
  };
}

const withCameras = (cameras: Workspace["cameras"]): Workspace => ({
  ...DEFAULT_WORKSPACE,
  cameras,
});

describe("what a remembered camera is", () => {
  it("starts empty — a graphic never opened has nothing to restore", () => {
    expect(DEFAULT_WORKSPACE.cameras).toEqual({});
  });

  it("survives a save and a load, exactly", () => {
    const store = memoryStore();
    saveWorkspace(
      withCameras({ doc_a: { zoom: 4, panX: -120.5, panY: 33 } }),
      store,
    );

    const loaded = loadWorkspace(store);
    // Exact. A zoom that came back as 3.9999 would not be on the ladder, and
    // §03's whole point about steps is that you always know what scale you are
    // at.
    expect(loaded.cameras.doc_a).toEqual({ zoom: 4, panX: -120.5, panY: 33 });
  });

  it("keeps graphics apart", () => {
    const store = memoryStore();
    saveWorkspace(
      withCameras({
        doc_a: { zoom: 4, panX: 10, panY: 20 },
        doc_b: { zoom: 0.5, panX: -30, panY: -40 },
      }),
      store,
    );

    const loaded = loadWorkspace(store);
    expect(loaded.cameras.doc_a).toEqual({ zoom: 4, panX: 10, panY: 20 });
    expect(loaded.cameras.doc_b).toEqual({ zoom: 0.5, panX: -30, panY: -40 });
  });

  /**
   * THE THING THAT MUST NEVER HAPPEN.
   *
   * A NaN zoom makes the picture vanish, and the only way out would be
   * clearing storage — the exact failure this file's sanitiser exists for.
   */
  it("drops a corrupt entry rather than restoring it", () => {
    const store = memoryStore();
    store.setItem(
      WORKSPACE_KEY,
      JSON.stringify({
        ...DEFAULT_WORKSPACE,
        cameras: {
          good: { zoom: 2, panX: 1, panY: 2 },
          nan: { zoom: Number.NaN, panX: 0, panY: 0 },
          zero: { zoom: 0, panX: 0, panY: 0 },
          missing: { zoom: 1 },
          notAnObject: 7,
          nulled: null,
        },
      }),
    );

    const loaded = loadWorkspace(store);
    // Only the sound one survives. A half-remembered camera is not worth
    // restoring, so it is dropped rather than repaired.
    expect(Object.keys(loaded.cameras)).toEqual(["good"]);
  });

  it("survives a store with no cameras at all — an older workspace", () => {
    const store = memoryStore();
    const { cameras: _dropped, ...older } = DEFAULT_WORKSPACE;
    store.setItem(WORKSPACE_KEY, JSON.stringify(older));
    expect(loadWorkspace(store).cameras).toEqual({});
  });

  it("stores nothing a renderer has ever heard of", () => {
    const store = memoryStore();
    saveWorkspace(withCameras({ doc_a: { zoom: 2, panX: 5, panY: 6 } }), store);

    const written = JSON.parse(store.raw.get(WORKSPACE_KEY)!) as {
      cameras: Record<string, Record<string, unknown>>;
    };
    // THREE NUMBERS. Not a camera object, not a matrix, not a handle — the
    // persisted view has to be reconstructable by any backend, and the way to
    // guarantee that is for it to contain nothing a backend could have made.
    expect(Object.keys(written.cameras.doc_a!).sort()).toEqual(["panX", "panY", "zoom"]);
    for (const value of Object.values(written.cameras.doc_a!)) {
      expect(typeof value).toBe("number");
    }
  });

  it("does not carry orbit, orientation or a camera transform", () => {
    const store = memoryStore();
    saveWorkspace(withCameras({ doc_a: { zoom: 1, panX: 0, panY: 0 } }), store);
    const written = store.raw.get(WORKSPACE_KEY)!;

    // Orbit belongs to the camera NODE and persists with the document. A copy
    // here would be a second source of truth for where the camera points.
    for (const forbidden of ["rotation", "orbit", "azimuth", "elevation", "matrix", "fov"]) {
      expect(written.includes(forbidden), `the workspace is storing ${forbidden}`).toBe(false);
    }
  });
});
