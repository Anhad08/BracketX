import { describe, expect, it } from "vitest";
import { canonicalize, validateDocument } from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import "./scenes";
import { listScenes, type ShowcaseScene } from "./registry";
import { ShowcaseSession } from "./engine/session";

/**
 * Every registered scene, verified.
 *
 * This suite grows automatically: a scene added to the registry is covered here
 * without touching this file. That is the whole point of the registry — a
 * showcase that needs a matching test edit is one that ships untested.
 *
 * Headless, against MockMirrorBackend. What these prove is that every scene is
 * a valid, deterministic, leak-free document that the engine can drive. Whether
 * it LOOKS right is what the browser is for.
 */

const scenes = listScenes();

function run(scene: ShowcaseScene): {
  session: ShowcaseSession;
  backend: MockMirrorBackend;
} {
  const backend = new MockMirrorBackend();
  const session = new ShowcaseSession(scene, backend);
  session.load();
  return { session, backend };
}

describe("the registry is populated", () => {
  it("registers every shipped capability", () => {
    expect(scenes.map((scene) => scene.id).sort()).toEqual([
      "animation",
      "collections",
      "layout",
      "leaderboard",
      "lower-third",
      "outputs",
      "primitive-rendering",
      "scoreboard",
      "states",
      "stress",
      "templates",
      "tournament-bracket",
      "variables",
    ]);
  });

  it("names a distinct capability for each", () => {
    // Two scenes claiming the same capability means one of them is not
    // verifying what it says it verifies.
    const capabilities = scenes.map((scene) => scene.capability);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });
});

describe.each(scenes.map((scene) => [scene.id, scene] as const))(
  "%s",
  (id, scene) => {
    it("builds a valid document", () => {
      const result = validateDocument(scene.build());
      expect(result.errors, `${id} validation`).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("builds deterministically", () => {
      // Called on every load, so a scene that differs between builds would
      // make screenshots and replay meaningless.
      expect(canonicalize(scene.build())).toBe(canonicalize(scene.build()));
    });

    it("loads, renders, and draws", () => {
      const { session } = run(scene);
      const result = session.step(0);

      expect(result.drawn, `${id} drew nothing`).toBe(true);
      expect(result.missed, `${id} missed an output`).toEqual([]);
      session.dispose();
    });

    it("has a camera and more than the root", () => {
      const { session, backend } = run(scene);
      expect(backend.snapshot().nodes.length).toBeGreaterThan(2);
      expect(session.diagnostics().outputs).toHaveLength(1);
      session.dispose();
    });

    it("accepts its opening commands", () => {
      const { session } = run(scene);
      expect(session.host.log.rejected, `${id} rejected a command on load`).toBe(0);
      session.dispose();
    });

    it("keeps the mirror consistent with the document", () => {
      const { session } = run(scene);
      for (let i = 1; i <= 10; i += 1) session.step((i * 1000) / 60);

      // Verification compares the mirror to the DOCUMENT. While a clip runs,
      // the mirror is a projection of the document PLUS runtime animation, so
      // a transform track legitimately makes them differ — the verifier is not
      // wrong, the question is. Clips are stopped first so the claim it does
      // make is the one being tested.
      for (const clip of session.host.animator.clips) {
        session.send({ type: "clip.stop", clipId: clip.id });
      }
      session.step();

      expect(session.host.reconciler.verify().issues, id).toEqual([]);
      session.dispose();
    });

    it("survives 120 frames without drift or error", () => {
      const { session } = run(scene);
      for (let i = 1; i <= 120; i += 1) session.step((i * 1000) / 60);

      expect(session.host.log.rejected).toBe(0);
      expect(session.diagnostics().outputs[0]!.missed).toBe(0);
      session.dispose();
    });

    it("frees everything on dispose", () => {
      const { session, backend } = run(scene);
      session.step(0);
      session.dispose();

      expect(backend.snapshot().nodes, `${id} leaked nodes`).toEqual([]);
      expect(backend.snapshot().resourceCounts.materials, `${id} leaked materials`).toBe(0);
      expect(backend.snapshot().resourceCounts.geometries, `${id} leaked geometry`).toBe(0);
    });

    it("reaches the same session by seeking as by playing", () => {
      // The screenshot guarantee, asserted per scene rather than once.
      const played = run(scene);
      for (let i = 1; i <= 45; i += 1) played.session.step((i * 1000) / 60);
      played.session.seekTo(45);

      const sought = run(scene);
      sought.session.seekTo(45);

      expect(sought.session.host.sessionHash(), id).toBe(
        played.session.host.sessionHash(),
      );

      played.session.dispose();
      sought.session.dispose();
    });

    it("only uses component types the engine already had", () => {
      // The architectural claim, asserted for every scene: these are
      // compositions, not features. No scene may introduce a component type.
      const document = scene.build();
      const types = new Set<string>();
      const walk = (node: { components?: readonly { type: string }[]; children?: readonly unknown[] }) => {
        for (const component of node.components ?? []) types.add(component.type);
        for (const child of node.children ?? []) walk(child as never);
      };
      walk(document.root as never);

      for (const type of types) {
        expect(["rect", "camera"], `${id} introduced "${type}"`).toContain(type);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Scenes that make a specific claim
// ---------------------------------------------------------------------------

describe("collections preserve identity", () => {
  it("reorders without creating or destroying anything", () => {
    const scene = listScenes().find((entry) => entry.id === "leaderboard")!;
    const { session } = run(scene);

    const standings = session.host.runtime.state.variables.get("standings") as {
      id: string;
    }[];

    session.send({
      type: "collection.reorder",
      key: "standings",
      ids: [...standings].reverse().map((row) => row.id),
      keyField: "id",
    });

    expect(session.host.lastReport!.nodesCreated).toBe(0);
    expect(session.host.lastReport!.nodesDestroyed).toBe(0);
    session.dispose();
  });
});

describe("outputs render independently", () => {
  it("drives several surfaces from one scene at different cadences", () => {
    const scene = listScenes().find((entry) => entry.id === "outputs")!;
    const { session } = run(scene);

    session.send({
      type: "output.bind",
      output: { id: "preview", width: 960, height: 540, cadence: 2 },
    });
    session.send({
      type: "output.bind",
      output: { id: "thumb", width: 320, height: 180, cadence: 4 },
    });

    for (let i = 1; i <= 12; i += 1) session.step((i * 1000) / 60);

    const outputs = session.diagnostics().outputs;
    const preview = outputs.find((output) => output.id === "preview")!;
    const thumb = outputs.find((output) => output.id === "thumb")!;

    // A quarter-rate output must draw fewer frames than a half-rate one, and
    // both fewer than the default. Cadence that does nothing is worse than none.
    expect(thumb.rendered).toBeLessThan(preview.rendered);
    expect(preview.rendered).toBeLessThan(outputs[0]!.rendered);
    expect(thumb.missed).toBe(0);

    session.dispose();
  });
});

describe("states carry no engine meaning", () => {
  it("applies names the engine has never heard of", () => {
    const scene = listScenes().find((entry) => entry.id === "states")!;
    const { session, backend } = run(scene);

    const before = JSON.stringify(backend.snapshot().nodes);
    session.send({ type: "state.set", states: ["error"] });
    const after = JSON.stringify(backend.snapshot().nodes);

    expect(after).not.toBe(before);
    expect(session.host.activeStates).toEqual(["error"]);

    session.dispose();
  });
});
