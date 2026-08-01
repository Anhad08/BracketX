import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createCanvasBackend } from "@bracketx/engine-render-three";

import { ShowcaseSession } from "../engine/session";
import type { Diagnostics } from "../engine/session";
import type { Metrics } from "../engine/metrics";
import type { ShowcaseScene } from "../registry";
import type { ShowcaseSettings } from "../settings";

/**
 * Mounts a scene onto a real canvas and keeps the overlays fed.
 *
 * The thin React adapter over ShowcaseSession. Everything worth verifying lives
 * in the session, which is why this component has no logic beyond lifecycle and
 * a sampling interval.
 */

export interface ViewportHandle {
  readonly session: ShowcaseSession | null;
  readonly canvas: HTMLCanvasElement | null;
}

export function Viewport({
  scene,
  settings,
  onReady,
}: {
  scene: ShowcaseScene;
  settings: ShowcaseSettings;
  onReady: (handle: ViewportHandle) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<ShowcaseSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(() => {
    onReady({ session: sessionRef.current, canvas: canvasRef.current });
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let session: ShowcaseSession | null = null;
    let backend: ReturnType<typeof createCanvasBackend> | null = null;

    try {
      const document_ = scene.build();
      const { width, height } = document_.world.output;
      // The canvas carries the DOCUMENT's resolution. CSS scales the result; it
      // must not change what is rendered, or the showcase would disagree with
      // the programme feed it is meant to verify.
      canvas.width = width;
      canvas.height = height;

      backend = createCanvasBackend(canvas);
      session = new ShowcaseSession(scene, backend, {
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
        session.send({ type: "playback.pause" });
      }
      session.start();

      sessionRef.current = session;
      publish();
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
      publish();
    };
  }, [scene, settings.autoPlay, settings.previewOutput, publish]);

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

/**
 * The overlay panels, with their own refresh.
 *
 * The timer lives HERE rather than in the shell or the viewport, and that
 * placement is the whole point: an earlier version ticked in the viewport,
 * which re-rendered the viewport while the overlays rendered in the shell — so
 * every number froze at the last shell render. The tool reported "1 frame" for
 * a session that was rendering sixty a second, and the only reason it was
 * caught is that the diagnostics disagreed with the picture.
 *
 * Scoped to the panels so a refresh does not re-render the canvas host.
 */
export function Panels({
  session,
  developer,
  performance: showPerformance,
  render,
}: {
  session: ShowcaseSession | null;
  developer: boolean;
  performance: boolean;
  render: (panels: {
    diagnostics: Diagnostics;
    metrics: Metrics;
    developer: boolean;
    performance: boolean;
  }) => ReactNode;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (session === null) return;
    // 10Hz. Measured: a diagnostics read costs 0.226ms against a 0.0007ms
    // frame, so sampling per frame would make the tool the thing that drops
    // frames. Faster than an eye reads a changing number.
    const timer = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(timer);
  }, [session]);

  if (session === null || session.disposed) return null;

  return (
    <>
      {render({
        diagnostics: session.diagnostics(),
        metrics: session.metrics(),
        developer,
        performance: showPerformance,
      })}
    </>
  );
}
