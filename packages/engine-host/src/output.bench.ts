import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { bench, describe } from "vitest";

import { SceneHost } from "./host";
import { makeDemoScene } from "./demo-scene";

/**
 * Output benchmarks. Phase 3.
 *
 * The question that matters: what does a second output cost? If binding one is
 * close to free, a preview alongside a programme feed is a product decision.
 * If it doubles frame cost, it is an architectural one.
 *
 * Run: pnpm --filter @bracketx/engine-host bench
 */

function hostWith(outputs: number, cadence = 1): SceneHost {
  const host = new SceneHost(new MockMirrorBackend());
  host.load(makeDemoScene());
  for (let i = 1; i < outputs; i += 1) {
    host.bindOutput({
      id: `out${i}`,
      width: 1920,
      height: 1080,
      cadence,
    });
  }
  host.play();
  return host;
}

describe("frame cost by output count", () => {
  const one = hostWith(1);
  const two = hostWith(2);
  const four = hostWith(4);
  const eight = hostWith(8);

  let t = 0;
  const step = () => (t += 1000 / 60);

  bench("1 output", () => {
    one.renderFrame(step());
  });
  bench("2 outputs", () => {
    two.renderFrame(step());
  });
  bench("4 outputs", () => {
    four.renderFrame(step());
  });
  bench("8 outputs", () => {
    eight.renderFrame(step());
  });
});

describe("cadence saves work", () => {
  // A half-rate preview should cost about half a full-rate one. If it does not,
  // the cadence check is more expensive than the draw it avoids.
  const full = hostWith(4, 1);
  const half = hostWith(4, 2);
  const quarter = hostWith(4, 4);

  let t = 0;
  const step = () => (t += 1000 / 60);

  bench("3 extra outputs at full rate", () => {
    full.renderFrame(step());
  });
  bench("3 extra outputs at half rate", () => {
    half.renderFrame(step());
  });
  bench("3 extra outputs at quarter rate", () => {
    quarter.renderFrame(step());
  });
});

describe("binding", () => {
  const host = hostWith(1);

  bench("bind an output", () => {
    host.bindOutput({ id: "churn", width: 640, height: 360 });
  });

  bench("rebind in place (resize)", () => {
    host.setOutputSize(1280, 720);
  });

  bench("read stats", () => {
    host.outputStats();
  });
});
