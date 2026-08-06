/**
 * Quality presets and device classification.
 *
 * The rule these defend is the expensive one: a preset may soften the EDITOR
 * PREVIEW and must never touch what goes to air.
 */
import { describe, expect, it } from "vitest";
import { classify, profileFor, type DeviceInput } from "./studio/device";
import {
  FrameMeter,
  lowerTier,
  PRESETS,
  previewOptions,
  programOptions,
  resolveTier,
  settingsFor,
  suggestTier,
  TIERS,
} from "./studio/quality";

const PHONE: DeviceInput = { width: 390, height: 844, coarsePointer: true, cores: 6, memoryGb: 4 };
const TABLET: DeviceInput = { width: 1024, height: 1366, coarsePointer: true, cores: 8, memoryGb: 8 };
const SMALL_TABLET: DeviceInput = {
  width: 744,
  height: 1133,
  coarsePointer: true,
  cores: 6,
  memoryGb: 4,
};
const LAPTOP: DeviceInput = { width: 1280, height: 800, coarsePointer: false, cores: 8, memoryGb: 16 };
const DESKTOP: DeviceInput = {
  width: 2560,
  height: 1440,
  coarsePointer: false,
  cores: 16,
  memoryGb: 32,
};

describe("classify", () => {
  it("calls a phone a phone in either orientation", () => {
    expect(classify(PHONE)).toBe("phone");
    expect(classify({ ...PHONE, width: 844, height: 390 })).toBe("phone");
  });

  it("does not demote a desktop whose window was narrowed", () => {
    // Width alone would call this a phone. A designer who narrowed their
    // window has not changed machine.
    expect(classify({ width: 700, height: 900, coarsePointer: false })).toBe("laptop");
  });

  it("uses the pointer, never a user-agent string", () => {
    // Identical geometry, opposite answers. Sniffing the agent is how a
    // product serves the phone layout to a laptop because a browser changed
    // its version string.
    const same = { width: 1024, height: 1366 };
    expect(classify({ ...same, coarsePointer: true })).toBe("tablet");
    expect(classify({ ...same, coarsePointer: false })).not.toBe("tablet");
  });
});

describe("profileFor", () => {
  it("gives a phone operating, not authoring", () => {
    const profile = profileFor(PHONE);
    expect(profile.canAuthor).toBe(false);
    expect(profile.canDock).toBe(false);
    expect(profile.touchTargets).toBe(true);
    // And says WHY, in the user's terms. A capability that vanishes without
    // explanation reads as a broken build.
    expect(profile.reason.length).toBeGreaterThan(10);
    expect(profile.reason).not.toMatch(/viewport|breakpoint|px|pointer:/i);
  });

  it("lets a large tablet author, and a small one not", () => {
    expect(profileFor(TABLET).canAuthor).toBe(true);
    expect(profileFor(SMALL_TABLET).canAuthor).toBe(false);
  });

  it("measures the width for docks, not the longer edge", () => {
    // Docks are on the left and the right. A portrait tablet 744 wide has no
    // room for them however tall it is, and measuring its long edge said it
    // did — which would have put two panels either side of a 200px stage.
    expect(profileFor({ width: 744, height: 1600, coarsePointer: true }).canDock).toBe(false);
    expect(profileFor({ width: 1200, height: 800, coarsePointer: true }).canDock).toBe(true);
  });

  it("grows the controls wherever the pointer is a finger", () => {
    expect(profileFor(TABLET).touchTargets).toBe(true);
    expect(profileFor(LAPTOP).touchTargets).toBe(false);
  });

  it("keeps authoring on a laptop even in a narrow window, but drops the docks", () => {
    const narrow = profileFor({ width: 820, height: 900, coarsePointer: false });
    expect(narrow.canAuthor).toBe(true);
    expect(narrow.canDock).toBe(false);
  });
});

describe("suggestTier", () => {
  it("starts a phone on Low whatever it claims about its cores", () => {
    // Thermal limits, not core count, decide what a phone sustains.
    expect(suggestTier({ ...PHONE, cores: 16, memoryGb: 16 })).toBe("low");
  });

  it("puts a workstation on High and a modest laptop in the middle", () => {
    expect(suggestTier(DESKTOP)).toBe("high");
    expect(suggestTier({ ...LAPTOP, cores: 6, memoryGb: 8 })).toBe("mid");
  });

  it("is conservative when the browser tells it nothing", () => {
    // A machine faster than expected costs one click. A machine slower than
    // expected costs a stuttering first impression.
    expect(suggestTier({ width: 1440, height: 900, coarsePointer: false })).toBe("low");
  });

  it("is overridden by an explicit choice", () => {
    expect(resolveTier("high", PHONE)).toBe("high");
    expect(resolveTier("auto", PHONE)).toBe("low");
  });
});

describe("what a preset may touch", () => {
  it("never changes what goes to air", () => {
    // The expensive rule. A feed that softened because the operator's laptop
    // was warm would be the worst bug this product could ship.
    for (const tier of TIERS) {
      const options = programOptions(PRESETS[tier]);
      expect(options.pixelRatio, tier).toBe(1);
      expect(options.antialias, tier).toBe(false);
    }
  });

  it("does change the preview", () => {
    expect(previewOptions(PRESETS.low, 1).pixelRatio).toBeLessThan(1);
    expect(previewOptions(PRESETS.high, 1).antialias).toBe(true);
  });

  it("never renders more pixels than the display can show", () => {
    // On a 2x display, scale 1 already means one rendered pixel per CSS pixel.
    expect(previewOptions(PRESETS.high, 1).pixelRatio).toBe(1);
    expect(previewOptions(PRESETS.mid, 3).pixelRatio).toBe(1);
  });

  it("never scales the preview into unreadability", () => {
    expect(
      previewOptions({ ...PRESETS.low, renderScale: 0.01 }, 2).pixelRatio,
    ).toBeGreaterThanOrEqual(0.35);
  });

  it("orders the tiers so each is genuinely cheaper than the next", () => {
    expect(PRESETS.low.renderScale).toBeLessThan(PRESETS.mid.renderScale);
    expect(PRESETS.low.gridSpacing).toBeGreaterThan(PRESETS.mid.gridSpacing);
    expect(PRESETS.mid.gridExtent).toBeLessThan(PRESETS.high.gridExtent);
    expect(PRESETS.low.maxBytes).toBeLessThan(PRESETS.mid.maxBytes);
    expect(PRESETS.mid.maxBytes).toBeLessThan(PRESETS.high.maxBytes);
  });

  it("resolves settings straight from a choice and a device", () => {
    expect(settingsFor("auto", PHONE)).toBe(PRESETS.low);
    expect(settingsFor("high", PHONE)).toBe(PRESETS.high);
  });
});

describe("FrameMeter", () => {
  const fill = (meter: FrameMeter, ms: number, count: number): void => {
    for (let i = 0; i < count; i += 1) meter.record(ms);
  };

  it("reports nothing before it has seen a frame", () => {
    const report = new FrameMeter().report(PRESETS.mid);
    expect(report.sampled).toBe(0);
    expect(report.strained).toBe(false);
  });

  it("measures a comfortable machine as comfortable", () => {
    const meter = new FrameMeter(60);
    fill(meter, 16, 60);
    const report = meter.report(PRESETS.mid);
    expect(report.fps).toBeGreaterThan(58);
    expect(report.strained).toBe(false);
  });

  it("reports the 95th percentile, not just the mean", () => {
    // A viewport that runs at 60 and hitches once a second reads as broken
    // while averaging perfectly well. The mean cannot see this; the
    // percentile is what matches what somebody watching actually feels.
    const meter = new FrameMeter(100);
    fill(meter, 10, 95);
    fill(meter, 120, 5);
    const report = meter.report(PRESETS.mid);
    expect(report.fps).toBeGreaterThan(40);
    expect(report.worstMs).toBeGreaterThan(100);
  });

  it("forgives a frame that lands a whisker late", () => {
    // 1.25x budget. Counting these would report strain on a machine that is
    // comfortably keeping up.
    const meter = new FrameMeter(60);
    fill(meter, 1000 / 60 + 1, 60);
    expect(meter.report(PRESETS.mid).missed).toBe(0);
  });

  it("calls out a machine that is genuinely struggling", () => {
    const meter = new FrameMeter(60);
    fill(meter, 45, 60);
    const report = meter.report(PRESETS.mid);
    expect(report.strained).toBe(true);
    expect(report.fps).toBeLessThan(30);
  });

  it("does not call strain from a single hitch", () => {
    // Reacting to noise is how a quality setting ends up flickering.
    const meter = new FrameMeter(60);
    fill(meter, 16, 59);
    meter.record(400);
    expect(meter.report(PRESETS.mid).strained).toBe(false);
  });

  it("waits for a real sample before judging anything", () => {
    const meter = new FrameMeter(60);
    fill(meter, 500, 4);
    expect(meter.report(PRESETS.mid).strained).toBe(false);
  });

  it("ignores impossible frame times rather than poisoning the average", () => {
    const meter = new FrameMeter(10);
    meter.record(Number.NaN);
    meter.record(-5);
    meter.record(0);
    expect(meter.samples).toBe(0);
  });

  it("judges against the tier's own target, not a fixed 60", () => {
    // 30ms is a missed frame at 60fps and a comfortable one at 30.
    const meter = new FrameMeter(60);
    fill(meter, 30, 60);
    expect(meter.report(PRESETS.mid).strained).toBe(true);
    expect(meter.report(PRESETS.low).strained).toBe(false);
  });
});

describe("lowerTier", () => {
  it("steps down and stops at the bottom", () => {
    expect(lowerTier("high")).toBe("mid");
    expect(lowerTier("mid")).toBe("low");
    expect(lowerTier("low")).toBeNull();
  });
});
