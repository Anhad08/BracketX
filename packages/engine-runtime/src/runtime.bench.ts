import { bench, describe } from "vitest";

import { RuntimeClock } from "./clock";
import { CommandQueue, replayCommands, type Command } from "./commands";
import { EventBus, SignalBus } from "./events";
import { FRAME_RATES } from "./rational";
import { Phase, Scheduler } from "./scheduler";
import { Runtime } from "./runtime";
import { canonicalizeRuntimeState, createRuntimeState, hashRuntimeState } from "./state";

/**
 * Runtime benchmarks.
 *
 * MEASURE, DO NOT OPTIMISE. These exist to record where the runtime actually
 * spends time before anyone tunes it, so a later optimisation can be judged
 * against a number rather than an intuition.
 *
 * Run: pnpm --filter @bracketx/engine-runtime bench
 */

function script(length: number): Command[] {
  const commands: Command[] = [];
  for (let i = 0; i < length; i += 1) {
    commands.push({ type: "variable.set", key: `k${i % 16}`, value: i });
  }
  return commands;
}

const SMALL = script(100);
const LARGE = script(10_000);

describe("command throughput", () => {
  bench("enqueue + dispatch 100 commands", () => {
    const clock = new RuntimeClock();
    const queue = new CommandQueue();
    for (const command of SMALL) queue.enqueue(command);
    queue.dispatch(createRuntimeState(clock.snapshot()), clock);
  });

  bench("enqueue + dispatch 10,000 commands", () => {
    const clock = new RuntimeClock();
    const queue = new CommandQueue({ capacity: 20_000, historyLimit: 20_000 });
    for (const command of LARGE) queue.enqueue(command);
    queue.dispatch(createRuntimeState(clock.snapshot()), clock);
  });

  bench("replay 10,000 commands", () => {
    const clock = new RuntimeClock();
    replayCommands(createRuntimeState(clock.snapshot()), LARGE, clock);
  });
});

describe("scheduler overhead", () => {
  const empty = new Scheduler();

  const ten = new Scheduler();
  for (let i = 0; i < 10; i += 1) {
    ten.register({
      id: `stage${i}`,
      phase: Phase.SceneEvaluation,
      priority: "P1",
      run: () => undefined,
    });
  }

  const hundred = new Scheduler();
  for (let i = 0; i < 100; i += 1) {
    hundred.register({
      id: `stage${i}`,
      phase: Phase.SceneEvaluation,
      priority: "P1",
      run: () => undefined,
    });
  }

  bench("empty frame", () => {
    empty.runFrame(0);
  });

  bench("frame with 10 stages", () => {
    ten.runFrame(0);
  });

  bench("frame with 100 stages", () => {
    hundred.runFrame(0);
  });
});

describe("event throughput", () => {
  bench("publish + drain 1,000 events, 1 subscriber", () => {
    const bus = new EventBus({ capacity: 20_000, maxPerDrain: 20_000 });
    bus.subscribe("t", () => undefined);
    for (let i = 0; i < 1000; i += 1) bus.publish({ type: "t", payload: i });
    bus.drain();
  });

  bench("publish + drain 1,000 events, 10 subscribers", () => {
    const bus = new EventBus({ capacity: 20_000, maxPerDrain: 20_000 });
    for (let i = 0; i < 10; i += 1) bus.subscribe("t", () => undefined);
    for (let i = 0; i < 1000; i += 1) bus.publish({ type: "t", payload: i });
    bus.drain();
  });

  bench("coalesce 1,000 publishes to 16 keys", () => {
    const bus = new EventBus({ capacity: 20_000, maxPerDrain: 20_000 });
    bus.subscribe("variable.changed", () => undefined);
    for (let i = 0; i < 1000; i += 1) {
      bus.publishCoalesced(`k${i % 16}`, {
        type: "variable.changed",
        payload: i,
      });
    }
    bus.drain();
  });

  bench("emit 1,000 signals, 3 subscribers", () => {
    const bus = new SignalBus();
    for (let i = 0; i < 3; i += 1) bus.subscribe("t", () => undefined);
    for (let i = 0; i < 1000; i += 1) bus.emit({ type: "t", payload: i });
  });
});

describe("state hashing", () => {
  const clock = new RuntimeClock();
  const populated = replayCommands(
    createRuntimeState(clock.snapshot()),
    script(500),
    clock,
  );

  bench("canonicalize a populated state", () => {
    canonicalizeRuntimeState(populated);
  });

  bench("hash a populated state", () => {
    hashRuntimeState(populated);
  });
});

describe("clock", () => {
  const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
  clock.play(0);
  let wall = 0;

  bench("advanceTo (wall-clock derivation)", () => {
    wall += 16.6;
    clock.advanceTo(wall);
  });

  bench("step (fixed timestep)", () => {
    clock.step();
  });

  bench("toTimecode (drop-frame)", () => {
    clock.toTimecode(1_000_000);
  });
});

describe("runtime frame", () => {
  bench("tick with no registered subsystems", () => {
    const runtime = new Runtime();
    runtime.tick();
  });

  bench("tick after 100 queued commands", () => {
    const runtime = new Runtime({ queue: { capacity: 20_000 } });
    for (const command of SMALL) runtime.dispatch(command);
    runtime.tick();
  });

  bench("1,000 ticks (steady state)", () => {
    const runtime = new Runtime();
    for (let i = 0; i < 1000; i += 1) runtime.step();
  });

  bench("reset cost", () => {
    const runtime = new Runtime({ queue: { capacity: 20_000 } });
    for (const command of SMALL) runtime.dispatch(command);
    runtime.tick();
    runtime.reset();
  });
});
