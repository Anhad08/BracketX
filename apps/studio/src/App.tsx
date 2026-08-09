import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MenuBar } from "./ui/menubar";
import { createStorage, type StoredScene } from "./studio/storage";
import { createBackend } from "./studio/renderer";
import { PreviewPlayer, renderTemplatePreviews } from "./studio/previews";
import type { ImageProvider, TextProvider } from "@bracketx/engine-reconciler";
import { findNode, type SceneDocument, type SceneNode, type Transaction } from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { GIZMO_MODES } from "./studio/spin";
import {
  EMPTY_SELECTION,
  primaryOf,
  prune,
  selectMany,
  selectOnly,
  step as stepSelection,
  type Selection,
} from "./studio/selection";
import {
  TOOLBOX,
  createNode,
  deleteNodes,
  duplicateNodes,
  moveNode,
  renameNode,
  setProp,
  setProps,
  type NodeKind,
} from "./studio/editing";
import { outline, pathTo } from "./studio/outline";
import { randomIdFactory } from "./studio/ids";
import { PREWARM_ASCII, loadStudioFonts } from "./studio/fonts";
import { loadStudioImages } from "./studio/images";
import {
  importAsset,
  loadAssetRecords,
  referencedAssets,
  saveAssetRecords,
  thumbnailUrl,
} from "./studio/library-assets";
import { hashBytes } from "@bracketx/engine-assets";
import type { AssetRecord, AssetRegistry } from "@bracketx/engine-assets";
import { DEFAULT_VIEWPORT, type Viewport } from "./studio/viewport";
import { cancel, claimEscape } from "./studio/cancellation";
import {
  ORBIT_STEP,
  PAN_STEP,
  PRESET_SLOTS,
  type ViewportAction,
  type ViewportRequest,
} from "./studio/interaction";
import {
  fileNameFor,
  loadRecents,
  newDocument,
  newHybridDocument,
  parseDocument,
  rememberProject,
  serializeDocument,
  touch,
  type RecentProject,
} from "./studio/project";
import {
  BOTTOM_PANELS,
  DEFAULT_WORKSPACE,
  loadWorkspace,
  saveWorkspace,
  type BottomPanel,
  type Workspace,
  docksAt,
} from "./studio/workspace";
import { matchBinding, shortcutFor, type StudioCommand } from "./studio/commands";
import type { RendererChoice } from "./studio/renderer";
import { ProgramBus } from "./studio/program";
import { PRESETS, applyPreset } from "./studio/presets";
import { align, distribute, group, reorder, ungroup } from "./studio/arrange";
import { createTimeline } from "./studio/keyframes";
import { nodeBounds } from "./studio/viewport";
import {
  describeDocument,
  loadLibrary,
  promoteToTemplate,
  saveToLibrary,
  type LibraryEntry,
} from "./studio/library";
import { SceneView } from "./ui/scene-view";
import { Content, Hierarchy, Inspector, LevelFoot, Toolbox, Variables } from "./ui/panels";
import { TimelineEditor } from "./ui/timeline";
import { ArrangeBar, LibraryPanel, PresetPanel } from "./ui/authoring";
import { ProgramRow } from "./ui/program";
import { CommandPalette, KeyboardHelp } from "./ui/palette";
import { Nav } from "./ui/nav";
import { Home } from "./ui/home";
import { Assets, Marketplace, Outputs, Settings, Templates } from "./ui/sections";
import { DeveloperPanel } from "./ui/developer";
import { Production } from "./ui/production";
import { placeScene } from "./studio/place";
import { readDevice, profileFor, type DeviceInput } from "./studio/device";
import { SoundEngine, type VoiceName } from "./studio/sound";
import {
  FrameMeter,
  previewOptions,
  programOptions,
  settingsFor,
  type FrameReport,
  type QualityChoice,
} from "./studio/quality";
import { lookAtRotation, orbitOf, positionFor, type Vec3 } from "./studio/camera";
import {
  between,
  DEFAULT_SPATIAL,
  FLAT,
  glide,
  poseFor,
  VIEW_TRANSITION_MS,
  SPATIAL_MODES,
  viewOf,
  VIEWS,
  type NamedView,
} from "./studio/views";
import {
  PACKS,
  installTheme,
  instantiateTemplate,
  templatesOf,
  type Pack,
  type PackTemplate,
} from "./studio/packs";
import { resetWorkspace } from "./studio/workspace";
import { sectionSpec, type Section } from "./studio/shell";

/**
 * The shell.
 *
 * ============================================================================
 * WHAT THE SHELL OWNS, AND WHY IT IS ALL HERE
 * ============================================================================
 * Selection, the viewport, the workspace, which nodes are expanded and which
 * are locked. Every one is reachable from at least two places — a panel, the
 * palette, a keyboard chord — and state that lives inside one panel cannot be
 * reached by the others.
 *
 * What the shell does NOT own is the document. That belongs to the session, and
 * it only ever changes through a transaction.
 */

const ids = randomIdFactory();

/**
 * What the editor's bottom tabs are CALLED.
 *
 * `presets` and `library` are our words for them; a designer has Motion and
 * Templates. The ids stay as they are — renaming a persisted key would discard
 * everyone's saved layout for a caption change.
 */
const PANEL_LABEL: Record<BottomPanel, string> = {
  timeline: "Timeline",
  presets: "Motion",
  variables: "Data",
  library: "Templates",
};

/**
 * What the named views turn about.
 *
 * The world origin, not the selection: a view control that re-pivoted as the
 * selection changed would send the camera somewhere different each time you
 * pressed the same button. Orbit pivots on the selection because it is a
 * continuous gesture you are watching; a named view is a place you go back to,
 * and it has to be the same place every time.
 */
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Six decimals. Enough for a camera, and it keeps the document tidy. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}

/** The first node carrying a camera — the one the scene is shot through. */
function findCameraNode(document: SceneDocument): SceneNode | null {
  const stack = [document.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if ((node.components ?? []).some((component) => component.type === "camera")) return node;
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

export function App() {
  // The canvas is created ONCE, imperatively, before any component mounts. The
  // backend binds to it for the session's lifetime (MirrorBackend contract C2),
  // so a canvas that mounted with a component would tear down the mirror every
  // time the panel layout changed.
  /**
   * The renderer this session was STARTED on.
   *
   * Read once, at boot, and never again. A backend binds to its canvas for the
   * session's lifetime, so reading the live preference here would let a
   * settings change tear down a mirror mid-show.
   */
  const rendererRef = useRef<RendererChoice>(loadWorkspace().renderer);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (canvasRef.current === null && typeof document !== "undefined") {
    canvasRef.current = document.createElement("canvas");
  }
  // Program gets its OWN canvas and its own session, for the reason
  // `program.ts` argues at length: Program has its own clock, and one runtime
  // cannot be at two frames. A graphic must keep animating on air while a
  // designer scrubs Preview to frame zero.
  const programCanvasRef = useRef<HTMLCanvasElement | null>(null);
  if (programCanvasRef.current === null && typeof document !== "undefined") {
    programCanvasRef.current = document.createElement("canvas");
  }

  const [session, setSession] = useState<StudioSession | null>(null);
  const [bus, setBus] = useState<ProgramBus | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const [workspace, setWorkspace] = useState<Workspace>(DEFAULT_WORKSPACE);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  /**
   * The machine, re-read when the window changes.
   *
   * Rotating a tablet changes what the interface can offer, so this cannot be
   * read once at boot — a designer who turns their device to landscape has
   * earned the docks that now fit.
   */
  const [device, setDevice] = useState<DeviceInput>(() => readDevice());
  useEffect(() => {
    const onResize = () => setDevice(readDevice());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /**
   * The nine voices.
   *
   * One engine for the session. It builds no AudioContext until sound is
   * switched on, so a tab that never asks for sound never acquires an audio
   * indicator.
   */
  const soundRef = useRef<SoundEngine | null>(null);
  if (soundRef.current === null) soundRef.current = new SoundEngine();
  const sound = soundRef.current;

  /** The spine's ignite flash, for the instant of a take. */
  const [igniting, setIgniting] = useState(false);

  const [frames, setFrames] = useState<FrameReport | null>(null);
  const meterRef = useRef(new FrameMeter());
  /**
   * The quality inputs, in a ref.
   *
   * The engine is created once, inside an effect that must not re-run when a
   * preset changes — tearing down the mirror to switch antialiasing would
   * lose the scene. The ref lets boot read the CURRENT choice without taking
   * a dependency on it; changing the preset afterwards is handled below.
   */
  const qualityRef = useRef<{ choice: QualityChoice; device: DeviceInput }>({
    choice: "auto",
    device,
  });

  qualityRef.current = { choice: workspace.quality, device };

  /**
   * The engine follows the preference and the programme bus.
   *
   * Ducking is driven from `bus.onAir` rather than inferred from anything the
   * UI knows: the one thing that must never be wrong is whether the desk is
   * live, and there is exactly one authority on that.
   */
  useEffect(() => {
    sound.toggle(workspace.sound);
  }, [sound, workspace.sound]);
  useEffect(() => {
    sound.setOnAir(bus?.onAir ?? false);
  }, [sound, bus?.onAir, revision]);
  useEffect(() => () => sound.dispose(), [sound]);

  /**
   * Plays a voice.
   *
   * A sound may CONFIRM that something happened and may never be the only way
   * to know it happened — so every call site below already has a visible
   * result, and removing the sound would lose nothing but the confirmation.
   */
  const say = useCallback((voice: VoiceName) => sound.play(voice), [sound]);

  /**
   * The moment of the take.
   *
   * Fires the spine's ignite and the take voice together. They are the same
   * event reported twice — once to the eye and once to the ear — and neither
   * is the only way to know, which is the law the voices are written under.
   */
  const ignite = useCallback(() => {
    setIgniting(true);
    window.setTimeout(() => setIgniting(false), 120);
    say("take");
  }, [say]);

  /**
   * What this machine can offer.
   *
   * Combined with depth, never instead of it. Depth is what the USER chose to
   * see; the profile is what the SCREEN can hold. A beginner on a desktop and
   * an expert on a phone are different problems, and collapsing them into one
   * number gets both wrong.
   */
  const profile = profileFor(device);
  const docks = docksAt(workspace.depth);
  const shows = {
    // Construction — layers, properties, the create tools — lives INSIDE the
    // one dock now. There is no left dock; the prototype has one column and
    // Studio had three, which is the shape of an IDE rather than of a product.
    construction: docks.construction && profile.canDock,
    timeline: docks.timeline && profile.canDock,
    dock: docks.dock,
  };

  /**
   * Records a drawn frame, and publishes a report about once a second.
   *
   * Not on every frame: re-rendering the shell sixty times a second to update
   * a number would itself be the thing making the number bad.
   */
  const publishedAt = useRef(0);
  const onFrame = useCallback(
    (milliseconds: number) => {
      meterRef.current.record(milliseconds);
      const now = performance.now();
      if (now - publishedAt.current < 1000) return;
      publishedAt.current = now;
      setFrames(meterRef.current.report(settingsFor(workspace.quality, device)));
    },
    [workspace.quality, device],
  );

  /**
   * ONE CHANNEL TO THE VIEWPORT.
   *
   * The shell NAMES a viewport action; the stage performs it. It used to be a
   * token per action plus arithmetic done here, which is how the keyboard came
   * to zoom continuously about the origin while the wheel zoomed in discrete
   * steps about the pointer — two zooms in one product. The stage is the only
   * thing that knows the element's size, and every one of these actions needs
   * it, so the stage is the owner.
   */
  const [viewportRequest, setViewportRequest] = useState<ViewportRequest | null>(null);
  /**
   * The two rungs the shell owns.
   *
   * Un-cueing sits ABOVE deselecting because it has consequences outside the
   * editor: with something armed, Escape should disarm before it costs a
   * designer their selection. Two presses do both, in that order, which is
   * what the old contested binding was trying to express with a special case
   * inside `matchBinding`.
   */
  useEffect(
    () =>
      claimEscape("air", () => {
        if (bus?.cued !== true) return false;
        bus.uncue();
        return true;
      }),
    [bus, revision],
  );

  useEffect(
    () =>
      claimEscape("selection", () => {
        if (selection.ids.length === 0) return false;
        setSelection(EMPTY_SELECTION);
        return true;
      }),
    [selection],
  );

  /**
   * Remembers where a graphic was left. §03 camera memory.
   *
   * Written into the WORKSPACE rather than the document: this is how a
   * designer is looking at the graphic, not what the graphic contains. An
   * unchanged view is not rewritten, so opening a file and closing it does not
   * churn storage.
   */
  const rememberCamera = useCallback(
    (documentId: string, view: Viewport) => {
      setWorkspace((current) => {
        const existing = current.cameras[documentId];
        if (
          existing !== undefined &&
          existing.zoom === view.zoom &&
          existing.panX === view.panX &&
          existing.panY === view.panY
        ) {
          return current;
        }
        const next: Workspace = {
          ...current,
          cameras: {
            ...current.cameras,
            [documentId]: { zoom: view.zoom, panX: view.panX, panY: view.panY },
          },
        };
        saveWorkspace(next);
        return next;
      });
    },
    [],
  );

  const askViewport = useCallback((action: ViewportAction) => {
    setViewportRequest((current) => ({ action, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [recents, setRecents] = useState<readonly RecentProject[]>([]);
  const [library, setLibrary] = useState<readonly LibraryEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const openInput = useRef<HTMLInputElement | null>(null);

  // -- Boot -----------------------------------------------------------------

  useEffect(() => {
    setWorkspace(loadWorkspace());
    setRecents(loadRecents());
    setLibrary(loadLibrary(storage()));
  }, []);

  // One text provider, shared by Preview and Program, LOADED LAZILY.
  //
  // ==========================================================================
  // WHY THIS IS A DYNAMIC IMPORT AND NOT A TOP-LEVEL ONE
  // ==========================================================================
  // `@bracketx/engine-host` re-exports the text engine, which imports
  // `harfbuzzjs`, which instantiates a WASM binary AT IMPORT TIME via top-level
  // await. A static import therefore puts the entire product behind that
  // instantiation succeeding: if the WASM is blocked, mis-served, or unsupported,
  // the module graph rejects, `createRoot().render()` never runs, and the page
  // is completely black with the real error only in a console nobody opened.
  //
  // That is not hypothetical — it happened in this repository. Vite pre-bundling
  // rewrote the loader's `import.meta.url`, the request fell through to the SPA
  // fallback, and the browser was handed `<!doctype html>` where it expected a
  // WASM magic word. The editor showed nothing at all.
  //
  // `optimizeDeps.exclude` fixed that one cause. This fixes the CLASS: the text
  // engine is now loaded after mount, inside a try/catch, and a failure degrades
  // to "text is unavailable" rather than to a blank application.
  //
  // The reconciler already refuses to import the text engine for exactly this
  // reason (see `text-provider.ts`). The shell should not have been doing what
  // the engine's own layering forbids.
  const textRef = useRef<TextProvider | null>(null);
  const imagesRef = useRef<ImageProvider | null>(null);
  const registryRef = useRef<AssetRegistry | null>(null);
  const [assets, setAssets] = useState<readonly AssetRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { HostTextProvider } = await import("@bracketx/engine-host/text");
        if (cancelled) return;
        const provider = new HostTextProvider({ pageSize: 2048, pxRange: 4 });
        textRef.current = provider;

        const loaded = await loadStudioFonts(provider);
        if (cancelled) return;
        // Pre-warm before anything is on screen. TEXT_ENGINE §5 — this is what
        // turns a mid-show generation spike into load-time cost.
        if (loaded.length > 0) provider.prewarm(PREWARM_ASCII, [loaded[0]!], 48);
      } catch (cause) {
        // Text is unavailable. Every other capability still works, and a
        // graphic containing text renders without it rather than not at all.
        console.error("Text is unavailable", cause);
        if (!cancelled) setTextError(String(cause));
      } finally {
        // ALWAYS. `fontsReady` gates the session, and a gate that can stay shut
        // forever is the blank screen wearing a different hat.
        if (!cancelled) setFontsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  /**
   * Rendered only where they are LOOKED AT.
   *
   * This used to run at boot regardless of where somebody was, so opening
   * straight into the editor spent the first three seconds rendering
   * thumbnails for a screen nobody had asked for — competing with the stage
   * for the same GPU while a designer was already working on it.
   *
   * It showed up as the picture-stability test going flaky: the stage compares
   * itself to itself after a trip into 3D, and a second renderer drawing
   * eight graphics in the background is exactly the thing that stops a
   * viewport ever reaching a still frame.
   */
  const showsArt =
    workspace.section === "home" ||
    workspace.section === "templates" ||
    workspace.section === "marketplace" ||
    workspace.section === "production";


  /**
   * WHAT THE CARDS ACTUALLY SHOW.
   *
   * Six of the eight template cards carried the same drawn glyph, so the screen
   * that decides what somebody makes asked them to choose between six identical
   * pictures. These are the real graphics, rendered by the real engine with the
   * real fonts — install a theme and every card restyles, because every card IS
   * the graphic.
   *
   * Rendered once fonts have parsed, one at a time, arriving as they land.
   * Cancelled if the user leaves before they finish: nobody is owed a thumbnail
   * for a screen they are no longer looking at.
   */
  const [templateArt, setTemplateArt] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  /**
   * THE HOVER PLAYER.
   *
   * One hidden renderer for the whole product. Only one card is ever under the
   * pointer, so a player per tile would mean forty WebGL contexts on the
   * Marketplace and a browser that refuses the seventeenth — this one blits
   * its frames into whichever tile is asking.
   *
   * Built once the fonts have parsed, kept for the session, and disposed with
   * it. Building one on hover would cost a couple of hundred milliseconds,
   * which is exactly long enough for somebody to have moved on.
   */
  const playerRef = useRef<PreviewPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    if (!fontsReady || !showsArt) return;
    const first = templatesOf()[0];
    if (first === undefined) return;
    const player = PreviewPlayer.create(
      {
        renderer: rendererRef.current,
        ...(textRef.current === null ? {} : { text: textRef.current }),
        ...(imagesRef.current === null ? {} : { images: imagesRef.current }),
        width: 400,
      },
      instantiateTemplate(first, ids, new Date().toISOString()),
    );
    playerRef.current = player;
    setPlayerReady(player !== null);
    return () => {
      player?.dispose();
      playerRef.current = null;
      setPlayerReady(false);
    };
  }, [fontsReady, showsArt]);

  const playTemplate = useCallback((templateId: string, into: HTMLCanvasElement) => {
    const player = playerRef.current;
    const template = templatesOf().find((entry) => entry.id === templateId);
    if (player === null || template === undefined) return;
    // Built with the OPEN PROJECT'S palette, so hovering a card in a themed
    // project previews the graphic as it would actually arrive — not as the
    // catalogue's default.
    player.play(
      instantiateTemplate(
        template,
        ids,
        new Date().toISOString(),
        session?.document.tokens ?? [],
      ),
      into,
    );
  }, [session]);

  const stopTemplate = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!fontsReady || !showsArt) return;
    let cancelled = false;
    void renderTemplatePreviews(
      templatesOf(),
      ids,
      {
        renderer: rendererRef.current,
        ...(textRef.current === null ? {} : { text: textRef.current }),
        ...(imagesRef.current === null ? {} : { images: imagesRef.current }),
        // 400 rather than 520: a card is 238px wide at its narrowest and the
        // grid never shows one larger than about 330. Encoding a PNG is the
        // slow half of a preview, and it is quadratic in width.
        width: 400,
      },
      (templateId, url) => {
        if (cancelled) return;
        setTemplateArt((current) => new Map(current).set(templateId, url));
      },
      () => cancelled,
    );
    return () => {
      cancelled = true;
    };
  }, [fontsReady, showsArt]);

  /**
   * Publishes the registry's state to the UI and to disk.
   *
   * One function because the three things always move together — records for
   * rendering, thumbnails for the tiles, storage for the next session — and
   * three call sites that each remembered two of them is how a library shows a
   * renamed asset that comes back with its old name.
   */
  const commitAssets = useCallback(() => {
    const registry = registryRef.current;
    if (registry === null) return;
    const records = registry.records();
    setAssets(records);
    saveAssetRecords(storage(), records);

    const previews = new Map<string, string>();
    for (const record of records) {
      const decoded = registry.decoded(record.id);
      if (decoded === undefined || decoded.kind !== "image") continue;
      const url = thumbnailUrl(decoded.value as { width: number; height: number; pixels: Uint8Array });
      if (url !== null) previews.set(record.id, url);
    }
    setThumbnails(previews);
  }, []);

  const mutateAsset = useCallback(
    (
      assetId: string,
      patch: {
        name?: string;
        tags?: readonly string[];
        favorite?: boolean;
      },
    ) => {
      const registry = registryRef.current;
      if (registry === null) return;
      registry.update(assetId, patch, new Date().toISOString());
      commitAssets();
    },
    [commitAssets],
  );

  // Usage tracking. IF-006 — "which graphics use this logo" must be exact and
  // instant over a library of thousands, so it is RECORDED as documents open
  // and close rather than recomputed by walking every document on demand.
  //
  // Re-run whenever the document changes, because adding or removing a logo
  // layer changes the answer, and `retain` is idempotent per holder so the
  // common case of an unrelated edit costs a set comparison.
  useEffect(() => {
    const registry = registryRef.current;
    if (registry === null || session === null) return;
    const holder = session.document.id;
    registry.releaseHolder(holder);
    for (const assetId of referencedAssets(session.document)) {
      registry.retain(assetId, holder);
    }
    return () => registry.releaseHolder(holder);
  }, [session, revision]);

  // Images load separately from fonts, and separately from the session gate.
  //
  // Separately from FONTS because a HarfBuzz failure must not also cost every
  // graphic its logo — one subsystem being unavailable should subtract one
  // capability. Separately from the GATE because an image arriving late
  // re-projects the nodes that use it, whereas a font arriving late reflows
  // every graphic using it (TEXT_ENGINE §3), which is why only one of them can
  // hold up the first frame.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { createAssetRegistry, RegistryImageProvider } = await import(
          "@bracketx/engine-host/assets"
        );
        const { IndexedDbAssetStore } = await import("./studio/asset-store");
        if (cancelled) return;

        // The registry is the single source of truth (IF-006). Studio does not
        // hold a second image cache beside it, and the projector sees it only
        // through the reconciler's port.
        const registry = createAssetRegistry(new IndexedDbAssetStore());
        registryRef.current = registry;
        imagesRef.current = new RegistryImageProvider(registry);

        const restored = loadAssetRecords(storage());
        for (const record of restored) registry.register(record);
        await loadStudioImages(registry);
        // Whatever a user brought in a previous session, decoded before it is
        // needed — an asset resolving mid-broadcast pops on screen.
        await Promise.all(restored.map((record) => registry.resolve(record.id)));
        if (!cancelled) commitAssets();
      } catch (cause) {
        // Images are unavailable. Everything else still works and a graphic
        // containing one renders without it rather than not at all.
        console.error("Images are unavailable", cause);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const programCanvas = programCanvasRef.current;
    if (canvas === null || programCanvas === null || session !== null) return;
    if (!fontsReady) return;
    try {
      const created = newDocument("Untitled", ids, new Date().toISOString());
      for (const surface of [canvas, programCanvas]) {
        surface.width = created.world.output.width;
        surface.height = created.world.output.height;
      }
      const text = textRef.current ?? undefined;
      const images = imagesRef.current ?? undefined;
      // The preview may be softened by a preset. Programme may not — see
      // `programOptions`, which exists so that rule is a function rather than
      // something everyone has to remember.
      const settings = settingsFor(qualityRef.current.choice, qualityRef.current.device);
      const preview = new StudioSession(
        createBackend(
          rendererRef.current,
          canvas,
          previewOptions(settings, window.devicePixelRatio || 1),
        ),
        created,
        {
          ...(text === undefined ? {} : { text }),
          ...(images === undefined ? {} : { images }),
        },
      );
      // Program starts on a document of its own rather than a reference to
      // Preview's: sharing one would be the exact leak the whole split exists
      // to prevent, and it would be invisible until the first edit.
      const program = new StudioSession(
        createBackend(rendererRef.current, programCanvas, programOptions(settings)),
        newDocument("Program", ids, new Date().toISOString()),
        {
          ...(text === undefined ? {} : { text }),
          ...(images === undefined ? {} : { images }),
        },
      );
      setSession(preview);
      setBus(new ProgramBus(preview, program));
      setExpanded(new Set([created.root.id]));

      // Whatever the user asked for while we were starting is drained by the
      // effect below, NOT here — see the comment there.
    } catch (cause) {
      // WebGL can be unavailable entirely. An editor that shows a blank page in
      // that case reads as broken software rather than as a missing GPU.
      setBootError(String(cause));
    }
  }, [session, fontsReady]);

  useEffect(() => {
    if (session === null) return;
    return session.store.subscribe(() => {
      setRevision((value) => value + 1);
      // Selection must never point at a node the document no longer has: the
      // inspector would read nothing and the next drag would build an operation
      // against a missing target.
      setSelection((current) => prune(current, (id) => session.exists(id)));
    });
  }, [session]);


  // Runtime changes — a seek, a cue, a live variable — are NOT document edits,
  // so they do not reach the store. Without this the shell renders the engine
  // to its canvas and never re-reads it: the frame counter, the timeline
  // playhead and the live variable column are each correct once and then
  // frozen. Every panel individually right, collectively stale.
  useEffect(() => (session === null ? undefined : session.subscribe(() => {
    setRevision((value) => value + 1);
  })), [session]);

  // The rail carries the on-air tally, so the shell has to hear the program bus
  // as well as the document store. Without this the tally was correct once and
  // then frozen — the same class of staleness Phase 3A found in the frame
  // counter, in a place where being wrong is worse: an operator reading OFF
  // while a graphic is live.
  useEffect(
    () => (bus === null ? undefined : bus.subscribe(() => setRevision((value) => value + 1))),
    [bus],
  );

  // While the clock is RUNNING, the engine advances with no discrete event to
  // notify on, so the UI is ticked per animation frame — and only then. An
  // unconditional loop would re-render an idle editor sixty times a second for
  // nothing, which is what makes a tool feel heavy on a laptop.
  useEffect(() => {
    if (session === null || !session.playing) return;
    let handle = 0;
    const tick = () => {
      setRevision((value) => value + 1);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
    // `playing` and not `revision`: pausing notifies, which re-renders, which
    // changes this dep and tears the loop down. Depending on `revision` would
    // rebuild the effect on every frame it caused.
  }, [session, session?.playing]);

  const update = useCallback((patch: Partial<Workspace>) => {
    setWorkspace((current) => {
      const next = { ...current, ...patch };
      saveWorkspace(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme;
  }, [workspace.theme]);

  // -- Editing --------------------------------------------------------------

  const edit = useCallback(
    (candidate: Transaction | null) => {
      session?.store.apply(candidate);
    },
    [session],
  );

  const reveal = useCallback(
    (nodeId: string) => {
      if (session === null) return;
      setSelection(selectOnly(nodeId));
      setExpanded((current) => new Set([...current, ...pathTo(session.document, nodeId)]));
    },
    [session],
  );

  const create = useCallback(
    (kind: NodeKind) => {
      if (session === null) return;
      // Into the selected node when it can hold children, otherwise at the root.
      const primary = primaryOf(selection);
      const target = primary === null ? null : findNode(session.document.root, primary);
      const parentId =
        target !== null && target.components === undefined ? target.id : session.document.root.id;
      const result = createNode(session.document, kind, parentId, ids);
      if (session.store.apply(result.transaction)) reveal(result.nodeId);
    },
    [session, selection, reveal],
  );

  // -- File -----------------------------------------------------------------

  /**
   * WHERE A SCENE LIVES.
   *
   * A scene is a SCENE_FORMAT document and nothing else, so anywhere that can
   * hold a text file can hold one — which is why this is a seam with several
   * providers rather than a Drive branch and a Dropbox branch inside `save`.
   *
   * The disk provider gives something downloading never could: a HANDLE. Save
   * once, choose the folder, and every save after it returns to the same file
   * instead of leaving `lower-third (7).json` behind. And because Drive and
   * Dropbox both mount a folder, saving into one IS saving to the cloud.
   */
  const places = useMemo(
    () =>
      createStorage({
        drive: workspace.driveClientId ? { clientId: workspace.driveClientId } : null,
        dropbox: workspace.dropboxAppKey ? { clientId: workspace.dropboxAppKey } : null,
      }),
    [workspace.driveClientId, workspace.dropboxAppKey],
  );

  /** The file this document came from, when it came from one. */
  const [bound, setBound] = useState<StoredScene | null>(null);

  const saveToDisk = useCallback(
    async (askWhere: boolean) => {
      if (session === null) return;
      const stamped = touch(session.document, new Date().toISOString());
      const json = serializeDocument(stamped);
      try {
        const target = await places.disk.write(
          fileNameFor(stamped),
          json,
          askWhere ? undefined : (bound ?? undefined),
        );
        setBound(target);
        session.store.markSaved();
        setNotice(`Saved to ${target.name}`);
      } catch (cause) {
        // A cancelled picker is not a failure and must not report one.
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setNotice(cause instanceof Error ? cause.message : "Could not save.");
      }
    },
    [session, places, bound],
  );


  const save = useCallback(
    (download: boolean) => {
      if (session === null) return;
      const stamped = touch(session.document, new Date().toISOString());
      const json = serializeDocument(stamped);
      setRecents((current) =>
        rememberProject(current, {
          id: stamped.id,
          name: stamped.meta.name,
          json,
          savedAt: new Date().toISOString(),
        }),
      );
      session.store.markSaved();

      if (download) {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileNameFor(stamped);
        anchor.click();
        URL.revokeObjectURL(url);
      }
      setNotice(`Saved ${stamped.meta.name}`);
    },
    [session],
  );

  /**
   * A document chosen before the session existed.
   *
   * Removing the boot gate means Home renders immediately — which is the point
   * — but it also means a user can click a template during the few hundred
   * milliseconds the fonts take. `openJson` used to return silently in that
   * window, so the click did nothing and the editor opened Untitled.
   *
   * Dropping a user's action because we were not ready is not acceptable, so it
   * is held and applied the moment the session appears.
   */
  const pendingOpen = useRef<string | null>(null);

  const openJson = useCallback(
    (json: string) => {
      if (session === null) {
        pendingOpen.current = json;
        return;
      }
      try {
        const parsed = parseDocument(json);
        session.open(parsed);
        setSelection(EMPTY_SELECTION);
        setExpanded(expandedOnOpen(parsed));
        setLocked(new Set());
        setRevision((value) => value + 1);
        // CAMERA MEMORY. §03: "Per graphic, restored on open, including zoom
        // step and centre." A graphic you left at 400% on the left third comes
        // back that way; one you have never opened is Fit, as it always was.
        askViewport({ kind: "recallCamera", documentId: parsed.id });
        setNotice(`Opened ${parsed.meta.name}`);
      } catch (error) {
        // Refused at the door, with the document that was open left intact.
        setNotice(String(error));
      }
    },
    [session],
  );

  // -- Sections and content --------------------------------------------------

  const goTo = useCallback(
    (section: Section) => update({ section }),
    [update],
  );

  /**
   * Opens a template as a NEW graphic.
   *
   * The open document's theme travels with it, so inserting a lower third into
   * a project that already has a palette produces a graphic that matches rather
   * than one that has to be restyled by hand.
   */
  /**
   * Opens whatever was asked for before the engine had finished starting.
   *
   * This MUST run after the subscription above, and it used to run before it:
   * the boot effect drained the queue synchronously, so `open()` published its
   * change to nobody, `revision` never advanced, and the shell went on
   * rendering the blank scene. Clicking a template on a cold load left you on
   * an empty stage called "Untitled" — the click looked ignored, and a second
   * click worked, which is the signature of a race and the reason it survived.
   *
   * It routes through `openJson` rather than repeating its body, so a queued
   * open and a normal one cannot diverge: same selection reset, same fit, same
   * notice.
   */
  useEffect(() => {
    if (session === null) return;
    const queued = pendingOpen.current;
    if (queued === null) return;
    pendingOpen.current = null;
    openJson(queued);
  }, [session, openJson]);

  const openTemplate = useCallback(
    (template: PackTemplate) => {
      const theme = session?.document.tokens ?? [];
      const built = instantiateTemplate(template, ids, new Date().toISOString(), theme);
      openJson(serializeDocument(built));
      update({ section: "design" });
      setNotice(`${template.name} ready to edit`);
    },
    [session, openJson, update],
  );

  /**
   * Places an installed scene onto the open stage.
   *
   * This is the join in the primary journey — Marketplace → Assets → Stage —
   * and it is deliberately ONE function used by both the drag and the click.
   * A scene dropped at a point lands there; a scene added by click lands where
   * its designer put it. Both go through `placeScene`, so both produce real
   * nodes in the open document, one undo step, with the placed scene selected
   * because the next thing anyone does is edit what they just added.
   */
  const placeTemplate = useCallback(
    (templateId: string, at?: { x: number; y: number }) => {
      const template = PACKS.flatMap((pack) => pack.templates ?? []).find(
        (candidate) => candidate.id === templateId,
      );
      if (template === undefined) return;

      // An empty studio has nothing to place INTO. Opening the scene is the
      // honest answer, not a silent no-op.
      if (session === null) {
        openTemplate(template);
        return;
      }

      const host = session.document;
      const built = instantiateTemplate(template, ids, new Date().toISOString(), host.tokens ?? []);
      const placement = placeScene(host, built, ids, at);
      if (placement === null) return;

      session.store.apply(placement.transaction);
      setSelection(selectMany(placement.nodeIds));
      say("detent");
      update({ section: "design" });
      setNotice(`${template.name} added`);
    },
    [session, openTemplate, update],
  );

  const installPack = useCallback(
    (pack: Pack) => {
      update({
        installedPacks: [...new Set([...workspace.installedPacks, pack.id])],
      });
      say("install");
      setNotice(`${pack.name} installed`);
    },
    [update, workspace.installedPacks],
  );

  const uninstallPack = useCallback(
    (pack: Pack) => {
      update({
        installedPacks: workspace.installedPacks.filter((id) => id !== pack.id),
      });
    },
    [update, workspace.installedPacks],
  );

  const applyTheme = useCallback(
    (pack: Pack) => {
      if (session === null) return;
      const txn = installTheme(session.document, pack);
      if (txn !== null) session.store.apply(txn);
      setNotice(`${pack.name} applied`);
    },
    [session],
  );

  /**
   * Where the camera is standing, in the terms the view control speaks.
   *
   * Recovered from the camera's position each render rather than remembered,
   * so orbiting away from a view un-highlights it. A remembered "current
   * view" would keep claiming Front long after the camera had left it, which
   * is the state where a graphic quietly stops being pixel-accurate.
   */
  const cameraOrbit = useMemo(() => {
    if (session === null) return null;
    const camera = findCameraNode(session.document);
    if (camera === null) return null;
    const [x, y, z] = camera.transform?.position ?? [0, 0, 10];
    return { node: camera, orbit: orbitOf({ x, y, z }, ORIGIN) };
  }, [session, revision]);

  const currentView = cameraOrbit === null ? null : viewOf(cameraOrbit.orbit);
  /**
   * Is the scene being worked in space?
   *
   * Derived from where the camera IS, never remembered — so orbiting away
   * from Front puts the product in 3D without anybody pressing anything, and
   * returning to Front puts it back. The switch reports the truth rather than
   * asserting it.
   */
  const spatial =
    cameraOrbit !== null &&
    (Math.abs(cameraOrbit.orbit.azimuth) > 0.01 || Math.abs(cameraOrbit.orbit.elevation) > 0.01);

  // -- Commands -------------------------------------------------------------

  const commands = useMemo<readonly StudioCommand[]>(() => {
    if (session === null) return [];
    const store = session.store;
    const document_ = session.document;
    const selected = selection.ids;
    const visibleIds = (): readonly string[] =>
      outline(document_, { expanded }).map((row) => row.id);

    return [
      {
        id: "file.new",
        title: "New scene",
        section: "File",
        shortcut: shortcutFor("file.new"),
        run: () =>
          openJson(
            serializeDocument(newDocument("Untitled", ids, new Date().toISOString())),
          ),
      },
      {
        id: "file.open",
        title: "Open scene…",
        section: "File",
        shortcut: shortcutFor("file.open"),
        run: () => {
          void openFromDisk();
        },
      },
      {
        id: "file.save",
        title: "Save",
        section: "File",
        hint: store.dirty ? "unsaved changes" : "up to date",
        shortcut: shortcutFor("file.save"),
        // Back to the same file when there is one. Only the first save asks
        // where, which is the difference between a document and a download.
        run: () => {
          save(false);
          void saveToDisk(bound === null);
        },
      },
      {
        id: "file.saveAs",
        title: "Save as…",
        section: "File",
        shortcut: shortcutFor("file.saveAs"),
        keywords: ["download", "export"],
        run: () => save(true),
      },
      {
        id: "edit.undo",
        title: store.undoLabel === null ? "Undo" : `Undo ${store.undoLabel}`,
        section: "Edit",
        shortcut: shortcutFor("edit.undo"),
        enabled: store.canUndo,
        run: () => void store.undo(),
      },
      {
        id: "edit.redo",
        title: store.redoLabel === null ? "Redo" : `Redo ${store.redoLabel}`,
        section: "Edit",
        shortcut: shortcutFor("edit.redo"),
        enabled: store.canRedo,
        run: () => void store.redo(),
      },
      {
        id: "edit.duplicate",
        title: "Duplicate",
        section: "Edit",
        shortcut: shortcutFor("edit.duplicate"),
        enabled: selected.length > 0,
        run: () => {
          const result = duplicateNodes(document_, selected, ids);
          if (result !== null && store.apply(result.transaction)) {
            setSelection(selectMany(result.nodeIds));
          }
        },
      },
      {
        id: "edit.delete",
        title: "Delete",
        section: "Edit",
        shortcut: shortcutFor("edit.delete"),
        enabled: selected.length > 0,
        run: () => edit(deleteNodes(document_, selected)),
      },
      {
        id: "edit.deleteBack",
        title: "Delete (backspace)",
        section: "Edit",
        enabled: selected.length > 0,
        run: () => edit(deleteNodes(document_, selected)),
      },
      {
        id: "edit.rename",
        title: "Rename selected node",
        section: "Edit",
        shortcut: shortcutFor("edit.rename"),
        enabled: selected.length === 1,
        run: () => {
          const id = primaryOf(selection);
          if (id === null) return;
          const next = window.prompt("Name", findNode(document_.root, id)?.name ?? "");
          if (next !== null) edit(renameNode(document_, id, next));
        },
      },
      {
        id: "edit.addTimeline",
        title: "Add a timeline",
        section: "Create",
        hint: "Animations are document data, so this is an undoable edit",
        keywords: ["animation", "clip", "keyframe"],
        run: () => {
          edit(createTimeline(document_, "Timeline", ids).transaction);
          update({ bottomOpen: true, bottomExpanded: [...new Set([...workspace.bottomExpanded, "timeline" as const])] });
        },
      },
      ...TOOLBOX.map((entry) => ({
        id: `create.${entry.kind}`,
        title: `Add ${entry.label.toLowerCase()}`,
        section: "Create" as const,
        hint: entry.hint,
        run: () => create(entry.kind),
      })),

      // -- Arrange ----------------------------------------------------------
      //
      // Bounds are read from the MIRROR at run time, not captured here: a
      // command built against a stale snapshot would align to where things were
      // before the last edit.
      ...(
        [
          ["left", "Align left"],
          ["centerX", "Align centres horizontally"],
          ["right", "Align right"],
          ["top", "Align top"],
          ["middle", "Align middles vertically"],
          ["bottom", "Align bottom"],
        ] as const
      ).map(([edge, title]) => ({
        id: `arrange.align.${edge}`,
        title,
        section: "Arrange" as const,
        keywords: ["align", "arrange"],
        enabled: selected.length >= 2,
        run: () =>
          edit(
            align(
              document_,
              selected,
              nodeBounds(document_, (id) => session.worldMatrixOf(id)),
              edge,
            ),
          ),
      })),
      ...(["horizontal", "vertical"] as const).map((axis) => ({
        id: `arrange.distribute.${axis}`,
        title: `Distribute ${axis}ly`,
        section: "Arrange" as const,
        keywords: ["space", "even"],
        enabled: selected.length >= 3,
        run: () =>
          edit(
            distribute(
              document_,
              selected,
              nodeBounds(document_, (id) => session.worldMatrixOf(id)),
              axis,
            ),
          ),
      })),
      {
        id: "arrange.group",
        title: "Group selection",
        section: "Arrange",
        shortcut: shortcutFor("arrange.group"),
        enabled: selected.length > 0,
        run: () => {
          const result = group(document_, selected, ids);
          if (result !== null && store.apply(result.transaction)) {
            setSelection(selectOnly(result.groupId));
          }
        },
      },
      {
        id: "arrange.ungroup",
        title: "Ungroup",
        section: "Arrange",
        shortcut: shortcutFor("arrange.ungroup"),
        enabled: selected.length === 1,
        run: () => {
          const id = primaryOf(selection);
          if (id !== null) edit(ungroup(document_, id));
        },
      },
      ...(
        [
          ["front", "Bring to front"],
          ["forward", "Bring forward"],
          ["backward", "Send backward"],
          ["back", "Send to back"],
        ] as const
      ).map(([move, title]) => ({
        id: `arrange.${move}`,
        title,
        section: "Arrange" as const,
        keywords: ["layer", "order", "z"],
        shortcut: shortcutFor(`arrange.${move}`),
        enabled: selected.length === 1,
        run: () => {
          const id = primaryOf(selection);
          if (id !== null) edit(reorder(document_, id, move));
        },
      })),

      // -- Motion -----------------------------------------------------------
      ...PRESETS.map((preset) => ({
        id: `motion.${preset.id}`,
        title: `${preset.label}`,
        section: "Motion" as const,
        hint: preset.hint,
        keywords: ["preset", "animate", preset.kind],
        enabled: selected.length > 0,
        run: () => {
          edit(applyPreset(document_, selected, preset, ids));
          update({ bottomOpen: true, bottomExpanded: [...new Set([...workspace.bottomExpanded, "timeline" as const])] });
        },
      })),

      // -- Program ----------------------------------------------------------
      ...(bus === null
        ? []
        : [
            {
              id: "air.cue",
              title: "Cue",
              section: "Program" as const,
              hint: "Arm this for the next Take. Nothing goes out.",
              keywords: ["arm", "ready", "preview"],
              shortcut: shortcutFor("air.cue"),
              enabled: !bus.onAir,
              run: () => {
                bus.cue();
                say("cue");
              },
            },
            {
              id: "air.uncue",
              title: "Un-cue",
              section: "Program" as const,
              hint: "Disarm. Nothing was on air.",
              shortcut: shortcutFor("air.uncue"),
              enabled: bus.cued,
              run: () => bus.uncue(),
            },
            {
              id: "program.take",
              title: "Take to Program",
              section: "Program" as const,
              hint: bus.pending ? "Preview differs from air" : "nothing pending",
              keywords: ["air", "live", "transition"],
              run: () => {
                bus.take();
                say("take");
                update({ programOpen: true });
              },
            },
            {
              id: "program.cut",
              title: "Cut to Program",
              section: "Program" as const,
              hint: "No entrance animation",
              run: () => {
                bus.cut();
                update({ programOpen: true });
              },
            },
            {
              id: "program.continue",
              title: "Continue",
              section: "Program" as const,
              hint: "Resume a hold, or play the exit",
              enabled: bus.onAir,
              run: () => bus.continue(),
            },
            {
              id: "program.hold",
              title: "Hold",
              section: "Program" as const,
              enabled: bus.onAir,
              run: () => bus.hold(),
            },
            {
              id: "program.clear",
              title: "Clear Program",
              section: "Program" as const,
              enabled: bus.onAir,
              run: () => bus.clear(),
            },
            {
              id: "program.toggle",
              title: workspace.programOpen ? "Hide Program row" : "Show Program row",
              section: "Program" as const,
              run: () => update({ programOpen: !workspace.programOpen }),
            },
          ]),

      // -- Library ----------------------------------------------------------
      {
        id: "file.saveTemplate",
        title: "Save as template",
        section: "File",
        hint:
          document_.variables.length === 0
            ? "declare a variable first"
            : `${document_.variables.length} parameters`,
        keywords: ["template", "reusable", "marketplace"],
        enabled: document_.variables.length > 0,
        run: () => {
          edit(promoteToTemplate(document_, document_.meta.name, ids));
          update({ bottomOpen: true, bottomExpanded: [...new Set([...workspace.bottomExpanded, "library" as const])] });
        },
      },
      {
        id: "file.saveToLibrary",
        title: "Save to library",
        section: "File",
        keywords: ["library", "shelf"],
        run: () => {
          setLibrary((current) =>
            saveToLibrary(
              current,
              describeDocument(document_, new Date().toISOString()),
              storage(),
            ),
          );
          setNotice(`${document_.meta.name} saved to the library`);
          update({ bottomOpen: true, bottomExpanded: [...new Set([...workspace.bottomExpanded, "library" as const])] });
        },
      },
      {
        id: "select.all",
        title: "Select all",
        section: "Select",
        shortcut: shortcutFor("select.all"),
        run: () =>
          setSelection(
            selectMany(allIds(document_).filter((id) => id !== document_.root.id)),
          ),
      },
      {
        id: "select.none",
        title: "Deselect",
        section: "Select",
        shortcut: shortcutFor("select.none"),
        run: () => setSelection(EMPTY_SELECTION),
      },
      {
        id: "select.up",
        title: "Select previous node",
        section: "Select",
        shortcut: shortcutFor("select.up"),
        run: () => setSelection((current) => stepSelection(visibleIds(), current, -1)),
      },
      {
        id: "select.down",
        title: "Select next node",
        section: "Select",
        shortcut: shortcutFor("select.down"),
        run: () => setSelection((current) => stepSelection(visibleIds(), current, 1)),
      },
      {
        id: "view.fit",
        title: "Fit scene in view",
        section: "View",
        shortcut: shortcutFor("view.fit"),
        run: () => askViewport({ kind: "fit" }),
      },
      {
        id: "view.frameSelected",
        title: "Frame selection",
        section: "View",
        hint:
          selection.ids.length === 0
            ? "Nothing selected — frames the whole scene"
            : "Zoom to what is selected",
        shortcut: shortcutFor("view.frameSelected"),
        run: () => askViewport({ kind: "frame" }),
      },
      {
        id: "view.zoomIn",
        title: "Zoom in",
        section: "View",
        shortcut: shortcutFor("view.zoomIn"),
        run: () => askViewport({ kind: "zoom", direction: 1 }),
      },
      {
        id: "view.zoomOut",
        title: "Zoom out",
        section: "View",
        shortcut: shortcutFor("view.zoomOut"),
        run: () => askViewport({ kind: "zoom", direction: -1 }),
      },
      {
        id: "view.actualSize",
        title: "Zoom to 100%",
        section: "View",
        shortcut: shortcutFor("view.actualSize"),
        // Zoom alone is not enough: the spec guarantees one viewport pixel is
        // one output pixel at 100%, and leaving the pan where it was slides
        // the frame off centre on the way.
        run: () => askViewport({ kind: "actualSize" }),
      },

      /**
       * NAVIGATION AS COMMANDS.
       *
       * Pan, orbit and walk were private handlers inside the stage. Their
       * gestures are unchanged — middle-drag and space-drag still pan,
       * Alt-drag still orbits, Shift+` still walks — but the ACTION each one
       * performs is now named, registered, and reachable from the View menu,
       * the palette and the keyboard reference like every other viewport
       * action.
       *
       * The gesture decides WHEN; the command describes WHAT. Neither holds
       * the other's arithmetic: a drag carries its own delta, and these carry
       * a step, and both end up in the same place in the stage.
       */
      {
        id: "view.centre",
        title: "Centre the view",
        section: "View",
        keywords: ["pan", "centre", "center", "recentre", "navigate"],
        hint: "Brings the frame back to the middle without changing the zoom.",
        run: () => askViewport({ kind: "centre" }),
      },
      ...(
        [
          ["Left", -PAN_STEP, 0],
          ["Right", PAN_STEP, 0],
          ["Up", 0, -PAN_STEP],
          ["Down", 0, PAN_STEP],
        ] as const
      ).map(([where, dx, dy]) => ({
        id: `view.pan${where}`,
        title: `Pan ${where.toLowerCase()}`,
        section: "View" as const,
        keywords: ["pan", "navigate", "scroll", "view"],
        run: () => askViewport({ kind: "panBy", dx, dy }),
      })),
      ...(
        [
          ["Left", -ORBIT_STEP, 0],
          ["Right", ORBIT_STEP, 0],
          ["Up", 0, ORBIT_STEP],
          ["Down", 0, -ORBIT_STEP],
        ] as const
      ).map(([where, azimuth, elevation]) => ({
        id: `view.orbit${where}`,
        title: `Orbit ${where.toLowerCase()}`,
        section: "View" as const,
        keywords: ["orbit", "turn", "camera", "3d"],
        // Only where there is something to orbit. The flat view is fixed.
        enabled: spatial,
        run: () => askViewport({ kind: "orbitBy", azimuth, elevation }),
      })),
      {
        id: "view.walk",
        title: "Walk the camera",
        section: "View",
        shortcut: shortcutFor("view.walk"),
        keywords: ["walk", "fly", "wasd", "navigate", "3d"],
        hint: "W A S D to move, Q and E for down and up, Escape to leave.",
        enabled: spatial,
        run: () => askViewport({ kind: "walk" }),
      },

      /**
       * CAMERA PRESETS. `studio-specification.html` §03.
       *
       * "Six, bound ⌥1 – ⌥6. Set with ⌥⇧1 – ⌥⇧6. Six because a lower third has
       * about that many regions worth returning to. Ten would never be filled."
       *
       * Generated rather than written twelve times, and registered as COMMANDS
       * so they reach the palette, the View menu and the keyboard reference —
       * which is the whole reason viewport actions now go through one channel.
       * A gesture nobody can find is a gesture nobody has.
       */
      ...Array.from({ length: PRESET_SLOTS }, (_, index) => index + 1).flatMap((slot) => [
        {
          id: `view.recall${slot}`,
          title: `Camera ${slot}`,
          section: "View" as const,
          keywords: ["camera", "preset", "recall", "view"],
          shortcut: `⌥${slot}`,
          run: () => askViewport({ kind: "recall", slot }),
        },
        {
          id: `view.store${slot}`,
          title: `Set camera ${slot}`,
          section: "View" as const,
          keywords: ["camera", "preset", "store", "save view"],
          shortcut: `⌥⇧${slot}`,
          run: () => askViewport({ kind: "store", slot }),
        },
      ]),
      ...(
        [
          ["view.safeAreas", "safe areas", "showSafeAreas"],
          ["view.grid", "grid", "showGrid"],
          ["view.snap", "snapping", "snapEnabled"],
          // The four kinds, individually. `commands.ts` states the rule — "an
          // action with no entry here does not exist" — so a snap kind that
          // could only be reached by editing stored workspace JSON would, for
          // the menu bar, the palette and the keyboard, not exist at all.
          ["view.snapGrid", "snap to grid", "snapToGrid"],
          ["view.snapObjects", "snap to objects", "snapToObjects"],
          ["view.snapSafe", "snap to safe areas", "snapToSafeAreas"],
          ["view.snapAngle", "angle snapping", "snapToAngle"],
          ["view.snapSize", "size snapping", "snapToSize"],
          ["view.debug", "debug overlay", "showDebug"],
        ] as const
      ).map(([id, label, key]) => ({
        id,
        title: `Toggle ${label}`,
        section: "View" as const,
        shortcut: shortcutFor(id),
        run: () => update({ [key]: !workspace[key] } as Partial<Workspace>),
      })),

      // THE THREE TRANSFORMS. Declared here like everything else, so G, R and
      // S are searchable in the palette and appear in the keyboard reference
      // rather than being folklore a 3D person happens to try.
      //
      // `enabled` follows the viewport: in the flat view there is one plane and
      // the box handles already offer all three, so a mode switch there would
      // change nothing visible — a control that appears to do nothing is worse
      // than one that says it does not apply.
      ...GIZMO_MODES.map((mode) => ({
        id: `gizmo.${mode.id}`,
        title: mode.label,
        section: "Arrange" as const,
        hint: mode.hint,
        shortcut: shortcutFor(`gizmo.${mode.id}`),
        enabled: spatial,
        keywords: ["gizmo", "transform", "tool"],
        run: () => update({ gizmoMode: mode.id }),
      })),

      // THE ONE KEY THAT MOVES BETWEEN THE TWO LEVELS, both directions.
      {
        id: "view.expert",
        title: workspace.depth === "beginner" ? "See how it is built" : "Hide the design",
        section: "View" as const,
        hint:
          workspace.depth === "beginner"
            ? "Layers, properties and the create tools"
            : "Back to the content of the graphic",
        keywords: ["expert", "beginner", "level", "advanced", "reveal"],
        shortcut: shortcutFor("view.expert"),
        run: () =>
          update({ depth: workspace.depth === "beginner" ? "expert" : "beginner" }),
      },
      {
        id: "view.timeline",
        title: workspace.bottomOpen ? "Hide the timeline" : "Show the timeline",
        section: "View" as const,
        hint: "Keyframes and timing, across the bottom",
        keywords: ["keyframes", "timing", "animate"],
        shortcut: shortcutFor("view.timeline"),
        // Summoning the timeline from beginner reveals the level that HAS one,
        // rather than silently doing nothing. A shortcut that no-ops is a
        // shortcut people stop trusting.
        run: () =>
          update({
            bottomOpen: !workspace.bottomOpen,
            ...(workspace.bottomOpen ? {} : { depth: "expert" as const }),
          }),
      },
      {
        id: "transport.toggle",
        title: session.playing ? "Pause" : "Play",
        section: "Transport",
        shortcut: shortcutFor("transport.toggle"),
        run: () => (session.playing ? session.pause() : session.play()),
      },
      {
        id: "transport.stepForward",
        title: "Step one frame",
        section: "Transport",
        shortcut: shortcutFor("transport.stepForward"),
        run: () => void session.stepFrames(1),
      },
      {
        id: "transport.stepBack",
        title: "Step back one frame",
        section: "Transport",
        shortcut: shortcutFor("transport.stepBack"),
        run: () => void session.stepFrames(-1),
      },
      {
        id: "transport.stop",
        title: "Stop and rewind",
        section: "Transport",
        shortcut: shortcutFor("transport.stop"),
        run: () => session.stop(),
      },
      {
        id: "help.keys",
        title: "Keyboard reference",
        section: "Help",
        shortcut: shortcutFor("help.keys"),
        run: () => setKeysOpen(true),
      },
      {
        id: "palette.open",
        title: "Command palette",
        section: "Help",
        shortcut: shortcutFor("palette.open"),
        run: () => setPaletteOpen(true),
      },
    ];
  }, [session, selection, expanded, workspace, revision, edit, create, save, openJson, update]);

  /**
   * What the stage offers on a right-click.
   *
   * Picked BY ID from the commands above, so the menu can never drift from
   * the palette or the keyboard: one implementation, one enabled rule, one
   * shortcut label. A menu that assembled its own actions would be a second
   * system, and the first place the two disagreed would be a bug report
   * nobody could reproduce.
   */
  /**
   * Moves the scene camera to a named view.
   *
   * A document edit, exactly like orbit and for the same reason: it changes
   * what the output frames. The distance is kept, so choosing a view re-aims
   * without also re-framing.
   */
  const flight = useRef(0);
  /** True while the camera is in flight between two views. */
  const [flying, setFlying] = useState(false);
  const setView = useCallback(
    (view: NamedView) => {
      if (session === null || cameraOrbit === null) return;
      const radius = cameraOrbit.orbit.radius || 10;
      const from = cameraOrbit.orbit;
      const to = { radius, azimuth: view.azimuth, elevation: view.elevation };
      const node = cameraOrbit.node.id;

      // Cancel any flight already in progress. Two overlapping transitions
      // fight over the same camera and produce a wobble that reads as a bug.
      cancelAnimationFrame(flight.current);

      const place = (orbit: typeof to): void => {
        const position = positionFor(orbit, ORIGIN);
        const rotation = lookAtRotation(position, ORIGIN);
        const turn = setProps(
          session.document,
          node,
          new Map<string, unknown>([
            ["transform.position", [round6(position.x), round6(position.y), round6(position.z)]],
            ["transform.rotation", [round6(rotation[0]), round6(rotation[1]), round6(rotation[2])]],
          ]),
          `${view.label} view`,
        );
        // Silently: a view is a change of VIEW, not of work. Undo gives back
        // the last thing the designer DID, not the last place they looked
        // from — and a transition must not write sixty history entries.
        if (turn !== null) session.store.applySilently(turn);
      };

      // Already there. Nothing to fly.
      if (
        Math.abs(from.azimuth - to.azimuth) < 1e-4 &&
        Math.abs(from.elevation - to.elevation) < 1e-4
      ) {
        place(to);
        setFlying(false);
        return;
      }

      // ANNOUNCED, so nothing has to guess how long it took.
      //
      // The flight is 420ms of wall clock, and a test that waited "600ms and
      // probably fine" passed alone and failed in a loaded suite — which is
      // the worst kind of test, because the failure looks like a product bug.
      // Saying when the camera is moving costs one boolean and turns a race
      // into a condition.
      setFlying(true);
      const started = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - started) / VIEW_TRANSITION_MS);
        place(between(from, to, glide(t)));
        // The LAST frame lands on the target exactly. Easing that merely
        // approaches it leaves the camera a fraction off, so "2D" would stop
        // meaning square-on after a few switches.
        if (t < 1) {
          flight.current = requestAnimationFrame(step);
        } else {
          place(to);
          setFlying(false);
        }
      };
      flight.current = requestAnimationFrame(step);
    },
    [session, cameraOrbit],
  );

  useEffect(() => () => cancelAnimationFrame(flight.current), []);

  /**
   * The broadcast keys.
   *
   * ⏎ TAKES, EVEN FROM A FOCUSED FIELD. That is the prototype's rule and its
   * words: "a show outranks a form". Every other shortcut in the product
   * stands down while somebody is typing; this one does not, because the
   * alternative is an operator pressing Enter at the moment that matters and
   * being told they were in a text box.
   *
   * Space cues and Escape un-cues, both only when not typing — they are
   * ordinary characters and stealing them mid-word would be a fault.
   */
  /**
   * The right mouse button belongs to Studio, not to the browser.
   *
   * A broadcast tool that answers a right-click with "Back / Reload / View
   * page source" is a web page wearing an application's clothes. Surfaces that
   * have their own menu — the stage, the Scene tree — already call
   * `preventDefault`; this covers everywhere else, so the answer is either OUR
   * menu or nothing, and never the browser's.
   *
   * TEXT FIELDS ARE EXEMPT, DELIBERATELY. The native menu there carries cut,
   * copy, paste, spelling and the clipboard permissions that go with them, and
   * we do not reimplement any of it. Taking it away would remove working
   * functionality to make a point about branding.
   */
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (bus === null) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        bus.take();
        ignite();
        return;
      }
      // Space = Cue and Escape = un-cue are NOT here yet, and deliberately
      // not faked. `ProgramBus` has off-air, on-air and holding; the
      // prototype has off, CUED and live. Binding Space to something that is
      // not a cue would be worse than leaving it unbound, because an operator
      // would learn a key that does the wrong thing.
      //
      // PROTOTYPE.md item 7 adds the cued state. These two keys land with it.
      void typing;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bus, ignite, say, revision]);

  const openFromDisk = useCallback(async () => {
    try {
      const picked = await places.disk.pick();
      if (picked === null) {
        // No picker in this browser. The file input still works, so the
        // command falls back rather than doing nothing.
        openInput.current?.click();
        return;
      }
      openJson(picked.json);
      setBound(picked.scene);
      update({ section: "design" });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setNotice(cause instanceof Error ? cause.message : "Could not open that file.");
    }
  }, [places, openJson, update]);

  const menuCommands = useMemo<readonly StudioCommand[]>(() => {
    const wanted = [
      "edit.duplicate",
      "edit.delete",
      "arrange.group",
      "arrange.ungroup",
      "view.frameSelected",
    ];
    const byId = new Map(commands.map((command) => [command.id, command]));
    return wanted.flatMap((id) => {
      const command = byId.get(id);
      return command === undefined ? [] : [command];
    });
  }, [commands]);

  // -- Keyboard -------------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      /**
       * ESCAPE, ONCE, HERE.
       *
       * This is the only listener that sees it. Six surfaces used to claim it
       * with their own window listeners, three in capture phase so they could
       * win; whichever mounted last took the key, and the fixes for that —
       * stopping propagation — then swallowed Escape from everything behind.
       *
       * Now every surface CLAIMS A RUNG and this walks the ladder: overlay,
       * gesture, mode, air, selection. The first rung with something to back
       * out of takes the key and nothing below it hears it.
       *
       * Not routed through `matchBinding`: Escape is not one command, it is a
       * question about what is open. The keymap still LISTS it, because the
       * keyboard reference has to say what the key does.
       */
      if (event.key === "Escape" && typing) {
        // A TEXT FIELD KEEPS ITS OWN ESCAPE.
        //
        // `select.none` is flagged `whileTyping`, so Escape in a name field
        // reached past the field and cleared the selection the designer was
        // editing. Backing out of a field means leaving the field.
        (event.target as HTMLElement | null)?.blur?.();
        event.preventDefault();
        return;
      }

      if (event.key === "Escape") {
        if (cancel() !== null) {
          event.preventDefault();
          return;
        }
        // Nothing claimed it. Fall through so the palette and the keyboard
        // reference — which are rendered by this component and have no other
        // owner — can still close.
        if (paletteOpen || keysOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          setKeysOpen(false);
        }
        return;
      }

      const binding = matchBinding(event, typing);
      if (binding === null) return;
      const command = commands.find((entry) => entry.id === binding.id);
      if (command === undefined || command.enabled === false) return;
      event.preventDefault();
      command.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, paletteOpen, keysOpen]);

  // -- Render ---------------------------------------------------------------

  // ==========================================================================
  // THE SHELL RENDERS UNCONDITIONALLY
  // ==========================================================================
  // These were three early returns: a boot error, a "Loading fonts…" gate, and
  // a null session each replaced the WHOLE application with a bare `<div>` —
  // no navigation, no toolbar, no panels, no status bar. Two of them could
  // persist indefinitely, and one of them (`session === null`) is the ordinary
  // state during startup and after a failed backend construction.
  //
  // A blank screen is never an acceptable state, so nothing below returns
  // early. The shell is always drawn; what cannot be drawn yet is reported
  // INSIDE it, where the user can still navigate, read the reason, and reach
  // Settings.
  const store = session?.store ?? null;
  const document_ = session?.document ?? null;

  const installed = new Set(workspace.installedPacks);
  // A stale preference can name `developer` while the mode is off. Without this
  // the rail correctly hides the entry and the router still renders the panel —
  // Developer Mode replacing the normal interface, which is exactly what it
  // must never do.
  const section: Section =
    workspace.section === "developer" && !workspace.developerMode
      ? "home"
      : workspace.section;
  const designing = section === "design";

  /** Why the canvas cannot be shown, or null when it can. */
  const blocker: string | null =
    bootError !== null
      ? `Rendering is unavailable: ${bootError}`
      : !fontsReady
        ? "Starting…"
        : session === null
          ? "Preparing the editor…"
          : null;

  /**
   * The non-editor sections.
   *
   * Rendered INSTEAD of the editor, never beside it. That is a performance
   * decision as much as a layout one: `SceneView` removes the canvas and stops
   * its animation frame loop when it unmounts, so browsing the Marketplace
   * costs zero rendering. Keeping the editor mounted-but-hidden would have the
   * engine drawing frames nobody can see.
   */
  const renderSection = () => {
    switch (section) {
      case "home":
        return (
          <Home
            recents={recents}
            library={library}
            installedPacks={installed}
            onCreate={openTemplate}
            art={templateArt}
            onPlay={playerReady ? playTemplate : undefined}
            onStop={playerReady ? stopTemplate : undefined}
            onBlank={() => {
              openJson(serializeDocument(newDocument("Untitled", ids, new Date().toISOString())));
              update({ section: "design" });
            }}
            onHybrid={() => {
              openJson(
                serializeDocument(newHybridDocument("Untitled scene", ids, new Date().toISOString())),
              );
              // Expert, because a set has parts. The layer tree, the toolbox
              // and the transform gizmo are the whole of the work here, and a
              // beginner level that hid them would open a 3D scene with no way
              // to put anything in it.
              update({ section: "design", depth: "expert" });
            }}
            onOpenRecent={(project) => {
              openJson(project.json);
              update({ section: "design" });
            }}
            onOpenLibrary={(entry) => {
              openJson(entry.json);
              update({ section: "design" });
            }}
            onBrowse={() => goTo("marketplace")}
            document={document_}
          />
        );
      case "production":
        return (
          <Production
            session={session}
            bus={bus}
            art={templateArt}
            onPlay={playerReady ? playTemplate : undefined}
            onStop={playerReady ? stopTemplate : undefined}
            programCanvas={programCanvasRef.current}
            previewCanvas={canvasRef.current}
            revision={revision}
            installed={installed}
            onOpenScene={openTemplate}
            onOffAir={() => say("offair")}
          />
        );
      case "marketplace":
        return (
          <Marketplace
            installed={installed}
            onInstall={installPack}
            onUninstall={uninstallPack}
            onApplyTheme={applyTheme}
            onUseTemplate={openTemplate}
            canApply={session !== null}
          />
        );
      case "templates":
        return (
          <Templates
            library={library}
            onOpen={(entry) => {
              openJson(entry.json);
              update({ section: "design" });
            }}
            onLibrary={setLibrary}
            storage={storage()}
          />
        );
      case "assets":
        return (
          <Assets
            session={session}
            installed={installed}
            onPlaceScene={(templateId) => placeTemplate(templateId)}
            assets={assets}
            thumbnails={thumbnails}
            usersOf={(assetId) => registryRef.current?.usersOf(assetId) ?? []}
            onRename={(assetId, name) => mutateAsset(assetId, { name })}
            onFavourite={(assetId, favorite) => mutateAsset(assetId, { favorite })}
            onTags={(assetId, tags) => mutateAsset(assetId, { tags })}
            onDuplicate={(assetId) => {
              const registry = registryRef.current;
              if (registry === null) return;
              registry.duplicate(assetId, ids("asset"), new Date().toISOString());
              commitAssets();
            }}
            onDelete={(assetId) => {
              const registry = registryRef.current;
              if (registry === null) return;
              void registry.remove(assetId).then(commitAssets);
            }}
            onReplace={async (assetId, file) => {
              const registry = registryRef.current;
              if (registry === null) return "The asset library is still starting.";
              const bytes = new Uint8Array(await file.arrayBuffer());
              // Decoded BEFORE the record is repointed, so a bad file leaves the
              // existing logo on air rather than replacing it with nothing.
              const codec = registry.codecFor(bytes, file.type);
              if (codec === undefined) return "Streamatrix cannot read that file yet.";
              const hash = hashBytes(bytes);
              await registry.store.put(hash, bytes);
              registry.replace(assetId, hash, bytes.length, new Date().toISOString());
              const resolved = await registry.resolve(assetId);
              if (!resolved.ok) return resolved.reason;
              registry.register({
                ...registry.record(assetId)!,
                metadata: resolved.asset.metadata,
              });
              commitAssets();
              // Every graphic using this id repaints, without being re-opened.
              session?.render();
              return null;
            }}
            onImport={async (file) => {
              const registry = registryRef.current;
              if (registry === null) return "The asset library is still starting.";
              const result = await importAsset(
                registry,
                {
                  name: file.name,
                  type: file.type,
                  bytes: new Uint8Array(await file.arrayBuffer()),
                },
                new Date().toISOString(),
                () => ids("asset"),
              );
              if (!result.ok) return result.reason;
              commitAssets();
              // The open graphic may already reference it by id — a re-import
              // of a replaced logo, say — so re-project rather than waiting for
              // the next edit.
              session?.render();
              return null;
            }}
          />
        );
      case "outputs":
        return <Outputs session={session} />;
      case "settings":
        return (
          <Settings
            places={places.providers.map((provider) => provider.status)}
            driveClientId={workspace.driveClientId}
            dropboxAppKey={workspace.dropboxAppKey}
            onCloudKeys={(keys) => update(keys)}
            onConnect={(id) => {
              const provider = places.providers.find((entry) => entry.status.id === id);
              void provider?.connect?.().then(
                (status) =>
                  setNotice(
                    status.connected ? `Connected to ${status.label}` : (status.blocker ?? ""),
                  ),
                (cause: unknown) =>
                  setNotice(cause instanceof Error ? cause.message : "Could not connect."),
              );
            }}
            theme={workspace.theme}
            onTheme={(theme) => update({ theme })}
            developerMode={workspace.developerMode}
            onDeveloperMode={(developerMode) => update({ developerMode })}
            quality={workspace.quality}
            onQuality={(quality) => update({ quality })}
            renderer={workspace.renderer}
            activeRenderer={rendererRef.current}
            onRenderer={(renderer) => update({ renderer })}
            device={device}
            frames={frames}
            sound={workspace.sound}
            onSound={(on) => {
              update({ sound: on });
              // The switch confirms itself — the one place a sound is allowed
              // to be the thing you just asked for.
              if (on) sound.toggle(true), say("detent");
            }}
            onAudition={say}
            onAir={bus?.onAir ?? false}
            onResetWorkspace={() => {
              resetWorkspace();
              setWorkspace(DEFAULT_WORKSPACE);
              setNotice("Layout reset");
            }}
          />
        );
      case "developer":
        return <DeveloperPanel session={session} revision={revision} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="studio"
      data-section={section}
      data-depth={workspace.depth}
      data-flying={flying ? "yes" : "no"}
      data-device={profile.deviceClass}
      data-authoring={profile.canAuthor ? "yes" : "no"}
      data-touch={profile.touchTargets ? "yes" : "no"}
    >
      {/* THE SPINE. Three pixels across the top of the entire application:
          nearly invisible off air, a glowing red bar when live, with a short
          ignite at the moment of the take.

          It is the most important thing on the screen and it costs three
          pixels. You cannot be on air and not know it, from any distance,
          without reading anything — which a text tally in a corner cannot
          claim. */}
      <div
        className={`spine ${bus?.onAir ? "live" : ""} ${bus?.cued === true ? "cued" : ""} ${
          igniting ? "igniting" : ""
        }`}
        data-testid="spine"
        /* Three states, and only ONE of them is red. A cued graphic tints the
           spine teal — the preview colour — because red must never mean
           anything except "this is going out right now". */
        data-air={bus?.onAir === true ? "live" : bus?.cued === true ? "cued" : "off"}
        aria-hidden
      />

      <Nav
        section={section}
        onSection={goTo}
        developerMode={workspace.developerMode}
        dirty={store?.dirty ?? false}
        onAir={bus?.onAir ?? false}
        cued={bus?.cued ?? false}
      />
      <div className="workspace">
      {/* The titlebar is CONTEXTUAL.
          It carried the document name, a recents dropdown and a theme toggle on
          every screen, including Home — editor chrome on a browsing surface,
          which is the sort of thing that makes a product feel like an IDE. The
          document name only means something while a document is open; the theme
          belongs to Settings, which owns appearance. */}
      <header className="titlebar">
        {/* ALWAYS, ON EVERY SCREEN. A menu bar that appeared only in the
            editor would be the opposite of what a menu bar is for: the one
            place that is always in the same place. */}
        <MenuBar commands={commands} />
        {designing ? (
          <>
            <span className="doc-name" data-testid="doc-name">
              {document_?.meta.name ?? "Untitled"}
              {store?.dirty === true ? (
                <span className="dirty" title="Unsaved changes" data-testid="dirty">
                  {" "}
                  ●
                </span>
              ) : null}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="chip"
              disabled={session === null}
              onClick={() => save(false)}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <strong className="section-title">{sectionSpec(section).label}</strong>
            <span className="spacer" />
          </>
        )}
        <button type="button" className="chip" onClick={() => setPaletteOpen(true)}>
          Commands <kbd>Ctrl/⌘ K</kbd>
        </button>
      </header>

      {!designing ? (
        // KEYED BY SECTION, so the arrival animation actually runs.
        // React keeps one div and swaps its children, which means a CSS
        // entrance plays exactly once — on first paint — and every navigation
        // afterwards is a hard cut. Re-keying remounts the wrapper, so moving
        // between Home, Marketplace and Production is a movement rather than
        // a swap.
        <div className="section-host" data-testid="section-host" key={section}>
          {renderSection()}
        </div>
      ) : session === null || store === null || document_ === null || canvasRef.current === null ? (
        // The editor needs a session; the SHELL does not. So this reports the
        // reason inside the fully-drawn application rather than replacing it,
        // and every other section stays reachable while it resolves.
        <div className="section-host" data-testid="section-host">
          <div className="section-page" data-testid="editor-unavailable">
            <header className="section-head">
              <div>
                <h1>Design</h1>
                <p className="lede">{blocker ?? "Preparing the editor…"}</p>
              </div>
            </header>
            {bootError !== null ? (
              <section className="home-block">
                <p className="note pad">
                  Streamatrix needs hardware-accelerated graphics. Check that it
                  is enabled in your browser, then reload.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
      <>
      <div className="body">
        <main className="stage">
          <div className="viewport-toolbar" data-testid="viewport-toolbar">
            {/* THE TRANSPORT, at the depth that needs it.
                A beginner previewing a lower third needs to watch it and stop
                watching it. Frame-stepping and a frame counter are what you
                reach for when you are TIMING something, which is designer
                work — and putting them here regardless is how a stage ends up
                looking like an engine rather than a product. */}
            <button
              type="button"
              className="chip"
              onClick={() => (session.playing ? session.pause() : session.play())}
              aria-label={session.playing ? "Pause" : "Play"}
              data-testid="transport-play"
            >
              {session.playing ? "❙❙" : "▶"}
            </button>
            <button type="button" className="chip" onClick={() => session.stop()} aria-label="Stop">
              ■
            </button>
            {workspace.depth === "beginner" ? null : (
              <>
                <button
                  type="button"
                  className="chip"
                  onClick={() => session.stepFrames(-1)}
                  aria-label="Step back"
                >
                  ◀|
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => session.stepFrames(1)}
                  aria-label="Step forward"
                >
                  |▶
                </button>
                <span className="frame mono" data-testid="frame">
                  f{session.frame}
                </span>
              </>
            )}
            <span className="spacer" />

            {/* THE VIEW. Five named angles, because orbit alone is a gesture
                you have to know about and a camera you can turn freely is a
                camera you can lose. Pressing "Top" is also what teaches
                somebody the camera can move at all. */}
            {/* 2D or 3D FIRST, modes second.
                Five equal buttons asked a designer to understand camera
                angles before they could make a flat lower third, and buried
                the one distinction that actually matters: flat, or in space.
                The modes appear only once you are in 3D. */}
            <span className="views" data-testid="views">
              <span className="seg" role="group" aria-label="Dimension">
                <button
                  type="button"
                  className={`chip ${spatial ? "" : "on"}`}
                  data-testid="dim-2d"
                  aria-pressed={!spatial}
                  title={FLAT.hint}
                  onClick={() => setView(FLAT)}
                >
                  2D
                </button>
                <button
                  type="button"
                  className={`chip ${spatial ? "on" : ""}`}
                  data-testid="dim-3d"
                  aria-pressed={spatial}
                  title="Work in space. The camera can be turned."
                  /* From flat, `currentView` IS Front — so reusing it here
                     re-selected 2D and the button did nothing. Entering 3D
                     goes to a spatial mode; pressing it while already in one
                     leaves you where you are. */
                  onClick={() => setView(spatial ? (currentView ?? DEFAULT_SPATIAL) : DEFAULT_SPATIAL)}
                >
                  3D
                </button>
              </span>

              {spatial ? (
                <span className="modes" data-testid="modes">
                  {SPATIAL_MODES.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      className={`chip ${currentView?.id === view.id ? "on" : ""}`}
                      data-testid={`view-${view.id}`}
                      title={view.hint}
                      onClick={() => setView(view)}
                    >
                      {view.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>

            {/* MOVE, ROTATE, SCALE. In space there are three transforms and a
                pointer with two dimensions, so the tool has to say which one
                a drag means before the drag starts.

                Only in 3D. Square-on there is one plane and the box handles
                already offer all three, so a switcher there would be three
                buttons that change nothing. */}
            {spatial ? (
              <span className="seg" role="group" aria-label="Transform" data-testid="gizmo-modes">
                {GIZMO_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`chip ${workspace.gizmoMode === mode.id ? "on" : ""}`}
                    data-testid={`gizmo-${mode.id}`}
                    aria-pressed={workspace.gizmoMode === mode.id}
                    title={`${mode.hint} (${mode.key})`}
                    onClick={() => update({ gizmoMode: mode.id })}
                  >
                    {mode.label}
                  </button>
                ))}
              </span>
            ) : null}

            <button type="button" className="chip" onClick={() => askViewport({ kind: "fit" })}>
              Fit
            </button>
            {/* A percentage is for matching two views precisely. A beginner
                has Fit, and a number they cannot act on is noise. */}
            {workspace.depth === "beginner" ? null : (
              <span className="zoom mono" data-testid="zoom">
                {(viewport.zoom * 100).toFixed(0)}%
              </span>
            )}
            {(workspace.depth === "beginner"
              ? []
              : ([
                  ["showSafeAreas", "Safe"],
                  ["showGrid", "Grid"],
                  ["showGuides", "Guides"],
                  ["showRulers", "Rulers"],
                  ["snapEnabled", "Snap"],
                  // Debug names the engine, so it needs Developer Mode as
                  // well as expert — the two are different axes and a
                  // colourist working on materials is neither.
                  ...(workspace.developerMode
                    ? ([["showDebug", "Debug"]] as const)
                    : []),
                ] as const)
            ).map(([key, label]) => (
              <label key={key} className="toggle">
                <input
                  type="checkbox"
                  checked={workspace[key]}
                  onChange={(event) =>
                    update({ [key]: event.target.checked } as Partial<Workspace>)
                  }
                />
                {label}
              </label>
            ))}
          </div>

          {/* Align, distribute, group. All operate on a SELECTION — so the row
              exists when there is one and not before.

              It used to be permanent, which meant the stage carried three
              stacked bars and a hundred pixels of chrome above the picture,
              two of them full of greyed-out icons for actions that could not
              be performed. A row of disabled controls is a row that teaches
              somebody the product is mostly unavailable. */}
          {shows.construction && selection.ids.length > 0 ? (
            <ArrangeBar
              session={session}
              selection={selection}
              ids={ids}
              onEdit={edit}
              onSelect={(nodeIds) => setSelection(selectMany(nodeIds))}
            />
          ) : null}

          <div className="well">
            <SceneView
            onDropScene={(templateId, at) => placeTemplate(templateId, at)}
            session={session}
            canvas={canvasRef.current}
            revision={revision}
            workspace={workspace}
            selection={selection}
            onSelection={setSelection}
            lockedIds={locked}
            viewport={viewport}
            onViewport={setViewport}
            viewportRequest={viewportRequest}
            cameras={workspace.cameras}
            onRememberCamera={rememberCamera}
            /* The SAME command objects the palette and keyboard run. */
            menuCommands={menuCommands}
            /* Clicking a ball looks down that axis. It reuses the named-view
               machinery rather than aiming the camera itself, so the widget,
               the view buttons and the keyboard can never disagree about
               where "Side" is. */
            onFrame={onFrame}
            canAuthor={profile.canAuthor}
            onCompass={(axis, sign) => {
              // +Z is straight on, which is 2D. Everything else is a mode.
              const wanted =
                axis === "y"
                  ? sign > 0 ? "top" : "low"
                  : axis === "x"
                    ? "side"
                    : sign > 0 ? "front" : "three-quarter";
              const view = VIEWS.find((candidate) => candidate.id === wanted);
              if (view !== undefined) setView(view);
            }}
            />

          </div>

          {/* The Program row lives in Production now. Going to air is not a
              design act, and a control that starts a transmission has no
              business beside one that nudges a rectangle. */}

          {workspace.bottomOpen && shows.timeline ? (
            <>
              <Divider
                axis="y"
                onDelta={(delta) => update({ bottomHeight: workspace.bottomHeight - delta })}
              />
              <section className="dock bottom" style={{ height: workspace.bottomHeight }}>
                {/* NOT A TAB BAR. Volume Two: "Streamatrix never tabs a
                    panel. A tab hides a panel's state behind another panel's,
                    and a hidden panel on a live desk is a panel you forgot
                    about." Every panel below is present and shows whether it
                    is open or collapsed. Any number can be open at once. */}
                <nav className="dock-heads">
                  {BOTTOM_PANELS.map((panel: BottomPanel) => {
                    const open = workspace.bottomExpanded.includes(panel);
                    return (
                      <button
                        key={panel}
                        type="button"
                        className={`dock-head ${open ? "open" : ""}`}
                        aria-expanded={open}
                        data-testid={`panel-${panel}`}
                        onClick={() => {
                          update({
                            bottomExpanded: open
                              ? workspace.bottomExpanded.filter((entry) => entry !== panel)
                              : [...workspace.bottomExpanded, panel],
                          });
                          say(open ? "tick" : "detent");
                        }}
                      >
                        <span className="caret" aria-hidden>
                          {open ? "▾" : "▸"}
                        </span>
                        {PANEL_LABEL[panel]}
                      </button>
                    );
                  })}
                  <span className="spacer" />
                  <button
                    type="button"
                    className="chip"
                    onClick={() => update({ section: "production" })}
                    title="Cue and take are in Production"
                  >
                    Production
                  </button>
                </nav>

                {/* Stacked, and every open panel shares the height. */}
                <div className="dock-stack">
                  {workspace.bottomExpanded.includes("timeline") ? (
                    <TimelineEditor
                      session={session}
                      revision={revision}
                      selection={selection}
                      ids={ids}
                      zoom={workspace.timelineZoom}
                      onZoom={(timelineZoom) => update({ timelineZoom })}
                      onEdit={edit}
                    />
                  ) : null}
                  {workspace.bottomExpanded.includes("presets") ? (
                    <PresetPanel session={session} selection={selection} ids={ids} onEdit={edit} />
                  ) : null}
                  {workspace.bottomExpanded.includes("variables") ? (
                    <Variables session={session} selection={selection} ids={ids} onEdit={edit} />
                  ) : null}
                  {workspace.bottomExpanded.includes("library") ? (
                    <LibraryPanel
                      session={session}
                      ids={ids}
                      library={library}
                      onLibrary={setLibrary}
                      storage={storage()}
                      onEdit={edit}
                      onOpen={(next) => openJson(serializeDocument(next))}
                      now={() => new Date().toISOString()}
                    />
                  ) : null}
                  {workspace.bottomExpanded.length === 0 ? (
                    <p className="note pad" data-testid="dock-empty">
                      Every panel here is collapsed. Open one above — nothing is
                      hidden behind anything else.
                    </p>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
        </main>

        {workspace.rightOpen ? (
          <aside className="dock right" style={{ width: workspace.rightWidth }}>
            <Divider
              axis="x"
              onDelta={(delta) => update({ rightWidth: workspace.rightWidth - delta })}
            />
            {/* The BODY scrolls; the foot does not. A hint that describes the
                whole dock has to stay visible while the dock is scrolled, or
                it is a hint about whatever happens to be above it. */}
            <div className="dock-body">
            {/* ==============================================================
                ONE DOCK, IN THE ORDER THE PROTOTYPE PUTS IT
                ==============================================================
                  [expert]  Layers
                            Content       Name · Role · Logo
                            Look          Colour · Entrance
                  [expert]  Properties
                  [expert]  Create
                            ----------------------------------------
                            the foot, which states the bargain

                Content is ALWAYS FIRST, above the layer tree, because the
                thing a person came to change is the thing in the graphic —
                not the structure that holds it. Studio had that backwards
                for as long as it had a left dock. */}
            <Content
              session={session}
              assets={assets}
              onAir={bus?.onAir ?? false}
              onGoLive={() => {
                // Design does not put anything on air. It hands you to the
                // surface that does — one place is in charge of transmission,
                // and it is not the place where rectangles get nudged.
                update({ section: "production" });
              }}
              ids={ids}
              depth={workspace.depth}
              onDepth={(depth) => update({ depth })}
              onEdit={edit}
            />
            {shows.construction ? (
              <>
                <Hierarchy
                  session={session}
                  commands={commands}
                  selection={selection}
                  onSelection={setSelection}
                  expanded={expanded}
                  onExpanded={setExpanded}
                  locked={locked}
                  onToggleLock={(nodeId) =>
                    setLocked((current) => {
                      const next = new Set(current);
                      if (next.has(nodeId)) next.delete(nodeId);
                      else next.add(nodeId);
                      return next;
                    })
                  }
                  onMove={(nodeId, parentId, index) =>
                    edit(moveNode(document_, nodeId, parentId, index))
                  }
                  onRename={(nodeId, name) => edit(renameNode(document_, nodeId, name))}
                  onToggleVisible={(nodeId) =>
                    edit(
                      setProp(
                        document_,
                        nodeId,
                        "visible",
                        findNode(document_.root, nodeId)?.visible === false,
                        "Toggle visibility",
                      ),
                    )
                  }
                />
                {/* Properties is expert. Showing it at beginner put a node id,
                    position z and scale x in front of somebody whose panel
                    footer said "Content only" — the interface contradicting
                    itself, and every engine term in it a bug. */}
                <Inspector
                  session={session}
                  selection={selection}
                  onEdit={edit}
                  ids={ids}
                  developerMode={workspace.developerMode}
                />
                <Toolbox
                  onCreate={create}
                  installed={installed}
                  onPlaceScene={(templateId) => placeTemplate(templateId)}
                />
              </>
            ) : null}
            </div>
            <LevelFoot depth={workspace.depth} onDepth={(depth) => update({ depth })} />
          </aside>
        ) : null}
      </div>

      {/* Text failing must be VISIBLE and non-fatal. Before Phase 4's fix a
          text-engine failure took the whole application down silently; now it
          is one line in the status bar and everything else keeps working. */}
      {textError !== null ? (
        <div className="banner" role="status" data-testid="text-unavailable">
          Text is unavailable — graphics will render without words. Reloading
          may fix it.
        </div>
      ) : null}

      {/* Grain over everything. Fixed, non-interactive, blend-overlay — it is
          what stops large flat areas reading as untextured fills. */}
      <div className="grain" aria-hidden />

      <footer className="statusbar" data-testid="statusbar">
        <span>{selection.ids.length} selected</span>
        {/* "Objects" is what the panel now calls them. "Layers" was wrong the
            moment the tree held things that are in space: a light and a camera
            are not layers, and calling them one taught the wrong model. */}
        <span className="dim">{countNodes(document_)} objects</span>
        <span className="dim" data-testid="history">
          history {store.depth}
          {store.dirty ? " · unsaved" : " · saved"}
        </span>
        <span className="spacer" />
        {notice !== null ? <span className="notice">{notice}</span> : null}
        {/* The scene's id is a debugging aid, not a fact anyone making a
            graphic needs. It stays, behind Developer Mode. */}
        {workspace.developerMode ? <span className="dim mono">{document_.id}</span> : null}
      </footer>
      </>
      )}
      </div>

      <input
        ref={openInput}
        type="file"
        accept="application/json"
        className="hidden-input"
        aria-label="Open scene file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const input = event.target;
          if (file !== undefined) void file.text().then((text) => openJson(text));
          input.value = "";
        }}
      />

      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      {keysOpen ? <KeyboardHelp onClose={() => setKeysOpen(false)} /> : null}
    </div>
  );
}

function Divider({ axis, onDelta }: { axis: "x" | "y"; onDelta: (delta: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className={`divider ${axis}`}
      role="separator"
      aria-label="Resize panel"
      onPointerDown={(event) => {
        last.current = axis === "x" ? event.clientX : event.clientY;
        (event.target as Element).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;
        const current = axis === "x" ? event.clientX : event.clientY;
        onDelta(current - last.current);
        last.current = current;
      }}
      onPointerUp={() => {
        last.current = null;
      }}
    />
  );
}

/**
 * Which layers are open when a document is.
 *
 * Root-only was wrong. Opening a template showed ONE collapsed layer, and a
 * first-time user had to know to expand it before they could find the text they
 * came to edit — which is a documentation step inside a workflow that is
 * supposed to need none.
 *
 * Everything is expanded, up to a cap. A template is a handful of layers and a
 * designer wants to see them; an imported scene of ten thousand is not
 * something anyone wants unrolled, and the cap is what tells the two apart.
 */
const EXPAND_ON_OPEN_LIMIT = 60;

function expandedOnOpen(document_: SceneDocument): ReadonlySet<string> {
  const ids_ = allIds(document_);
  if (ids_.length > EXPAND_ON_OPEN_LIMIT) return new Set([document_.root.id]);
  return new Set(ids_);
}

/**
 * Local storage, or nothing.
 *
 * Returns null rather than throwing when storage is unavailable — private
 * browsing, a blocked origin, a quota-full profile. The library and the recents
 * are conveniences; the document is the truth, and an editor that will not open
 * because it cannot read a shelf is worse than one that forgets the shelf.
 */
function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    localStorage.getItem("streamatrix.studio.probe");
    return localStorage;
  } catch {
    return null;
  }
}

function allIds(document_: SceneDocument): readonly string[] {
  const out: string[] = [];
  const stack = [document_.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node.id);
    for (const child of node.children ?? []) stack.push(child);
  }
  return out;
}

function countNodes(document_: SceneDocument): number {
  return allIds(document_).length;
}
