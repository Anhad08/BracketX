import { describe, expect, it } from "vitest";

import { RuntimeClock } from "./clock";
import { replayCommands, type Command } from "./commands";
import { FRAME_RATES, rational } from "./rational";
import { Runtime } from "./runtime";
import { canonicalizeRuntimeState, createRuntimeState } from "./state";

/**
 * Property-based determinism verification.
 *
 * Handcrafted tests prove the cases their author imagined. These generate
 * thousands of random command sequences and assert the invariants hold across
 * all of them — including interleavings nobody would think to write.
 *
 * The generator is a seeded LCG, not Math.random: a failure must be
 * reproducible from its seed, otherwise a property failure is unactionable.
 */

function createRandom(seed: number) {
  let state = seed >>> 0;
  return {
    next(): number {
      // Numerical Recipes LCG. Adequate for test input generation.
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    int(maxExclusive: number): number {
      return Math.floor(this.next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      return items[this.int(items.length)]!;
    },
  };
}

type Random = ReturnType<typeof createRandom>;

const KEYS = ["home", "away", "period", "clockText", "sponsor"] as const;
const NODES = ["nod_a", "nod_b", "nod_c", "nod_d"] as const;
const SPEEDS = [
  rational(0, 1),
  rational(1, 4),
  rational(1, 2),
  rational(1, 1),
  rational(2, 1),
] as const;

/**
 * A random command. Weighted toward state mutation over transport, because
 * that is the mix a live show produces — many small data updates, occasional
 * transport changes.
 */
function randomCommand(random: Random): Command {
  const roll = random.int(100);

  if (roll < 30) {
    return {
      type: "variable.set",
      key: random.pick(KEYS),
      value: random.int(1000),
    };
  }
  if (roll < 40) return { type: "variable.clear", key: random.pick(KEYS) };
  if (roll < 52) {
    return {
      type: "override.set",
      key: random.pick(KEYS),
      value: random.int(1000),
    };
  }
  if (roll < 58) return { type: "override.clear", key: random.pick(KEYS) };
  if (roll < 66) {
    const count = random.int(4);
    return {
      type: "selection.set",
      nodeIds: Array.from({ length: count }, () => random.pick(NODES)),
    };
  }
  if (roll < 72) return { type: "clock.play" };
  if (roll < 78) return { type: "clock.pause" };
  if (roll < 82) return { type: "clock.resume" };
  if (roll < 86) return { type: "clock.stop" };
  if (roll < 90) return { type: "clock.seek", frame: random.int(10_000) };
  if (roll < 94) return { type: "clock.step", frames: random.int(120) };
  if (roll < 97) return { type: "clock.setSpeed", speed: random.pick(SPEEDS) };
  if (roll < 99) {
    return {
      type: "scene.setActive",
      sceneId: random.int(2) === 0 ? "scn_a" : "scn_b",
    };
  }
  return { type: "runtime.reset" };
}

function randomScript(seed: number, length: number): Command[] {
  const random = createRandom(seed);
  return Array.from({ length }, () => randomCommand(random));
}

/** Replays a script against a fresh clock and state, returning canonical state. */
function replayToCanonical(script: readonly Command[]): string {
  const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
  const state = replayCommands(
    createRuntimeState(clock.snapshot()),
    script,
    clock,
  );
  return canonicalizeRuntimeState(state);
}

const SEEDS = Array.from({ length: 250 }, (_, i) => i * 7919 + 1);

describe("property: identical command sequences produce identical state", () => {
  it("holds across 250 random scripts of 200 commands each", () => {
    // 50,000 commands total.
    for (const seed of SEEDS) {
      const script = randomScript(seed, 200);
      const first = replayToCanonical(script);
      const second = replayToCanonical(script);
      expect(first, `seed ${seed} diverged between runs`).toBe(second);
    }
  });

  it("holds when the same script runs through the runtime queue", () => {
    // The queue path and the direct replay path must agree, or a recorded
    // show would not reproduce what actually happened.
    for (const seed of SEEDS.slice(0, 60)) {
      const script = randomScript(seed, 120);

      const runtime = new Runtime({ clock: { rate: FRAME_RATES.ntsc2997 } });
      for (const command of script) runtime.dispatch(command);
      runtime.tick();

      expect(runtime.canonicalState, `seed ${seed}`).toBe(
        replayToCanonical(script),
      );
    }
  });
});

describe("property: runtime reset yields identical replay", () => {
  it("holds across 100 random scripts", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const script = randomScript(seed, 150);

      const runtime = new Runtime({ clock: { rate: FRAME_RATES.ntsc2997 } });
      for (const command of script) runtime.dispatch(command);
      runtime.tick();
      const first = runtime.canonicalState;

      runtime.reset();
      for (const command of script) runtime.dispatch(command);
      runtime.tick();

      expect(runtime.canonicalState, `seed ${seed}`).toBe(first);
    }
  });

  it("returns a dirtied runtime exactly to its pristine state", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const runtime = new Runtime();
      const pristine = runtime.canonicalState;

      for (const command of randomScript(seed, 100)) runtime.dispatch(command);
      runtime.tick();
      runtime.step(seed % 97);

      runtime.reset();
      expect(runtime.canonicalState, `seed ${seed}`).toBe(pristine);
    }
  });
});

describe("property: frame stepping equals seeking", () => {
  it("holds for arbitrary step decompositions", () => {
    // Invariant I3: evaluating frame N directly equals playing forward to N.
    // The property that makes editor scrubbing and offline rendering the same
    // code path.
    for (const seed of SEEDS.slice(0, 120)) {
      const random = createRandom(seed);
      const target = random.int(5000) + 1;

      const sought = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
      sought.seek(target);

      const stepped = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
      let remaining = target;
      while (remaining > 0) {
        const chunk = Math.min(remaining, random.int(50) + 1);
        stepped.step(chunk);
        remaining -= chunk;
      }

      expect(stepped.frame, `seed ${seed}`).toBe(sought.frame);
      expect(stepped.seconds).toEqual(sought.seconds);
      expect(stepped.toTimecode()).toBe(sought.toTimecode());
    }
  });
});

describe("property: no delta-time accumulation", () => {
  it("reaches the same frame regardless of timestamp granularity", () => {
    // Accumulation would make the answer depend on how finely the host
    // reports time. Derivation cannot.
    for (const seed of SEEDS.slice(0, 80)) {
      const random = createRandom(seed);
      const durationMs = random.int(30_000) + 1000;
      const rate = random.pick([
        FRAME_RATES.ntsc2997,
        FRAME_RATES.smpte60,
        FRAME_RATES.pal25,
        FRAME_RATES.ntsc5994,
      ]);

      const coarse = new RuntimeClock({ rate });
      coarse.play(0);
      coarse.advanceTo(durationMs);

      const fine = new RuntimeClock({ rate });
      fine.play(0);
      for (let ms = 0; ms < durationMs; ms += random.int(30) + 1) {
        fine.advanceTo(ms);
      }
      fine.advanceTo(durationMs);

      expect(fine.frame, `seed ${seed}`).toBe(coarse.frame);
    }
  });

  it("never moves show time backwards under disordered timestamps", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const random = createRandom(seed);
      const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc5994 });
      clock.play(0);

      let previous = 0;
      for (let i = 0; i < 300; i += 1) {
        clock.advanceTo(random.next() * 60_000);
        expect(clock.frame, `seed ${seed}`).toBeGreaterThanOrEqual(previous);
        previous = clock.frame;
      }
    }
  });
});

describe("property: no crashes and no invariant violations", () => {
  it("survives 250 random scripts without throwing", () => {
    for (const seed of SEEDS) {
      const runtime = new Runtime({ clock: { rate: FRAME_RATES.ntsc2997 } });
      expect(() => {
        for (const command of randomScript(seed, 200)) runtime.dispatch(command);
        runtime.tick();
      }, `seed ${seed}`).not.toThrow();
    }
  });

  it("keeps runtime state structurally sound throughout", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const runtime = new Runtime();
      const random = createRandom(seed);

      for (let i = 0; i < 200; i += 1) {
        runtime.dispatch(randomCommand(random));
        if (random.int(10) === 0) runtime.tick();
      }
      runtime.tick();

      const state = runtime.state;
      expect(Number.isInteger(state.frame)).toBe(true);
      expect(state.frame).toBeGreaterThanOrEqual(0);
      // Selection is stored sorted and de-duplicated, so two clients
      // selecting the same nodes hash identically.
      expect([...state.selection]).toEqual([...state.selection].sort());
      expect(new Set(state.selection).size).toBe(state.selection.length);
      // Runtime state must never acquire document structure.
      expect(state).not.toHaveProperty("root");
    }
  });

  it("never lets a rejected command mutate state", () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const runtime = new Runtime();
      const random = createRandom(seed);

      for (let i = 0; i < 50; i += 1) {
        const before = runtime.canonicalState;
        // Deliberately invalid commands mixed with valid ones.
        runtime.dispatch({ type: "clock.seek", frame: -random.int(100) - 1 });
        const report = runtime.tick();
        if (report.applied === 0 && report.rejected.length > 0) {
          expect(runtime.canonicalState, `seed ${seed}`).toBe(before);
        }
      }
    }
  });
});
