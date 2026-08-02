import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createCanvasBackend } from "@bracketx/engine-render-three";

import { ShowcaseSession } from "../engine/session";
import type { Diagnostics } from "../engine/session";
import type { Metrics } from "../engine/metrics";
import type { SceneParameters, ShowcaseScene } from "../registry";
import type { ShowcaseSettings } from "../settings";

/**
 * Mounts a scene onto a real canvas and keeps the panels fed.
 *
 * The thin React adapter over ShowcaseSession. Everything worth verifying lives
 * in the session, which is why this component has no logic beyond lifecycle and
 * a sampling interval.
 */

export interface ViewportHandle {
  readonly session: ShowcaseSession | null;
  readonly canvas: HTMLCanvasElement | null;
  /** Bumped whenever a session is replaced, so consumers can reset local state. */
  readonly generation: number;
}

let generation = 0;

export function Viewport({
  scene,
  settings,
  parameters,
  onReady,
}: {
  scene: ShowcaseScene;
  settings: ShowcaseSettings;
  /** Build parameters. Changing these rebuilds the document — see the stress lab. */
  parameters: SceneParameters;
  onReady: (handle: ViewportHandle) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<ShowcaseSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    (mark: number) => {
      onReady({ session: sessionRef.current, canvas: canvasRef.current, generation: mark });
    },
    [onReady],
  );

  // Serialised so a parameter object rebuilt with the same values does not
  // tear down a running session. Object identity would rebuild on every render.
  const parameterKey = JSON.stringify(parameters);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let session: ShowcaseSession | null = null;
    let backend: ReturnType<typeof createCanvasBackend> | null = null;
    const mark = (generation += 1);

    try {
      const built = JSON.parse(parameterKey) as SceneParameters;
      const document_ = scene.build(built);
      const { width, height } = document_.world.output;
      // The canvas carries the DOCUMENT's resolution. CSS scales the result; it
      // must not change what is rendered, or the workbench would disagree with
      // the programme feed it is meant to verify.
      canvas.width = width;
      canvas.height = height;

      backend = createCanvasBackend(canvas);
      session = new ShowcaseSession(scene, backend, {
        parameters: built,
        outputs: settings.previewOutput
          ? [
              {
                id: "preview",
                width: Math.round(width / 2),
                height: Math.round(height / 2),
                cadence: 2,
              },
            ]
          : [],
      });

      session.load();
      if (!settings.autoPlay) {
        session.send({ type: "playback.pause" }, "workbench");
      }
      session.start();

      sessionRef.current = session;
      setError(null);
      publish(mark);
    } catch (cause) {
      // WebGL can be unavailable entirely — a locked-down browser, a headless
      // environment, a GPU lost at startup. Say so rather than showing an empty
      // rectangle that reads as a scene bug.
      setError(String(cause));
    }

    return () => {
      session?.dispose();
      backend?.dispose();
      sessionRef.current = null;
      publish(generation += 1);
    };
  }, [scene, settings.autoPlay, settings.previewOutput, parameterKey, publish]);

  return (
    <div className="viewport">
      {/* The checkerboard is not decoration. Broadcast output is transparent
          and composites over live video; a solid backdrop would hide an alpha
          bug until it reached air. */}
      <div className="checker" aria-hidden />
      <canvas
        ref={canvasRef}
        data-testid="showcase-canvas"
        data-scene={scene.id}
        className={settings.fitCanvas ? "fit" : ""}
      />
      {error !== null ? (
        <p role="alert" className="error">
          Rendering unavailable: {error}
        </p>
      ) : null}
    </div>
  );
}

export interface PanelData {
  readonly diagnostics: Diagnostics;
  readonly metrics: Metrics;
}

/**
 * The sampling tick, and the only place engine state is read for display.
 *
 * The timer lives HERE rather than in the shell or the viewport, and that
 * placement is the whole point: an earlier version ticked in the viewport,
 * which re-rendered the viewport while the panels rendered in the shell — so
 * every number froze at the last shell render. The tool reported "1 frame" for
 * a session that was rendering sixty a second, and the only reason it was
 * caught is that the diagnostics disagreed with the picture.
 *
 * Scoped to the panels so a refresh does not re-render the canvas host.
 */
export function Panels({
  session,
  hashes = false,
  intervalMs = 100,
  render,
}: {
  session: ShowcaseSession | null;
  /** Compute session hashes on each sample. Costs a full canonicalisation. */
  hashes?: boolean;
  intervalMs?: number;
  render: (panels: PanelData) => ReactNode;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (session === null) return;
    // 10Hz by default. Measured: the sampled reads together cost far less than
    // one frame, and faster than an eye reads a changing number is waste.
    const timer = window.setInterval(() => tick((n) => n + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [session, intervalMs]);

  if (session === null || session.disposed) return null;

  return (
    <>
      {render({
        diagnostics: session.diagnostics({ hashes }),
        metrics: session.metrics(),
      })}
    </>
  );
}
