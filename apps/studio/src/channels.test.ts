import { describe, expect, it, vi } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { StudioSession } from "./studio/session";
import { newDocument } from "./studio/project";
import { testIdFactory } from "./studio/ids";
import { ProgramBus } from "./studio/program";
import { CHANNELS, type ChannelId } from "./studio/channels";

function harness() {
  const ids = testIdFactory();
  const preview = new StudioSession(new MockMirrorBackend(), newDocument("Preview", ids));
  const make = vi.fn(
    (id: ChannelId) => new StudioSession(new MockMirrorBackend(), newDocument(id, ids)),
  );
  return { preview, make, bus: new ProgramBus(preview, make) };
}

describe("channels", () => {
  it("composites bottom to top, and names roles rather than numbers", () => {
    expect(CHANNELS).toEqual(["background", "lower", "upper", "overlay"]);
  });

  it("builds a channel's session on first use and never again", () => {
    const { bus, make } = harness();
    expect(make).not.toHaveBeenCalled();

    const first = bus.channel("lower");
    const second = bus.channel("lower");

    expect(first).toBe(second);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith("lower");
  });

  it("does not build channels nobody has used", () => {
    const { bus, make } = harness();
    bus.channel("lower");
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).not.toHaveBeenCalledWith("overlay");
  });
});

describe("a channel is addressed by name", () => {
  it("refuses to cue a channel that is already on air", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.cue("lower");
    expect(bus.stateOf("lower")).toBe("on-air");
  });

  it("arms and disarms one channel without touching another", () => {
    const { bus } = harness();
    bus.cue("upper");
    expect(bus.stateOf("upper")).toBe("cued");
    expect(bus.stateOf("lower")).toBe("off-air");

    bus.uncue("upper");
    expect(bus.stateOf("upper")).toBe("off-air");
  });

  it("holds and resumes per channel", () => {
    const { bus } = harness();
    bus.take("overlay");
    bus.hold("overlay");
    expect(bus.stateOf("overlay")).toBe("holding");
    bus.continue("overlay");
    expect(bus.stateOf("overlay")).toBe("on-air");
  });
});

describe("channels are independent", () => {
  it("taking to one layer leaves another's aired content untouched", () => {
    const { bus } = harness();

    bus.take("lower");
    // A DIFFERENT session per channel is the thing that makes independence
    // possible — one runtime cannot be at two frames.
    expect(bus.channel("lower")).not.toBe(bus.channel("upper"));

    bus.take("upper");

    // The whole feature, in one assertion: lower is STILL on air.
    expect(bus.stateOf("lower")).toBe("on-air");
    expect(bus.stateOf("upper")).toBe("on-air");
  });

  it("reports what is live in compositing order", () => {
    const { bus } = harness();
    bus.take("overlay");
    bus.take("background");
    bus.take("lower");
    expect(bus.live).toEqual(["background", "lower", "overlay"]);
  });

  it("clearing one layer leaves the others live", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.take("upper");

    bus.clear("upper");

    expect(bus.stateOf("upper")).toBe("off-air");
    expect(bus.stateOf("lower")).toBe("on-air");
    expect(bus.onAir).toBe(true);
  });

  it("clearing one layer does not disturb another's clock", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.take("upper");
    const lowerSession = bus.channel("lower");

    bus.clear("upper");

    // `clear` stops ITS session only. A shared runtime would have rewound the
    // lower third to frame zero mid-show.
    expect(lowerSession.disposed).toBe(false);
    expect(bus.stateOf("lower")).toBe("on-air");
  });

  it("is on air while ANY channel is live, and not for a mere cue", () => {
    const { bus } = harness();
    expect(bus.onAir).toBe(false);
    bus.cue("lower");
    expect(bus.onAir).toBe(false);
    bus.take("lower");
    expect(bus.onAir).toBe(true);
  });

  it("panic takes every channel off air at once", () => {
    const { bus } = harness();
    bus.take("background");
    bus.take("lower");
    bus.take("upper");

    bus.clearAll();

    expect(bus.live).toEqual([]);
    expect(bus.onAir).toBe(false);
  });

  it("a show runs from its first take to going off air, across channels", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.take("upper");
    expect(bus.takes).toBe(2);

    // Clearing ONE layer has not ended the show.
    bus.clear("upper");
    expect(bus.wentOffAt).toBeNull();

    bus.clearAll();
    expect(bus.wentOffAt).not.toBeNull();
  });
});
