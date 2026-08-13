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
