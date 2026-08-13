import { useEffect, useRef, useState } from "react";

import type { ProgramBus } from "../studio/program";
import { CHANNELS, type ChannelId } from "../studio/channels";

/**
 * PREVIEW and PROGRAM, side by side.
 *
 * ============================================================================
 * THE TWO MONITORS ARE THE PRODUCT'S MOST IMPORTANT SCREEN
 * ============================================================================
 * A gallery is two pictures and one decision between them. Everything else on
 * this page supports that: you look at what is armed, you look at what is out,
 * and you press one key.
 *
 * Studio showed ONE monitor — Program — which meant the operator could see
 * what was already on air and not what they were about to send. That is the
 * wrong half. Preview is the one you study; Program is the one you glance at.
 *
 * ============================================================================
 * WHAT EACH STATE IS ALLOWED TO CHANGE
 * ============================================================================
 * The states are specified precisely, and the discipline is in what does NOT
 * move:
 *
 *   CUE    the preview monitor gains a teal edge and its lamp lights. The
 *          program monitor does not change in any way, because nothing has
 *          happened to the show. Cue is fully reversible, so it needs no
 *          confirmation, no warning and no guard — and it says so by being
 *          quiet.
 *
 *   TAKE   the program monitor takes the red edge, the strip across the top
 *          ignites, and the clock starts. The cut has already happened; every
 *          one of those is REPORTING it, and none of them may delay it.
 *
 *   OFF    preview goes away entirely and the closure states what the show
 *          actually did — how long it ran and how many graphics went out.
 *
 * `CLEAN` is the broadcast word for a program feed carrying nothing. It is
 * used rather than "off" or "empty" because it is what an operator would say,
 * and because a clean feed is a legitimate thing to be transmitting.
 */

export interface MonitorsProps {
  readonly bus: ProgramBus;
  /**
   * Which layer this monitor's controls address.
   *
   * The tally still reads `bus.onAir`, which genuinely means "anything at all
   * is out" — but Cue, Take and Clear act on ONE layer, and a control that
   * silently addressed whichever layer happened to be first would be the worst
   * kind of wrong on a live desk.
   */
  readonly channel: ChannelId;
  /** The canvas the design session draws into. Moved here while Production is open. */
  readonly previewCanvas: HTMLCanvasElement | null;
  /** Borrows a channel's canvas. Owned by the shell, never by a component. */
  readonly canvasFor: (id: ChannelId) => HTMLCanvasElement;
  readonly revision: number;
  readonly onOffAir: () => void;
  readonly onTake: () => void;
  readonly onCue: () => void;
}

/** `hh:mm:ss` from milliseconds. Broadcast timecode is never a decimal. */
function timecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** `h:mm:ss` — a duration reads differently from a running clock. */
function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

export function Monitors({
  bus,
  channel,
  previewCanvas,
  canvasFor,
  revision,
  onOffAir,
  onTake,
  onCue,
}: MonitorsProps) {
  const previewMount = useRef<HTMLDivElement | null>(null);
  const programMount = useRef<HTMLDivElement | null>(null);
  const [, bump] = useState(0);

  // The canvases are created ONCE and moved, never recreated: a backend binds
  // to its canvas for the session's lifetime (MirrorBackend C2), so a canvas
  // that mounted with this component would tear down a mirror — the on-air one
  // — every time somebody opened this page.
  //
  // THE STACK IS THE COMPOSITE. Every live layer's canvas is appended in
  // `CHANNELS` order, so DOM order is z-order is compositing order — one rule,
  // three places it has to agree, expressed once by this loop rather than
  // three times by three conventions that can drift apart.
  useEffect(() => {
    const host = programMount.current;
    if (host === null) return;
    for (const id of CHANNELS) {
      if (!bus.live.includes(id)) continue;
      const surface = canvasFor(id);
      // `appendChild` on a node already present MOVES it, which is what keeps
      // the order correct when a lower layer is taken after a higher one.
      host.appendChild(surface);
    }
  }, [bus, canvasFor, revision]);

  /** A layer that has left air must leave the stack, or it keeps compositing. */
  useEffect(() => {
    const host = programMount.current;
    if (host === null) return;
    for (const id of CHANNELS) {
      if (bus.live.includes(id)) continue;
      const surface = canvasFor(id);
      if (surface.parentElement === host) host.removeChild(surface);
    }
  }, [bus, canvasFor, revision]);

  useEffect(() => {
    const host = previewMount.current;
    if (host !== null && previewCanvas !== null && previewCanvas.parentElement !== host) {
      host.appendChild(previewCanvas);
    }
  }, [previewCanvas]);

  useEffect(() => bus.subscribe(() => bump((value) => value + 1)), [bus]);

  /**
   * Both monitors keep drawing while this page is open.
   *
   * The stage owns a render loop and it is unmounted here, so without this the
   * preview monitor would show whatever frame happened to be left in the
   * buffer — a still picture that looks like a working preview, which is worse
   * than a blank one. The clock also has to advance for the timecode to be
   * true rather than decorative.
   */
  useEffect(() => {
    let handle = 0;
    const frame = () => {
      handle = requestAnimationFrame(frame);
      bus.preview.render();
      // OFF AIR MEANS NOTHING IS GOING OUT, and the monitor has to show that.
      //
      // `clear()` rewinds the programme clock but the last frame stays in the
      // buffer, so continuing to draw would leave the graphic sitting on a
      // feed that is no longer transmitting it. That is the one picture on
      // this screen that must never be wrong: an operator glancing at a
      // monitor showing a lower third has every reason to believe it is out.
      //
      // A clean feed is black. So the programme monitor stops being drawn.
      //
      // EVERY live layer, not just this monitor's: each has its own clock, and
      // a ticker that stopped advancing because a score bug happened to own the
      // controls would be frozen on air.
      for (const id of bus.live) bus.channel(id).render();
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [bus]);

  /** Wipes a layer's surface the moment it stops transmitting. */
  useEffect(() => {
    for (const id of CHANNELS) {
      if (bus.live.includes(id)) continue;
      const surface = canvasFor(id);
      const context = surface.getContext("webgl2") ?? surface.getContext("webgl");
      if (context === null) continue;
      context.clearColor(0, 0, 0, 0);
      context.clear(context.COLOR_BUFFER_BIT);
    }
  }, [bus, canvasFor, revision]);

  // The timecode is read from the bus, which owns the run. A second clock here
  // would drift from the one the closure reports.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!bus.onAir) return;
    const timer = setInterval(() => tick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, [bus, bus.onAir]);

  const live = bus.onAir;
  const cued = bus.cuedOn(channel);
  const closed = !live && bus.wentOffAt !== null;

  return (
    <section
      className={`monitors ${live ? "live" : ""} ${closed ? "closed" : ""}`}
      aria-label="Preview and Program"
      data-testid="monitors"
      data-air={live ? "live" : cued ? "cued" : "off"}
    >
      {/* THE STRIP. One row across both monitors, so the two states are read
          in a single glance rather than hunted for in two places. It takes the
          live colour along its whole length — the same tally the spine
          carries, at the place the operator is already looking.

          EACH HALF BELONGS TO ITS OWN MONITOR. They shared one line to begin
          with — "PREVIEW READY PROGRAM 00:00:00" ran together as a single
          sentence, and an operator glancing at it had to work out which word
          described which picture. Now the label sits at the left of its
          monitor and the state at the right of the same monitor, so the
          reading is unambiguous at a glance from across a gallery. */}
      <header className="mon-strip">
        {closed ? null : (
          <span className="mon-head">
            <span className="mon-label" data-testid="preview-label">
              <span className={`lamp ${cued ? "pvw" : ""}`} aria-hidden />
              PREVIEW
            </span>
            <span className="mon-state" data-testid="preview-state">
              {cued ? "CUED" : "READY"}
            </span>
          </span>
        )}
        <span className="mon-head">
          <span className="mon-label program" data-testid="program-label">
            <span className={`lamp ${live ? "live" : ""}`} aria-hidden />
            PROGRAM
          </span>
          <span className="mon-clock" data-testid="program-state">
            {live || closed ? timecode(bus.elapsed()) : "CLEAN"}
          </span>
        </span>
      </header>

      <div className="mon-row">
        {/* PREVIEW. Gone once the show has ended — there is nothing to arm. */}
        {closed ? null : (
          <div
            className={`mon preview ${cued ? "cued" : ""}`}
            data-testid="monitor-preview"
            data-cued={cued ? "yes" : "no"}
          >
            <div className="mon-face" ref={previewMount} />
            {/* TWO DIFFERENT FACTS, and an operator needs both.
                `cueStale` — somebody edited the graphic AFTER it was armed, so
                what you take is not what you checked. Amber, because it is a
                thing to look at before pressing anything.
                `pending` — Preview differs from what is currently ON AIR, so
                there is something to send. Quiet, because it is the normal
                state of an operator doing their job. */}
            {bus.cueStaleOn(channel) ? (
              <span className="mon-note warn" data-testid="cue-stale-monitor">
                Changed since you cued it
              </span>
            ) : bus.pendingOn(channel) ? (
              <span className="mon-note" data-testid="pending-note">
                Preview differs from what is on air
              </span>
            ) : null}
          </div>
        )}

        {/* PROGRAM. The red edge arrives with the cut, never before it. */}
        <div
          className={`mon program ${live ? "live" : ""}`}
          data-testid="monitor-program"
          data-live={live ? "yes" : "no"}
        >
          <div className="mon-face" ref={programMount} data-testid="program-monitor" />

          {/* THE KEY, on the monitor it acts on. It is the one primary control
              on this screen, and it sits over Program because that is where
              the consequence lands. */}
          {closed ? null : (
            <button
              type="button"
              className={`take-key ${bus.pendingOn(channel) ? "pending" : ""}`}
              data-testid="take"
              onClick={onTake}
              title="Send Preview to Program"
            >
              TAKE
              <span className="kbd-inline">⏎</span>
            </button>
          )}
        </div>
      </div>

      {/* CLOSURE. What the show actually did, counted by the thing that did
          it. Shown only after a transmission has ended, so an operator who
          never took anything is not offered a report on a show that did not
          happen. */}
      {closed ? (
        <footer className="mon-closure" data-testid="closure">
          <div>
            <strong>
              Off air at{" "}
              {new Date(bus.wentOffAt!).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
            <span className="dim tiny">{bus.channel(channel).document.meta.name}</span>
          </div>
          <dl className="closure-facts mono">
            <div>
              <dt>Duration</dt>
              <dd data-testid="closure-duration">{duration(bus.elapsed())}</dd>
            </div>
            <div>
              <dt>Takes</dt>
              <dd data-testid="closure-takes">{bus.takes}</dd>
            </div>
          </dl>
        </footer>
      ) : (
        <footer className="mon-controls">
          <button
            type="button"
            className={`chip cue ${cued ? "armed" : ""}`}
            data-testid="cue"
            data-armed={cued ? "yes" : "no"}
            disabled={live}
            onClick={onCue}
            title={
              live
                ? "Already on air. Go off air before cueing something else."
                : cued
                  ? "Disarm (Esc)"
                  : "Arm this for the next Take (C)"
            }
          >
            {cued ? "CUED" : "Cue"}
          </button>
          {/* CUT — a take with no entrance. Two words an operator uses for two
              different acts, so both exist. It sits beside Cue rather than on
              the monitor because TAKE is the one primary key on this screen
              and a second key of equal weight would make neither primary. */}
          <button
            type="button"
            className="chip"
            data-testid="cut"
            onClick={() => bus.cut(channel)}
            title="Send Preview to Program with no entrance animation"
          >
            Cut
          </button>
          <button
            type="button"
            className="chip"
            disabled={!live}
            onClick={() => bus.hold(channel)}
            title="Freeze where it is. Pauses rather than rewinds."
          >
            Hold
          </button>
          <button
            type="button"
            className="chip"
            disabled={!live}
            onClick={() => bus.continue(channel)}
            title="Resume a hold, or play the exit"
          >
            Continue
          </button>
          <span className="sp" />
          <button
            type="button"
            className="offair"
            disabled={!live}
            data-testid="off-air"
            onClick={() => {
              bus.clear(channel);
              onOffAir();
            }}
            title="Stop sending to air"
          >
            OFF AIR
          </button>
          <span className="hidden-input" aria-hidden>
            {revision}
          </span>
        </footer>
      )}
    </section>
  );
}
