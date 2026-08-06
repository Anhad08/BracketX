/**
 * The nine voices, and the laws that govern them.
 *
 * The synthesis itself is transcribed from Volume One §4 and can be checked by
 * ear against the artifact. What is tested here is what an ear cannot check:
 * that sound is off until asked for, that it ducks on air, that the one voice
 * meaning "a person is needed" survives ducking, and that no voice runs longer
 * than the specification allows.
 *
 * These are the failures that only appear on a live desk, which is the worst
 * possible place to discover them.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ALERT,
  LENGTH_LAW_EXEMPT,
  MAX_VOICE_MS,
  SoundEngine,
  VOICE_LENGTH,
  VOICE_NAMES,
  VOICES,
} from "./studio/sound";

/**
 * A recording stand-in for an AudioContext.
 *
 * Every node records what it was asked to do, so a test can assert that a
 * voice scheduled anything at all without a browser or a speaker.
 */
function fakeContext(state: AudioContextState = "running") {
  const started: number[] = [];
  const connected: string[] = [];
  const node = (kind: string) => {
    connected.push(kind);
    return {
      connect: () => undefined,
      start: (t: number) => started.push(t),
      stop: () => undefined,
      type: "",
      loop: false,
      buffer: null,
      frequency: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      Q: { value: 0 },
      gain: {
        value: 0,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
    };
  };
  const ctx = {
    state,
    currentTime: 1,
    sampleRate: 48_000,
    destination: {},
    createGain: () => node("gain"),
    createOscillator: () => node("osc"),
    createBufferSource: () => node("source"),
    createBiquadFilter: () => node("filter"),
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    resume: vi.fn(() => Promise.resolve()),
    close: () => Promise.resolve(),
  };
  return { ctx: ctx as unknown as AudioContext, started, connected };
}

describe("the voice table", () => {
  it("has exactly the nine the specification names", () => {
    expect(VOICE_NAMES).toEqual([
      "tick",
      "detent",
      "press",
      "cue",
      "take",
      "offair",
      "notify",
      "alert",
      "install",
    ]);
  });

  it("says what each voice is FOR, in an operator's words", () => {
    for (const name of VOICE_NAMES) {
      const doc = VOICES[name];
      expect(doc.label.length, name).toBeGreaterThan(1);
      expect(doc.when.length, name).toBeGreaterThan(3);
      // Not engine vocabulary. These strings are shown in Settings.
      expect(doc.when, name).not.toMatch(/oscillator|gain|buffer|hz/i);
    }
  });

  it("keeps every interface voice under the length the specification allows", () => {
    // "No voice exceeds 420 ms." A voice that crept over would overlap the
    // next action on a fast desk, which is exactly when it must not.
    for (const name of VOICE_NAMES) {
      if (LENGTH_LAW_EXEMPT.includes(name)) continue;
      expect(VOICE_LENGTH[name] * 1000, name).toBeLessThanOrEqual(MAX_VOICE_MS);
    }
  });

  it("pins the one place the specification contradicts itself", () => {
    // Volume One §4 states "No voice exceeds 420 ms" AND synthesises `offair`
    // at 780 ms, noting "the only descending voice; release is long". Both are
    // the specification; they disagree.
    //
    // The artifact is executable and says of itself that the running specimen
    // wins over the prose, so the long release is kept and the exemption is
    // made visible here rather than buried. This test exists so the day
    // somebody resolves it in Volume One, the code is found and updated —
    // rather than the contradiction living on because nothing pointed at it.
    expect(LENGTH_LAW_EXEMPT).toEqual(["offair"]);
    expect(VOICE_LENGTH.offair * 1000).toBeGreaterThan(MAX_VOICE_MS);
  });
});

describe("off by default", () => {
  it("starts silent, and plays nothing until asked", () => {
    // A gallery has its own audio discipline. An unexpected noise on a live
    // desk is a fault, not a delight.
    const { ctx, started } = fakeContext();
    const engine = new SoundEngine({ contextFactory: () => ctx });
    expect(engine.enabled).toBe(false);

    for (const name of VOICE_NAMES) engine.play(name);
    expect(started).toHaveLength(0);
  });

  it("does not even build an audio context until enabled", () => {
    // Constructing one on load is how a browser tab acquires an audio
    // indicator nobody asked for.
    const factory = vi.fn(() => fakeContext().ctx);
    const engine = new SoundEngine({ contextFactory: factory });
    engine.play("take");
    expect(factory).not.toHaveBeenCalled();

    engine.toggle(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("plays once enabled", () => {
    const { ctx, started } = fakeContext();
    const engine = new SoundEngine({ contextFactory: () => ctx });
    engine.toggle(true);
    engine.play("take");
    expect(started.length).toBeGreaterThan(0);
  });
});

describe("ducking", () => {
  it("silences the interface while on air", () => {
    // An operator mid-transmission must not hear the editor.
    const { ctx, started } = fakeContext();
    const engine = new SoundEngine({ contextFactory: () => ctx });
    engine.toggle(true);
    engine.setOnAir(true);

    for (const name of VOICE_NAMES.filter((n) => n !== ALERT)) engine.play(name);
    expect(started).toHaveLength(0);
  });

  it("lets alert through, because otherwise it is not an alert", () => {
    const { ctx, started } = fakeContext();
    const engine = new SoundEngine({ contextFactory: () => ctx });
    engine.toggle(true);
    engine.setOnAir(true);

    engine.play(ALERT);
    expect(started.length).toBeGreaterThan(0);
  });

  it("reports audibility without playing, so the UI can show the truth", () => {
    const engine = new SoundEngine({ contextFactory: () => fakeContext().ctx });
    engine.toggle(true);
    engine.setOnAir(true);
    expect(engine.audible("take")).toBe(false);
    expect(engine.audible("alert")).toBe(true);

    engine.setOnAir(false);
    expect(engine.audible("take")).toBe(true);
  });

  it("comes back when the broadcast ends", () => {
    const { ctx, started } = fakeContext();
    const engine = new SoundEngine({ contextFactory: () => ctx });
    engine.toggle(true);
    engine.setOnAir(true);
    engine.setOnAir(false);
    engine.play("detent");
    expect(started.length).toBeGreaterThan(0);
  });
});

describe("a suspended clock", () => {
  it("resumes before scheduling, rather than playing into silence", async () => {
    // Scheduling against a suspended context produces NOTHING, with no error.
    // It is the hardest audio bug to notice, because everything looks correct.
    const { ctx, started } = fakeContext("suspended");
    const engine = new SoundEngine({ contextFactory: () => ctx });
    engine.toggle(true);
    engine.play("press");

    expect(ctx.resume).toHaveBeenCalled();
    expect(started, "nothing may be scheduled before the clock is running").toHaveLength(0);

    // Once resumed and running, it plays.
    (ctx as unknown as { state: AudioContextState }).state = "running";
    await Promise.resolve();
    await Promise.resolve();
    expect(started.length).toBeGreaterThan(0);
  });
});

describe("no audio hardware at all", () => {
  it("degrades to silence rather than throwing", () => {
    // A sound may never be required to complete a task, so a machine with no
    // audio must lose the sound and keep the product.
    const engine = new SoundEngine({ contextFactory: () => null });
    expect(engine.toggle(true)).toBe(true);
    expect(() => {
      for (const name of VOICE_NAMES) engine.play(name);
    }).not.toThrow();
  });
});

describe("every voice actually synthesises something", () => {
  it("schedules at least one source per voice", () => {
    // A voice that silently did nothing would pass every other test here.
    for (const name of VOICE_NAMES) {
      const { ctx, started } = fakeContext();
      const engine = new SoundEngine({ contextFactory: () => ctx });
      engine.toggle(true);
      engine.play(name);
      expect(started.length, name).toBeGreaterThan(0);
    }
  });

  it("schedules take as the densest voice, as the specification intends", () => {
    // Take is the one moment that must feel like a relay closing. It carries
    // four layers; if it ever became a single beep the product would have
    // lost its most important sound without any test noticing.
    const counts = new Map<string, number>();
    for (const name of VOICE_NAMES) {
      const { ctx, started } = fakeContext();
      const engine = new SoundEngine({ contextFactory: () => ctx });
      engine.toggle(true);
      engine.play(name);
      counts.set(name, started.length);
    }
    expect(counts.get("take")).toBeGreaterThanOrEqual(4);
    expect(counts.get("tick")).toBe(1);
  });
});
