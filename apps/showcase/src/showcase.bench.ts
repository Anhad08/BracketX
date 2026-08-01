import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { bench, describe } from "vitest";

import { ShowcaseSession } from "./engine/session";
import { MetricsRecorder } from "./engine/metrics";
import { registerScene, listScenes, resetRegistry, type ShowcaseScene } from "./registry";
import { makeBenchScene } from "./bench-fixture";

/**
 * Showcase benchmarks, Phase 1.
 *
 * The showcase must not be the thing that drops frames. Its overhead competes
 * with the engine for the same 16.67ms, and a diagnostics tool that distorts
 * the measurement is worse than no tool.
 *
 * Run: pnpm --filter showcase bench
 */

function scene(id: string, rows: number): ShowcaseScene {
  return {
    id, title: id, group: "Bench", order: 0,
    summary: "bench", capability: "bench",
    build: () => makeBenchScene(id, rows),
  };
}

describe("startup", () => {
  bench("load a 10-row scene", () => {
    const session = new ShowcaseSession(scene("s", 10), new MockMirrorBackend());
    session.load();
    session.dispose();
  });

  bench("load a 200-row scene", () => {
    const session = new ShowcaseSession(scene("s", 200), new MockMirrorBackend());
    session.load();
    session.dispose();
  });
});

describe("scene switching", () => {
  bench("dispose and load another", () => {
    const a = new ShowcaseSession(scene("a", 50), new MockMirrorBackend());
    a.load();
    a.dispose();
    const b = new ShowcaseSession(scene("b", 50), new MockMirrorBackend());
    b.load();
    b.dispose();
  });
});

describe("overlay overhead", () => {
  const session = new ShowcaseSession(scene("s", 200), new MockMirrorBackend());
  session.load();
  let frame = 0;

  bench("frame only", () => {
    session.step((++frame * 1000) / 60);
  });

  bench("frame plus diagnostics read", () => {
    session.step((++frame * 1000) / 60);
    session.diagnostics();
  });

  bench("diagnostics read alone", () => {
    session.diagnostics();
  });

  bench("metrics snapshot alone", () => {
    session.metrics();
  });
});

describe("metrics recorder", () => {
  const recorder = new MetricsRecorder();
  for (let i = 0; i < 240; i += 1) {
    recorder.record({ total: i % 17, runtime: 1, animation: 1, render: 1 }, null);
  }

  bench("record one frame", () => {
    recorder.record({ total: 2, runtime: 1, animation: 1, render: 1 }, null);
  });

  bench("snapshot a full window", () => {
    recorder.snapshot();
  });
});

describe("screenshot preparation", () => {
  // The engine half of a capture: pause, seek, render. Encoding is the
  // browser's and is not measured here.
  const session = new ShowcaseSession(scene("s", 50), new MockMirrorBackend());
  session.load();
  let target = 0;

  bench("seek to an exact frame and render", () => {
    session.seekTo((target += 30) % 600);
  });
});

describe("registry", () => {
  resetRegistry();
  for (let i = 0; i < 40; i += 1) {
    registerScene(scene(`bench-${i}`, 1));
  }

  bench("list and sort 40 scenes", () => {
    listScenes();
  });
});
