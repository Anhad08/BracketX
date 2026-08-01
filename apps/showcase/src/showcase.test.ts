import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import {
  getScene,
  listGroups,
  listScenes,
  registerScene,
  resetRegistry,
  validateScene,
  type ShowcaseScene,
} from "./registry";
import { ShowcaseSession } from "./engine/session";
import { MetricsRecorder } from "./engine/metrics";
import { screenshotName } from "./engine/screenshot";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type SettingsStorage,
} from "./settings";

/**
 * Showcase verification, Phase 1.
 *
 * All headless, against MockMirrorBackend. That is deliberate and is the reason
 * ShowcaseSession is a plain class rather than a hook: a test that needs a
 * browser to check that a displayed number matches an engine number is a test
 * that will eventually be skipped.
 */

function documentFor(id: string, rows = 3): SceneDocument {
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

function makeScene(id: string, overrides: Partial<ShowcaseScene> = {}): ShowcaseScene {
  return {
    id,
    title: id.toUpperCase(),
    group: "Test",
    order: 0,
    summary: `verifies ${id}`,
    capability: "test",
    build: () => documentFor(id),
    ...overrides,
  };
}

function sessionFor(scene: ShowcaseScene): {
  session: ShowcaseSession;
  backend: MockMirrorBackend;
} {
  const backend = new MockMirrorBackend();
  const session = new ShowcaseSession(scene, backend);
  session.load();
  return { session, backend };
}

beforeEach(() => resetRegistry());
afterEach(() => resetRegistry());

/** In-memory stand-in. Node has no localStorage, which is itself a case the
 *  settings store must survive — see the fallback test below. */
function memoryStore(): SettingsStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("registers and retrieves a scene", () => {
    const scene = registerScene(makeScene("alpha"));
    expect(getScene("alpha")).toBe(scene);
  });

  it("refuses a duplicate id rather than silently winning", () => {
    // Last-write-wins would make two scenes with one id a heisenbug that
    // depends on import order.
    registerScene(makeScene("alpha"));
    expect(() => registerScene(makeScene("alpha"))).toThrow(/already registered/);
  });

  it.each([
    ["Uppercase", { id: "Alpha" }],
    ["spaces", { id: "my scene" }],
    ["empty title", { title: "" }],
    ["empty summary", { summary: "" }],
    ["no capability", { capability: "" }],
  ])("rejects %s", (_name, patch) => {
    expect(validateScene(makeScene("valid", patch))).not.toBeNull();
  });

  it("orders deterministically regardless of registration order", () => {
    // Registration order is import order, which is not stable enough to
    // navigate by.
    registerScene(makeScene("zulu", { group: "B", order: 1 }));
    registerScene(makeScene("alpha", { group: "A", order: 2 }));
    registerScene(makeScene("bravo", { group: "A", order: 1 }));

    expect(listScenes().map((s) => s.id)).toEqual(["bravo", "alpha", "zulu"]);
    expect(listGroups().map((g) => g.name)).toEqual(["A", "B"]);
  });

  it("adding a scene requires only registration", () => {
    // The property that keeps the shell from accumulating switch statements.
    expect(listScenes()).toHaveLength(0);
    registerScene(makeScene("new-capability"));
    expect(listGroups()[0]!.scenes.map((s) => s.id)).toEqual(["new-capability"]);
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe("scene loading", () => {
  it("loads a scene and builds its mirror", () => {
    const { session, backend } = sessionFor(makeScene("alpha"));
    // root + camera + list + 3 instances
    expect(backend.snapshot().nodes).toHaveLength(6);
    session.dispose();
  });

  it("applies the scene's opening commands", () => {
    const { session } = sessionFor(
      makeScene("alpha", {
        onLoad: [{ type: "clip.play", clipId: "anm_move" }],
      }),
    );
    expect(session.host.animator.isPlaying("anm_move")).toBe(true);
    session.dispose();
  });

  it("builds the document on every load, proving it is deterministic", () => {
    // A scene that renders differently on a second load is a bug the showcase
    // should surface, not cache away.
    const scene = makeScene("alpha");
    const a = sessionFor(scene);
    const b = sessionFor(scene);

    expect(JSON.stringify(b.backend.snapshot().nodes)).toBe(
      JSON.stringify(a.backend.snapshot().nodes),
    );
    a.session.dispose();
    b.session.dispose();
  });

  it("binds extra outputs when asked", () => {
    const backend = new MockMirrorBackend();
    const session = new ShowcaseSession(makeScene("alpha"), backend, {
      outputs: [{ id: "preview", width: 640, height: 360, cadence: 2 }],
    });
    session.load();

    expect(session.host.outputs.map((o) => o.id)).toEqual(["default", "preview"]);
    session.dispose();
  });
});

describe("switching scenes does not leak", () => {
  it("frees every mirror node and resource on dispose", () => {
    const backend = new MockMirrorBackend();
    const session = new ShowcaseSession(makeScene("alpha"), backend);
    session.load();
    expect(backend.snapshot().nodes.length).toBeGreaterThan(0);

    session.dispose();
    expect(backend.snapshot().nodes).toEqual([]);
    expect(backend.snapshot().resourceCounts.materials).toBe(0);
    expect(backend.snapshot().resourceCounts.geometries).toBe(0);
  });

  it("leaves nothing behind across twenty switches", () => {
    // A tool that leaks per scene switch is unusable after an afternoon of
    // debugging, and the leak is invisible in a single-scene test.
    for (let i = 0; i < 20; i += 1) {
      const backend = new MockMirrorBackend();
      const session = new ShowcaseSession(makeScene(`scene-${i}`), backend);
      session.load();
      session.step(0);
      session.dispose();

      expect(backend.snapshot().nodes, `switch ${i}`).toEqual([]);
      expect(backend.snapshot().resourceCounts.materials, `switch ${i}`).toBe(0);
    }
  });

  it("ignores commands after dispose rather than throwing", () => {
    const { session } = sessionFor(makeScene("alpha"));
    session.dispose();
    expect(() => session.send({ type: "playback.play" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Diagnostics agree with the engine
// ---------------------------------------------------------------------------

describe("diagnostics match engine state", () => {
  it("reports the engine's own numbers, not its own arithmetic", () => {
    // A panel with its own idea of the node count will eventually disagree with
    // the engine, and the panel is what gets believed.
    const { session } = sessionFor(makeScene("alpha"));
    session.step(0);

    const d = session.diagnostics();
    expect(d.frame).toBe(session.host.runtime.clock.frame);
    expect(d.sessionHash).toBe(session.host.sessionHash());
    expect(d.runtimeHash).toBe(session.host.session().runtimeHash);
    expect(d.nodeCount).toBe([...session.host.reconciler.mirror.nodeIds()].length);
    expect(d.framesRendered).toBe(session.host.framesRendered);
    expect(d.submissions).toBe(session.host.submissions);
    expect(d.commandsAccepted).toBe(session.host.log.accepted);

    session.dispose();
  });

  it("tracks output statistics per output", () => {
    const backend = new MockMirrorBackend();
    const session = new ShowcaseSession(makeScene("alpha"), backend, {
      outputs: [{ id: "preview", width: 640, height: 360, cadence: 2 }],
    });
    session.load();
    for (let i = 1; i <= 6; i += 1) session.step((i * 1000) / 60);

    const preview = session.diagnostics().outputs.find((o) => o.id === "preview")!;
    expect(preview.cadence).toBe(2);
    expect(preview.rendered + preview.skipped).toBe(6);
    expect(preview.missed).toBe(0);

    session.dispose();
  });

  it("counts animated nodes while a clip runs", () => {
    const { session } = sessionFor(
      makeScene("alpha", { onLoad: [{ type: "clip.play", clipId: "anm_move" }] }),
    );
    for (let i = 1; i <= 10; i += 1) session.step((i * 1000) / 60);

    expect(session.diagnostics().animatedNodes).toBe(1);
    expect(session.diagnostics().activeClips).toEqual(["anm_move"]);
    session.dispose();
  });

  it("surfaces a rejected command instead of swallowing it", () => {
    const { session } = sessionFor(makeScene("alpha"));
    session.send({ type: "variable.set", key: "", value: 1 });

    const d = session.diagnostics();
    expect(d.commandsRejected).toBe(1);
    expect(d.recentCommands[0]!.accepted).toBe(false);
    expect(d.recentCommands[0]!.reason).toBeTruthy();

    session.dispose();
  });

  it("takes one coherent snapshot rather than tearing", () => {
    // A panel showing a frame number from one moment beside a node count from
    // another is worse than none, because it is believed.
    const { session } = sessionFor(makeScene("alpha"));
    session.step(0);
    const a = session.diagnostics();
    const b = session.diagnostics();
    expect(b.frame).toBe(a.frame);
    expect(b.sessionHash).toBe(a.sessionHash);
    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe("metrics", () => {
  it("reports nothing before any frame", () => {
    const recorder = new MetricsRecorder();
    const metrics = recorder.snapshot();
    expect(metrics.samples).toBe(0);
    expect(metrics.fps).toBe(0);
  });

  it("computes mean, p95, and max over its window", () => {
    const recorder = new MetricsRecorder();
    for (const total of [1, 2, 3, 4, 100]) {
      recorder.record({ total, runtime: 0, animation: 0, render: 0 }, null);
    }
    const stat = recorder.snapshot().total;
    expect(stat.last).toBe(100);
    expect(stat.max).toBe(100);
    expect(stat.mean).toBeCloseTo(22, 5);
  });

  it("bounds its memory and forgets old samples", () => {
    // A metrics buffer that grows is a leak in a process meant to run for the
    // length of a show.
    const recorder = new MetricsRecorder();
    for (let i = 0; i < 1000; i += 1) {
      recorder.record({ total: 1, runtime: 0, animation: 0, render: 0 }, null);
    }
    expect(recorder.snapshot().samples).toBeLessThanOrEqual(240);
    expect(recorder.snapshot().total.mean).toBeCloseTo(1, 5);
  });

  it("stays synchronized with the session across frames", () => {
    const { session } = sessionFor(makeScene("alpha"));
    for (let i = 1; i <= 30; i += 1) session.step((i * 1000) / 60);

    const metrics = session.metrics();
    expect(metrics.samples).toBe(30);
    expect(metrics.total.mean).toBeGreaterThan(0);
    // Timings must decompose: the parts cannot exceed the whole.
    expect(metrics.runtime.mean + metrics.animation.mean + metrics.render.mean)
      .toBeLessThanOrEqual(metrics.total.mean + 0.001);

    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

describe("screenshot determinism", () => {
  it("reaches an identical session at a frame however it got there", () => {
    // The property a baseline depends on. Bytes are a browser concern; this is
    // the engine-side guarantee underneath them.
    const scene = makeScene("alpha", {
      onLoad: [{ type: "clip.play", clipId: "anm_move" }],
      screenshotFrame: 30,
    });

    const played = sessionFor(scene);
    for (let i = 1; i <= 30; i += 1) played.session.step((i * 1000) / 60);
    played.session.seekTo(30);

    const sought = sessionFor(scene);
    sought.session.seekTo(30);

    expect(sought.session.host.sessionHash()).toBe(
      played.session.host.sessionHash(),
    );
    expect(JSON.stringify(sought.backend.snapshot().nodes)).toBe(
      JSON.stringify(played.backend.snapshot().nodes),
    );

    played.session.dispose();
    sought.session.dispose();
  });

  it("pauses the clock so the frame cannot drift under the capture", () => {
    // A running clock advances between the seek and the read, and "frame 300"
    // becomes 301 on a slow machine.
    const { session } = sessionFor(makeScene("alpha"));
    session.seekTo(120);

    expect(session.host.runtime.clock.frame).toBe(120);
    expect(session.diagnostics().playing).toBe(false);
    expect(session.running).toBe(false);

    session.dispose();
  });

  it("names captures stably, with no timestamp", () => {
    // A name that changes every run cannot be a baseline, and adding the date
    // is the most common way that happens.
    expect(screenshotName("lower-third", 30)).toBe("lower-third@000030.png");
    expect(screenshotName("lower-third", 30)).toBe(screenshotName("lower-third", 30));
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("settings", () => {
  it("falls back to defaults with no storage at all", () => {
    // Node has none, and neither do some private-browsing modes. A developer
    // tool that will not start because it cannot remember a checkbox is worse
    // than one that forgets.
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults on unreadable or corrupt contents", () => {
    const store = memoryStore();
    store.setItem("bracketx.showcase.settings.v1", "{not json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips", () => {
    const store = memoryStore();
    saveSettings(
      { ...DEFAULT_SETTINGS, performanceOverlay: false, lastSceneId: "alpha" },
      store,
    );
    const loaded = loadSettings(store);
    expect(loaded.performanceOverlay).toBe(false);
    expect(loaded.lastSceneId).toBe("alpha");
  });

  it("keeps only known keys", () => {
    // A stale or hostile store must not inject fields into the app.
    const store = memoryStore();
    saveSettings(
      { ...DEFAULT_SETTINGS, injected: "value", autoPlay: "not a boolean" } as never,
      store,
    );

    const loaded = loadSettings(store);
    expect(loaded.autoPlay).toBe(DEFAULT_SETTINGS.autoPlay);
    expect("injected" in loaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The architectural rule
// ---------------------------------------------------------------------------

describe("public API only", () => {
  it("drives the engine entirely through commands", () => {
    // Controls receive `send`, not a host. A control that could reach into the
    // host could bypass the command path, and the showcase exists partly to
    // prove that path is sufficient.
    const { session } = sessionFor(makeScene("alpha"));

    session.send({ type: "collection.insert", key: "rows", at: "end", items: [{ id: "r9", color: "#fff" }] });
    session.send({ type: "playback.play" });
    session.send({ type: "clip.play", clipId: "anm_move" });

    expect(session.host.log.accepted).toBeGreaterThanOrEqual(3);
    expect(session.host.log.rejected).toBe(0);
    // Every one of those is replayable, which is only true because they all
    // went through the log.
    expect(session.host.log.replayable().length).toBeGreaterThanOrEqual(3);

    session.dispose();
  });
});
