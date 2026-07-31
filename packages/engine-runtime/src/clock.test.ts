import { describe, expect, it } from "vitest";

import {
  ClockError,
  RuntimeClock,
  framesToTimecode,
  isDropFrame,
} from "./clock";
import { FRAME_RATES, rational, toNumber } from "./rational";

describe("rational frame rates", () => {
  it("represents 29.97 exactly", () => {
    // The reason this module exists: 29.97 is 30000/1001, and 1/29.97 is
    // 33.3666...ms, which no binary float represents.
    expect(FRAME_RATES.ntsc2997).toEqual({ num: 30000, den: 1001 });
    expect(toNumber(FRAME_RATES.ntsc2997)).toBeCloseTo(29.97, 2);
  });

  it("normalises equal rationals to identical structures", () => {
    expect(rational(60, 2)).toEqual(rational(30, 1));
    expect(rational(-1, -2)).toEqual(rational(1, 2));
  });

  it("rejects a zero denominator", () => {
    expect(() => rational(1, 0)).toThrow();
  });
});

describe("clock is frame-canonical", () => {
  it("starts stopped at frame zero", () => {
    const clock = new RuntimeClock();
    expect(clock.frame).toBe(0);
    expect(clock.status).toBe("stopped");
  });

  it("steps by whole frames", () => {
    const clock = new RuntimeClock();
    clock.step();
    clock.step(5);
    expect(clock.frame).toBe(6);
  });

  it("rejects a fractional step", () => {
    expect(() => new RuntimeClock().step(0.5)).toThrow(ClockError);
  });

  it("rejects a negative frame", () => {
    expect(() => new RuntimeClock().seek(-1)).toThrow(ClockError);
  });

  it("derives seconds exactly, without float drift", () => {
    // 1001 frames at 29.97 is exactly 1001 x 1001/30000 seconds. The rational
    // form is exact; the float form is not.
    const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
    clock.seek(30000);
    expect(clock.seconds).toEqual(rational(1001, 1));
  });

  it("accumulates no error over eight hours at 29.97", () => {
    // ENGINE_RUNTIME §1.1: the naive millisecond approach drifts by seconds
    // across a long event. Frame-canonical time cannot drift, because nothing
    // is added up.
    const rate = FRAME_RATES.ntsc2997;
    const clock = new RuntimeClock({ rate });
    const eightHoursOfFrames = 8 * 3600 * 30000 / 1001;
    const frames = Math.floor(eightHoursOfFrames);

    for (let i = 0; i < 1000; i += 1) clock.step(Math.floor(frames / 1000));

    const expected = Math.floor(frames / 1000) * 1000;
    expect(clock.frame).toBe(expected);
    // Exact rational seconds, derived not accumulated.
    expect(clock.seconds).toEqual(rational(expected * 1001, 30000));
  });
});

describe("seeking and scrubbing", () => {
  it("seeks to an absolute frame", () => {
    const clock = new RuntimeClock();
    clock.seek(120);
    expect(clock.frame).toBe(120);
  });

  it("seeks by seconds, rounding to the nearest frame", () => {
    const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
    clock.seekSeconds(1);
    // 1s at 29.97 is 29.97 frames; nearest is 30, not 29.
    expect(clock.frame).toBe(30);
  });

  it("scrubs backwards and forwards to the same result", () => {
    const clock = new RuntimeClock();
    clock.seek(500);
    clock.seek(10);
    clock.seek(500);
    expect(clock.frame).toBe(500);
  });
});

describe("transport", () => {
  it("pauses and resumes without losing position", () => {
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);
    clock.advanceTo(1000);
    const atPause = clock.frame;

    clock.pause();
    expect(clock.status).toBe("paused");

    // Wall time passes while paused; the frame must not move.
    clock.resume(9000);
    expect(clock.frame).toBe(atPause);

    clock.advanceTo(9500);
    expect(clock.frame).toBe(atPause + 30);
  });

  it("does not advance while paused", () => {
    const clock = new RuntimeClock();
    clock.play(0);
    clock.advanceTo(100);
    clock.pause();
    const frozen = clock.frame;
    clock.advanceTo(10_000);
    expect(clock.frame).toBe(frozen);
  });

  it("does not advance while stopped", () => {
    const clock = new RuntimeClock();
    clock.advanceTo(10_000);
    expect(clock.frame).toBe(0);
  });

  it("refuses to resume when not paused", () => {
    expect(() => new RuntimeClock().resume()).toThrow(ClockError);
  });

  it("resets to the initial state", () => {
    const clock = new RuntimeClock();
    clock.play(0);
    clock.advanceTo(5000);
    clock.setSpeed(rational(1, 2));
    clock.reset();
    expect(clock.snapshot()).toMatchObject({
      frame: 0,
      speed: { num: 1, den: 1 },
      status: "stopped",
    });
  });
});

describe("wall-clock playback derives, never accumulates", () => {
  it("advances proportionally to elapsed time", () => {
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);
    clock.advanceTo(1000);
    expect(clock.frame).toBe(60);
  });

  it("is idempotent for a repeated timestamp", () => {
    // The signature property of derivation over accumulation: calling twice
    // with the same wall time must not advance twice.
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);
    clock.advanceTo(1000);
    clock.advanceTo(1000);
    clock.advanceTo(1000);
    expect(clock.frame).toBe(60);
  });

  it("reaches the same frame in one jump or many small steps", () => {
    // Accumulation would produce a different answer here. Derivation cannot.
    const oneJump = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
    oneJump.play(0);
    oneJump.advanceTo(10_000);

    const manySteps = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
    manySteps.play(0);
    for (let ms = 17; ms <= 10_000; ms += 17) manySteps.advanceTo(ms);
    manySteps.advanceTo(10_000);

    expect(manySteps.frame).toBe(oneJump.frame);
  });

  it("survives irregular host timestamps", () => {
    const irregular = new RuntimeClock({ rate: rational(60, 1) });
    irregular.play(0);
    for (const ms of [3, 19, 20, 51, 52, 400, 401, 999, 1000]) {
      irregular.advanceTo(ms);
    }
    expect(irregular.frame).toBe(60);
  });

  it("re-anchors on a backwards timestamp rather than running time backwards", () => {
    // Show time is monotonic (ENGINE_RUNTIME §1.3). A host anomaly must not
    // rewind it.
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);
    clock.advanceTo(1000);
    const before = clock.frame;
    clock.advanceTo(500);
    expect(clock.frame).toBe(before);
    clock.advanceTo(1000);
    expect(clock.frame).toBeGreaterThanOrEqual(before);
  });

  it("never moves backwards, under any timestamp sequence", () => {
    // ENGINE_RUNTIME §1.3: show time is monotonic. Found by test — comparing
    // a timestamp against the origin alone misses a stale-but-after-origin
    // value, which still rewound the frame.
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);

    let previous = clock.frame;
    let seed = 12345;
    const nextRandom = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 2000; i += 1) {
      // Deliberately disordered timestamps, including large regressions.
      const wallMs = nextRandom() * 20_000;
      clock.advanceTo(wallMs);
      expect(clock.frame).toBeGreaterThanOrEqual(previous);
      previous = clock.frame;
    }
  });

  it("returns the number of frames advanced", () => {
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);
    expect(clock.advanceTo(0)).toBe(0);
    expect(clock.advanceTo(1000)).toBe(60);
    expect(clock.advanceTo(1000)).toBe(0);
  });
});

describe("playback speed", () => {
  it("halves the frame rate at half speed", () => {
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.setSpeed(rational(1, 2));
    clock.play(0);
    clock.advanceTo(1000);
    expect(clock.frame).toBe(30);
  });

  it("doubles the frame rate at double speed", () => {
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.setSpeed(rational(2, 1));
    clock.play(0);
    clock.advanceTo(1000);
    expect(clock.frame).toBe(120);
  });

  it("freezes at zero speed", () => {
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.setSpeed(rational(0, 1));
    clock.play(0);
    clock.advanceTo(5000);
    expect(clock.frame).toBe(0);
  });

  it("does not jump when speed changes mid-playback", () => {
    // The old origin was measured at the old speed; reusing it would jump.
    const clock = new RuntimeClock({ rate: rational(60, 1) });
    clock.play(0);
    clock.advanceTo(1000);
    const atChange = clock.frame;
    clock.setSpeed(rational(2, 1));
    clock.advanceTo(1000);
    expect(clock.frame).toBe(atChange);
    clock.advanceTo(2000);
    expect(clock.frame).toBe(atChange + 120);
  });

  it("rejects a negative speed", () => {
    expect(() => new RuntimeClock().setSpeed(rational(-1, 1))).toThrow(
      ClockError,
    );
  });
});

describe("replay determinism", () => {
  it("produces the same frame for the same step sequence", () => {
    const run = () => {
      const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc2997 });
      clock.play(0);
      for (let i = 0; i < 500; i += 1) clock.step(i % 3);
      clock.seek(1234);
      clock.step(7);
      return clock.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it("produces the same frame for the same wall-clock sequence", () => {
    const run = () => {
      const clock = new RuntimeClock({ rate: FRAME_RATES.ntsc5994 });
      clock.play(0);
      for (let ms = 0; ms <= 5000; ms += 13) clock.advanceTo(ms);
      return clock.frame;
    };
    expect(run()).toBe(run());
  });

  it("reaches the same frame by stepping or seeking", () => {
    // Invariant I3 for the clock: evaluating frame N directly equals playing
    // forward to frame N.
    const stepped = new RuntimeClock();
    for (let i = 0; i < 300; i += 1) stepped.step();

    const sought = new RuntimeClock();
    sought.seek(300);

    expect(stepped.frame).toBe(sought.frame);
    expect(stepped.seconds).toEqual(sought.seconds);
  });
});

describe("timecode", () => {
  it("labels non-drop rates with a colon", () => {
    expect(framesToTimecode(0, FRAME_RATES.smpte30)).toBe("00:00:00:00");
    expect(framesToTimecode(30, FRAME_RATES.smpte30)).toBe("00:00:01:00");
    expect(framesToTimecode(1800, FRAME_RATES.smpte30)).toBe("00:01:00:00");
  });

  it("labels 25fps correctly", () => {
    expect(framesToTimecode(25 * 3661, FRAME_RATES.pal25)).toBe("01:01:01:00");
  });

  it("identifies drop-frame rates", () => {
    expect(isDropFrame(FRAME_RATES.ntsc2997)).toBe(true);
    expect(isDropFrame(FRAME_RATES.ntsc5994)).toBe(true);
    // 23.976 shares the 1001 denominator but is not a drop-frame rate.
    expect(isDropFrame(FRAME_RATES.ntscFilm)).toBe(false);
    expect(isDropFrame(FRAME_RATES.smpte30)).toBe(false);
  });

  it("uses a semicolon separator for drop-frame", () => {
    expect(framesToTimecode(0, FRAME_RATES.ntsc2997)).toContain(";");
  });

  it("skips frame numbers 0 and 1 at a non-tenth minute", () => {
    // The defining behaviour of drop-frame: the label jumps from 00:00:59;29
    // to 00:01:00;02 so the count tracks wall time.
    const rate = FRAME_RATES.ntsc2997;
    expect(framesToTimecode(1799, rate)).toBe("00:00:59;29");
    expect(framesToTimecode(1800, rate)).toBe("00:01:00;02");
  });

  it("does not skip at the tenth minute", () => {
    const rate = FRAME_RATES.ntsc2997;
    // 10 minutes of 29.97 is 17982 frames, and minute 10 drops nothing.
    expect(framesToTimecode(17982, rate)).toBe("00:10:00;00");
  });

  it("rejects a negative frame", () => {
    expect(() => framesToTimecode(-1, FRAME_RATES.smpte30)).toThrow(ClockError);
  });
});
