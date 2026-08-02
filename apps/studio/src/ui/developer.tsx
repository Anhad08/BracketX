import { useMemo } from "react";

import type { StudioSession } from "../studio/session";

/**
 * Developer Mode.
 *
 * ============================================================================
 * NOTHING IS DELETED. IT IS NO LONGER THE PRODUCT
 * ============================================================================
 * Every engine concept Phase 4 removed from the commercial interface lives
 * here, named exactly as an engineer expects: the mirror, projection reports,
 * backend writes, dirty channels, the glyph atlas, resource counts.
 *
 * The engineering workbench (`apps/showcase`) remains the deep instrument —
 * 324 tests, replay, stress sweeps, alerting, diffing. This panel is not a
 * replacement for it. It answers the narrower question an engineer has while
 * standing in the PRODUCT: *what is the engine doing with the graphic that is
 * open right now?*
 *
 * ============================================================================
 * IT COSTS NOTHING WHEN IT IS OFF
 * ============================================================================
 * This component is only rendered when the section is `developer`, and the
 * numbers are read on render rather than polled. There is no interval, no
 * subscription and no per-frame work — a diagnostic that becomes part of the
 * load it is measuring is the specific failure the workbench documented, and
 * the rule carries over.
 */

export interface DeveloperPanelProps {
  readonly session: StudioSession | null;
  readonly revision: number;
}

export function DeveloperPanel({ session, revision }: DeveloperPanelProps) {
  const stats = useMemo(() => {
    if (session === null) return null;
    const reconciler = session.host.reconciler;
    const report = session.host.lastReport;
    const text = session.host.text;
    return {
      mirror: reconciler.stats(),
      report,
      dependencies: reconciler.projector.dependencies,
      textStats:
        text !== null && "stats" in text && typeof text.stats === "function"
          ? (text.stats as () => Record<string, unknown>)()
          : null,
      frame: session.frame,
      playing: session.playing,
      states: session.host.activeStates,
      clips: session.host.animator.clips.map((clip) => clip.id),
    };
    // `revision` is the dependency: it changes on every document edit and every
    // runtime change, which is exactly when these numbers change.
  }, [session, revision]);

  if (session === null || stats === null) {
    return (
      <div className="section-page" data-testid="developer">
        <header className="section-head">
          <h1>Developer</h1>
        </header>
        <p className="note pad">No session.</p>
      </div>
    );
  }

  const report = stats.report;

  return (
    <div className="section-page" data-testid="developer">
      <header className="section-head">
        <div>
          <h1>Developer</h1>
          <p className="lede">
            Engine internals for the graphic that is open. The full instrument is
            the engineering workbench.
          </p>
        </div>
      </header>

      <section className="home-block">
        <div className="block-head">
          <h2>Mirror</h2>
          <span className="dim">The engine&apos;s parallel scene</span>
        </div>
        <dl className="facts mono">
          <div>
            <dt>nodes</dt>
            <dd>{stats.mirror.mirrorNodes}</dd>
          </div>
          <div>
            <dt>created</dt>
            <dd>{stats.mirror.created}</dd>
          </div>
          <div>
            <dt>destroyed</dt>
            <dd>{stats.mirror.destroyed}</dd>
          </div>
          <div>
            <dt>dependency edges</dt>
            <dd>{stats.mirror.dependencyEdges}</dd>
          </div>
        </dl>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Last projection</h2>
          <span className="dim">
            What the most recent edit actually touched
          </span>
        </div>
        {report === null ? (
          <p className="note pad">Nothing projected yet.</p>
        ) : (
          <dl className="facts mono">
            <div>
              <dt>operations</dt>
              <dd>{report.operations}</dd>
            </div>
            <div>
              <dt>backend writes</dt>
              <dd>{report.backendWrites}</dd>
            </div>
            <div>
              <dt>nodes created</dt>
              <dd>{report.nodesCreated}</dd>
            </div>
            <div>
              <dt>nodes destroyed</dt>
              <dd>{report.nodesDestroyed}</dd>
            </div>
            <div>
              <dt>dirty transform</dt>
              <dd>{report.dirty.transform}</dd>
            </div>
            <div>
              <dt>dirty material</dt>
              <dd>{report.dirty.material}</dd>
            </div>
          </dl>
        )}
        <p className="note">
          Backend writes is the measure that matters: it is the count of things
          the renderer was actually told to change. An edit that touches one
          property and issues fifty writes is a bug.
        </p>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Runtime</h2>
        </div>
        <dl className="facts mono">
          <div>
            <dt>frame</dt>
            <dd>{stats.frame}</dd>
          </div>
          <div>
            <dt>clock</dt>
            <dd>{stats.playing ? "playing" : "paused"}</dd>
          </div>
          <div>
            <dt>active states</dt>
            <dd>{stats.states.length === 0 ? "—" : stats.states.join(", ")}</dd>
          </div>
          <div>
            <dt>clips</dt>
            <dd>{stats.clips.length === 0 ? "—" : stats.clips.join(", ")}</dd>
          </div>
        </dl>
      </section>

      {stats.textStats !== null ? (
        <section className="home-block">
          <div className="block-head">
            <h2>Text</h2>
            <span className="dim">Glyph atlas and layout caches</span>
          </div>
          <pre className="dump mono" data-testid="dev-text">
            {JSON.stringify(stats.textStats, null, 2)}
          </pre>
        </section>
      ) : null}

      <p className="note pad">
        Deeper instrumentation — replay, stress sweeps, spike detection, backend
        conformance — lives in the engineering workbench, which remains a
        separate internal application.
      </p>
    </div>
  );
}
