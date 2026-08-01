import { useCallback, useEffect, useMemo, useState } from "react";

import { getScene, listGroups, type ShowcaseScene } from "./registry";
import { captureScreenshot, downloadScreenshot } from "./engine/screenshot";
import { DeveloperOverlay, PerformanceOverlay } from "./ui/overlays";
import { Viewport, readPanels, type ViewportHandle } from "./ui/viewport";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type ShowcaseSettings,
} from "./settings";

/**
 * The shell.
 *
 * Routing is the URL hash. No router dependency: a development tool should open
 * from a file, survive a reload, and produce a link that still works next year.
 * `#/scene-id` does all three in about ten lines.
 */

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
  const [settings, setSettings] = useState<ShowcaseSettings>(DEFAULT_SETTINGS);
  const [routeId, navigate] = useHashRoute();
  const [handle, setHandle] = useState<ViewportHandle>({
    session: null,
    canvas: null,
  });
  const [notice, setNotice] = useState<string | null>(null);

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
      update({ lastSceneId: scene.id });
    }
  }, [scene, settings.lastSceneId, update]);

  const { diagnostics, metrics } = readPanels(handle.session);

  const onScreenshot = useCallback(() => {
    try {
      const shot = captureScreenshot(handle.session!, handle.canvas);
      downloadScreenshot(shot);
      setNotice(`captured ${shot.sceneId} @ frame ${shot.frame}`);
    } catch (error) {
      setNotice(String(error));
    }
  }, [handle]);

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>BracketX</h1>
          <p className="dim">Engine Showcase</p>
        </header>

        <nav>
          {groups.length === 0 ? (
            <p className="empty">
              No scenes registered yet. Add one with <code>registerScene</code>.
            </p>
          ) : (
            groups.map((group) => (
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
          <h2>Developer</h2>
          {(
            [
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
          <button
            type="button"
            className="action"
            onClick={onScreenshot}
            disabled={handle.session === null}
          >
            Capture screenshot
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
              <span className="capability-badge">{scene.capability}</span>
            </header>

            <Viewport scene={scene} settings={settings} onReady={setHandle} />

            {scene.controls !== undefined && handle.session !== null && diagnostics !== null ? (
              <section className="controls">
                {scene.controls({
                  send: (command) => handle.session?.send(command),
                  variables: Object.fromEntries(
                    handle.session.host.runtime.state.variables,
                  ),
                  frame: diagnostics.frame,
                  playing: diagnostics.playing,
                  activeStates: handle.session.host.activeStates,
                })}
              </section>
            ) : null}
          </>
        )}
      </main>

      {(settings.developerOverlay || settings.performanceOverlay) &&
      diagnostics !== null &&
      metrics !== null ? (
        <aside className="panels">
          {settings.performanceOverlay ? (
            <PerformanceOverlay metrics={metrics} diagnostics={diagnostics} />
          ) : null}
          {settings.developerOverlay ? (
            <DeveloperOverlay diagnostics={diagnostics} />
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
