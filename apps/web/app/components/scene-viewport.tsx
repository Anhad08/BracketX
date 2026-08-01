"use client";

/**
 * The render surface. Phase 2.6d.
 *
 * This component is the entire application-side of rendering: create a canvas,
 * hand it to the engine, drive frames, tear down. It imports no renderer type
 * and contains no scene logic — swapping Three.js for WebGPU would not change
 * a line of it.
 *
 * Everything visible is produced by the engine from a SceneDocument.
 */
import { useEffect, useRef, useState } from "react";
import {
  FrameLoop,
  SceneHost,
  browserScheduler,
} from "@bracketx/engine-host";
import { createCanvasBackend } from "@bracketx/engine-render-three";
import type { SceneDocument } from "@bracketx/engine-scene";

export interface SceneViewportProps {
  readonly document: SceneDocument;
  /** Start the clock immediately. Off by default — loaded is cued, not on air. */
  readonly autoPlay?: boolean;
  /** Exposes the host for controls and for the browser verification suite. */
  readonly onReady?: (host: SceneHost) => void;
}

interface Status {
  readonly kind: "loading" | "ready" | "failed";
  readonly detail?: string;
}

export function SceneViewport({
  document: sceneDocument,
  autoPlay = false,
  onReady,
}: SceneViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let host: SceneHost | null = null;
    let loop: FrameLoop | null = null;
    let backend: ReturnType<typeof createCanvasBackend> | null = null;

    try {
      const { width, height } = sceneDocument.world.output;
      // The canvas carries the document's declared resolution, not the
      // element's CSS size. CSS scales the result; it must not change what is
      // rendered, or the preview would disagree with the programme feed.
      canvas.width = width;
      canvas.height = height;

      backend = createCanvasBackend(canvas);
      host = new SceneHost(backend);
      host.load(sceneDocument);
      if (autoPlay) host.play();

      loop = new FrameLoop(host, {
        scheduler: browserScheduler(),
        onError: (error) => {
          // A frame that throws must not freeze the output silently.
          console.error("[bracketx] frame failed", error);
          setStatus({ kind: "failed", detail: String(error) });
        },
      });
      loop.start();

      setStatus({ kind: "ready" });
      onReady?.(host);
    } catch (error) {
      // WebGL can be unavailable entirely — a locked-down browser, a headless
      // environment, a lost GPU at startup. Say so rather than showing a
      // blank rectangle that looks like a scene bug.
      setStatus({ kind: "failed", detail: String(error) });
    }

    return () => {
      loop?.stop();
      host?.dispose();
      backend?.dispose();
    };
  }, [sceneDocument, autoPlay, onReady]);

  return (
    <div className="relative h-full w-full">
      {/*
        The checkerboard is the point, not decoration: broadcast output is
        transparent and composites over live video. A solid background would
        hide an alpha bug until it reached air.
      */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[length:24px_24px] opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(45deg, var(--color-muted) 25%, transparent 25%, transparent 75%, var(--color-muted) 75%), " +
            "linear-gradient(45deg, var(--color-muted) 25%, transparent 25%, transparent 75%, var(--color-muted) 75%)",
          backgroundPosition: "0 0, 12px 12px",
        }}
      />
      <canvas
        ref={canvasRef}
        data-testid="scene-canvas"
        data-status={status.kind}
        className="relative h-full w-full object-contain"
      />
      {status.kind === "failed" ? (
        <p
          role="alert"
          className="absolute inset-x-0 bottom-0 bg-destructive/90 p-3 text-sm text-destructive-foreground"
        >
          Rendering unavailable: {status.detail}
        </p>
      ) : null}
    </div>
  );
}
