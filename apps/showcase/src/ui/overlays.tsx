import type { Diagnostics } from "../engine/session";
import type { Metrics, Stat } from "../engine/metrics";
import type { Alert } from "../tools/alerts";

/**
 * The always-visible panels.
 *
 * Every number displayed here is read from a public engine API and shown
 * unmodified. The overlay computes nothing the engine already knows — a panel
 * with its own idea of the node count will eventually disagree with the engine,
 * and the panel is what gets believed.
 */

function ms(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(3);
}

function Row({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
  title?: string;
}) {
  const color =
    tone === "bad" ? "#ff6b6b" : tone === "warn" ? "#ffd166" : tone === "good" ? "#7ae582" : "#c9d1d9";
  return (
    <div className="row" title={title}>
      <span className="label">{label}</span>
      <span className="value" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function StatRow({ label, stat }: { label: string; stat: Stat }) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <span className="value stat">
        <span title="mean">{ms(stat.mean)}</span>
        <span className="dim" title="95th percentile">
          {ms(stat.p95)}
        </span>
        <span className="dim" title="worst in window">
          {ms(stat.max)}
        </span>
      </span>
    </div>
  );
}

/**
 * Findings, not numbers.
 *
 * The panel V3 exists to add. Numbers tell an engineer what is happening;
 * these tell them what is WRONG, with the evidence attached and somewhere to
 * go next. Everything here is derived by `alerts()` — a pure function over a
 * snapshot, so every line on screen is asserted in the headless suite.
 */
export function AlertsOverlay({
  alerts,
  onAction,
}: {
  alerts: readonly Alert[];
  onAction: (alert: Alert) => void;
}) {
  return (
    <section className="overlay alerts" aria-label="Diagnostics" data-testid="alerts">
      <h2>
        Findings
        {alerts.length > 0 ? <span className="dim"> {alerts.length}</span> : null}
      </h2>
      {alerts.length === 0 ? (
        <p className="dim" data-testid="alerts-empty">
          Nothing to report. Every rule that could fire is passing.
        </p>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => (
            <li key={alert.id} className={`alert ${alert.severity}`}>
              <strong>{alert.title}</strong>
              <p>{alert.detail}</p>
              {alert.action !== undefined ? (
                <button type="button" className="linkish" onClick={() => onAction(alert)}>
                  {alert.action.label} →
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DeveloperOverlay({
  diagnostics,
  onHash,
}: {
  diagnostics: Diagnostics;
  /** Computes the session hash once, on request. It is not free — see Diagnostics. */
  onHash: () => void;
}) {
  const d = diagnostics;

  return (
    <section className="overlay" aria-label="Developer diagnostics">
      <h2>Engine</h2>
      <Row label="frame" value={String(d.frame)} />
      <Row label="runtime" value={`${d.runtimeSeconds.toFixed(3)}s`} />
      <Row
        label="clock"
        value={d.playing ? "playing" : "stopped"}
        tone={d.playing ? "good" : undefined}
      />
      {/* Both hashes are on demand. Each canonicalises the whole of runtime
          state; on a 4,000-row collection that measured 5.1ms and 10.9ms
          against a 0.0016ms frame, and V2 paid it ten times a second so a
          panel could show sixteen characters nobody reads. */}
      {d.runtimeHash === null || d.sessionHash === null ? (
        <div className="row">
          <span className="label">identity</span>
          <span className="value">
            <button type="button" className="linkish" onClick={onHash}>
              compute hashes
            </button>
          </span>
        </div>
      ) : (
        <>
          <div className="row">
            <span className="label">runtime hash</span>
            <span className="value mono" title={d.runtimeHash}>
              {d.runtimeHash.slice(0, 16)}…
            </span>
          </div>
          <div className="row">
            <span className="label">session hash</span>
            <span className="value mono" title={d.sessionHash}>
              {d.sessionHash.slice(0, 16)}…
            </span>
          </div>
        </>
      )}

      <h2>Scene</h2>
      <Row label="nodes" value={String(d.nodeCount)} />
      <Row label="animated" value={String(d.animatedNodes)} />
      <Row label="states" value={d.activeStates.join(", ") || "—"} />
      <Row label="clips playing" value={d.activeClips.join(", ") || "—"} />
      <Row
        label="clips held"
        value={d.heldClips.join(", ") || "—"}
        title="A completed clip holds its final frame; only clip.stop reverts it."
      />

      <h2>Projection</h2>
      <Row label="dirty nodes" value={String(d.dirtyNodes)} />
      <Row label="backend writes" value={String(d.backendWrites)} />
      <Row label="created" value={String(d.nodesCreated)} />
      <Row label="destroyed" value={String(d.nodesDestroyed)} />

      <h2>Outputs</h2>
      {d.outputs.length === 0 ? (
        <Row label="—" value="none bound" tone="warn" />
      ) : (
        d.outputs.map((output) => (
          <div className="row" key={output.id}>
            <span className="label">{output.id}</span>
            <span className="value">
              {output.width}×{output.height}
              {output.cadence > 1 ? ` /${output.cadence}` : ""}
              <span className="dim"> {output.rendered}</span>
              {output.skipped > 0 ? (
                <span className="dim" title="skipped by cadence">
                  {" "}
                  −{output.skipped}
                </span>
              ) : null}
              {output.missed > 0 ? (
                <span style={{ color: "#ff6b6b" }} title="no camera resolved">
                  {" "}
                  !{output.missed}
                </span>
              ) : null}
            </span>
          </div>
        ))
      )}

      <h2>Commands</h2>
      <Row label="accepted" value={String(d.commandsAccepted)} tone="good" />
      <Row
        label="rejected"
        value={String(d.commandsRejected)}
        tone={d.commandsRejected > 0 ? "bad" : undefined}
      />
      <ol className="log">
        {d.recentCommands.length === 0 ? (
          <li className="dim">no commands yet</li>
        ) : (
          d.recentCommands.map((entry) => (
            <li key={entry.sequence} className={entry.accepted ? "" : "bad"}>
              <span className="dim">{entry.sequence}</span> {entry.type}
              {entry.reason ? <span className="reason"> — {entry.reason}</span> : null}
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

export function PerformanceOverlay({
  metrics,
  diagnostics,
}: {
  metrics: Metrics;
  diagnostics: Diagnostics;
}) {
  const m = metrics;
  const overBudget = m.budget > 1;
  const nearBudget = m.budget > 0.5;

  return (
    <section className="overlay" aria-label="Performance">
      <h2>Frame</h2>
      {/* Capacity, not rate: the loop is capped at the display refresh, so this
          says how much room the engine has, not how fast it is running. */}
      <Row
        label="capacity"
        value={m.capacityFps > 0 ? `${m.capacityFps.toFixed(0)} fps` : "—"}
        tone={overBudget ? "bad" : nearBudget ? "warn" : "good"}
        title="Frames per second the engine could produce. The loop is capped at the display refresh."
      />
      <Row
        label="budget"
        value={`${(m.budget * 100).toFixed(1)}%`}
        tone={overBudget ? "bad" : nearBudget ? "warn" : "good"}
      />
      <Row label="samples" value={String(m.samples)} />

      {/* mean · p95 · max. The last frame is noise; the worst one is the
          dropped frame, which is what matters on air. */}
      <h2>
        Timings <span className="dim">mean · p95 · max (ms)</span>
      </h2>
      <StatRow label="total" stat={m.total} />
      <StatRow label="runtime" stat={m.runtime} />
      <StatRow label="animation" stat={m.animation} />
      <StatRow label="render" stat={m.render} />

      <h2>Work</h2>
      <StatRow label="backend writes" stat={m.backendWrites} />
      <StatRow label="dirty nodes" stat={m.dirtyNodes} />
      <Row label="submissions" value={String(diagnostics.submissions)} />
      <Row label="frames" value={String(diagnostics.framesRendered)} />

      <p className="note">
        Render is submission time. GPU time is not visible from this side of the
        backend boundary.
      </p>
    </section>
  );
}
