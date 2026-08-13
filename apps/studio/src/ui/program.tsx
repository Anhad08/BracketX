import { useEffect, useRef, useState } from "react";

import type { ProgramBus } from "../studio/program";
import type { ChannelId } from "../studio/channels";

/**
 * The Preview / Program row.
 *
 * ============================================================================
 * WHY THIS IS A ROW AND NOT A TAB
 * ============================================================================
 * On-air state is the one thing an operator must never have to go and find. A
 * tab can be behind another tab; a row cannot. It costs vertical space and that
 * is the correct trade — the alternative is somebody taking a graphic to air
 * while looking at a panel that does not show what is already on it.
 *
 * The buttons are the words an operator says. `Take` and `Cut` differ only in
 * whether the entrance plays, which is exactly the distinction those two words
 * carry in a gallery, and `Continue` means "carry on" — resume a hold, or play
 * the exit — because that is what the finger reaching for it expects.
 */

export interface ProgramRowProps {
  readonly bus: ProgramBus;
  /** Which layer this row addresses. */
  readonly channel: ChannelId;
  readonly canvas: HTMLCanvasElement;
  readonly revision: number;
  /** Fired after going off air, so the shell can sound the off-air voice. */
  readonly onOffAir?: () => void;
}

export function ProgramRow({ bus, channel, canvas, revision, onOffAir }: ProgramRowProps) {
  const mount = useRef<HTMLDivElement | null>(null);
  const [, bump] = useState(0);

  // The Program canvas is created once and mounted here, never recreated: the
  // backend binds to it for the session's lifetime (MirrorBackend C2), so a
  // canvas that mounted with the component would tear down the on-air mirror
  // every time this row was toggled.
  useEffect(() => {
    const host = mount.current;
    if (host === null || canvas.parentElement === host) return;
    host.appendChild(canvas);
  }, [canvas]);

  useEffect(() => bus.subscribe(() => bump((value) => value + 1)), [bus]);

  const pending = bus.pendingOn(channel);

  return (
    <section className="program-row" aria-label="Preview and Program" data-testid="program-row">
      <div className="program-monitor">
        <header>
          <span
            className={`tally ${bus.onAir ? "on-air" : ""} ${bus.cuedOn(channel) ? "cued" : ""}`}
            data-testid="tally"
          >
            {bus.stateOf(channel) === "on-air"
              ? "ON AIR"
              : bus.stateOf(channel) === "holding"
                ? "HOLD"
                : bus.stateOf(channel) === "cued"
                  ? "CUED"
                  : "OFF"}
          </span>
          <strong>Program</strong>
          <span className="dim mono">
            f{bus.channel(channel).frame}
            {bus.playingOn(channel) === null ? "" : ` · ${bus.playingOn(channel)}`}
          </span>
        </header>
        <div className="program-canvas" ref={mount} data-testid="program-canvas" />
      </div>

      <div className="program-controls">
        {/* CUE, before Take, because that is the order of the act: arm it,
            look at it, send it. Rendered `.armed` when it is armed — the one
            control on this row whose appearance states a state rather than
            offering an action. */}
        <button
          type="button"
          className={`chip cue ${bus.cuedOn(channel) ? "armed" : ""}`}
          disabled={bus.onAir}
          onClick={() => (bus.cuedOn(channel) ? bus.uncue(channel) : bus.cue(channel))}
          data-testid="cue"
          data-armed={bus.cuedOn(channel) ? "yes" : "no"}
          title={
            bus.onAir
              ? "Already on air. Go off air before cueing something else."
              : bus.cuedOn(channel)
                ? "Disarm (Esc)"
                : "Arm this for the next Take (C)"
          }
        >
          {bus.cuedOn(channel) ? "CUED" : "Cue"}
        </button>
        <button
          type="button"
          className={`take ${pending ? "pending" : ""}`}
          onClick={() => bus.take(channel)}
          data-testid="take"
          title="Send Preview to Program and play the entrance"
        >
          TAKE
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => bus.cut(channel)}
          data-testid="cut"
          title="Send Preview to Program with no animation"
        >
          Cut
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => bus.auto(channel)}
          title="Take, then arm the exit for Continue"
        >
          Auto
        </button>
        <button
          type="button"
          className="chip"
          disabled={!bus.onAir}
          onClick={() => bus.hold(channel)}
          title="Freeze where it is. Pauses rather than rewinds."
        >
          Hold
        </button>
        <button
          type="button"
          className="chip"
          disabled={!bus.onAir}
          onClick={() => bus.continue(channel)}
          title="Resume a hold, or play the exit"
        >
          Continue
        </button>
        {/* OFF AIR. It was called "Clear", which is what it does to the
            surface and not what it means to a gallery — so an operator
            looking for the way off air could not find one. The tally says ON
            AIR; the control that ends it says OFF AIR. */}
        <button
          type="button"
          className="offair"
          disabled={!bus.onAir}
          onClick={() => {
            bus.clear(channel);
            onOffAir?.();
          }}
          data-testid="off-air"
          title="Stop sending to air. The surface is cleared."
        >
          OFF AIR
        </button>

        <span className="program-note dim">
          {pending
            ? "Preview differs from what is on air."
            : "Program matches what was last taken."}
          {" "}
          Editing Preview never reaches air — only a Take does.
        </span>
        {/* `revision` is read so the row re-renders when the document changes;
            `pending` is derived from it. */}
        <span className="hidden-input" aria-hidden>
          {revision}
        </span>
      </div>
    </section>
  );
}
