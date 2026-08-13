/**
 * Production — where scenes go to air.
 *
 * ==========================================================================
 * WHY THIS IS NOT PART OF DESIGN
 * ==========================================================================
 * Going to air sat on the design surface, which put a control that starts a
 * transmission next to a control that nudges a rectangle. Those are not the
 * same class of act and should not share a neighbourhood: one is undoable and
 * private, the other is neither.
 *
 * They also belong to different people. Design is the advanced surface — the
 * place a graphic is BUILT. Production is where somebody who did not build it
 * picks it, checks it, and puts it out. That person needs a list of scenes, a
 * picture of what is going out, and two unmistakable buttons. They do not need
 * a layer tree.
 *
 * ==========================================================================
 * THE ORDER ON SCREEN IS THE ORDER OF THE ACT
 * ==========================================================================
 * Choose a scene → see it → check it → take it. Left to right, top to bottom,
 * with the state of the transmission stated in words at every step. Nothing
 * here is a mode; nothing here is behind a tab.
 */

import type { ProgramBus } from "../studio/program";
import type { StudioSession } from "../studio/session";
import type { PackTemplate } from "../studio/packs";
import { TemplateArt } from "./art";
import type { Pack } from "../studio/packs";
import { PACKS } from "../studio/packs";
import { contentSurface, preflight } from "../studio/preflight";
import { Monitors } from "./monitors";
import type { ChannelId } from "../studio/channels";

export interface ProductionProps {
  readonly session: StudioSession | null;
  readonly bus: ProgramBus | null;
  /** Borrows a channel's canvas. Owned by the shell, never by a component. */
  readonly canvasFor: (id: ChannelId) => HTMLCanvasElement;
  /** The design session's canvas, shown as the PREVIEW monitor. */
  readonly previewCanvas: HTMLCanvasElement | null;
  readonly revision: number;
  readonly installed: ReadonlySet<string>;
  /** Loads a scene ready to cue. */
  readonly onOpenScene: (template: PackTemplate) => void;
  readonly onOffAir: () => void;
  /** Rendered stills of each scene, by template id. */
  readonly art: ReadonlyMap<string, string>;
  readonly onPlay: ((templateId: string, into: HTMLCanvasElement) => void) | undefined;
  readonly onStop: (() => void) | undefined;
}

/**
 * One point up or down, in the type the document already uses.
 *
 * A scoreboard stores "0" as a string because a text node draws it. Returning
 * a number here would change the variable’s type mid-match, which the
 * binding would then have to cope with — so the step is arithmetic and the
 * shape is preserved.
 */
function stepped(current: unknown, by: number): string | number {
  const next = Math.max(0, Math.round(Number(current ?? 0)) + by);
  return typeof current === "number" ? next : String(next);
}

export function Production({
  session,
  bus,
  art,
  onPlay,
  onStop,
  canvasFor,
  previewCanvas,
  revision,
  installed,
  onOpenScene,
  onOffAir,
}: ProductionProps) {
  const scenes: { pack: Pack; template: PackTemplate }[] = PACKS.filter((pack) =>
    installed.has(pack.id),
  ).flatMap((pack) => (pack.templates ?? []).map((template) => ({ pack, template })));

  const report = session === null ? null : preflight(session.host);
  const fields = session === null ? [] : contentSurface(session.host);
  const onAir = bus?.onAir ?? false;
  const cued = bus?.cuedOn("lower") ?? false;
  // THREE states, not two. Off, armed, out. The middle one is what the Cue key
  // is for, and Studio had no way to say it.
  const air = onAir ? "live" : cued ? "cued" : "off";
  const airWords = onAir ? "ON AIR" : cued ? "CUED" : "Off air";

  return (
    <div className="section-page production" data-testid="production">
      <header className="section-head">
        <div>
          <h1>Production</h1>
          <p className="lede">Choose a scene, check it, and put it on air.</p>
        </div>
        {/* The state of the transmission, in words, at the top of the page
            that controls it. A tally the operator has to hunt for is a tally
            that gets misread. */}
        <span className={`air-state ${air}`} data-testid="air-state" data-air={air}>
          <span className={`lamp ${onAir ? "live" : cued ? "pvw" : ""}`} aria-hidden />
          {airWords}
          {/* An operator who cued a graphic and then had somebody edit it is
              about to air something they did not check. Silence here is the
              expensive option. */}
          {bus?.cueStaleOn("lower") === true ? (
            <span className="stale" data-testid="cue-stale">
              changed since you cued it
            </span>
          ) : null}
        </span>
      </header>

      {session === null || bus === null ? (
        <p className="note pad">Open a scene to cue it.</p>
      ) : (
        <>
          {/* ==================================================================
              THE SCORE, WHERE THE SHOW IS RUN
              ==================================================================
              An operator changing a score had to open Design, find the layer
              tree, and edit a variable in the inspector — the advanced surface,
              built for the person who BUILT the graphic, next to controls that
              nudge rectangles. Mid-match that is not a workflow, it is a hazard.

              This writes the same live values `panels.tsx` writes, through the
              same `session.overrideVariable`. There is no scoring state here:
              the runtime holds the value, the bound scene re-resolves, and the
              picture follows. A second store would be a second answer to "what
              is the score", and the one on air would eventually be the wrong
              one.

              Live values are NOT document edits — they do not enter the undo
              stack and do not persist, which is exactly right for a score that
              belongs to tonight's match and not to the template. */}
          <section className="home-block live-data" data-testid="live-data">
            <div className="block-head">
              <h2>Live</h2>
              <span className="dim">Changes go out as you make them</span>
            </div>
            {fields.length === 0 ? (
              <p className="empty">This scene carries no live values.</p>
            ) : (
              <div className="live-grid">
                {fields.map((field) => {
                  // THE LIVE VALUE, NOT THE DOCUMENT DEFAULT.
                  //
                  // `contentSurface` reports what the TEMPLATE ships. An
                  // override never touches the document, so reading from there
                  // meant every click computed its step from the original
                  // score: the first point landed, and the second recomputed
                  // 0 + 1 and set 1 again. Measured — the graphic stuck on 1
                  // however many times it was clicked.
                  const live = session.variableValue(field.key);
                  const current = live === undefined ? field.value : live;
                  // A SCORE IS A NUMBER TO THE OPERATOR, WHATEVER THE DOCUMENT
                  // CALLS IT. The scoreboard authors its scores as strings —
                  // "0", "1" — because that is what the text node draws, and a
                  // stepper gated on the declared type therefore appeared on
                  // nothing at all. What decides whether one point can be added
                  // is whether the value IS a count, not how it is stored.
                  const numeric =
                    field.type === "number" ||
                    typeof current === "number" ||
                    (typeof current === "string" && /^\d+$/.test(current.trim()));
                  return (
                    <div
                      className={`live-field${numeric ? " numeric" : ""}`}
                      key={field.key}
                      data-testid={`live-${field.key}`}
                    >
                      <label htmlFor={`live-input-${field.key}`}>
                        {field.label}
                        {field.overridden ? (
                          <span className="badge tiny" data-testid={`live-changed-${field.key}`}>
                            changed
                          </span>
                        ) : null}
                      </label>
                      <div className="live-controls">
                        {/* A SCORE GOES UP BY ONE FAR MORE OFTEN THAN IT IS
                            TYPED. One button, one point — the common act costs
                            one click, and the field is still there for a
                            correction or a jump. */}
                        {numeric ? (
                          <button
                            type="button"
                            className="chip"
                            data-testid={`live-down-${field.key}`}
                            aria-label={`${field.label} down one`}
                            onClick={() =>
                              session.overrideVariable(
                                field.key,
                                Math.max(0, Number(current ?? 0) - 1),
                              )
                            }
                          >
                            −
                          </button>
                        ) : null}
                        <input
                          id={`live-input-${field.key}`}
                          className="field"
                          type={numeric ? "number" : "text"}
                          value={current === undefined || current === null ? "" : String(current)}
                          onChange={(event) =>
                            session.overrideVariable(
                              field.key,
                              typeof current === "number"
                                ? Number(event.target.value || 0)
                                : event.target.value,
                            )
                          }
                        />
                        {numeric ? (
                          <button
                            type="button"
                            className="chip primary"
                            data-testid={`live-up-${field.key}`}
                            aria-label={`${field.label} up one`}
                            onClick={() =>
                              session.overrideVariable(field.key, stepped(current, 1))
                            }
                          >
                            +
                          </button>
                        ) : null}
                        {/* THE WAY BACK. A live value is not undoable — it never
                            entered the history — so a mistyped score needs its
                            own correction, and it is the template's value that
                            it goes back to. */}
                        {field.overridden ? (
                          <button
                            type="button"
                            className="link"
                            data-testid={`live-reset-${field.key}`}
                            onClick={() => session.resetVariable(field.key)}
                          >
                            Reset
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* WHAT IS ABOUT TO GO OUT, before the button that sends it. */}
          <section className="home-block">
            <div className="block-head">
              <h2>Check</h2>
              <span className="dim">{fields.length} fields · before you take it</span>
            </div>
            {report === null || report.clear ? (
              <p className="note ok" data-testid="production-clear">
                Ready. Nothing to report.
              </p>
            ) : (
              <ul className="checks" data-testid="production-issues">
                {report.issues.map((issue) => (
                  <li key={`${issue.nodeId ?? issue.label}:${issue.kind}`}>
                    <strong>{issue.label}</strong>
                    <span className="dim"> {issue.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Monitors
            bus={bus}
            channel="lower"
            previewCanvas={previewCanvas}
            canvasFor={canvasFor}
            revision={revision}
            onOffAir={onOffAir}
            onTake={() => bus.take("lower")}
            onCue={() => (bus.cuedOn("lower") ? bus.uncue("lower") : bus.cue("lower"))}
          />
        </>
      )}
      <section className="home-block">
        <div className="block-head">
          <h2>Scenes</h2>
          <span className="dim">Ready to cue</span>
        </div>
        {scenes.length === 0 ? (
          <p className="empty">
            No scenes installed yet. Anything you add from the Marketplace
            appears here, ready to go out.
          </p>
        ) : (
          <div className="scene-grid">
            {scenes.map(({ pack, template }) => (
              <button
                key={template.id}
                type="button"
                className="scene-tile"
                data-testid={`cue-${template.id}`}
                onClick={() => onOpenScene(template)}
                title={`Load ${template.name} ready to take`}
              >
                {/* THE SCENE, not a swatch of its pack's colours. Five tiles
                    wearing five gradients told an operator which PACK a scene
                    came from and nothing at all about what would go to air —
                    which is the only question being asked at this moment. */}
                {/* An operator choosing a graphic under time pressure is
                    matching a remembered picture — and half of what they
                    remember is the move. Pointing at a tile plays it. */}
                <TemplateArt
                  className="scene-art"
                  templateId={template.id}
                  still={art.get(template.id)}
                  onPlay={onPlay}
                  onStop={onStop}
                  placeholder={
                    <span
                      className="art-swatch"
                      style={{
                        background: `linear-gradient(135deg, ${pack.swatch[0]}, ${pack.swatch[1]})`,
                      }}
                    />
                  }
                />
                <strong>{template.name}</strong>
                <span className="dim tiny">{template.description}</span>
              </button>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
