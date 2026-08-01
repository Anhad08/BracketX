"use client";

import { useCallback, useMemo, useState } from "react";
import { makeDemoScene, type SceneHost } from "@bracketx/engine-host";

import { SceneViewport } from "../components/scene-viewport";

/**
 * The vertical slice, on screen.
 *
 * Every pixel below originates in a SceneDocument: no CSS shapes, no images,
 * no placeholder geometry. The controls drive the engine's real paths — a
 * variable change goes through the runtime and re-resolves only the nodes that
 * read it, exactly as a score update would on air.
 */
export function RenderCheck() {
  const scene = useMemo(() => makeDemoScene(), []);
  const [host, setHost] = useState<SceneHost | null>(null);
  const [accent, setAccent] = useState("#E8B23A");

  const onReady = useCallback((next: SceneHost) => {
    setHost(next);
    // The browser suite reaches the engine through this. It is also genuinely
    // useful in development for poking at a live scene from the console.
    (window as unknown as { __bracketx?: unknown }).__bracketx = {
      host: next,
      diagnostics: () => next.reconciler.verify(),
    };
  }, []);

  const setAccentColor = (value: string) => {
    setAccent(value);
    host?.setVariable("accentColor", value);
  };

  return (
    <main className="flex min-h-svh flex-col gap-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Render check</h1>
        <p className="text-sm text-muted-foreground">
          A lower third authored in SCENE_FORMAT v2, drawn through Runtime →
          Reconciler → MirrorBackend → WebGL. Nothing here is CSS.
        </p>
      </header>

      <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg border">
        <SceneViewport document={scene} onReady={onReady} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {["#E8B23A", "#22C55E", "#EF4444", "#3B82F6"].map((color) => (
          <button
            key={color}
            type="button"
            data-testid={`accent-${color.slice(1)}`}
            onClick={() => setAccentColor(color)}
            aria-pressed={accent === color}
            className="size-9 rounded-md border-2 transition"
            style={{
              backgroundColor: color,
              borderColor: accent === color ? "currentColor" : "transparent",
            }}
          >
            <span className="sr-only">Accent {color}</span>
          </button>
        ))}
        <span className="text-sm text-muted-foreground">
          Changing the accent dispatches a runtime variable, not a document
          edit.
        </span>
      </div>
    </main>
  );
}
