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

export interface ProductionProps {
  readonly session: StudioSession | null;
  readonly bus: ProgramBus | null;
  readonly programCanvas: HTMLCanvasElement | null;
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

export function Production({
  session,
  bus,
  art,
  onPlay,
  onStop,
  programCanvas,
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
  const cued = bus?.cued ?? false;
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
          {bus?.cueStale === true ? (
            <span className="stale" data-testid="cue-stale">
              changed since you cued it
            </span>
          ) : null}
        </span>
      </header>

      {session === null || bus === null || programCanvas === null ? (
        <p className="note pad">Open a scene to cue it.</p>
      ) : (
        <>
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
            previewCanvas={previewCanvas}
            programCanvas={programCanvas}
            revision={revision}
            onOffAir={onOffAir}
            onTake={() => bus.take()}
            onCue={() => (bus.cued ? bus.uncue() : bus.cue())}
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
