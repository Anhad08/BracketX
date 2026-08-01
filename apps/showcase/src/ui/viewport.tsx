import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Overlays sample on a timer, not per frame.
 *
 * Re-rendering a React tree sixty times a second to display numbers would make
 * the tool the thing that drops frames, and the measurements would then be
 * measuring the measurement. Ten hertz is faster than an eye reads a changing
 * number.
 */
const SAMPLE_INTERVAL_MS = 100;

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
  const [, forceUpdate] = useState(0);

  const publish = useCallback(() => {
    onReady({ session: sessionRef.current, canvas: canvasRef.current });
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let session: ShowcaseSession | null = null;
    let backend: ReturnType<typeof createCanvasBackend> | null = null;
    let timer: number | undefined;

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

      // Sampling drives the overlays. The session records metrics on every
      // frame regardless; this only decides how often the DOM sees them.
      timer = window.setInterval(() => forceUpdate((n) => n + 1), SAMPLE_INTERVAL_MS);
    } catch (cause) {
      // WebGL can be unavailable entirely — a locked-down browser, a headless
      // environment, a GPU lost at startup. Say so rather than showing an empty
      // rectangle that reads as a scene bug.
      setError(String(cause));
    }

    return () => {
      if (timer !== undefined) window.clearInterval(timer);
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

/** Reads live numbers out of a session for the overlays. */
export function readPanels(session: ShowcaseSession | null): {
  diagnostics: Diagnostics | null;
  metrics: Metrics | null;
} {
  if (session === null || session.disposed) {
    return { diagnostics: null, metrics: null };
  }
  return { diagnostics: session.diagnostics(), metrics: session.metrics() };
}
