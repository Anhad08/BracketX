/**
 * The layers a show goes out on.
 *
 * ============================================================================
 * NAMED BY ROLE, NOT NUMBERED
 * ============================================================================
 * An operator says "kill the ticker", never "kill layer three". Numbering
 * would also make the compositing order a thing to remember rather than a
 * thing to read.
 *
 * Four is a decision, not a limit discovered later: each channel is a full
 * session with its own clock, and the frame budget is measured against this
 * count before the interface offers it.
 */
import type { StudioSession } from "./session";

export type ChannelId = "background" | "lower" | "upper" | "overlay";

/** Compositing order, BOTTOM FIRST. The array order is the z-order. */
export const CHANNELS: readonly ChannelId[] = [
  "background",
  "lower",
  "upper",
  "overlay",
];

/** What a channel is FOR, in the words an operator would use. */
export const CHANNEL_HINTS: Readonly<Record<ChannelId, string>> = {
  background: "Stings and full-frame beds",
  lower: "Name straps and score bugs",
  upper: "Tickers and breaking bands",
  overlay: "Countdowns and clocks",
};

/**
 * Builds a channel's session.
 *
 * Injected rather than constructed here so a test can hand over a mock and the
 * shell can hand over a real canvas. The bus must not know how a session is
 * made — it only knows when one is needed.
 */
export type ChannelFactory = (id: ChannelId) => StudioSession;
