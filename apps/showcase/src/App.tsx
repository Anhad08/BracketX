import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clampParameters,
  defaultParameters,
  getScene,
  listGroups,
  listScenes,
  type SceneParameters,
  type ShowcaseScene,
} from "./registry";
import { captureScreenshot, downloadScreenshot } from "./engine/screenshot";
import { findSpikes, type Baseline } from "./engine/history";
import { alerts as deriveAlerts, worstSeverity, type Alert } from "./tools/alerts";
import { dirtyOrigins } from "./tools/model";
import { AlertsOverlay, DeveloperOverlay, PerformanceOverlay } from "./ui/overlays";
import { CommandPalette, KeyboardHelp } from "./ui/palette";
import { Panels, Viewport, type ViewportHandle } from "./ui/viewport";
import {
  DebugLayers,
  TOOLS,
  Workbench,
  type LayerSettings,
  type ToolId,
  type WorkbenchState,
} from "./tools/workbench";
import { buildPalette, matchBinding, TOOL_DIGIT_KEYS } from "./tools/palette";
import type { StressConfig } from "./tools/stress";
import type { SessionSnapshot } from "@bracketx/engine-host";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  pushRecent,
  saveSettings,
  toggleInList,
  type ShowcaseSettings,
} from "./settings";

/**
 * The shell.
 *
 * Routing is the URL hash. No router dependency: a development tool should open
 * from a file, survive a reload, and produce a link that still works next year.
 * `#/scene-id` does all three in about ten lines.
 *
 * ============================================================================
 * WHY THE SHELL OWNS SO MUCH STATE
 * ============================================================================
 * Selection, pins, watches, the baseline, the snapshot, the open tool. Every
 * one of these is reachable from at least two places — a tool, the palette, a
 * keyboard chord, an alert's "go here" button — and state that lives inside one
 * tool cannot be reached by the others. An alert that can say "open this node"
 * is the difference between a finding and a fix, and that only works if the
 * selection is above both of them.
 */

/** Frames the findings rules reason over. Five seconds at 60fps. */
const ALERT_WINDOW = 300;

/** How often findings are re-derived. Conclusions change slower than numbers. */
const FINDINGS_INTERVAL_MS = 500;

function currentSceneId(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, "").trim();
  return hash.length > 0 ? hash : null;
}

function useHashRoute(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(currentSceneId);

  useEffect(() => {
    const onChange = () => setId(currentSceneId());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: string) => {
    window.location.hash = `#/${next}`;
  }, []);

  return [id, navigate];
}

export function App() {
  const groups = useMemo(() => listGroups(), []);
  const scenes = useMemo(() => listScenes(), []);
  const [settings, setSettings] = useState<ShowcaseSettings>(DEFAULT_SETTINGS);
  const [routeId, navigate] = useHashRoute();
  const [handle, setHandle] = useState<ViewportHandle>({
    session: null,
    canvas: null,
    generation: 0,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [sceneFilter, setSceneFilter] = useState("");

  // Workbench state, shared by every surface that can reach it.
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [parameters, setParameters] = useState<SceneParameters>({});
  const [searchToken, setSearchToken] = useState(0);
  const [hashes, setHashes] = useState(false);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);

  // Settings load after mount, not during render: localStorage is unavailable
  // in some environments and reading it in a render body makes the first paint
  // depend on the browser's mood.
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const update = useCallback((patch: Partial<ShowcaseSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const first = groups[0]?.scenes[0];
  const scene: ShowcaseScene | undefined =
    (routeId === null ? undefined : getScene(routeId)) ??
    (settings.lastSceneId === null ? undefined : getScene(settings.lastSceneId)) ??
    first;

  useEffect(() => {
    if (scene !== undefined && scene.id !== settings.lastSceneId) {
      update({
        lastSceneId: scene.id,
        recentSceneIds: pushRecent(settings.recentSceneIds, scene.id),
      });
    }
  }, [scene, settings.lastSceneId, settings.recentSceneIds, update]);

  // A new scene means new parameters and a stale selection.
  useEffect(() => {
    setParameters(scene === undefined ? {} : defaultParameters(scene));
    setSelected(null);
    setExpanded(new Set());
    setBaseline(null);
    setSnapshot(null);
  }, [scene]);

  const session = handle.session;

  // Open the first two levels when a session appears. A tree that shows one
  // root row and nothing else is technically correct and reads as broken; two
  // levels is the smallest amount that looks like a scene.
  useEffect(() => {
    if (session === null) return;
    const mirror = session.host.reconciler.mirror;
    const root = mirror.rootId;
    if (root === null) return;
    setExpanded(new Set([root, ...mirror.childrenOf(root)]));
  }, [session, handle.generation]);

  const reveal = useCallback(
    (nodeId: string) => {
      setSelected(nodeId);
      const path = session?.host.reconciler.mirror.ancestorsOf(nodeId) ?? [];
      setExpanded((current) => new Set([...current, ...path]));
    },
    [session],
  );

  const state: WorkbenchState = useMemo(
    () => ({
      tool: settings.tool as ToolId,
      setTool: (tool) => update({ tool }),
      selected,
      select: setSelected,
      expanded,
      setExpanded,
      reveal,
      pinned: settings.pinnedNodeIds,
      togglePin: (nodeId) => update({ pinnedNodeIds: toggleInList(settings.pinnedNodeIds, nodeId) }),
      watched: settings.watchedKeys,
      toggleWatch: (key) => update({ watchedKeys: toggleInList(settings.watchedKeys, key) }),
      baseline,
      setBaseline,
      snapshot,
      setSnapshot,
      parameters,
      setParameters: (next) =>
        setParameters(scene === undefined ? next : clampParameters(scene, next)),
      searchToken,
    }),
    [
      settings.tool,
      settings.pinnedNodeIds,
      settings.watchedKeys,
      selected,
      expanded,
      reveal,
      baseline,
      snapshot,
      parameters,
      searchToken,
      scene,
      update,
    ],
  );

  // Hoisted out of the JSX: hooks may not be called inside a conditional
  // branch, and the stage only renders when a scene resolved.
  const highlight = useMemo(
    () => new Set([...(selected === null ? [] : [selected]), ...settings.pinnedNodeIds]),
    [selected, settings.pinnedNodeIds],
  );

  const layers: LayerSettings = {
    bounds: settings.layers.bounds ?? false,
    layout: settings.layers.layout ?? false,
    anchors: settings.layers.anchors ?? false,
    origins: settings.layers.origins ?? false,
  };

  const onScreenshot = useCallback(() => {
    try {
      const shot = captureScreenshot(handle.session!, handle.canvas);
      downloadScreenshot(shot);
      setNotice(`captured ${shot.sceneId} @ frame ${shot.frame}`);
    } catch (error) {
      setNotice(String(error));
    }
  }, [handle]);

  // --- Palette + keyboard --------------------------------------------------

  const sceneIndexInList = scenes.findIndex((entry) => entry.id === scene?.id);
  const goRelative = useCallback(
    (delta: number) => {
      if (scenes.length === 0) return;
      const next = scenes[(sceneIndexInList + delta + scenes.length) % scenes.length];
      if (next !== undefined) navigate(next.id);
    },
    [scenes, sceneIndexInList, navigate],
  );

  const actions = useMemo(
    () =>
      buildPalette({
        scenes,
        currentSceneId: scene?.id ?? null,
        tools: TOOLS.map((tool) => ({ id: tool.id, label: tool.label })),
        recentSceneIds: settings.recentSceneIds,
        playing: session?.host.runtime.clock.snapshot().status === "playing",
        goToScene: navigate,
        openTool: (id) => update({ tool: id }),
        toggleTransport: () => {
          if (session === null) return;
          const playing = session.host.runtime.clock.snapshot().status === "playing";
          session.send({ type: playing ? "playback.pause" : "playback.play" }, "workbench");
          if (!playing) session.start();
          else session.stop();
        },
        step: (frames) => {
          if (session === null) return;
          if (frames >= 0) session.stepFrames(frames);
          else session.seekTo(Math.max(0, session.frame + frames));
        },
        restart: () => session?.seekTo(0),
        captureBaseline: () => {
          if (session === null) return;
          setBaseline(session.history.captureBaseline(`f${session.frame}`));
          setNotice("Baseline captured. Everything after this is compared to it.");
        },
        captureSnapshot: () => {
          if (session === null) return;
          setSnapshot(session.session());
          setNotice("Snapshot captured. Open the Recorder to read the diff.");
        },
        screenshot: onScreenshot,
        toggleLayer: (layer) =>
          update({ layers: { ...settings.layers, [layer]: !settings.layers[layer] } }),
        toggleWorkbench: () => update({ workbenchOpen: !settings.workbenchOpen }),
        resetWorkspace: () => {
          update({
            pinnedNodeIds: [],
            watchedKeys: [],
            workbenchSize: DEFAULT_SETTINGS.workbenchSize,
            layers: DEFAULT_SETTINGS.layers,
          });
          setNotice("Workspace reset.");
        },
        showKeys: () => setKeysOpen(true),
      }),
    [scenes, scene, settings, session, navigate, update, onScreenshot],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // Tool digits, when not typing. Declared here rather than in KEYMAP
      // because the count is data — a ninth tool must not need a code change.
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const digit = TOOL_DIGIT_KEYS.indexOf(event.key);
        if (digit >= 0 && digit < TOOLS.length) {
          event.preventDefault();
          update({ tool: TOOLS[digit]!.id });
          return;
        }
      }

      const binding = matchBinding(event, typing);
      if (binding === null) return;

      if (binding.id === "ui.escape") {
        setPaletteOpen(false);
        setKeysOpen(false);
        return;
      }

      event.preventDefault();
      if (binding.id === "palette.open" || binding.id === "palette.scenes") {
        setPaletteOpen(true);
        return;
      }
      if (binding.id === "search.nodes") {
        update({ tool: "inspector", workbenchOpen: true });
        setSearchToken((token) => token + 1);
        return;
      }
      if (binding.id === "scene.previous") return goRelative(-1);
      if (binding.id === "scene.next") return goRelative(1);

      actions.find((action) => action.id === binding.id)?.run();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, goRelative, update]);

  // --- Alerts --------------------------------------------------------------

  // A short trail of node counts, so "the mirror only grows" can be a finding
  // rather than something an engineer notices by accident three hours in.
  const nodeTrail = useRef<{ count: number; at: number }[]>([]);
  useEffect(() => {
    nodeTrail.current = [];
  }, [handle.generation]);

  const computeAlerts = useCallback(
    (diagnostics: Parameters<typeof deriveAlerts>[0]["diagnostics"]): readonly Alert[] => {
      if (session === null) return [];
      // A bounded window, not the whole retained history. Summarising 1,800
      // samples across six fields measured 1.07ms; ten times a second that is
      // 1% of a core spent so a panel can restate what the last five seconds
      // already say. Findings are about NOW.
      const samples = session.history.recent(ALERT_WINDOW);
      const trail = nodeTrail.current;
      trail.push({ count: diagnostics.nodeCount, at: diagnostics.frame });
      if (trail.length > 120) trail.shift();
      const firstEntry = trail[0];
      const lastEntry = trail[trail.length - 1];

      return deriveAlerts({
        diagnostics,
        stats: session.history.stats(samples),
        baseline,
        spikes: findSpikes(samples),
        origins: dirtyOrigins(session, session.host.log.entries(), 100),
        records: session.host.log.entries(),
        ...(firstEntry !== undefined && lastEntry !== undefined && trail.length > 20
          ? {
              nodeCountWindow: {
                first: firstEntry.count,
                last: lastEntry.count,
                seconds: (lastEntry.at - firstEntry.at) / 60,
              },
            }
          : {}),
      });
    },
    [session, baseline],
  );

  const onAlertAction = useCallback(
    (alert: Alert) => {
      const action = alert.action;
      if (action === undefined) return;
      if (action.kind === "open-tool") update({ tool: action.target, workbenchOpen: true });
      else if (action.kind === "select-node") reveal(action.target);
      else if (action.kind === "watch-variable") {
        update({ tool: "watch", watchedKeys: toggleInList(settings.watchedKeys, action.target) });
      }
    },
    [update, reveal, settings.watchedKeys],
  );

  // --- Workbench resize ----------------------------------------------------

  const dragging = useRef(false);
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      const fromBottom = ((window.innerHeight - event.clientY) / window.innerHeight) * 100;
      update({ workbenchSize: Math.min(80, Math.max(15, fromBottom)) });
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [update]);

  const visibleGroups = useMemo(() => {
    const needle = sceneFilter.trim().toLowerCase();
    if (needle.length === 0) return groups;
    return groups
      .map((group) => ({
        name: group.name,
        scenes: group.scenes.filter(
          (entry) =>
            entry.title.toLowerCase().includes(needle) ||
            entry.id.includes(needle) ||
            entry.capability.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.scenes.length > 0);
  }, [groups, sceneFilter]);

  const railOpen =
    settings.alertsOverlay || settings.developerOverlay || settings.performanceOverlay;

  return (
    <div className={`app ${railOpen ? "" : "no-rail"}`}>
      <aside className="sidebar">
        <header>
          <h1>BracketX</h1>
          <p className="dim">Engineering Workbench</p>
        </header>

        <input
          className="control-text"
          placeholder="Filter scenes"
          value={sceneFilter}
          onChange={(event) => setSceneFilter(event.target.value)}
          aria-label="Filter scenes"
        />
        <button type="button" className="palette-hintbar" onClick={() => setPaletteOpen(true)}>
          <span>Command palette</span>
          <kbd>Ctrl/⌘ K</kbd>
        </button>

        <nav>
          {visibleGroups.length === 0 ? (
            <p className="empty">No scene matches.</p>
          ) : (
            visibleGroups.map((group) => (
              <section key={group.name}>
                <h2>{group.name}</h2>
                <ul>
                  {group.scenes.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={entry.id === scene?.id ? "active" : ""}
                        onClick={() => navigate(entry.id)}
                        title={entry.summary}
                      >
                        {entry.title}
                        <span className="capability">{entry.capability}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>

        <section className="settings">
          <h2>Panels</h2>
          {(
            [
              ["alertsOverlay", "Findings"],
              ["developerOverlay", "Diagnostics"],
              ["performanceOverlay", "Performance"],
              ["autoPlay", "Auto-play clock"],
              ["previewOutput", "Second output"],
              ["fitCanvas", "Fit canvas"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(event) => update({ [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
          <button type="button" className="action" onClick={() => setKeysOpen(true)}>
            Keyboard reference
          </button>
          {notice !== null ? <p className="notice">{notice}</p> : null}
        </section>
      </aside>

      <main>
        {scene === undefined ? (
          <div className="placeholder">
            <h2>No scenes registered</h2>
            <p>
              The shell is working. Register a scene to see it here — see{" "}
              <code>SHOWCASE_GUIDE.md</code>.
            </p>
          </div>
        ) : (
          <>
            <header className="scene-header">
              <div>
                <h2>{scene.title}</h2>
                <p className="dim">{scene.summary}</p>
              </div>
              <Panels
                session={session}
                render={({ diagnostics }) => (
                  <div className="transport" data-testid="transport">
                    <button
                      type="button"
                      className="control-button"
                      onClick={() => {
                        if (session === null) return;
                        if (diagnostics.playing) {
                          session.send({ type: "playback.pause" }, "workbench");
                          session.stop();
                        } else {
                          session.send({ type: "playback.play" }, "workbench");
                          session.start();
                        }
                      }}
                      aria-label={diagnostics.playing ? "Pause" : "Play"}
                    >
                      {diagnostics.playing ? "❚❚" : "▶"}
                    </button>
                    <button
                      type="button"
                      className="control-button"
                      onClick={() => session?.seekTo(Math.max(0, session.frame - 1))}
                      title="Step back one frame (,)"
                    >
                      ◀|
                    </button>
                    <button
                      type="button"
                      className="control-button"
                      onClick={() => session?.stepFrames(1)}
                      title="Step one frame (.)"
                    >
                      |▶
                    </button>
                    <span className="frame-counter mono" data-testid="frame-counter">
                      f{diagnostics.frame}
                    </span>
                    <span className="capability-badge">{scene.capability}</span>
                  </div>
                )}
              />
            </header>

            <div className="stage">
              <Viewport
                scene={scene}
                settings={settings}
                parameters={parameters}
                onReady={setHandle}
              />
              <DebugLayers
                session={session}
                layers={layers}
                canvasWidth={handle.canvas?.width ?? 1920}
                canvasHeight={handle.canvas?.height ?? 1080}
                highlight={highlight}
              />
            </div>

            <div className="layer-bar">
              <span className="control-label">Overlays</span>
              {(
                [
                  ["bounds", "Bounds"],
                  ["layout", "Layout"],
                  ["anchors", "Anchors"],
                  ["origins", "Origins"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="control-toggle">
                  <input
                    type="checkbox"
                    checked={settings.layers[key] ?? false}
                    onChange={(event) =>
                      update({ layers: { ...settings.layers, [key]: event.target.checked } })
                    }
                  />
                  {label}
                </label>
              ))}
              <span className="spacer" />
              {scene.controls !== undefined ? null : (
                <span className="dim">This scene declares no controls.</span>
              )}
              <button
                type="button"
                className="control-button"
                onClick={() => update({ workbenchOpen: !settings.workbenchOpen })}
              >
                {settings.workbenchOpen ? "Hide workbench" : "Show workbench"}
              </button>
            </div>

            {scene.controls !== undefined ? (
              <Panels
                session={session}
                render={({ diagnostics }) => (
                  <section className="controls">
                    {scene.controls!({
                      send: (command) => session?.send(command),
                      edit: (transaction) => session?.edit(transaction),
                      variables: Object.fromEntries(session!.host.runtime.state.variables),
                      frame: diagnostics.frame,
                      playing: diagnostics.playing,
                      activeStates: diagnostics.activeStates,
                    })}
                  </section>
                )}
              />
            ) : null}

            {settings.workbenchOpen && session !== null ? (
              <>
                <div
                  className="resizer"
                  onPointerDown={() => {
                    dragging.current = true;
                  }}
                  role="separator"
                  aria-label="Resize workbench"
                />
                <div style={{ height: `${settings.workbenchSize}vh`, minHeight: 0, display: "flex" }}>
                  <Panels
                    session={session}
                    render={({ metrics }) => (
                      <Workbench
                        session={session}
                        metrics={metrics}
                        state={state}
                        savedStress={settings.savedStress}
                        onSaveStress={(config: StressConfig) =>
                          update({ savedStress: [...settings.savedStress, config].slice(-20) })
                        }
                      />
                    )}
                  />
                </div>
              </>
            ) : null}
          </>
        )}
      </main>

      {railOpen ? (
        <aside className="panels">
          {/* Findings sample at 2Hz, numbers at 10Hz, deliberately.
              Summarising 300 frames across six fields is the most expensive
              read in the workbench at 0.23ms, and — more importantly — a
              finding that appears and vanishes five times a second is a finding
              nobody reads. Numbers move fast; conclusions should not. */}
          {settings.alertsOverlay ? (
            <Panels
              session={session}
              intervalMs={FINDINGS_INTERVAL_MS}
              render={({ diagnostics }) => (
                <AlertsOverlay alerts={computeAlerts(diagnostics)} onAction={onAlertAction} />
              )}
            />
          ) : null}
          <Panels
            session={session}
            hashes={hashes}
            render={({ diagnostics, metrics }) => (
              <>
                {settings.performanceOverlay ? (
                  <PerformanceOverlay metrics={metrics} diagnostics={diagnostics} />
                ) : null}
                {settings.developerOverlay ? (
                  <DeveloperOverlay diagnostics={diagnostics} onHash={() => setHashes(true)} />
                ) : null}
              </>
            )}
          />
        </aside>
      ) : null}

      {paletteOpen ? (
        <CommandPalette actions={actions} onClose={() => setPaletteOpen(false)} />
      ) : null}
      {keysOpen ? <KeyboardHelp onClose={() => setKeysOpen(false)} /> : null}
    </div>
  );
}

/** Exported for the alert badge in tests. */
export { worstSeverity };
