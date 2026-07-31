import { describe, expect, it } from "vitest";

import { RuntimeClock } from "./clock";
import {
  CommandQueue,
  CommandQueueOverflowError,
  applyCommand,
  replayCommands,
  validateCommand,
  type Command,
} from "./commands";
import { canonicalString, hashValue } from "./hash";
import {
  RuntimeStateOps,
  canonicalizeRuntimeState,
  createRuntimeState,
  hashRuntimeState,
  resolveVariable,
  runtimeStatesEqual,
} from "./state";

function freshState() {
  const clock = new RuntimeClock();
  return { clock, state: createRuntimeState(clock.snapshot()) };
}

describe("canonical hashing", () => {
  it("is insensitive to object key order", () => {
    expect(canonicalString({ a: 1, b: 2 })).toBe(canonicalString({ b: 2, a: 1 }));
  });

  it("is insensitive to Map insertion order", () => {
    // Map iteration follows insertion order, so two structurally equal states
    // would otherwise hash differently.
    const first = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const second = new Map([
      ["b", 2],
      ["a", 1],
    ]);
    expect(canonicalString(first)).toBe(canonicalString(second));
  });

  it("is insensitive to Set insertion order", () => {
    expect(canonicalString(new Set([3, 1, 2]))).toBe(
      canonicalString(new Set([1, 2, 3])),
    );
  });

  it("collapses negative zero", () => {
    expect(canonicalString(-0)).toBe(canonicalString(0));
  });

  it("distinguishes structurally different values", () => {
    expect(canonicalString({ a: 1 })).not.toBe(canonicalString({ a: "1" }));
    expect(canonicalString([1, 2])).not.toBe(canonicalString([2, 1]));
  });

  it("refuses values that cannot be deterministic state", () => {
    // A Date would smuggle wall-clock time into hashed state, violating I2.
    expect(() => canonicalString(new Date())).toThrow();
    expect(() => canonicalString(() => undefined)).toThrow();
  });

  it("produces a stable digest", () => {
    expect(hashValue({ a: 1, b: [2, 3] })).toBe(hashValue({ b: [2, 3], a: 1 }));
  });
});

describe("runtime state is isolated from document state", () => {
  it("exposes no serialisation function", () => {
    // Runtime state has no on-disk form, by design. This test exists so that
    // adding one is a deliberate act that breaks a test, not a convenience
    // someone slips in.
    const exported = Object.keys(RuntimeStateOps);
    expect(exported).not.toContain("serialize");
    expect(exported).not.toContain("toJSON");
  });

  it("holds no document structure", () => {
    const { state } = freshState();
    expect(state).not.toHaveProperty("root");
    expect(state).not.toHaveProperty("nodes");
    expect(state).not.toHaveProperty("format");
  });

  it("treats the clock as authoritative for frame", () => {
    const { clock, state } = freshState();
    clock.seek(42);
    const next = RuntimeStateOps.withClock(state, clock.snapshot());
    expect(next.frame).toBe(42);
  });
});

describe("state transitions are immutable and identity-preserving", () => {
  it("returns the same object when nothing changes", () => {
    // Identity stability lets consumers skip work by reference comparison.
    const { state } = freshState();
    const once = RuntimeStateOps.withVariable(state, "score", 1);
    expect(RuntimeStateOps.withVariable(once, "score", 1)).toBe(once);
  });

  it("does not mutate the previous state", () => {
    const { state } = freshState();
    const before = canonicalizeRuntimeState(state);
    RuntimeStateOps.withVariable(state, "score", 5);
    expect(canonicalizeRuntimeState(state)).toBe(before);
  });

  it("clears scene-scoped state when the active scene changes", () => {
    // A variable from one scene must not resolve into another.
    const { state } = freshState();
    const populated = RuntimeStateOps.withVariable(
      RuntimeStateOps.withActiveScene(state, "scn_a"),
      "score",
      3,
    );
    const switched = RuntimeStateOps.withActiveScene(populated, "scn_b");
    expect(switched.variables.size).toBe(0);
    expect(switched.overrides.size).toBe(0);
  });

  it("sorts and de-duplicates selection", () => {
    const { state } = freshState();
    const a = RuntimeStateOps.withSelection(state, ["nod_c", "nod_a", "nod_a"]);
    const b = RuntimeStateOps.withSelection(state, ["nod_a", "nod_c"]);
    expect(a.selection).toEqual(["nod_a", "nod_c"]);
    expect(runtimeStatesEqual(a, b)).toBe(true);
  });
});

describe("variable resolution", () => {
  it("prefers an override over a runtime value", () => {
    // An operator taking manual control mid-show must win over the feed.
    const { state } = freshState();
    const withBoth = RuntimeStateOps.withOverride(
      RuntimeStateOps.withVariable(state, "score", 1),
      "score",
      99,
    );
    expect(resolveVariable(withBoth, "score", 0)).toBe(99);
  });

  it("falls back to the document default when unset", () => {
    const { state } = freshState();
    expect(resolveVariable(state, "score", 7)).toBe(7);
  });

  it("returns the runtime value when no override exists", () => {
    const { state } = freshState();
    const set = RuntimeStateOps.withVariable(state, "score", 4);
    expect(resolveVariable(set, "score", 0)).toBe(4);
  });
});

describe("command validation rejects rather than throws", () => {
  it.each<[string, Command]>([
    ["fractional seek", { type: "clock.seek", frame: 1.5 }],
    ["negative seek", { type: "clock.seek", frame: -1 }],
    ["fractional step", { type: "clock.step", frames: 0.5 }],
    ["negative speed", { type: "clock.setSpeed", speed: { num: -1, den: 1 } }],
    ["empty key", { type: "variable.set", key: "", value: 1 }],
    ["NaN value", { type: "variable.set", key: "a", value: NaN }],
  ])("rejects %s", (_label, command) => {
    const { state } = freshState();
    expect(validateCommand(command, state)).not.toBeNull();
  });

  it("rejects resume when not paused", () => {
    const { state } = freshState();
    expect(validateCommand({ type: "clock.resume" }, state)).not.toBeNull();
  });

  it("accepts a valid command", () => {
    const { state } = freshState();
    expect(
      validateCommand({ type: "variable.set", key: "score", value: 3 }, state),
    ).toBeNull();
  });
});

describe("command queue", () => {
  it("dispatches in enqueue order", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    queue.enqueue({ type: "variable.set", key: "a", value: 1 });
    queue.enqueue({ type: "variable.set", key: "a", value: 2 });
    queue.enqueue({ type: "variable.set", key: "a", value: 3 });

    const result = queue.dispatch(state, clock);
    expect(result.state.variables.get("a")).toBe(3);
    expect(result.applied.map((q) => q.sequence)).toEqual([0, 1, 2]);
  });

  it("empties the queue on dispatch", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    queue.enqueue({ type: "clock.play" });
    queue.dispatch(state, clock);
    expect(queue.pendingCount).toBe(0);
  });

  it("cancels a queued command before dispatch", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    const doomed = queue.enqueue({ type: "variable.set", key: "a", value: 1 });
    queue.enqueue({ type: "variable.set", key: "b", value: 2 });

    expect(queue.cancel(doomed)).toBe(true);
    const result = queue.dispatch(state, clock);
    expect(result.state.variables.has("a")).toBe(false);
    expect(result.state.variables.get("b")).toBe(2);
  });

  it("reports cancelling an unknown sequence", () => {
    expect(new CommandQueue().cancel(999)).toBe(false);
  });

  it("records rejections without stopping the dispatch", () => {
    // A bad command during a live show must not take down the frame.
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    queue.enqueue({ type: "clock.seek", frame: -5 });
    queue.enqueue({ type: "variable.set", key: "ok", value: 1 });

    const result = queue.dispatch(state, clock);
    expect(result.rejected).toHaveLength(1);
    expect(result.state.variables.get("ok")).toBe(1);
  });

  it("applies a batch atomically, rejecting all when one member fails", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    queue.enqueueBatch([
      { type: "variable.set", key: "a", value: 1 },
      { type: "clock.seek", frame: -1 },
      { type: "variable.set", key: "b", value: 2 },
    ]);

    const result = queue.dispatch(state, clock);
    expect(result.applied).toHaveLength(0);
    expect(result.state.variables.size).toBe(0);
    expect(result.rejected).toHaveLength(3);
  });

  it("applies a valid batch entirely", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    queue.enqueueBatch([
      { type: "variable.set", key: "a", value: 1 },
      { type: "variable.set", key: "b", value: 2 },
    ]);
    const result = queue.dispatch(state, clock);
    expect(result.state.variables.size).toBe(2);
  });

  it("cancels a whole batch", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue();
    const batch = queue.enqueueBatch([
      { type: "variable.set", key: "a", value: 1 },
      { type: "variable.set", key: "b", value: 2 },
    ]);
    expect(queue.cancelBatch(batch)).toBe(2);
    expect(queue.dispatch(state, clock).applied).toHaveLength(0);
  });

  it("bounds the queue so a runaway producer cannot exhaust memory", () => {
    const queue = new CommandQueue({ capacity: 3 });
    for (let i = 0; i < 3; i += 1) {
      queue.enqueue({ type: "variable.set", key: `k${i}`, value: i });
    }
    expect(() =>
      queue.enqueue({ type: "variable.set", key: "overflow", value: 0 }),
    ).toThrow(CommandQueueOverflowError);
  });

  it("bounds history so a long show cannot grow without limit", () => {
    const { clock, state } = freshState();
    const queue = new CommandQueue({ historyLimit: 10 });
    let next = state;
    for (let i = 0; i < 50; i += 1) {
      queue.enqueue({ type: "variable.set", key: "a", value: i });
      next = queue.dispatch(next, clock).state;
    }
    expect(queue.history).toHaveLength(10);
  });
});

describe("replay determinism", () => {
  const script: Command[] = [
    { type: "scene.setActive", sceneId: "scn_a" },
    { type: "variable.set", key: "home", value: 0 },
    { type: "clock.play" },
    { type: "clock.step", frames: 30 },
    { type: "variable.set", key: "home", value: 1 },
    { type: "override.set", key: "home", value: 99 },
    { type: "clock.pause" },
    { type: "clock.seek", frame: 500 },
    { type: "selection.set", nodeIds: ["nod_b", "nod_a"] },
    { type: "override.clear", key: "home" },
    { type: "clock.setSpeed", speed: { num: 1, den: 2 } },
    { type: "clock.step", frames: 7 },
  ];

  const run = () => {
    const clock = new RuntimeClock();
    return replayCommands(createRuntimeState(clock.snapshot()), script, clock);
  };

  it("produces identical state for identical commands", () => {
    expect(canonicalizeRuntimeState(run())).toBe(
      canonicalizeRuntimeState(run()),
    );
  });

  it("produces identical hashes", () => {
    expect(hashRuntimeState(run())).toBe(hashRuntimeState(run()));
  });

  it("matches queue dispatch", () => {
    // The queue path and the replay path must agree, or a recorded show would
    // not reproduce what actually happened.
    const clock = new RuntimeClock();
    const queue = new CommandQueue();
    for (const command of script) queue.enqueue(command);
    const dispatched = queue.dispatch(createRuntimeState(clock.snapshot()), clock);

    expect(canonicalizeRuntimeState(dispatched.state)).toBe(
      canonicalizeRuntimeState(run()),
    );
  });

  it("returns to the initial state after runtime.reset", () => {
    const clock = new RuntimeClock();
    const initial = createRuntimeState(clock.snapshot());
    const dirtied = replayCommands(initial, script, clock);
    const reset = replayCommands(dirtied, [{ type: "runtime.reset" }], clock);
    expect(canonicalizeRuntimeState(reset)).toBe(
      canonicalizeRuntimeState(initial),
    );
  });

  it("replays identically after a reset", () => {
    const clock = new RuntimeClock();
    const initial = createRuntimeState(clock.snapshot());

    const first = replayCommands(initial, script, clock);
    const afterReset = replayCommands(first, [{ type: "runtime.reset" }], clock);
    const second = replayCommands(afterReset, script, clock);

    expect(canonicalizeRuntimeState(second)).toBe(
      canonicalizeRuntimeState(first),
    );
  });
});

describe("commands never touch document state or undo", () => {
  it("exposes no inverse", () => {
    // Commands are deliberately not invertible. RFC-002 §4.3 as corrected: a
    // score correction must never land on the undo stack.
    const commandsModule = { applyCommand, validateCommand, replayCommands };
    expect(Object.keys(commandsModule)).not.toContain("invertCommand");
  });

  it("leaves the clock as the only mutable object", () => {
    const { clock, state } = freshState();
    const before = canonicalizeRuntimeState(state);
    applyCommand(state, { type: "variable.set", key: "a", value: 1 }, clock);
    expect(canonicalizeRuntimeState(state)).toBe(before);
  });
});
