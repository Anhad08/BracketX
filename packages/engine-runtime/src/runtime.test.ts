import { describe, expect, it, vi } from "vitest";

import {
  ENGINE_EVENTS,
  EventBus,
  EventError,
  PRIORITY_HIGH,
  PRIORITY_LOW,
  PRIORITY_NORMAL,
  SignalBus,
} from "./events";
import { Lifecycle, LifecycleError, type LifecycleState } from "./lifecycle";
import { Phase, Scheduler, SchedulerError } from "./scheduler";
import { IdAllocator, ServiceError, ServiceRegistry, serviceKey } from "./services";
import { Runtime } from "./runtime";

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

describe("signals are synchronous and explicitly ordered", () => {
  it("delivers in priority order", () => {
    const bus = new SignalBus();
    const seen: string[] = [];
    bus.subscribe("t", () => seen.push("low"), PRIORITY_LOW);
    bus.subscribe("t", () => seen.push("high"), PRIORITY_HIGH);
    bus.subscribe("t", () => seen.push("normal"), PRIORITY_NORMAL);
    bus.emit({ type: "t" });
    expect(seen).toEqual(["high", "normal", "low"]);
  });

  it("breaks priority ties by registration order", () => {
    // Ordering must be total, or two runs could dispatch differently.
    const bus = new SignalBus();
    const seen: string[] = [];
    bus.subscribe("t", () => seen.push("first"));
    bus.subscribe("t", () => seen.push("second"));
    bus.subscribe("t", () => seen.push("third"));
    bus.emit({ type: "t" });
    expect(seen).toEqual(["first", "second", "third"]);
  });

  it("delivers synchronously", () => {
    const bus = new SignalBus();
    let called = false;
    bus.subscribe("t", () => {
      called = true;
    });
    bus.emit({ type: "t" });
    expect(called).toBe(true);
  });

  it("refuses recursive dispatch", () => {
    // Allowing it would make ordering depend on handler internals, which is
    // exactly the hidden ordering this system exists to prevent.
    const bus = new SignalBus();
    bus.subscribe("t", () => bus.emit({ type: "t" }));
    expect(() => bus.emit({ type: "t" })).toThrow(EventError);
  });

  it("is unaffected by a handler unsubscribing mid-dispatch", () => {
    const bus = new SignalBus();
    const seen: string[] = [];
    let second = 0;
    bus.subscribe("t", () => {
      seen.push("first");
      bus.unsubscribe(second);
    });
    second = bus.subscribe("t", () => seen.push("second"));
    bus.emit({ type: "t" });
    expect(seen).toEqual(["first", "second"]);
  });

  it("ignores events with no subscribers", () => {
    expect(() => new SignalBus().emit({ type: "nobody" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("events are deferred, never delivered inline", () => {
  it("does not deliver on publish", () => {
    const bus = new EventBus();
    let called = false;
    bus.subscribe("t", () => {
      called = true;
    });
    bus.publish({ type: "t" });
    expect(called).toBe(false);
    bus.drain();
    expect(called).toBe(true);
  });

  it("defers an event published by a handler to the next drain", () => {
    // This is what bounds the drain: a handler cannot extend the current one
    // into an unbounded loop.
    const bus = new EventBus();
    let depth = 0;
    bus.subscribe("t", () => {
      depth += 1;
      if (depth < 3) bus.publish({ type: "t" });
    });

    bus.publish({ type: "t" });
    bus.drain();
    expect(depth).toBe(1);
    bus.drain();
    expect(depth).toBe(2);
  });

  it("isolates a throwing handler from the others", () => {
    // One bad subscriber must not stop delivery or take down the frame loop.
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe("t", () => {
      throw new Error("boom");
    });
    bus.subscribe("t", () => seen.push("survived"));

    bus.publish({ type: "t" });
    const report = bus.drain();
    expect(seen).toEqual(["survived"]);
    expect(report.errors).toHaveLength(1);
  });

  it("coalesces by key, keeping the last value", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.subscribe("variable.changed", (event) => seen.push(event.payload));

    for (let i = 0; i < 12; i += 1) {
      bus.publishCoalesced("homeScore", {
        type: "variable.changed",
        payload: i,
      });
    }
    bus.drain();
    expect(seen).toEqual([11]);
  });

  it("counts dropped events rather than dropping silently", () => {
    const bus = new EventBus({ capacity: 2 });
    bus.publish({ type: "t" });
    bus.publish({ type: "t" });
    bus.publish({ type: "t" });
    expect(bus.droppedCount).toBe(1);
  });

  it("bounds handlers started per drain", () => {
    const bus = new EventBus({ maxPerDrain: 5 });
    let delivered = 0;
    bus.subscribe("t", () => {
      delivered += 1;
    });
    for (let i = 0; i < 20; i += 1) bus.publish({ type: "t" });

    const report = bus.drain();
    expect(report.delivered).toBe(5);
    expect(report.deferred).toBe(15);
    expect(delivered).toBe(5);
  });

  it("refuses a recursive drain", () => {
    const bus = new EventBus();
    bus.subscribe("t", () => bus.drain());
    bus.publish({ type: "t" });
    const report = bus.drain();
    expect(report.errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

describe("scheduler owns execution order", () => {
  it("runs stages in phase order regardless of registration order", () => {
    // The property that makes ordering architectural rather than incidental.
    const scheduler = new Scheduler();
    const seen: string[] = [];
    scheduler.register({
      id: "render",
      phase: Phase.RenderSubmission,
      priority: "P0",
      run: () => seen.push("render"),
    });
    scheduler.register({
      id: "time",
      phase: Phase.Time,
      priority: "P0",
      run: () => seen.push("time"),
    });
    scheduler.register({
      id: "commands",
      phase: Phase.Commands,
      priority: "P0",
      run: () => seen.push("commands"),
    });

    scheduler.runFrame(0);
    expect(seen).toEqual(["time", "commands", "render"]);
  });

  it("rejects a duplicate stage id", () => {
    const scheduler = new Scheduler();
    const stage = {
      id: "dup",
      phase: Phase.Time,
      priority: "P0" as const,
      run: () => undefined,
    };
    scheduler.register(stage);
    expect(() => scheduler.register(stage)).toThrow(SchedulerError);
  });

  it("never defers P0 work, even when degraded", () => {
    // On-air work is never degraded — ENGINE_RUNTIME §2.3.
    let elapsed = 0;
    const scheduler = new Scheduler({
      budgetMs: 1,
      degradeAfter: 1,
      now: () => elapsed,
    });
    let p0Runs = 0;
    let p2Runs = 0;
    scheduler.register({
      id: "critical",
      phase: Phase.Commands,
      priority: "P0",
      run: () => {
        p0Runs += 1;
        elapsed += 10;
      },
    });
    scheduler.register({
      id: "deferrable",
      phase: Phase.FrameEnd,
      priority: "P2",
      run: () => {
        p2Runs += 1;
      },
    });

    for (let frame = 0; frame < 5; frame += 1) {
      elapsed = 0;
      scheduler.runFrame(frame);
    }

    expect(p0Runs).toBe(5);
    expect(p2Runs).toBeLessThan(5);
  });

  it("degrades only after sustained pressure, not a single spike", () => {
    let elapsed = 0;
    const scheduler = new Scheduler({
      budgetMs: 5,
      degradeAfter: 3,
      now: () => elapsed,
    });
    scheduler.register({
      id: "slow",
      phase: Phase.Commands,
      priority: "P0",
      run: () => {
        elapsed += 10;
      },
    });

    elapsed = 0;
    expect(scheduler.runFrame(0).degraded).toBe(false);
    elapsed = 0;
    expect(scheduler.runFrame(1).degraded).toBe(false);
    elapsed = 0;
    expect(scheduler.runFrame(2).degraded).toBe(true);
  });

  it("recovers from degradation when frames fit again", () => {
    let elapsed = 0;
    let cost = 10;
    const scheduler = new Scheduler({
      budgetMs: 5,
      degradeAfter: 2,
      now: () => elapsed,
    });
    scheduler.register({
      id: "variable",
      phase: Phase.Commands,
      priority: "P0",
      run: () => {
        elapsed += cost;
      },
    });

    for (let f = 0; f < 3; f += 1) {
      elapsed = 0;
      scheduler.runFrame(f);
    }
    expect(scheduler.degraded).toBe(true);

    cost = 1;
    elapsed = 0;
    expect(scheduler.runFrame(3).degraded).toBe(false);
  });

  it("reports a stage that exceeds the chunk budget", () => {
    // Invariant I5: nothing over the chunk budget may run unchunked on the
    // frame thread. Reported, not thrown — killing a live frame is worse.
    let elapsed = 0;
    const scheduler = new Scheduler({ chunkWarningMs: 2, now: () => elapsed });
    scheduler.register({
      id: "unchunked",
      phase: Phase.Commands,
      priority: "P0",
      run: () => {
        elapsed += 40;
      },
    });
    expect(scheduler.runFrame(0).slowStages[0]?.id).toBe("unchunked");
  });

  it("promotes starved deferred work regardless of budget", () => {
    // Without this a permanently loaded frame would never stream an asset,
    // and the show would stall waiting for content always one frame away.
    let elapsed = 0;
    const scheduler = new Scheduler({ budgetMs: 1, now: () => elapsed });
    scheduler.register({
      id: "hog",
      phase: Phase.Commands,
      priority: "P0",
      run: () => {
        elapsed += 100;
      },
    });

    let ran = false;
    scheduler.defer({ id: "stream", priority: "P2", run: () => (ran = true) });

    for (let frame = 0; frame < 62 && !ran; frame += 1) {
      elapsed = 0;
      scheduler.runFrame(frame);
    }
    expect(ran).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("lifecycle rejects illegal transitions", () => {
  it("follows the documented happy path", () => {
    const lifecycle = new Lifecycle();
    for (const state of ["loading", "ready", "playing", "paused", "stopped"] as const) {
      lifecycle.transition(state);
    }
    expect(lifecycle.state).toBe("stopped");
  });

  it("refuses to reach playing without passing through ready", () => {
    // ENGINE_RECONCILIATION §1.7: every asset resolved and every glyph
    // pre-warmed before air.
    const lifecycle = new Lifecycle();
    lifecycle.transition("loading");
    expect(() => lifecycle.transition("playing")).toThrow(LifecycleError);
  });

  it.each<[LifecycleState, LifecycleState]>([
    ["boot", "playing"],
    ["boot", "ready"],
    ["shutdown", "boot"],
    ["shutdown", "ready"],
  ])("refuses %s -> %s", (from, to) => {
    const lifecycle = new Lifecycle();
    if (from !== "boot") {
      lifecycle.transition("loading");
      lifecycle.transition("ready");
      lifecycle.transition("stopped");
      lifecycle.transition("shutdown");
    }
    expect(() => lifecycle.transition(to)).toThrow(LifecycleError);
  });

  it("treats shutdown as terminal", () => {
    const lifecycle = new Lifecycle();
    lifecycle.transition("shutdown");
    expect(lifecycle.canTransition("boot")).toBe(false);
  });

  it("records the failure and allows only a restart", () => {
    const lifecycle = new Lifecycle();
    lifecycle.transition("loading");
    const error = new Error("asset missing");
    lifecycle.fail(error, "scene load failed");

    expect(lifecycle.state).toBe("failed");
    expect(lifecycle.failure).toBe(error);
    expect(lifecycle.canTransition("playing")).toBe(false);
    expect(lifecycle.canTransition("boot")).toBe(true);
  });

  it("reports live only while playing", () => {
    const lifecycle = new Lifecycle();
    lifecycle.transition("loading");
    lifecycle.transition("ready");
    expect(lifecycle.isLive).toBe(false);
    expect(lifecycle.isRenderable).toBe(true);
    lifecycle.transition("playing");
    expect(lifecycle.isLive).toBe(true);
  });

  it("keeps a transition history", () => {
    const lifecycle = new Lifecycle();
    lifecycle.transition("loading", "boot complete");
    expect(lifecycle.history[0]).toMatchObject({
      from: "boot",
      to: "loading",
      reason: "boot complete",
    });
  });
});

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

describe("services avoid global mutable state", () => {
  it("keeps two registries independent", () => {
    // Two runtimes in one process — an editor preview and an offline render —
    // must not interfere.
    const key = serviceKey<number>("counter");
    const a = new ServiceRegistry();
    const b = new ServiceRegistry();
    a.register(key, 1);
    b.register(key, 2);
    expect(a.require(key)).toBe(1);
    expect(b.require(key)).toBe(2);
  });

  it("throws on a missing dependency", () => {
    expect(() => new ServiceRegistry().require(serviceKey("absent"))).toThrow(
      ServiceError,
    );
  });

  it("refuses a duplicate registration", () => {
    const registry = new ServiceRegistry();
    const key = serviceKey<number>("k");
    registry.register(key, 1);
    expect(() => registry.register(key, 2)).toThrow(ServiceError);
  });

  it("refuses registration after freeze", () => {
    const registry = new ServiceRegistry();
    registry.freeze();
    expect(() => registry.register(serviceKey("late"), 1)).toThrow(ServiceError);
  });

  it("allocates ids monotonically and deterministically", () => {
    // Replay from a fresh runtime must allocate the same ids in order.
    const first = new IdAllocator();
    const second = new IdAllocator();
    const take = (a: IdAllocator) => [
      a.nextString("node"),
      a.nextString("node"),
      a.nextString("cmd"),
    ];
    expect(take(first)).toEqual(take(second));
    expect(take(first)[0]).toBe("node_3");
  });
});

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

describe("runtime is the single execution authority", () => {
  it("registers its owned stages at construction", () => {
    const runtime = new Runtime();
    expect(runtime.scheduler.stageIds()).toEqual([
      "runtime.commands",
      "runtime.stateUpdate",
      "runtime.frameEnd",
    ]);
  });

  it("applies queued commands during the frame, not on dispatch", () => {
    const runtime = new Runtime();
    runtime.dispatch({ type: "variable.set", key: "score", value: 3 });
    expect(runtime.state.variables.has("score")).toBe(false);
    runtime.tick();
    expect(runtime.state.variables.get("score")).toBe(3);
  });

  it("keeps stages in phase order when subsystems register later", () => {
    const runtime = new Runtime();
    const seen: string[] = [];
    runtime.registerStage({
      id: "render",
      phase: Phase.RenderSubmission,
      priority: "P0",
      run: () => seen.push("render"),
    });
    runtime.registerStage({
      id: "animation",
      phase: Phase.Animation,
      priority: "P1",
      run: () => seen.push("animation"),
    });
    runtime.tick();
    expect(seen).toEqual(["animation", "render"]);
  });

  it("publishes an error event for a rejected command", () => {
    const runtime = new Runtime();
    const errors: unknown[] = [];
    runtime.events.subscribe(ENGINE_EVENTS.errorRaised, (e) =>
      errors.push(e.payload),
    );
    runtime.dispatch({ type: "clock.seek", frame: -5 });
    runtime.tick();
    expect(errors).toHaveLength(1);
  });

  it("advances deterministically with step", () => {
    const runtime = new Runtime();
    runtime.dispatch({ type: "clock.play" });
    runtime.tick();
    runtime.step(10);
    expect(runtime.clock.frame).toBe(10);
  });

  it("resets to a reproducible state", () => {
    const runtime = new Runtime();
    const pristine = runtime.canonicalState;

    runtime.dispatch({ type: "scene.setActive", sceneId: "scn_a" });
    runtime.dispatch({ type: "variable.set", key: "a", value: 1 });
    runtime.tick();
    runtime.step(50);
    expect(runtime.canonicalState).not.toBe(pristine);

    runtime.reset();
    expect(runtime.canonicalState).toBe(pristine);
  });

  it("keeps registered stages across a reset", () => {
    // A reset that dropped stages would leave a runtime that cannot run.
    const runtime = new Runtime();
    runtime.registerStage({
      id: "custom",
      phase: Phase.Animation,
      priority: "P1",
      run: () => undefined,
    });
    runtime.reset();
    expect(runtime.scheduler.stageIds()).toContain("custom");
  });

  it("never reads a platform clock", () => {
    // Invariant I2. Omitting wallMs runs in fixed-timestep mode, which is
    // what offline rendering and replay use.
    const spy = vi.spyOn(Date, "now");
    const runtime = new Runtime();
    runtime.dispatch({ type: "clock.play" });
    runtime.tick();
    runtime.step(5);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("runtime replay determinism", () => {
  const script = [
    { type: "scene.setActive", sceneId: "scn_a" },
    { type: "variable.set", key: "home", value: 0 },
    { type: "clock.play" },
    { type: "variable.set", key: "away", value: 0 },
    { type: "override.set", key: "home", value: 5 },
    { type: "selection.set", nodeIds: ["nod_z", "nod_a"] },
    { type: "clock.setSpeed", speed: { num: 1, den: 2 } },
  ] as const;

  const run = () => {
    const runtime = new Runtime();
    for (const command of script) runtime.dispatch(command);
    runtime.tick();
    for (let i = 0; i < 20; i += 1) runtime.step(3);
    return runtime;
  };

  it("produces identical canonical state", () => {
    expect(run().canonicalState).toBe(run().canonicalState);
  });

  it("produces identical hashes", () => {
    expect(run().stateHash).toBe(run().stateHash);
  });

  it("reaches the same frame by stepping or seeking", () => {
    // Invariant I3 at the runtime level.
    const stepped = new Runtime();
    stepped.dispatch({ type: "clock.play" });
    stepped.tick();
    for (let i = 0; i < 120; i += 1) stepped.step();

    const sought = new Runtime();
    sought.dispatch({ type: "clock.play" });
    sought.dispatch({ type: "clock.seek", frame: 120 });
    sought.tick();

    expect(stepped.clock.frame).toBe(sought.clock.frame);
  });
});
