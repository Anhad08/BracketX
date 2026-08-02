import { useEffect, useRef, useState } from "react";

import type { ProgramBus } from "../studio/program";

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
  readonly canvas: HTMLCanvasElement;
  readonly revision: number;
}

export function ProgramRow({ bus, canvas, revision }: ProgramRowProps) {
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

  const pending = bus.pending;

  return (
    <section className="program-row" aria-label="Preview and Program" data-testid="program-row">
      <div className="program-monitor">
        <header>
          <span className={`tally ${bus.onAir ? "on-air" : ""}`} data-testid="tally">
            {bus.state === "on-air" ? "ON AIR" : bus.state === "holding" ? "HOLD" : "OFF"}
          </span>
          <strong>Program</strong>
          <span className="dim mono">
            f{bus.program.frame}
            {bus.playing === null ? "" : ` · ${bus.playing}`}
          </span>
        </header>
        <div className="program-canvas" ref={mount} data-testid="program-canvas" />
      </div>

      <div className="program-controls">
        <button
          type="button"
          className={`take ${pending ? "pending" : ""}`}
          onClick={() => bus.take()}
          data-testid="take"
          title="Send Preview to Program and play the entrance"
        >
          TAKE
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => bus.cut()}
          data-testid="cut"
          title="Send Preview to Program with no animation"
        >
          Cut
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => bus.auto()}
          title="Take, then arm the exit for Continue"
        >
          Auto
        </button>
        <button
          type="button"
          className="chip"
          disabled={!bus.onAir}
          onClick={() => bus.hold()}
          title="Freeze where it is. Pauses rather than rewinds."
        >
          Hold
        </button>
        <button
          type="button"
          className="chip"
          disabled={!bus.onAir}
          onClick={() => bus.continue()}
          title="Resume a hold, or play the exit"
        >
          Continue
        </button>
        <button
          type="button"
          className="chip danger"
          disabled={!bus.onAir}
          onClick={() => bus.clear()}
          title="Clear the surface"
        >
          Clear
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
