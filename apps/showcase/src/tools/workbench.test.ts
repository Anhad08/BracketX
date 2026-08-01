import { beforeEach, describe, expect, it } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import "../scenes";
import { getScene } from "../registry";
import { ShowcaseSession } from "../engine/session";
import {
  commandSources,
  commandTarget,
  debugBoxes,
  filterCommands,
  filterTree,
  frameForClipTime,
  inspectorTree,
  nodeDetail,
  outputRows,
  timeline,
} from "./model";
import {
  SessionRecorder,
  parseRecording,
  replayRecording,
  serializeRecording,
} from "./recorder";

/**
 * Workbench verification.
 *
 * Headless, like everything else that matters. Each tool's DATA is tested here;
 * the browser suite checks only that the panels stay synchronized on screen,
 * which is the one thing a DOM is actually required for.
 */

function make(sceneId: string): ShowcaseSession {
  const scene = getScene(sceneId)!;
  const session = new ShowcaseSession(scene, new MockMirrorBackend(), {
    replayBackend: () => new MockMirrorBackend(),
  });
  session.load();
  return session;
}

let session: ShowcaseSession;

beforeEach(() => {
  session = make("leaderboard");
});

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

describe("scene inspector", () => {
  it("reads the MIRROR, so collection instances appear", () => {
    // The document says what was authored; the mirror says what exists. An
    // inspector reading the document would be missing exactly the nodes that
    // are hardest to reason about.
    const tree = inspectorTree(session);
    const instances = tree.filter((node) => node.instance);

    expect(tree.length).toBeGreaterThan(instances.length);
    expect(instances.length).toBeGreaterThan(0);
  });

  it("matches the engine's own hierarchy exactly", () => {
    const tree = inspectorTree(session);
    for (const node of tree) {
      const mirror = session.host.reconciler.mirror.get(node.id)!;
      expect(node.parentId, node.id).toBe(mirror.parentId);
      expect(node.childIds, node.id).toEqual(mirror.childIds);
      expect(node.effectiveVisible, node.id).toBe(mirror.effectiveVisible);
    }
  });

  it("reports depth as real nesting", () => {
    const tree = inspectorTree(session);
    expect(tree[0]!.depth).toBe(0);
    expect(Math.max(...tree.map((node) => node.depth))).toBeGreaterThan(1);
  });

  it("keeps ancestors of a filtered match", () => {
    // A filtered tree that drops the parents of its matches is a list, and a
    // list loses the one thing a tree view is for.
    const tree = inspectorTree(session);
    const filtered = filterTree(tree, "entry");

    expect(filtered.length).toBeGreaterThan(0);
    for (const node of filtered) {
      if (node.parentId === null) continue;
      expect(
        filtered.some((other) => other.id === node.parentId),
        node.id,
      ).toBe(true);
    }
  });

  it("returns everything for an empty filter", () => {
    const tree = inspectorTree(session);
    expect(filterTree(tree, "")).toHaveLength(tree.length);
  });

  it("details a node from engine sources only", () => {
    const target = inspectorTree(session).find((node) => node.instance)!;
    const detail = nodeDetail(session, target.id)!;
    const mirror = session.host.reconciler.mirror.get(target.id)!;

    expect(detail.parentId).toBe(mirror.parentId);
    expect(detail.worldMatrix).toEqual(mirror.worldMatrix);
    expect(detail.worldPosition[0]).toBe(mirror.worldMatrix[12]);
  });

  it("lists the variables a node reads, with their live values", () => {
    const tree = inspectorTree(session);
    const withDeps = tree
      .map((node) => nodeDetail(session, node.id)!)
      .find((detail) => detail.dependencies.length > 0);

    expect(withDeps).toBeDefined();
    for (const key of withDeps!.dependencies) {
      // The engine's own reverse index. Recomputing it here would be a second
      // answer to a question the engine already answers.
      expect(
        session.host.reconciler.projector.dependencies
          .dependenciesOf(withDeps!.id)
          .has(key),
      ).toBe(true);
    }
  });

  it("returns null for a node that does not exist", () => {
    expect(nodeDetail(session, "nod_nothing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Command console
// ---------------------------------------------------------------------------

describe("command console", () => {
  it("shows commands exactly as the runtime processed them", () => {
    session.send({ type: "variable.set", key: "standings", value: [] });
    const record = session.host.log.entries().at(-1)!;

    expect(record.source).toBe("operator");
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.frame).toBe(session.host.runtime.clock.frame);
  });

  it("distinguishes sources, including replay", () => {
    session.send({ type: "playback.pause" });
    session.host.applyLive({ type: "playback.play" }, "automation");
    session.host.replay([{ type: "playback.pause" }]);

    const sources = commandSources(session.host.log.entries());
    expect(sources).toContain("operator");
    expect(sources).toContain("automation");
    expect(sources).toContain("replay");
    // Scene-issued load commands are tagged too, so nothing reads as unknown.
    expect(sources).not.toContain("unknown");
  });

  it("derives a target for every command shape", () => {
    const cases: [Parameters<typeof session.send>[0], string][] = [
      [{ type: "variable.set", key: "score", value: 1 }, "score"],
      [{ type: "clip.stop", clipId: "anm_x" }, "anm_x"],
      [{ type: "output.unbind", id: "preview" }, "preview"],
      [{ type: "state.add", state: "live" }, "live"],
      [{ type: "playback.seek", frame: 12 }, "f12"],
    ];

    for (const [command, expected] of cases) {
      session.send(command);
      expect(commandTarget(session.host.log.entries().at(-1)!), command.type).toBe(
        expected,
      );
    }
  });

  it("filters by text, source, and acceptance", () => {
    session.send({ type: "variable.set", key: "", value: 1 });
    const records = session.host.log.entries();

    expect(
      filterCommands(records, { text: "", acceptedOnly: true, source: null }).every(
        (record) => record.accepted,
      ),
    ).toBe(true);

    expect(
      filterCommands(records, {
        text: "playback",
        acceptedOnly: false,
        source: null,
      }).every((record) => record.command.type.includes("playback")),
    ).toBe(true);

    expect(
      filterCommands(records, {
        text: "",
        acceptedOnly: false,
        source: "operator",
      }).every((record) => record.source === "operator"),
    ).toBe(true);
  });

  it("times a command, so a slow one is identifiable", () => {
    // Without this, a 12ms collection rebuild and a 12ms render are
    // indistinguishable in a log.
    const big = make("stress");
    big.send({
      type: "collection.replace",
      key: "items",
      items: Array.from({ length: 2000 }, (_, i) => ({
        id: `r${i}`,
        color: "#123456",
      })),
    });

    expect(big.host.log.entries().at(-1)!.durationMs).toBeGreaterThan(0);
    big.dispose();
  });
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

describe("timeline", () => {
  it("visualizes clips without owning playback", () => {
    const animation = make("animation");
    animation.send({ type: "playback.play" });
    animation.send({ type: "clip.play", clipId: "anm_sweep" });
    for (let i = 1; i <= 30; i += 1) animation.step((i * 1000) / 60);

    const [clip] = timeline(animation);
    expect(clip!.id).toBe("anm_sweep");
    expect(clip!.tracks.length).toBeGreaterThan(0);
    expect(clip!.events.map((event) => event.name)).toContain("midpoint");

    // The playhead comes from the ENGINE. A timeline computing its own would
    // be a second, wrong clock.
    expect(clip!.state).toBeDefined();
    expect(clip!.state!.playing).toBe(true);
    expect(clip!.state!.seconds).toBe(
      animation.host.animator.clipState("anm_sweep")!.seconds,
    );

    animation.dispose();
  });

  it("reports direction and speed", () => {
    const animation = make("animation");
    animation.send({ type: "playback.play" });
    animation.send({
      type: "clip.play",
      clipId: "anm_sweep",
      options: { speed: -2, startFrame: 0 },
    });

    expect(timeline(animation)[0]!.state!.speed).toBe(-2);
    animation.dispose();
  });

  it("has no state for a clip that is not running", () => {
    const animation = make("animation");
    animation.send({ type: "clip.stop", clipId: "anm_sweep" });
    expect(timeline(animation)[0]!.state).toBeUndefined();
    animation.dispose();
  });

  it("maps a timeline position back to a frame", () => {
    const state = {
      clipId: "c",
      playing: true,
      held: false,
      startFrame: 10,
      speed: 1,
      loop: false,
      seconds: 0,
      duration: 2,
    };
    expect(frameForClipTime(state, 1, 60)).toBe(70);
    expect(frameForClipTime(undefined, 1, 60)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Debug layers
// ---------------------------------------------------------------------------

describe("debug layers", () => {
  it("projects world boxes into canvas pixels", () => {
    const boxes = debugBoxes(session, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      orthographicSize: 5,
    });

    expect(boxes.length).toBeGreaterThan(0);
    // 1080 / (5 * 2) = 108 pixels per unit; origin at the canvas centre.
    const table = boxes.find((box) => box.nodeId === "nod_table")!;
    expect(table.width).toBeCloseTo(11 * 108, 1);
    expect(table.x).toBeCloseTo(960, 1);
  });

  it("classifies layout containers separately from plain bounds", () => {
    const lowerThird = make("lower-third");
    const boxes = debugBoxes(lowerThird, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      orthographicSize: 5,
    });

    expect(boxes.some((box) => box.kind === "layout")).toBe(true);
    expect(boxes.every((box) => box.width >= 0)).toBe(true);
    lowerThird.dispose();
  });

  it("flips Y, because a canvas grows downward and the scene grows up", () => {
    const boxes = debugBoxes(session, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      orthographicSize: 5,
    });
    for (const box of boxes) {
      const mirror = session.host.reconciler.mirror.get(box.nodeId)!;
      expect(box.y).toBeCloseTo(540 - mirror.worldMatrix[13]! * 108, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Output monitor
// ---------------------------------------------------------------------------

describe("output monitor", () => {
  it("reports every bound output with live counters", () => {
    session.send({
      type: "output.bind",
      output: { id: "preview", width: 960, height: 540, cadence: 2 },
    });
    for (let i = 1; i <= 8; i += 1) session.step((i * 1000) / 60);

    const rows = outputRows(session, 60);
    expect(rows.map((row) => row.id)).toEqual(["default", "preview"]);

    const preview = rows[1]!;
    expect(preview.resolution).toBe("960×540");
    expect(preview.effectiveFps).toBe(30);
    expect(preview.rendered + preview.skipped).toBe(8);
    expect(preview.missed).toBe(0);
  });

  it("matches the engine's own statistics", () => {
    for (let i = 1; i <= 5; i += 1) session.step((i * 1000) / 60);
    const rows = outputRows(session, 60);
    const stats = session.host.outputStats();

    for (const row of rows) {
      const stat = stats.find((entry) => entry.id === row.id)!;
      expect(row.rendered).toBe(stat.framesRendered);
      expect(row.missed).toBe(stat.framesMissed);
    }
  });
});

// ---------------------------------------------------------------------------
// Session recorder
// ---------------------------------------------------------------------------

describe("session recorder", () => {
  it("records commands and checkpoints, then replays to a match", () => {
    const recorder = new SessionRecorder();
    recorder.start(session);

    for (let frame = 1; frame <= 90; frame += 1) {
      if (frame === 10) {
        session.send({
          type: "collection.reorder",
          key: "standings",
          ids: ["t3", "t1"],
          keyField: "id",
        });
      }
      if (frame === 40) {
        session.send({
          type: "collection.patch",
          key: "standings",
          id: "t2",
          keyField: "id",
          patch: { score: 99 },
        });
      }
      session.step((frame * 1000) / 60);
      recorder.tick(session);
    }

    const recording = recorder.stop(session);
    expect(recording.commands.length).toBe(2);
    expect(recording.checkpoints.length).toBeGreaterThan(1);

    const fresh = session.forkForReplay();
    const result = replayRecording(fresh, recording);

    expect(result.mismatches).toEqual([]);
    expect(result.matched).toBe(true);
    expect(result.checkpointsChecked).toBeGreaterThan(1);
    fresh.dispose();
  });

  it("stores hashes, not just commands", () => {
    // Commands alone would replay identically by construction. The hashes are
    // what can disagree, and disagreement is the bug worth finding.
    const recorder = new SessionRecorder();
    recorder.start(session);
    session.step(0);
    const recording = recorder.stop(session);

    expect(recording.checkpoints[0]!.sessionHash).toBeTruthy();
    expect(recording.checkpoints[0]!.runtimeHash).toBeTruthy();
    expect(recording.checkpoints[0]!.nodeCount).toBeGreaterThan(0);
  });

  it("detects a divergence rather than reporting success", () => {
    const recorder = new SessionRecorder();
    recorder.start(session);
    session.step(0);
    const recording = recorder.stop(session);

    // Corrupt every checkpoint: the tool must notice.
    const tampered = {
      ...recording,
      checkpoints: recording.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        sessionHash: "definitely-not-the-hash",
      })),
    };

    const fresh = session.forkForReplay();
    const result = replayRecording(fresh, tampered);

    expect(result.matched).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches[0]!.kind).toBe("session");
    fresh.dispose();
  });

  it("refuses a recording from another scene", () => {
    const recorder = new SessionRecorder();
    recorder.start(session);
    const recording = { ...recorder.stop(session), sceneId: "somewhere-else" };

    const fresh = session.forkForReplay();
    expect(replayRecording(fresh, recording).matched).toBe(false);
    fresh.dispose();
  });

  it("round-trips through JSON, so it can be attached to a bug report", () => {
    const recorder = new SessionRecorder();
    recorder.start(session);
    session.send({ type: "playback.pause" });
    session.step(0);
    const recording = recorder.stop(session);

    const parsed = parseRecording(serializeRecording(recording));
    expect(parsed.sceneId).toBe(recording.sceneId);
    expect(parsed.commands).toEqual(recording.commands);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseRecording("{}")).toThrow(/not a recording/);
  });
});
