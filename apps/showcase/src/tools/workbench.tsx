import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveCommandRecord } from "@bracketx/engine-host";

import type { ShowcaseSession } from "../engine/session";
import type { Metrics } from "../engine/metrics";
import {
  commandSources,
  commandTarget,
  debugBoxes,
  filterCommands,
  filterTree,
  frameForClipTime,
  inspectorTree,
  nodeDetail,
  outputRows,
  timeline,
  type DebugBox,
  type InspectorNode,
} from "./model";
import {
  SessionRecorder,
  replayRecording,
  type Recording,
  type ReplayResult,
} from "./recorder";

/**
 * The engineering workbench.
 *
 * Tools are TABS, and only the visible one reads the engine. That is the whole
 * cost strategy: a diagnostics read is 0.226ms against a 0.0007ms frame, so
 * eight panels all sampling would be the dominant cost in the process and the
 * tool would be measuring itself.
 */

export type ToolId =
  | "inspector"
  | "console"
  | "timeline"
  | "breakdown"
  | "outputs"
  | "recorder";

export const TOOLS: readonly { id: ToolId; label: string }[] = [
  { id: "inspector", label: "Inspector" },
  { id: "console", label: "Console" },
  { id: "timeline", label: "Timeline" },
  { id: "breakdown", label: "Frame" },
  { id: "outputs", label: "Outputs" },
  { id: "recorder", label: "Recorder" },
];

function ms(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(3);
}

// ---------------------------------------------------------------------------
// Scene Inspector
// ---------------------------------------------------------------------------

function Inspector({ session }: { session: ShowcaseSession }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const tree = inspectorTree(session);
  const filtered = filterTree(tree, query);

  // A collapsed node hides its descendants. Computed from depth rather than
  // parentage so a filtered tree collapses consistently.
  const visible: InspectorNode[] = [];
  let hiddenBelow: number | null = null;
  for (const node of filtered) {
    if (hiddenBelow !== null && node.depth > hiddenBelow) continue;
    hiddenBelow = null;
    visible.push(node);
    if (collapsed.has(node.id)) hiddenBelow = node.depth;
  }

  const detail = selected === null ? null : nodeDetail(session, selected);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="tool inspector">
      <div className="tool-toolbar">
        <input
          className="control-text"
          placeholder="filter by id, name, or component"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="dim">
          {filtered.length}/{tree.length}
        </span>
      </div>

      <div className="inspector-body">
        <ol className="tree" data-testid="inspector-tree">
          {visible.map((node) => (
            <li
              key={node.id}
              style={{ paddingLeft: `${node.depth * 12}px` }}
              className={node.id === selected ? "selected" : ""}
            >
              <button
                type="button"
                className="twisty"
                onClick={() => toggle(node.id)}
                disabled={node.childIds.length === 0}
                aria-label={collapsed.has(node.id) ? "expand" : "collapse"}
              >
                {node.childIds.length === 0 ? "·" : collapsed.has(node.id) ? "▸" : "▾"}
              </button>
              <button type="button" className="node" onClick={() => setSelected(node.id)}>
                <span className={node.effectiveVisible ? "" : "dim"}>{node.name}</span>
                {node.instance ? <span className="tag">instance</span> : null}
                {node.componentTypes.map((type) => (
                  <span key={type} className="tag type">
                    {type}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ol>

        <div className="detail" data-testid="inspector-detail">
          {detail === null ? (
            <p className="dim">Select a node.</p>
          ) : (
            <>
              <h3>{detail.name}</h3>
              <dl>
                <dt>id</dt>
                <dd className="mono">{detail.id}</dd>
                <dt>parent</dt>
                <dd className="mono">{detail.parentId ?? "—"}</dd>
                <dt>children</dt>
                <dd>{detail.childIds.length}</dd>
                <dt>components</dt>
                <dd>{detail.componentTypes.join(", ") || "—"}</dd>
                <dt>visible</dt>
                <dd>
                  {String(detail.visible)}
                  {detail.visible !== detail.effectiveVisible ? (
                    <span className="dim"> (effective {String(detail.effectiveVisible)})</span>
                  ) : null}
                </dd>
                <dt>world</dt>
                <dd className="mono">
                  {detail.worldPosition.map((n) => n.toFixed(3)).join(", ")}
                </dd>
                <dt>size</dt>
                <dd>{detail.size ? `${detail.size.width} × ${detail.size.height}` : "—"}</dd>
                <dt>layout</dt>
                <dd>{detail.layout ?? "—"}</dd>
                <dt>anchor</dt>
                <dd>{detail.anchor ?? "—"}</dd>
                <dt>states</dt>
                <dd>{detail.states.join(", ") || "—"}</dd>
                <dt>animated</dt>
                <dd className="mono">{detail.animatedPaths.join(", ") || "—"}</dd>
              </dl>

              <h4>Variables read</h4>
              {detail.dependencies.length === 0 ? (
                <p className="dim">none</p>
              ) : (
                <dl>
                  {detail.dependencies.map((key) => (
                    <div key={key} className="pair">
                      <dt className="mono">{key}</dt>
                      <dd className="mono">{JSON.stringify(detail.values[key])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command Console
// ---------------------------------------------------------------------------

function Console({ session }: { session: ShowcaseSession }) {
  const [text, setText] = useState("");
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const frozen = useRef<readonly LiveCommandRecord[] | null>(null);

  // Pausing freezes the SNAPSHOT, not the engine. A console that stopped the
  // show to be read would be useless during the thing worth reading it for.
  const live = session.host.log.entries();
  if (paused && frozen.current === null) frozen.current = [...live];
  if (!paused && frozen.current !== null) frozen.current = null;

  const records = frozen.current ?? live;
  const rows = filterCommands(records, { text, acceptedOnly, source });
  const sources = commandSources(records);

  return (
    <div className="tool console">
      <div className="tool-toolbar">
        <input
          className="control-text"
          placeholder="filter"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <select
          className="control-text"
          value={source ?? ""}
          onChange={(event) => setSource(event.target.value || null)}
        >
          <option value="">all sources</option>
          {sources.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={acceptedOnly}
            onChange={(event) => setAcceptedOnly(event.target.checked)}
          />
          accepted only
        </label>
        <button type="button" className="control-button" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="control-button"
          onClick={() => {
            session.host.log.clear();
            frozen.current = null;
          }}
        >
          Clear
        </button>
        <span className="dim">
          {rows.length}/{records.length}
        </span>
      </div>

      <table className="log-table" data-testid="command-log">
        <thead>
          <tr>
            <th>#</th>
            <th>frame</th>
            <th>source</th>
            <th>command</th>
            <th>target</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice(-200)
            .reverse()
            .map((record) => (
              <tr key={record.sequence} className={record.accepted ? "" : "bad"}>
                <td className="dim">{record.sequence}</td>
                <td>{record.frame}</td>
                <td className="dim">{record.source}</td>
                <td className="mono">{record.command.type}</td>
                <td className="mono">{commandTarget(record)}</td>
                <td>{ms(record.durationMs)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {rows.some((record) => !record.accepted) ? (
        <p className="reason">
          {rows.filter((record) => !record.accepted).at(-1)?.reason}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function Timeline({ session }: { session: ShowcaseSession }) {
  const clips = timeline(session);
  const rate = 60;

  if (clips.length === 0) {
    return <p className="dim tool">This scene declares no animation clips.</p>;
  }

  return (
    <div className="tool timeline" data-testid="timeline">
      {clips.map((clip) => {
        const progress =
          clip.state === undefined || clip.duration === 0
            ? 0
            : Math.min(1, Math.max(0, clip.state.seconds / clip.duration));

        return (
          <section key={clip.id} className="clip">
            <header>
              <strong>{clip.name}</strong>
              <span className="dim">
                {clip.duration}s{clip.loop ? " · loop" : ""}
                {clip.state
                  ? clip.state.playing
                    ? ` · ${clip.state.speed > 0 ? "▶" : "◀"} ${clip.state.speed}×`
                    : " · held"
                  : " · stopped"}
              </span>
            </header>

            {/* Clicking seeks the ENGINE. The timeline never advances anything
                itself — it is a view of the clock, not a second one. */}
            <div
              className="ruler"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - rect.left) / rect.width;
                session.send({
                  type: "playback.seek",
                  frame: frameForClipTime(clip.state, ratio * clip.duration, rate),
                });
              }}
            >
              {clip.tracks.map((track) => (
                <div className="track" key={`${track.target}:${track.path}`}>
                  <span className="track-name mono">{track.path}</span>
                  {track.keyframes.map((keyframe, index) => (
                    <span
                      key={index}
                      className="keyframe"
                      style={{ left: `${(keyframe.time / clip.duration) * 100}%` }}
                      title={`${keyframe.time}s · ${keyframe.easing}`}
                    />
                  ))}
                </div>
              ))}

              {clip.events.map((event) => (
                <button
                  key={event.name}
                  type="button"
                  className="event"
                  style={{ left: `${(event.time / clip.duration) * 100}%` }}
                  title={`${event.name} @ ${event.time}s`}
                  onClick={(mouse) => {
                    mouse.stopPropagation();
                    session.send({
                      type: "playback.seek",
                      frame: frameForClipTime(clip.state, event.time, rate),
                    });
                  }}
                >
                  {event.name}
                </button>
              ))}

              {clip.state !== undefined ? (
                <div className="playhead" style={{ left: `${progress * 100}%` }} />
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame Breakdown
// ---------------------------------------------------------------------------

const HISTORY = 120;

function Breakdown({ metrics }: { metrics: Metrics }) {
  const history = useRef<{ runtime: number; animation: number; render: number }[]>([]);

  history.current.push({
    runtime: metrics.runtime.last,
    animation: metrics.animation.last,
    render: metrics.render.last,
  });
  if (history.current.length > HISTORY) history.current.shift();

  const budget = 1000 / 60;
  const scale = (value: number) => Math.min(100, (value / budget) * 100);

  return (
    <div className="tool breakdown" data-testid="frame-breakdown">
      {/* Stacked against the 16.67ms budget rather than against the largest
          sample: a bar that rescales to its own maximum always looks full, and
          the question is never "which part is biggest" but "does it fit". */}
      <div className="stack">
        <div className="seg runtime" style={{ width: `${scale(metrics.runtime.mean)}%` }} title={`runtime ${ms(metrics.runtime.mean)}ms`} />
        <div className="seg animation" style={{ width: `${scale(metrics.animation.mean)}%` }} title={`animation ${ms(metrics.animation.mean)}ms`} />
        <div className="seg render" style={{ width: `${scale(metrics.render.mean)}%` }} title={`render ${ms(metrics.render.mean)}ms`} />
        <div className="budget-line" />
      </div>
      <div className="legend">
        <span className="key runtime" /> runtime {ms(metrics.runtime.mean)}
        <span className="key animation" /> animation {ms(metrics.animation.mean)}
        <span className="key render" /> render {ms(metrics.render.mean)}
        <span className="dim">
          {(metrics.budget * 100).toFixed(1)}% of 16.67ms · capacity{" "}
          {metrics.capacityFps.toFixed(0)} fps
        </span>
      </div>

      <svg className="graph" viewBox={`0 0 ${HISTORY} 40`} preserveAspectRatio="none">
        <line x1="0" y1="20" x2={HISTORY} y2="20" className="budget" />
        {history.current.map((sample, index) => {
          const total = sample.runtime + sample.animation + sample.render;
          const height = Math.min(40, (total / budget) * 20);
          return (
            <rect
              key={index}
              x={index}
              y={40 - height}
              width={1}
              height={height}
              className={total > budget ? "over" : "under"}
            />
          );
        })}
      </svg>
      <p className="note">
        Bars are frame totals; the line is the 60fps budget. Render is submission
        time — GPU time is not visible from this side of the backend boundary.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output Monitor
// ---------------------------------------------------------------------------

function Outputs({ session, metrics }: { session: ShowcaseSession; metrics: Metrics }) {
  // Capacity, not the achieved rate — an output's effective fps is derived
  // from its cadence against what the engine can produce.
  const rows = outputRows(session, Math.min(60, metrics.capacityFps));

  return (
    <table className="tool log-table" data-testid="output-monitor">
      <thead>
        <tr>
          <th>output</th>
          <th>resolution</th>
          <th>alpha</th>
          <th>cadence</th>
          <th>fps</th>
          <th>rendered</th>
          <th>skipped</th>
          <th>missed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={row.missed > 0 ? "bad" : ""}>
            <td className="mono">{row.id}</td>
            <td>{row.resolution}</td>
            <td className="dim">{row.alpha}</td>
            <td>{row.cadence > 1 ? `1/${row.cadence}` : "every"}</td>
            <td>{row.effectiveFps.toFixed(1)}</td>
            <td>{row.rendered}</td>
            <td className="dim">{row.skipped}</td>
            <td>{row.missed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Session Recorder
// ---------------------------------------------------------------------------

function Recorder({ session }: { session: ShowcaseSession }) {
  const recorder = useRef(new SessionRecorder());
  const [recording, setRecording] = useState<Recording | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      recorder.current.tick(session);
      if (recorder.current.recording) tick((n) => n + 1);
    }, 100);
    return () => window.clearInterval(timer);
  }, [session]);

  return (
    <div className="tool recorder" data-testid="recorder">
      <div className="tool-toolbar">
        {recorder.current.recording ? (
          <button
            type="button"
            className="control-button danger"
            onClick={() => {
              setRecording(recorder.current.stop(session));
              setResult(null);
            }}
          >
            Stop ({recorder.current.commandCount} cmd · {recorder.current.checkpointCount} checkpoints)
          </button>
        ) : (
          <button
            type="button"
            className="control-button primary"
            onClick={() => {
              recorder.current.start(session);
              setRecording(null);
              setResult(null);
              tick((n) => n + 1);
            }}
          >
            Record
          </button>
        )}

        <button
          type="button"
          className="control-button"
          disabled={recording === null}
          onClick={() => {
            if (recording === null) return;
            // A NEW session. Replaying into the one that produced the recording
            // would compare a state against itself and pass unconditionally.
            const fresh = session.forkForReplay();
            setResult(replayRecording(fresh, recording));
            fresh.dispose();
          }}
        >
          Replay &amp; verify
        </button>
      </div>

      {recording !== null ? (
        <p className="dim">
          {recording.commands.length} commands · {recording.checkpoints.length}{" "}
          checkpoints · {recording.frames} frames
        </p>
      ) : null}

      {result !== null ? (
        <div className={result.matched ? "verdict good" : "verdict bad"} data-testid="replay-verdict">
          {result.matched
            ? `Replay matched: ${result.checkpointsChecked} checkpoints, ${result.commandsReplayed} commands.`
            : `Replay DIVERGED at ${result.mismatches.length} checkpoint(s).`}
          <ul>
            {result.mismatches.slice(0, 5).map((mismatch, index) => (
              <li key={index} className="mono">
                f{mismatch.frame} {mismatch.kind}: {mismatch.expected.slice(0, 12)} ≠{" "}
                {mismatch.actual.slice(0, 12)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="note">
        A recording stores commands AND session hashes at checkpoints. Commands
        alone would replay identically by construction; the hashes are what can
        disagree, and disagreement is the bug worth finding.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debug layers
// ---------------------------------------------------------------------------

export interface LayerSettings {
  readonly bounds: boolean;
  readonly layout: boolean;
  readonly anchors: boolean;
  readonly origins: boolean;
  readonly dirty: boolean;
}

export const NO_LAYERS: LayerSettings = {
  bounds: false,
  layout: false,
  anchors: false,
  origins: false,
  dirty: false,
};

/**
 * Debug overlay, drawn as SVG over the canvas.
 *
 * SVG rather than into the scene: adding debug geometry to the document would
 * make the thing being measured different from the thing that ships, and the
 * overlay would appear in screenshots meant to be baselines.
 */
export function DebugLayers({
  session,
  layers,
  canvasWidth,
  canvasHeight,
}: {
  session: ShowcaseSession | null;
  layers: LayerSettings;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const enabled =
    layers.bounds || layers.layout || layers.anchors || layers.origins || layers.dirty;

  const boxes = useMemo<readonly DebugBox[]>(() => {
    if (session === null || !enabled) return [];
    return debugBoxes(session, {
      canvasWidth,
      canvasHeight,
      orthographicSize: 5,
    });
  }, [session, enabled, canvasWidth, canvasHeight]);

  if (!enabled || boxes.length === 0) return null;

  const shown = boxes.filter(
    (box) =>
      (layers.bounds && box.kind === "bounds") ||
      (layers.layout && box.kind === "layout") ||
      (layers.anchors && box.kind === "anchor"),
  );

  return (
    <svg
      className="debug-layers"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="xMidYMid meet"
      data-testid="debug-layers"
      aria-hidden
    >
      {shown.map((box) => (
        <rect
          key={`${box.kind}:${box.nodeId}`}
          x={box.x - box.width / 2}
          y={box.y - box.height / 2}
          width={box.width}
          height={box.height}
          className={`layer ${box.kind}`}
        />
      ))}
      {layers.origins
        ? shown.map((box) => (
            <g key={`origin:${box.nodeId}`} className="origin">
              <line x1={box.x - 8} y1={box.y} x2={box.x + 8} y2={box.y} />
              <line x1={box.x} y1={box.y - 8} x2={box.x} y2={box.y + 8} />
            </g>
          ))
        : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Workbench({
  session,
  metrics,
  tool,
  onTool,
}: {
  session: ShowcaseSession;
  metrics: Metrics;
  tool: ToolId;
  onTool: (next: ToolId) => void;
}) {
  return (
    <section className="workbench" aria-label="Workbench">
      <nav className="tool-tabs">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === tool ? "active" : ""}
            onClick={() => onTool(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {/* Only the visible tool reads the engine. Eight panels sampling at once
          would cost more than the frames they describe. */}
      {tool === "inspector" ? <Inspector session={session} /> : null}
      {tool === "console" ? <Console session={session} /> : null}
      {tool === "timeline" ? <Timeline session={session} /> : null}
      {tool === "breakdown" ? <Breakdown metrics={metrics} /> : null}
      {tool === "outputs" ? <Outputs session={session} metrics={metrics} /> : null}
      {tool === "recorder" ? <Recorder session={session} /> : null}
    </section>
  );
}
