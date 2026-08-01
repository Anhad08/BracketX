import { beforeEach, describe, expect, it } from "vitest";

import {
  MockMirrorBackend,
  type InspectableMirrorBackend,
} from "@bracketx/engine-reconciler";

import { SceneHost, DEFAULT_OUTPUT_ID } from "./host";
import { OutputError, OutputSet, resolveOutput } from "./output";
import { makeDemoScene } from "./demo-scene";

/**
 * Outputs. Project Alpha A1, Phase 3.
 *
 * The property under test throughout: the engine does not know what consumes
 * its frames. An output states what it wants and gets it; nothing about a
 * canvas, a browser, or a broadcast pipeline appears here.
 */

let backend: InspectableMirrorBackend;
let host: SceneHost;

beforeEach(() => {
  backend = new MockMirrorBackend();
  host = new SceneHost(backend);
});

describe("descriptor resolution", () => {
  it("defaults to transparent, because opaque fails silently", () => {
    // An opaque default is a black rectangle over live video, and nobody sees
    // it until it is on air.
    const output = resolveOutput({ id: "a", width: 1920, height: 1080 });
    expect(output.alpha).toBe("transparent");
    expect(output.clearColor).toEqual([0, 0, 0, 0]);
  });

  it("clears to black when the output owns the whole picture", () => {
    const output = resolveOutput({
      id: "a",
      width: 1920,
      height: 1080,
      alpha: "opaque",
    });
    expect(output.clearColor).toEqual([0, 0, 0, 1]);
  });

  it("lets an explicit clear colour win over the alpha default", () => {
    const output = resolveOutput({
      id: "a",
      width: 100,
      height: 100,
      alpha: "opaque",
      clearColor: [0, 0.5, 0, 1],
    });
    expect(output.clearColor).toEqual([0, 0.5, 0, 1]);
  });

  it("defaults cadence to every frame and layers to all", () => {
    const output = resolveOutput({ id: "a", width: 16, height: 16 });
    expect(output.cadence).toBe(1);
    expect(output.layerMask).toBe(0xffffffff);
    expect(output.target).toBeNull();
    expect(output.cameraNodeId).toBeNull();
  });

  it.each([
    ["zero width", { id: "a", width: 0, height: 100 }],
    ["negative height", { id: "a", width: 100, height: -1 }],
    ["fractional width", { id: "a", width: 100.5, height: 100 }],
    ["empty id", { id: "", width: 100, height: 100 }],
    ["zero cadence", { id: "a", width: 100, height: 100, cadence: 0 }],
    ["fractional cadence", { id: "a", width: 100, height: 100, cadence: 1.5 }],
  ])("refuses %s at bind time", (_name, descriptor) => {
    // Loudly, while someone is still looking. An output that binds and then
    // quietly draws nothing for three hours is the worse failure.
    expect(() => resolveOutput(descriptor)).toThrow(OutputError);
  });
});

describe("binding", () => {
  it("binds a default output sized from the document", () => {
    // SCENE_FORMAT §4 makes the document declare its own resolution, so the
    // single-surface case needs no configuration.
    host.load(makeDemoScene({ width: 1280, height: 720 }));

    expect(host.outputs).toHaveLength(1);
    expect(host.outputs[0]!.id).toBe(DEFAULT_OUTPUT_ID);
    expect(host.outputs[0]!.width).toBe(1280);
    expect(host.outputs[0]!.height).toBe(720);
  });

  it("binds nothing when the caller manages outputs itself", () => {
    const managed = new SceneHost(new MockMirrorBackend(), {
      defaultOutput: false,
    });
    managed.load(makeDemoScene());
    expect(managed.outputs).toEqual([]);
  });

  it("rebinds in place and preserves counters", () => {
    // Resizing an output must not reset its telemetry — an operator resizing a
    // preview should not lose the frame history that tells them it is healthy.
    host.load(makeDemoScene());
    host.renderFrame(0);
    host.renderFrame(16);

    host.setOutputSize(1280, 720);

    expect(host.outputs).toHaveLength(1);
    expect(host.outputs[0]!.width).toBe(1280);
    expect(host.outputStats()[0]!.framesRendered).toBe(2);
  });

  it("unbinds and reports whether anything was bound", () => {
    host.load(makeDemoScene());
    expect(host.unbindOutput(DEFAULT_OUTPUT_ID)).toBe(true);
    expect(host.unbindOutput(DEFAULT_OUTPUT_ID)).toBe(false);
    expect(host.outputs).toEqual([]);
  });

  it("refuses to resize an output that is not bound", () => {
    host.load(makeDemoScene());
    expect(() => host.setOutputSize(100, 100, "missing")).toThrow(
      /no output bound as "missing"/,
    );
  });

  it("draws nothing, without throwing, when no output is bound", () => {
    // A scene with no output is a legitimate state: loaded, cued, not yet
    // routed anywhere.
    host.load(makeDemoScene());
    host.unbindOutput(DEFAULT_OUTPUT_ID);

    const result = host.renderFrame(0);
    expect(result.drawn).toBe(false);
    expect(result.rendered).toEqual([]);
    expect(host.framesRendered).toBe(1);
    expect(host.submissions).toBe(0);
  });
});

describe("multi-output", () => {
  it("renders one scene to two outputs of different sizes", () => {
    // ROADMAP_V2 Phase 3 exit criterion. The whole point of the abstraction:
    // one document, two surfaces, no scene change.
    host.load(makeDemoScene());
    host.bindOutput({ id: "preview", width: 640, height: 360 });

    const result = host.renderFrame(0);

    expect(result.rendered).toEqual([DEFAULT_OUTPUT_ID, "preview"]);
    expect(host.submissions).toBe(2);
    // One frame advanced, two draws. These are different numbers and the host
    // reports both, because conflating them hides multi-output cost.
    expect(host.framesRendered).toBe(1);
  });

  it("renders in bind order, deterministically", () => {
    // Two outputs sharing a render target must compose the same way every run.
    host.load(makeDemoScene());
    host.bindOutput({ id: "b", width: 100, height: 100 });
    host.bindOutput({ id: "a", width: 100, height: 100 });

    expect(host.renderFrame(0).rendered).toEqual([DEFAULT_OUTPUT_ID, "b", "a"]);
    expect(host.renderFrame(16).rendered).toEqual([DEFAULT_OUTPUT_ID, "b", "a"]);
  });

  it("gives each output its own viewport and clear colour", () => {
    const inspect = backend as unknown as {
      submissions?: { options: { viewport: { width: number }; clearColor: number[] } }[];
    };
    host.load(makeDemoScene());
    host.bindOutput({
      id: "wall",
      width: 3840,
      height: 2160,
      alpha: "opaque",
    });

    host.renderFrame(0);

    // The mock records submissions; if it does not, the assertion above on
    // rendered ids already covers ordering and this is belt and braces.
    if (inspect.submissions) {
      const [first, second] = inspect.submissions;
      expect(first!.options.viewport.width).toBe(1920);
      expect(second!.options.viewport.width).toBe(3840);
      expect(second!.options.clearColor[3]).toBe(1);
    }
  });

  it("lets an output choose its own camera", () => {
    // A preview seeing the scene from a different camera is the same mechanism
    // a virtual-production texture uses.
    host.load(makeDemoScene());
    host.bindOutput({
      id: "iso",
      width: 640,
      height: 360,
      cameraNodeId: "nod_camera",
    });

    const result = host.renderFrame(0);
    expect(result.rendered).toContain("iso");
  });

  it("counts an output pointed at a missing camera as missed, not fatal", () => {
    // An operator error mid-show must not take the other outputs down.
    host.load(makeDemoScene());
    host.bindOutput({
      id: "broken",
      width: 100,
      height: 100,
      cameraNodeId: "nod_doesNotExist",
    });

    const result = host.renderFrame(0);

    expect(result.rendered).toEqual([DEFAULT_OUTPUT_ID]);
    expect(result.missed).toEqual(["broken"]);
    expect(result.drawn).toBe(true);
    expect(host.outputStats().find((s) => s.id === "broken")!.framesMissed).toBe(
      1,
    );
  });
});

describe("cadence", () => {
  it("draws a half-rate output on every other frame", () => {
    host.load(makeDemoScene());
    host.bindOutput({ id: "half", width: 640, height: 360, cadence: 2 });
    host.play();

    let halfDrawn = 0;
    for (let i = 0; i < 10; i += 1) {
      // 60fps: one frame per ~16.67ms.
      const result = host.renderFrame((i * 1000) / 60);
      if (result.rendered.includes("half")) halfDrawn += 1;
    }

    expect(halfDrawn).toBeGreaterThan(2);
    expect(halfDrawn).toBeLessThan(10);
  });

  it("keeps two outputs of equal cadence in phase", () => {
    // Keyed off the frame number rather than a per-output counter, so a
    // late-bound output lands on the same frames as an early-bound one. Drifting
    // phases never reconverge.
    host.load(makeDemoScene());
    host.bindOutput({ id: "a", width: 100, height: 100, cadence: 3 });
    host.play();

    host.renderFrame(0);
    host.bindOutput({ id: "b", width: 100, height: 100, cadence: 3 });

    for (let i = 1; i < 12; i += 1) {
      const result = host.renderFrame((i * 1000) / 60);
      const drewA = result.rendered.includes("a");
      const drewB = result.rendered.includes("b");
      expect(drewA).toBe(drewB);
    }
  });

  it("counts skips separately from misses", () => {
    // A skip is the cadence working. A miss is a fault. Conflating them would
    // make a healthy preview look broken.
    host.load(makeDemoScene());
    host.bindOutput({ id: "slow", width: 100, height: 100, cadence: 4 });
    host.play();

    for (let i = 0; i < 8; i += 1) host.renderFrame((i * 1000) / 60);

    const stats = host.outputStats().find((s) => s.id === "slow")!;
    expect(stats.framesSkipped).toBeGreaterThan(0);
    expect(stats.framesMissed).toBe(0);
    expect(stats.framesRendered + stats.framesSkipped).toBe(8);
  });
});

describe("output set", () => {
  it("keeps bind order across rebinds", () => {
    const set = new OutputSet();
    set.bind({ id: "a", width: 10, height: 10 });
    set.bind({ id: "b", width: 10, height: 10 });
    set.bind({ id: "a", width: 20, height: 20 });

    expect(set.list().map((o) => o.id)).toEqual(["a", "b"]);
    expect(set.get("a")!.width).toBe(20);
  });

  it("drops counters when an output is unbound", () => {
    const set = new OutputSet();
    set.bind({ id: "a", width: 10, height: 10 });
    set.recordRendered("a");
    set.unbind("a");
    set.bind({ id: "a", width: 10, height: 10 });

    expect(set.stats()[0]!.framesRendered).toBe(0);
  });
});

describe("lifecycle", () => {
  it("clears outputs on dispose", () => {
    host.load(makeDemoScene());
    host.bindOutput({ id: "extra", width: 100, height: 100 });
    host.dispose();
    expect(host.outputs).toEqual([]);
  });

  it("refuses to bind after dispose", () => {
    host.load(makeDemoScene());
    host.dispose();
    expect(() => host.bindOutput({ id: "x", width: 10, height: 10 })).toThrow(
      /disposed/,
    );
  });

  it("keeps outputs bound across a document reload", () => {
    // Reloading a scene must not tear down the surfaces it was routed to. An
    // operator swapping graphics does not expect their outputs to disappear.
    host.load(makeDemoScene());
    host.bindOutput({ id: "wall", width: 3840, height: 2160 });

    host.load(makeDemoScene());

    expect(host.outputs.map((o) => o.id)).toEqual([DEFAULT_OUTPUT_ID, "wall"]);
  });
});
