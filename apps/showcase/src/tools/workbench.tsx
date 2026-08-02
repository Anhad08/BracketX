import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LiveCommandRecord, SessionSnapshot } from "@bracketx/engine-host";

import type { ShowcaseSession } from "../engine/session";
import type { Metrics } from "../engine/metrics";
import {
  FRAME_BUDGET_MS,
  bucketMax,
  findSpikes,
  type Baseline,
  type Distribution,
  type SampleField,
} from "../engine/history";
import { compareToBaseline } from "../engine/history";
import {
  commandImpact,
  commandSources,
  commandTarget,
  debugBoxes,
  dirtyOrigins,
  filterCommands,
  frameForClipTime,
  inspectorRows,
  nodeDetail,
  outputRows,
  previewValue,
  searchNodes,
  timeline,
  variableKeys,
  watchRows,
  type DebugBox,
  type InspectorRow,
  type NodeDetail,
} from "./model";
import {
  SessionRecorder,
  replayRecording,
  serializeRecording,
  parseRecording,
  type Recording,
  type ReplayResult,
} from "./recorder";
import { describeDifference, diffRecordings, diffSnapshots } from "./diff";
import {
  DEFAULT_STRESS,
  STRESS_PRESETS,
  budgetCeiling,
  configCommands,
  runSweep,
  type StressConfig,
  type SweepPoint,
} from "./stress";
import type { SceneParameters } from "../registry";

/**
 * The engineering workbench.
 *
 * ============================================================================
 * THE COST STRATEGY, RESTATED FOR V3
 * ============================================================================
 * Tools are tabs and only the visible one reads the engine. V2 justified that
 * by cost and then MEASURED that the cost was never the problem — the panels
 * were 20x cheaper than the `diagnostics()` call the overlays already made.
 *
 * The tabs stay anyway, for a better reason: eight panels of dense numbers on
 * screen at once is not a debugging tool, it is a wall. The measurement changed
 * why, not what.
 *
 * What DID change is the shape of the reads. V2's inspector flattened the whole
 * mirror and its debug layer walked the whole document, on every sample. Both
 * are now proportional to what is on screen — see `model.ts`, which labels
 * every function SAMPLED or INVOKED.
 */

export type ToolId =
  | "inspector"
  | "console"
  | "timeline"
  | "performance"
  | "outputs"
  | "watch"
  | "recorder"
  | "stress";

export const TOOLS: readonly { id: ToolId; label: string; hint: string }[] = [
  { id: "inspector", label: "Inspector", hint: "What exists, and where each value came from" },
  { id: "console", label: "Console", hint: "What changed this, from where, and what it cost" },
  { id: "timeline", label: "Timeline", hint: "Where the playhead is, and what happened while it ran" },
  { id: "performance", label: "Performance", hint: "Distribution, spikes, and regression against a baseline" },
  { id: "outputs", label: "Outputs", hint: "What each surface is doing" },
  { id: "watch", label: "Watch", hint: "Variables, their readers, and their last writer" },
  { id: "recorder", label: "Recorder", hint: "Does this reproduce, and do two runs agree" },
  { id: "stress", label: "Stress", hint: "Where does it stop fitting in a frame" },
];

function ms(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(3);
}

/**
 * Shared workbench state.
 *
 * One object rather than fifteen props. The palette, the keyboard, the alerts
 * panel, and every tool all need to reach the same selection and the same
 * pins — an alert that can say "open this node" is the difference between a
 * finding and a fix.
 */
export interface WorkbenchState {
  readonly tool: ToolId;
  readonly setTool: (tool: ToolId) => void;

  readonly selected: string | null;
  readonly select: (nodeId: string | null) => void;
  readonly expanded: ReadonlySet<string>;
  readonly setExpanded: (next: ReadonlySet<string>) => void;
  /** Selects and expands every ancestor, so the node is actually on screen. */
  readonly reveal: (nodeId: string) => void;

  readonly pinned: readonly string[];
  readonly togglePin: (nodeId: string) => void;
  readonly watched: readonly string[];
  readonly toggleWatch: (key: string) => void;

  readonly baseline: Baseline | null;
  readonly setBaseline: (baseline: Baseline | null) => void;
  readonly snapshot: SessionSnapshot | null;
  readonly setSnapshot: (snapshot: SessionSnapshot | null) => void;

  readonly parameters: SceneParameters;
  readonly setParameters: (parameters: SceneParameters) => void;

  /** Bumped to move focus into the node search field. */
  readonly searchToken: number;
}

// ---------------------------------------------------------------------------
// Scene Inspector
// ---------------------------------------------------------------------------

function Inspector({
  session,
  state,
}: {
  session: ShowcaseSession;
  state: WorkbenchState;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (state.searchToken > 0) searchRef.current?.focus();
  }, [state.searchToken]);

  // Search is INVOKED: one full pass per query, ranked. The tree below is
  // SAMPLED and stays proportional to what is expanded. Conflating the two is
  // what made V2 O(scene) ten times a second.
  const results = useMemo(
    () => (query.trim().length === 0 ? null : searchNodes(session, query, 25)),
    // A new object every sample would defeat the memo; the query and the
    // session identity are what actually change the answer materially, and a
    // stale rank for 100ms is invisible.
    [session, query],
  );

  const tree = inspectorRows(session, {
    expanded: state.expanded,
    limit: 400,
  });

  const detail = state.selected === null ? null : nodeDetail(session, state.selected);

  const toggle = (id: string) => {
    const next = new Set(state.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    state.setExpanded(next);
  };

  return (
    <div className="tool inspector">
      <div className="tool-toolbar">
        <input
          ref={searchRef}
          className="control-text grow"
          placeholder="Find a node — id, name, or component"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Find node"
        />
        {results !== null ? (
          <span className="dim" data-testid="search-summary">
            {results.hits.length} of {results.scanned} scanned
          </span>
        ) : (
          <span className="dim">
            {tree.rows.length} shown{tree.truncated ? " · truncated" : ""}
          </span>
        )}
      </div>

      <div className="inspector-body">
        <div className="tree-pane">
          {results !== null ? (
            <ol className="tree results" data-testid="search-results">
              {results.hits.length === 0 ? (
                <li className="dim pad">No node matches.</li>
              ) : (
                results.hits.map(({ item }) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`node ${item.id === state.selected ? "on" : ""}`}
                      onClick={() => state.reveal(item.id)}
                    >
                      <span>{item.name}</span>
                      {item.instance ? <span className="tag">instance</span> : null}
                      <span className="dim mono ellipsis">{item.id}</span>
                    </button>
                  </li>
                ))
              )}
            </ol>
          ) : (
            <>
              {state.pinned.length > 0 ? (
                <div className="pins" data-testid="pinned-nodes">
                  <span className="control-label">Pinned</span>
                  {state.pinned.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`pin ${id === state.selected ? "on" : ""}`}
                      onClick={() => state.reveal(id)}
                      title={id}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              ) : null}
              <ol className="tree" data-testid="inspector-tree">
                {tree.rows.map((row) => (
                  <TreeRow
                    key={row.id}
                    row={row}
                    selected={row.id === state.selected}
                    pinned={state.pinned.includes(row.id)}
                    onToggle={() => toggle(row.id)}
                    onSelect={() => state.select(row.id)}
                    onPin={() => state.togglePin(row.id)}
                  />
                ))}
                {tree.truncated ? (
                  <li className="dim pad">
                    Stopped at 400 rows. Collapse a branch, or search instead — a tree
                    with more rows than a screen is a list nobody reads.
                  </li>
                ) : null}
              </ol>
            </>
          )}
        </div>

        <div className="detail" data-testid="inspector-detail">
          {detail === null ? (
            <p className="dim pad">Select a node.</p>
          ) : (
            <NodeDetailView detail={detail} state={state} />
          )}
        </div>
      </div>
    </div>
  );
}

function TreeRow({
  row,
  selected,
  pinned,
  onToggle,
  onSelect,
  onPin,
}: {
  row: InspectorRow;
  selected: boolean;
  pinned: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onPin: () => void;
}) {
  return (
    <li
      style={{ paddingLeft: `${row.depth * 12}px` }}
      className={selected ? "selected" : ""}
    >
      <button
        type="button"
        className="twisty"
        onClick={onToggle}
        disabled={!row.expandable}
        aria-label={row.expanded ? "collapse" : "expand"}
      >
        {!row.expandable ? "·" : row.expanded ? "▾" : "▸"}
      </button>
      <button type="button" className="node" onClick={onSelect}>
        <span className={row.effectiveVisible ? "" : "dim strike"}>{row.name}</span>
        {row.instance ? <span className="tag">instance</span> : null}
        {row.componentTypes.map((type) => (
          <span key={type} className="tag type">
            {type}
          </span>
        ))}
        {row.expandable && !row.expanded ? (
          <span className="dim count">{row.childCount}</span>
        ) : null}
      </button>
      <button
        type="button"
        className={`pin-toggle ${pinned ? "on" : ""}`}
        onClick={onPin}
        aria-label={pinned ? "unpin" : "pin"}
        title={pinned ? "Unpin" : "Pin — survives scene reloads"}
      >
        ◆
      </button>
    </li>
  );
}

/**
 * The detail pane.
 *
 * Organised around one question — "where did this come from" — rather than
 * around the shape of the data structures. Every section answers it for a
 * different kind of value: variables, animation, layout, states, outputs.
 */
function NodeDetailView({
  detail,
  state,
}: {
  detail: NodeDetail;
  state: WorkbenchState;
}) {
  return (
    <>
      <nav className="breadcrumbs" data-testid="breadcrumbs">
        {detail.ancestors.map((ancestor) => (
          <button
            key={ancestor.id}
            type="button"
            className="crumb"
            onClick={() => state.reveal(ancestor.id)}
            title={ancestor.id}
          >
            {ancestor.name}
          </button>
        ))}
        <span className="crumb current">{detail.name}</span>
      </nav>

      <dl className="facts">
        <dt>id</dt>
        <dd className="mono">{detail.id}</dd>
        {detail.instanceOf !== null ? (
          <>
            <dt>instance of</dt>
            <dd className="mono">
              <button
                type="button"
                className="linkish"
                onClick={() => state.reveal(detail.instanceOf!.templateId)}
              >
                {detail.instanceOf.templateId}
              </button>
              <span className="dim"> · identity {detail.instanceOf.identity}</span>
            </dd>
          </>
        ) : null}
        <dt>children</dt>
        <dd>{detail.childIds.length}</dd>
        <dt>components</dt>
        <dd>{detail.componentTypes.join(", ") || "—"}</dd>
        <dt>visible</dt>
        <dd>
          {String(detail.visible)}
          {detail.visible !== detail.effectiveVisible ? (
            <span className="dim"> (effective {String(detail.effectiveVisible)} — an ancestor is hidden)</span>
          ) : null}
        </dd>
        <dt>world</dt>
        <dd className="mono" data-testid="world-position">
          {detail.worldPosition.map((n) => n.toFixed(3)).join(", ")}
        </dd>
        <dt>size</dt>
        <dd>{detail.size ? `${detail.size.width} × ${detail.size.height}` : "—"}</dd>
        {detail.outputs.length > 0 ? (
          <>
            <dt>camera for</dt>
            <dd>{detail.outputs.join(", ")}</dd>
          </>
        ) : null}
      </dl>

      <Section title="Values read" count={detail.origins.length}>
        {detail.origins.length === 0 ? (
          <p className="dim">This node reads no variables.</p>
        ) : (
          <table className="mini" data-testid="origins">
            <tbody>
              {detail.origins.map((origin) => (
                <tr key={origin.key}>
                  <td className="mono">
                    {origin.key}
                    <span className={`tag kind ${origin.kind}`}>{origin.kind}</span>
                  </td>
                  <td className="mono ellipsis" title={JSON.stringify(origin.value)}>
                    {previewValue(origin.value, 40)}
                  </td>
                  <td className="dim ellipsis">
                    {origin.via !== undefined ? (
                      <>
                        row <span className="mono">{origin.via.identity}</span> of{" "}
                        <span className="mono">{origin.via.source}</span>
                      </>
                    ) : null}
                    {origin.lastWrite !== undefined ? (
                      <>
                        {origin.via !== undefined ? " · " : null}
                        {origin.lastWrite.type} from {origin.lastWrite.source} @ f
                        {origin.lastWrite.frame}
                      </>
                    ) : origin.via === undefined ? (
                      "authored default"
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => state.toggleWatch(origin.via?.source ?? origin.key)}
                    >
                      watch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Animation" count={detail.animation.length}>
        {detail.animation.length === 0 ? (
          <p className="dim">No clip targets this node.</p>
        ) : (
          <table className="mini" data-testid="animation-contributors">
            <tbody>
              {detail.animation.map((contributor) => (
                <tr key={`${contributor.clipId}:${contributor.path}`}>
                  <td className="mono">{contributor.path}</td>
                  <td>{contributor.clipName}</td>
                  <td className={contributor.driving ? "good" : "dim"}>
                    {contributor.driving
                      ? "driving"
                      : contributor.held
                        ? "held"
                        : contributor.playing
                          ? "playing"
                          : "idle"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Position" count={detail.layoutFrom === null ? 0 : 1}>
        {detail.layoutFrom !== null ? (
          <p>
            Placed by{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => state.reveal(detail.layoutFrom!.containerId)}
            >
              {detail.layoutFrom.containerName}
            </button>{" "}
            <span className="dim">
              ({detail.layoutFrom.mode}
              {detail.layoutFrom.gap === null ? "" : `, gap ${detail.layoutFrom.gap}`}) — its
              own transform position is overridden.
            </span>
          </p>
        ) : detail.anchor !== null ? (
          <p>
            Anchored <span className="mono">{detail.anchor}</span> to its parent.
          </p>
        ) : (
          <p className="dim">Positioned by its own transform.</p>
        )}
        {detail.layout !== null ? (
          <p className="dim">
            This node lays out its own children: <span className="mono">{detail.layout}</span>
          </p>
        ) : null}
      </Section>

      <Section title="States" count={detail.states.length}>
        {detail.states.length === 0 ? (
          <p className="dim">No state overrides declared.</p>
        ) : (
          <p>
            {detail.states.map((entry) => (
              <span key={entry.state} className={`tag ${entry.active ? "active" : ""}`}>
                {entry.state}
              </span>
            ))}
          </p>
        )}
      </Section>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <h4>
        {title}
        {count > 0 ? <span className="dim"> {count}</span> : null}
      </h4>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Command Console
// ---------------------------------------------------------------------------

function Console({ session, state }: { session: ShowcaseSession; state: WorkbenchState }) {
  const [text, setText] = useState("");
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const frozen = useRef<readonly LiveCommandRecord[] | null>(null);

  // Pausing freezes the SNAPSHOT, not the engine. A console that stopped the
  // show to be read would be useless during the thing worth reading it for.
  const live = session.host.log.entries();
  if (paused && frozen.current === null) frozen.current = [...live];
  if (!paused && frozen.current !== null) frozen.current = null;

  const records = frozen.current ?? live;
  const rows = filterCommands(records, { text, acceptedOnly, source, changedOnly }, session);
  const sources = commandSources(records);
  const origins = dirtyOrigins(session, records);

  return (
    <div className="tool console">
      <div className="tool-toolbar">
        <input
          className="control-text grow"
          placeholder="Filter by type, target, or source"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Filter commands"
        />
        <select
          className="control-text"
          value={source ?? ""}
          onChange={(event) => setSource(event.target.value || null)}
          aria-label="Source"
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
          accepted
        </label>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(event) => setChangedOnly(event.target.checked)}
          />
          changed the scene
        </label>
        {/* Named distinctly from the transport's play/pause: two controls that
            both read "Pause" and do different things is how someone freezes
            the wrong thing during a show. */}
        <button type="button" className="control-button" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume log" : "Pause log"}
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

      {origins.length > 0 ? (
        <p className="finding" data-testid="dirty-origins">
          Scene churn:{" "}
          {origins.slice(0, 3).map((origin, index) => (
            <span key={`${origin.commandType}:${origin.source}`}>
              {index > 0 ? " · " : ""}
              <strong>{origin.dirtyNodes}</strong> dirty from{" "}
              <span className="mono">{origin.commandType}</span>{" "}
              <span className="dim">({origin.source}, {origin.commands}×)</span>
            </span>
          ))}
        </p>
      ) : null}

      <table className="log-table" data-testid="command-log">
        <thead>
          <tr>
            <th>#</th>
            <th>frame</th>
            <th>source</th>
            <th>command</th>
            <th>target</th>
            <th className="num">ms</th>
            <th className="num">dirty</th>
            <th className="num">writes</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice(-200)
            .reverse()
            .map((record) => {
              const impact = commandImpact(session, record);
              return (
                <tr key={record.sequence} className={record.accepted ? "" : "bad"}>
                  <td className="dim">{record.sequence}</td>
                  <td>{record.frame}</td>
                  <td className="dim">{record.source}</td>
                  <td className="mono">{record.command.type}</td>
                  <td className="mono">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => state.toggleWatch(commandTarget(record))}
                      title="Watch this target"
                    >
                      {commandTarget(record)}
                    </button>
                  </td>
                  <td className="num">{ms(record.durationMs)}</td>
                  <td className="num dim">{impact?.dirtyNodes ?? "—"}</td>
                  <td className="num dim">{impact?.backendWrites ?? "—"}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {rows.some((record) => !record.accepted) ? (
        <p className="reason">{rows.filter((record) => !record.accepted).at(-1)?.reason}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function Timeline({ session }: { session: ShowcaseSession }) {
  const [showMarkers, setShowMarkers] = useState(true);
  const clips = timeline(session, { markers: showMarkers });
  const rate = 60;

  if (clips.length === 0) {
    return <p className="dim tool pad">This scene declares no animation clips.</p>;
  }

  return (
    <div className="tool timeline" data-testid="timeline">
      <div className="tool-toolbar">
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showMarkers}
            onChange={(event) => setShowMarkers(event.target.checked)}
          />
          command markers
        </label>
        <span className="dim">
          Clicking the ruler seeks the engine. The timeline never advances anything itself.
        </span>
      </div>

      {clips.map((clip) => {
        const progress =
          clip.state === undefined || clip.span === 0
            ? 0
            : Math.min(1, Math.max(0, clip.state.seconds / clip.span));

        return (
          <section key={clip.id} className="clip">
            <header>
              <strong>{clip.name}</strong>
              {clip.transient ? (
                <span className="tag" title="Compiled from a state change, not authored">
                  transition
                </span>
              ) : null}
              <span className="dim">
                {clip.duration}s
                {/* The span, when a stagger pushes the true end past the
                    nominal duration. A ruler drawn to `duration` would show the
                    playhead leaving while rows were still arriving. */}
                {clip.span > clip.duration ? ` (span ${clip.span.toFixed(2)}s)` : ""}
                {clip.loop ? " · loop" : ""}
                {clip.state
                  ? clip.state.playing
                    ? ` · ${clip.state.speed > 0 ? "▶" : "◀"} ${clip.state.speed}× · ${clip.state.seconds.toFixed(2)}s`
                    : " · held"
                  : " · stopped"}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="control-button tiny"
                onClick={() => session.send({ type: "clip.play", clipId: clip.id })}
              >
                Play
              </button>
              <button
                type="button"
                className="control-button tiny"
                onClick={() => session.send({ type: "clip.stop", clipId: clip.id })}
              >
                Stop
              </button>
            </header>

            {/* Clicking seeks the ENGINE. The timeline is a view of the clock,
                not a second one. */}
            <div
              className="ruler"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - rect.left) / rect.width;
                session.send({
                  type: "playback.seek",
                  frame: frameForClipTime(clip.state, ratio * clip.span, rate),
                });
              }}
            >
              {clip.tracks.map((track) => {
                // Everything is drawn against the SPAN, so a delayed or
                // staggered track sits where it actually runs rather than
                // where its keyframes happen to be numbered.
                const scale = clip.span > 0 ? clip.span : 1;
                const last = track.keyframes.at(-1)?.time ?? 0;
                return (
                  <div className="track" key={`${track.target}:${track.path}`}>
                    <span className="track-name mono">
                      {track.path}
                      {track.delay > 0 ? (
                        <span className="tag" title={`delayed ${track.delay}s`}>
                          +{track.delay}s
                        </span>
                      ) : null}
                      {track.stagger !== null ? (
                        <span
                          className="tag stagger"
                          title={`staggered ${track.stagger.direction}, ${
                            track.stagger.total !== null
                              ? `${track.stagger.total}s total`
                              : `${track.stagger.interval}s apart`
                          }`}
                        >
                          stagger
                        </span>
                      ) : null}
                    </span>
                    {/* The track's own extent, so a delay reads as a lead-in
                        rather than as a track that starts late for no reason. */}
                    <span
                      className="track-extent"
                      style={{
                        left: `${(track.delay / scale) * 100}%`,
                        width: `${(last / scale) * 100}%`,
                      }}
                    />
                    {track.keyframes.map((keyframe, index) => (
                      <span
                        key={index}
                        className="keyframe"
                        style={{
                          left: `${((keyframe.time + track.delay) / scale) * 100}%`,
                        }}
                        title={`${keyframe.time}s${track.delay > 0 ? ` +${track.delay}s delay` : ""} · ${keyframe.easing}`}
                      />
                    ))}
                  </div>
                );
              })}

              {clip.markers.map((marker, index) => (
                <span
                  key={index}
                  className={`marker ${marker.kind}`}
                  style={{ left: `${(marker.time / (clip.span || 1)) * 100}%` }}
                  title={`${marker.label} — ${marker.detail}`}
                  data-testid="timeline-marker"
                />
              ))}

              {clip.events.map((event) => (
                <button
                  key={event.name}
                  type="button"
                  className="event"
                  style={{ left: `${(event.time / (clip.span || 1)) * 100}%` }}
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
// Performance
// ---------------------------------------------------------------------------

const GRAPH_WIDTH = 240;

function Performance({
  session,
  metrics,
  state,
}: {
  session: ShowcaseSession;
  metrics: Metrics;
  state: WorkbenchState;
}) {
  const samples = session.history.samples();
  const stats = session.history.stats(samples);
  const spikes = findSpikes(samples);
  const bars = bucketMax(samples, "total", GRAPH_WIDTH);
  const peak = Math.max(FRAME_BUDGET_MS, ...bars.map((bar) => bar.value));
  const regressions =
    state.baseline === null ? [] : compareToBaseline(state.baseline, stats);

  return (
    <div className="tool performance" data-testid="performance">
      <div className="tool-toolbar">
        <button
          type="button"
          className="control-button primary"
          onClick={() => state.setBaseline(session.history.captureBaseline(`f${session.frame}`))}
        >
          Capture baseline
        </button>
        {state.baseline !== null ? (
          <>
            <span className="dim">
              baseline &quot;{state.baseline.label}&quot; · {state.baseline.sampleCount} samples
            </span>
            <button type="button" className="control-button" onClick={() => state.setBaseline(null)}>
              Clear
            </button>
          </>
        ) : (
          <span className="dim">No baseline. Capture one, then change something.</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="control-button"
          onClick={() => session.history.clear()}
        >
          Reset history
        </button>
        <span className="dim">{samples.length} frames retained</span>
      </div>

      {/* Scaled against the budget AND the peak, so an over-budget scene is not
          silently clipped to a full bar. */}
      <svg
        className="history"
        viewBox={`0 0 ${GRAPH_WIDTH} 60`}
        preserveAspectRatio="none"
        data-testid="frame-history"
        aria-label="Frame time history"
      >
        <line
          x1="0"
          y1={60 - (FRAME_BUDGET_MS / peak) * 60}
          x2={GRAPH_WIDTH}
          y2={60 - (FRAME_BUDGET_MS / peak) * 60}
          className="budget"
        />
        {bars.map((bar, index) => {
          const height = Math.max(0.5, (bar.value / peak) * 60);
          return (
            <rect
              key={index}
              x={index * (GRAPH_WIDTH / Math.max(1, bars.length))}
              y={60 - height}
              width={GRAPH_WIDTH / Math.max(1, bars.length)}
              height={height}
              className={bar.value > FRAME_BUDGET_MS ? "over" : "under"}
            />
          );
        })}
      </svg>
      <p className="note">
        Worst frame per bucket, not the average — averaging hides the single dropped
        frame that is the reason to open this. The line is the 60fps budget.
      </p>

      <table className="log-table" data-testid="distribution">
        <thead>
          <tr>
            <th>phase</th>
            <th className="num">p50</th>
            <th className="num">p95</th>
            <th className="num">p99</th>
            <th className="num">max</th>
            <th className="num">vs baseline</th>
          </tr>
        </thead>
        <tbody>
          {(["total", "runtime", "animation", "render"] as const).map((field) => (
            <DistributionRow
              key={field}
              field={field}
              stat={stats[field]}
              regression={regressions.find((entry) => entry.field === field) ?? null}
            />
          ))}
          {(["backendWrites", "dirtyNodes"] as const).map((field) => (
            <tr key={field}>
              <td>{field === "backendWrites" ? "backend writes" : "dirty nodes"}</td>
              <td className="num">{stats[field].p50.toFixed(0)}</td>
              <td className="num">{stats[field].p95.toFixed(0)}</td>
              <td className="num">{stats[field].p99.toFixed(0)}</td>
              <td className="num">{stats[field].max.toFixed(0)}</td>
              <td className="num dim">—</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="split">
        <section>
          <h4>Composition</h4>
          <div className="stack">
            <div
              className="seg runtime"
              style={{ width: `${(stats.runtime.p95 / FRAME_BUDGET_MS) * 100}%` }}
              title={`runtime ${ms(stats.runtime.p95)}ms`}
            />
            <div
              className="seg animation"
              style={{ width: `${(stats.animation.p95 / FRAME_BUDGET_MS) * 100}%` }}
              title={`animation ${ms(stats.animation.p95)}ms`}
            />
            <div
              className="seg render"
              style={{ width: `${(stats.render.p95 / FRAME_BUDGET_MS) * 100}%` }}
              title={`render ${ms(stats.render.p95)}ms`}
            />
          </div>
          <div className="legend">
            <span className="key runtime" /> runtime
            <span className="key animation" /> animation
            <span className="key render" /> render
            <span className="dim">
              p95 · {(metrics.budget * 100).toFixed(1)}% of budget · capacity{" "}
              {metrics.capacityFps.toFixed(0)} fps
            </span>
          </div>
          <p className="note">
            Render is submission time. GPU time is not visible from this side of the
            backend boundary, so this bar is not a GPU bar.
          </p>
        </section>

        <section>
          <h4>
            Spikes <span className="dim">{spikes.length}</span>
          </h4>
          {spikes.length === 0 ? (
            <p className="dim">None. Detected by median absolute deviation.</p>
          ) : (
            <ul className="spikes" data-testid="spikes">
              {spikes
                .slice(-8)
                .reverse()
                // Keyed by position, not by frame. A step that does not advance
                // the clock records two samples on the same frame number, so
                // frames are not unique and React was warning about it.
                .map((spike, index) => (
                  <li key={`${spike.frame}:${index}`}>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => session.seekTo(spike.frame)}
                    >
                      frame {spike.frame}
                    </button>{" "}
                    <span className="mono">{ms(spike.value)}ms</span>{" "}
                    <span className="dim">
                      {spike.ratio.toFixed(1)}× median · {spike.dominant}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function DistributionRow({
  field,
  stat,
  regression,
}: {
  field: SampleField;
  stat: Distribution;
  regression: { delta: number; verdict: string } | null;
}) {
  return (
    <tr>
      <td>{field}</td>
      <td className="num">{ms(stat.p50)}</td>
      <td className="num">{ms(stat.p95)}</td>
      <td className="num">{ms(stat.p99)}</td>
      <td className="num">{ms(stat.max)}</td>
      <td
        className={`num ${regression === null || regression.verdict === "unchanged" ? "dim" : regression.verdict === "slower" ? "bad-text" : "good"}`}
      >
        {regression === null
          ? "—"
          : `${regression.delta >= 0 ? "+" : ""}${(regression.delta * 100).toFixed(0)}%`}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Output Monitor
// ---------------------------------------------------------------------------

function Outputs({
  session,
  metrics,
  state,
}: {
  session: ShowcaseSession;
  metrics: Metrics;
  state: WorkbenchState;
}) {
  // Capacity, not the achieved rate — an output's effective fps is derived
  // from its cadence against what the engine can produce.
  const rows = outputRows(session, Math.min(60, metrics.capacityFps));

  return (
    <div className="tool">
      <table className="log-table" data-testid="output-monitor">
        <thead>
          <tr>
            <th>output</th>
            <th>resolution</th>
            <th>alpha</th>
            <th>camera</th>
            <th>cadence</th>
            <th className="num">fps</th>
            <th className="num">rendered</th>
            <th className="num">skipped</th>
            <th className="num">missed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.missed > 0 ? "bad" : ""}>
              <td className="mono">{row.id}</td>
              <td>{row.resolution}</td>
              <td className="dim">{row.alpha}</td>
              <td className="mono dim">
                {row.cameraNodeId === null ? (
                  "scene camera"
                ) : (
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => state.reveal(row.cameraNodeId!)}
                  >
                    {row.cameraNodeId}
                  </button>
                )}
              </td>
              <td>{row.cadence > 1 ? `1/${row.cadence}` : "every"}</td>
              <td className="num">{row.effectiveFps.toFixed(1)}</td>
              <td className="num">{row.rendered}</td>
              <td className="num dim">{row.skipped}</td>
              <td className="num">{row.missed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        A skipped frame is cadence working. A missed frame is black on air — no camera
        resolved for that output.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variable Watch
// ---------------------------------------------------------------------------

function Watch({ session, state }: { session: ShowcaseSession; state: WorkbenchState }) {
  const previous = useRef(new Map<string, unknown>());
  const keys = variableKeys(session);
  const rows = watchRows(session, state.watched, previous.current);

  useEffect(() => {
    const map = new Map<string, unknown>();
    for (const key of state.watched) {
      map.set(key, session.host.runtime.state.variables.get(key));
    }
    previous.current = map;
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const dependents =
    expanded === null
      ? []
      : [...session.host.reconciler.projector.dependencies.dependents(expanded)].slice(0, 20);

  return (
    <div className="tool watch">
      <div className="tool-toolbar">
        <select
          className="control-text"
          value=""
          onChange={(event) => {
            if (event.target.value.length > 0) state.toggleWatch(event.target.value);
          }}
          aria-label="Add variable to watch"
        >
          <option value="">add a variable…</option>
          {keys
            .filter((key) => !state.watched.includes(key))
            .map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="control-button"
          onClick={() => {
            for (const key of keys) if (!state.watched.includes(key)) state.toggleWatch(key);
          }}
        >
          Watch all
        </button>
        <span className="dim">{state.watched.length} watched · survives reload</span>
      </div>

      {state.watched.length === 0 ? (
        <p className="dim pad">
          Nothing watched. A watch row shows the value, how many nodes read it, and the
          last command that wrote it.
        </p>
      ) : (
        <table className="log-table" data-testid="watch-table">
          <thead>
            <tr>
              <th>variable</th>
              <th>value</th>
              <th className="num">readers</th>
              <th>last write</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.changed ? "flash" : ""}>
                <td className="mono">{row.key}</td>
                <td className="mono ellipsis" title={JSON.stringify(row.value)}>
                  {row.preview}
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => setExpanded(expanded === row.key ? null : row.key)}
                  >
                    {row.dependents}
                  </button>
                </td>
                <td className="dim">
                  {row.lastWrite === undefined
                    ? "—"
                    : `${row.lastWrite.type} · ${row.lastWrite.source} · f${row.lastWrite.frame}`}
                </td>
                <td>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => state.toggleWatch(row.key)}
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {expanded !== null ? (
        <div className="dependents" data-testid="dependents">
          <span className="control-label">Nodes reading {expanded}</span>
          {dependents.length === 0 ? (
            <span className="dim">none</span>
          ) : (
            dependents.map((id) => (
              <button key={id} type="button" className="pin" onClick={() => state.reveal(id)}>
                {id}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session Recorder
// ---------------------------------------------------------------------------

function Recorder({ session, state }: { session: ShowcaseSession; state: WorkbenchState }) {
  const recorder = useRef(new SessionRecorder());
  const [recording, setRecording] = useState<Recording | null>(null);
  const [held, setHeld] = useState<Recording | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      recorder.current.tick(session);
      if (recorder.current.recording) tick((n) => n + 1);
    }, 100);
    return () => window.clearInterval(timer);
  }, [session]);

  const comparison = useMemo(
    () => (held === null || recording === null ? null : diffRecordings(held, recording)),
    [held, recording],
  );

  // Deliberately NOT memoised. The inputs that matter — the live session's
  // variables — are not values React can compare, so a memo keyed on the
  // session object would freeze the diff at the moment of capture and report
  // "identical" forever. Recomputed per sample instead, bounded at 200
  // differences, which is the cost the benchmark covers.
  const snapshotDiff =
    state.snapshot === null ? null : diffSnapshots(state.snapshot, session.session());

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

        <button
          type="button"
          className="control-button"
          disabled={recording === null}
          onClick={() => {
            if (recording === null) return;
            setHeld(recording);
            setNotice("Held for comparison. Record again to diff the two runs.");
          }}
        >
          Hold for compare
        </button>

        <button
          type="button"
          className="control-button"
          disabled={recording === null}
          onClick={() => {
            if (recording === null) return;
            download(`${recording.sceneId}-recording.json`, serializeRecording(recording));
          }}
        >
          Export
        </button>

        <label className="control-button file">
          Import
          <input
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              try {
                setRecording(parseRecording(await file.text()));
                setNotice(`Imported ${file.name}.`);
              } catch (error) {
                setNotice(String(error));
              }
            }}
          />
        </label>
      </div>

      {notice !== null ? <p className="dim">{notice}</p> : null}

      {recording !== null ? (
        <p className="dim">
          {recording.commands.length} commands · {recording.checkpoints.length} checkpoints ·{" "}
          {recording.frames} frames
        </p>
      ) : null}

      {result !== null ? (
        <div
          className={result.matched ? "verdict good" : "verdict bad"}
          data-testid="replay-verdict"
        >
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

      {comparison !== null ? (
        <div
          className={comparison.divergedAtFrame === null ? "verdict good" : "verdict bad"}
          data-testid="recording-diff"
        >
          {comparison.divergedAtFrame === null
            ? `Two runs agree across ${comparison.checkpointsCompared} checkpoints.`
            : `Two runs diverge from frame ${comparison.divergedAtFrame}.`}
          <ul>
            {comparison.checkpointDifferences.slice(0, 5).map((entry, index) => (
              <li key={index} className="mono">
                f{entry.frame} {entry.field}: {entry.before.slice(0, 12)} ≠{" "}
                {entry.after.slice(0, 12)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="detail-section">
        <h4>Session snapshot</h4>
        <div className="control-row">
          <button
            type="button"
            className="control-button"
            onClick={() => state.setSnapshot(session.session())}
          >
            Capture snapshot
          </button>
          {state.snapshot !== null ? (
            <button type="button" className="control-button" onClick={() => state.setSnapshot(null)}>
              Clear
            </button>
          ) : null}
          <span className="dim">
            {state.snapshot === null
              ? "Capture, change something, then read the diff."
              : `Captured at frame ${state.snapshot.frame}.`}
          </span>
        </div>
        {snapshotDiff !== null ? (
          <div data-testid="snapshot-diff">
            {snapshotDiff.identical ? (
              <p className="good">Identical to the captured snapshot.</p>
            ) : (
              <ul className="diff">
                {snapshotDiff.differences.slice(0, 20).map((difference, index) => (
                  <li key={index} className="mono">
                    {describeDifference(difference)}
                  </li>
                ))}
                {snapshotDiff.truncated ? <li className="dim">…truncated at 200.</li> : null}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      <p className="note">
        A recording stores commands AND session hashes at checkpoints. Commands alone
        would replay identically by construction; the hashes are what can disagree, and
        disagreement is the bug worth finding.
      </p>
    </div>
  );
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Stress laboratory
// ---------------------------------------------------------------------------

function Stress({
  session,
  state,
  saved,
  onSave,
}: {
  session: ShowcaseSession;
  state: WorkbenchState;
  saved: readonly StressConfig[];
  onSave: (config: StressConfig) => void;
}) {
  const [config, setConfig] = useState<StressConfig>(DEFAULT_STRESS);
  const [sweep, setSweep] = useState<readonly SweepPoint[] | null>(null);
  const [running, setRunning] = useState(false);

  const scene = session.scene;
  const clipIds = useMemo(
    () => session.host.animator.clips.map((clip) => clip.id),
    [session],
  );
  const collectionKey = scene.id === "stress" ? "items" : "entries";

  const apply = useCallback(
    (next: StressConfig) => {
      setConfig(next);
      for (const command of configCommands(next, { collectionKey, clipIds })) {
        session.send(command, "stress");
      }
      if (next.playbackSpeed !== 0 && next.playbackSpeed !== 1) {
        session.send(
          { type: "playback.rate", num: Math.round(next.playbackSpeed * 60), den: 60 } as never,
          "stress",
        );
      }
    },
    [session, collectionKey, clipIds],
  );

  return (
    <div className="tool stress" data-testid="stress">
      <div className="tool-toolbar">
        <span className="control-label">Presets</span>
        {STRESS_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`control-button ${config.id === preset.id ? "primary" : ""}`}
            onClick={() => apply(preset)}
          >
            {preset.label}
          </button>
        ))}
        {saved.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="control-button"
            onClick={() => apply(entry)}
            title="Saved configuration"
          >
            ★ {entry.label}
          </button>
        ))}
        <button
          type="button"
          className="control-button"
          onClick={() => onSave({ ...config, id: `saved-${Date.now()}`, label: `f${session.frame}` })}
        >
          Save current
        </button>
      </div>

      <div className="axes">
        <Axis
          label="collection rows"
          value={config.collectionSize}
          min={0}
          max={5000}
          step={50}
          onChange={(value) => apply({ ...config, collectionSize: value })}
        />
        <Axis
          label="clips playing"
          value={config.clips}
          min={0}
          max={clipIds.length}
          step={1}
          onChange={(value) => apply({ ...config, clips: value })}
        />
        <Axis
          label="outputs"
          value={config.outputs}
          min={1}
          max={6}
          step={1}
          onChange={(value) => apply({ ...config, outputs: value })}
        />
        <Axis
          label="command rate /s"
          value={config.commandRate}
          min={0}
          max={240}
          step={10}
          onChange={(value) => setConfig({ ...config, commandRate: value })}
        />
        {(scene.parameters ?? []).map((parameter) => (
          <Axis
            key={parameter.key}
            label={`${parameter.label} (rebuilds)`}
            value={state.parameters[parameter.key] ?? parameter.default}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={(value) =>
              state.setParameters({ ...state.parameters, [parameter.key]: value })
            }
          />
        ))}
      </div>

      <CommandFlood
        session={session}
        rate={config.commandRate}
        collectionKey={collectionKey}
      />

      <div className="tool-toolbar">
        <button
          type="button"
          className="control-button primary"
          disabled={running}
          onClick={() => {
            setRunning(true);
            // Synchronous by design. A sweep that yielded to the event loop
            // would be measuring the browser's other work as well as the
            // engine's, which is the exact confound the sweep exists to remove.
            try {
              setSweep(
                runSweep(session, [10, 50, 200, 500, 1000, 2000, 4000], {
                  collectionKey,
                  framesPerPoint: 40,
                }),
              );
            } finally {
              setRunning(false);
              session.start();
            }
          }}
        >
          {running ? "Sweeping…" : "Run sweep"}
        </button>
        <span className="dim">
          Steps frames by hand at fixed wall times, so two runs measure the same work.
        </span>
      </div>

      {sweep !== null ? (
        <>
          <table className="log-table" data-testid="sweep">
            <thead>
              <tr>
                <th className="num">rows</th>
                <th className="num">mirror nodes</th>
                <th className="num">p50 ms</th>
                <th className="num">p95 ms</th>
                <th className="num">max ms</th>
                <th className="num">budget</th>
                <th>fits</th>
              </tr>
            </thead>
            <tbody>
              {sweep.map((point) => (
                <tr key={point.collectionSize} className={point.fits ? "" : "bad"}>
                  <td className="num">{point.collectionSize}</td>
                  <td className="num">{point.nodeCount}</td>
                  <td className="num">{ms(point.stats.total.p50)}</td>
                  <td className="num">{ms(point.stats.total.p95)}</td>
                  <td className="num">{ms(point.stats.total.max)}</td>
                  <td className="num">{(point.budgetRatio * 100).toFixed(0)}%</td>
                  <td>{point.fits ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="finding">
            {budgetCeiling(sweep) === null
              ? "Nothing fit in a frame, including the smallest size tried."
              : `Largest size fitting in a 60fps frame: ${budgetCeiling(sweep)!.collectionSize} rows (${budgetCeiling(sweep)!.nodeCount} mirror nodes).`}
          </p>
        </>
      ) : null}
    </div>
  );
}

function Axis({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="axis">
      <span className="control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <span className="control-value">{value}</span>
    </label>
  );
}

/** Pushes patches at a fixed rate. Deterministic target selection, not random. */
function CommandFlood({
  session,
  rate,
  collectionKey,
}: {
  session: ShowcaseSession;
  rate: number;
  collectionKey: string;
}) {
  const cursor = useRef(0);

  useEffect(() => {
    if (rate <= 0) return;
    const timer = window.setInterval(() => {
      const collection = session.host.runtime.state.variables.get(collectionKey);
      if (!Array.isArray(collection) || collection.length === 0) return;
      const index = cursor.current % collection.length;
      cursor.current += 1;
      const item = collection[index] as { id?: string } | undefined;
      if (item?.id === undefined) return;
      session.send(
        {
          type: "collection.patch",
          key: collectionKey,
          id: item.id,
          keyField: "id",
          patch: { score: cursor.current },
        } as never,
        "feed",
      );
    }, 1000 / rate);
    return () => window.clearInterval(timer);
  }, [session, rate, collectionKey]);

  return null;
}

// ---------------------------------------------------------------------------
// Debug layers
// ---------------------------------------------------------------------------

export interface LayerSettings {
  readonly bounds: boolean;
  readonly layout: boolean;
  readonly anchors: boolean;
  readonly origins: boolean;
}

export const NO_LAYERS: LayerSettings = {
  bounds: false,
  layout: false,
  anchors: false,
  origins: false,
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
  highlight,
}: {
  session: ShowcaseSession | null;
  layers: LayerSettings;
  canvasWidth: number;
  canvasHeight: number;
  highlight?: ReadonlySet<string>;
}) {
  const enabled = layers.bounds || layers.layout || layers.anchors || layers.origins;

  const boxes = useMemo<readonly DebugBox[]>(() => {
    if (session === null || !enabled) return [];
    return debugBoxes(session, {
      canvasWidth,
      canvasHeight,
      orthographicSize: 5,
      ...(highlight === undefined ? {} : { highlight }),
    });
  }, [session, enabled, canvasWidth, canvasHeight, highlight]);

  if (!enabled || boxes.length === 0) return null;

  const shown = boxes.filter(
    (box) =>
      (layers.bounds && box.kind === "bounds") ||
      (layers.layout && box.kind === "layout") ||
      (layers.anchors && box.kind === "anchor") ||
      box.selected,
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
          className={`layer ${box.kind}${box.selected ? " selected" : ""}`}
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
  state,
  savedStress,
  onSaveStress,
}: {
  session: ShowcaseSession;
  metrics: Metrics;
  state: WorkbenchState;
  savedStress: readonly StressConfig[];
  onSaveStress: (config: StressConfig) => void;
}) {
  return (
    <section className="workbench" aria-label="Workbench">
      <nav className="tool-tabs" role="tablist">
        {TOOLS.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === state.tool}
            className={entry.id === state.tool ? "active" : ""}
            onClick={() => state.setTool(entry.id)}
            title={`${entry.hint} — ${index + 1}`}
          >
            {entry.label}
            <span className="digit">{index + 1}</span>
          </button>
        ))}
      </nav>

      {/* Only the visible tool reads the engine. */}
      {state.tool === "inspector" ? <Inspector session={session} state={state} /> : null}
      {state.tool === "console" ? <Console session={session} state={state} /> : null}
      {state.tool === "timeline" ? <Timeline session={session} /> : null}
      {state.tool === "performance" ? (
        <Performance session={session} metrics={metrics} state={state} />
      ) : null}
      {state.tool === "outputs" ? (
        <Outputs session={session} metrics={metrics} state={state} />
      ) : null}
      {state.tool === "watch" ? <Watch session={session} state={state} /> : null}
      {state.tool === "recorder" ? <Recorder session={session} state={state} /> : null}
      {state.tool === "stress" ? (
        <Stress session={session} state={state} saved={savedStress} onSave={onSaveStress} />
      ) : null}
    </section>
  );
}
