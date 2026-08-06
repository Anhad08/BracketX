import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCanvasBackend } from "@bracketx/engine-render-three";
import type { ImageProvider, TextProvider } from "@bracketx/engine-reconciler";
import { findNode, type SceneDocument, type Transaction } from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
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
import { DEFAULT_VIEWPORT, zoomAt, type Viewport } from "./studio/viewport";
import {
  fileNameFor,
  loadRecents,
  newDocument,
  parseDocument,
  rememberProject,
  serializeDocument,
  touch,
  type RecentProject,
} from "./studio/project";
import {
  BOTTOM_TABS,
  DEFAULT_WORKSPACE,
  loadWorkspace,
  saveWorkspace,
  type BottomTab,
  type Workspace,
  docksAt,
} from "./studio/workspace";
import { matchBinding, shortcutFor, type StudioCommand } from "./studio/commands";
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
import { Content, Hierarchy, Inspector, Toolbox, Variables } from "./ui/panels";
import { TimelineEditor } from "./ui/timeline";
import { ArrangeBar, LibraryPanel, PresetPanel } from "./ui/authoring";
import { ProgramRow } from "./ui/program";
import { CommandPalette, KeyboardHelp } from "./ui/palette";
import { Nav } from "./ui/nav";
import { Home } from "./ui/home";
import { Assets, Marketplace, Outputs, Settings, Templates } from "./ui/sections";
import { DeveloperPanel } from "./ui/developer";
import { placeScene } from "./studio/place";
import {
  PACKS,
  installTheme,
  instantiateTemplate,
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
const TAB_LABEL: Record<BottomTab, string> = {
  timeline: "Timeline",
  presets: "Motion",
  variables: "Data",
  library: "Templates",
};

export function App() {
  // The canvas is created ONCE, imperatively, before any component mounts. The
  // backend binds to it for the session's lifetime (MirrorBackend contract C2),
  // so a canvas that mounted with a component would tear down the mirror every
  // time the panel layout changed.
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
  const [fitToken, setFitToken] = useState(0);
  const [frameToken, setFrameToken] = useState(0);
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
      const preview = new StudioSession(createCanvasBackend(canvas), created, {
        ...(text === undefined ? {} : { text }),
        ...(images === undefined ? {} : { images }),
      });
      // Program starts on a document of its own rather than a reference to
      // Preview's: sharing one would be the exact leak the whole split exists
      // to prevent, and it would be invisible until the first edit.
      const program = new StudioSession(
        createCanvasBackend(programCanvas),
        newDocument("Program", ids, new Date().toISOString()),
        {
          ...(text === undefined ? {} : { text }),
          ...(images === undefined ? {} : { images }),
        },
      );
      setSession(preview);
      setBus(new ProgramBus(preview, program));
      setExpanded(new Set([created.root.id]));

      // Apply whatever the user asked for while we were starting.
      const queued = pendingOpen.current;
      if (queued !== null) {
        pendingOpen.current = null;
        try {
          const parsed = parseDocument(queued);
          preview.open(parsed);
          setExpanded(expandedOnOpen(parsed));
        } catch {
          // A malformed queued document is no worse than a malformed opened
          // one: the blank scene stays, and nothing crashes.
        }
      }
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
        setFitToken((value) => value + 1);
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
        run: () => openInput.current?.click(),
      },
      {
        id: "file.save",
        title: "Save",
        section: "File",
        hint: store.dirty ? "unsaved changes" : "up to date",
        shortcut: shortcutFor("file.save"),
        run: () => save(false),
      },
      {
        id: "file.saveAs",
        title: "Save as file…",
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
          update({ bottomOpen: true, bottomTab: "timeline" });
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
          update({ bottomOpen: true, bottomTab: "timeline" });
        },
      })),

      // -- Program ----------------------------------------------------------
      ...(bus === null
        ? []
        : [
            {
              id: "program.take",
              title: "Take to Program",
              section: "Program" as const,
              hint: bus.pending ? "Preview differs from air" : "nothing pending",
              keywords: ["air", "live", "transition"],
              run: () => {
                bus.take();
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
          update({ bottomOpen: true, bottomTab: "library" });
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
          update({ bottomOpen: true, bottomTab: "library" });
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
        run: () => setFitToken((value) => value + 1),
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
        run: () => setFrameToken((value) => value + 1),
      },
      {
        id: "view.zoomIn",
        title: "Zoom in",
        section: "View",
        shortcut: shortcutFor("view.zoomIn"),
        run: () => setViewport((current) => zoomAt(current, { x: 0, y: 0 }, 1.25)),
      },
      {
        id: "view.zoomOut",
        title: "Zoom out",
        section: "View",
        shortcut: shortcutFor("view.zoomOut"),
        run: () => setViewport((current) => zoomAt(current, { x: 0, y: 0 }, 0.8)),
      },
      {
        id: "view.actualSize",
        title: "Zoom to 100%",
        section: "View",
        shortcut: shortcutFor("view.actualSize"),
        run: () => setViewport((current) => ({ ...current, zoom: 1 })),
      },
      ...(
        [
          ["view.safeAreas", "safe areas", "showSafeAreas"],
          ["view.grid", "grid", "showGrid"],
          ["view.snap", "snapping", "snapEnabled"],
          ["view.debug", "debug overlay", "showDebug"],
        ] as const
      ).map(([id, label, key]) => ({
        id,
        title: `Toggle ${label}`,
        section: "View" as const,
        shortcut: shortcutFor(id),
        run: () => update({ [key]: !workspace[key] } as Partial<Workspace>),
      })),
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

      const binding = matchBinding(event, typing);
      if (binding === null) return;

      if (binding.id === "select.none" && (paletteOpen || keysOpen)) {
        event.preventDefault();
        setPaletteOpen(false);
        setKeysOpen(false);
        return;
      }
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
            onBlank={() => {
              openJson(serializeDocument(newDocument("Untitled", ids, new Date().toISOString())));
              update({ section: "design" });
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
            theme={workspace.theme}
            onTheme={(theme) => update({ theme })}
            developerMode={workspace.developerMode}
            onDeveloperMode={(developerMode) => update({ developerMode })}
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
    <div className="studio" data-section={section}
        data-depth={workspace.depth}>
      <Nav
        section={section}
        onSection={goTo}
        developerMode={workspace.developerMode}
        dirty={store?.dirty ?? false}
        onAir={bus?.onAir ?? false}
      />
      <div className="workspace">
      {/* The titlebar is CONTEXTUAL.
          It carried the document name, a recents dropdown and a theme toggle on
          every screen, including Home — editor chrome on a browsing surface,
          which is the sort of thing that makes a product feel like an IDE. The
          document name only means something while a document is open; the theme
          belongs to Settings, which owns appearance. */}
      <header className="titlebar">
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
        <div className="section-host" data-testid="section-host">
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
        {workspace.leftOpen && docksAt(workspace.depth).left ? (
          <aside className="dock left" style={{ width: workspace.leftWidth }}>
            <Toolbox
              onCreate={create}
              installed={installed}
              onPlaceScene={(templateId) => placeTemplate(templateId)}
            />
            <Hierarchy
              session={session}
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
            <Divider
              axis="x"
              onDelta={(delta) => update({ leftWidth: workspace.leftWidth + delta })}
            />
          </aside>
        ) : null}

        <main className="stage">
          <div className="viewport-toolbar" data-testid="viewport-toolbar">
            <button type="button" className="chip" onClick={() => session.play()} aria-label="Play">
              ▶
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => session.pause()}
              aria-label="Pause"
            >
              ❚❚
            </button>
            <button type="button" className="chip" onClick={() => session.stop()} aria-label="Stop">
              ■
            </button>
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
            <span className="spacer" />
            <button type="button" className="chip" onClick={() => setFitToken((v) => v + 1)}>
              Fit
            </button>
            <span className="zoom mono" data-testid="zoom">
              {(viewport.zoom * 100).toFixed(0)}%
            </span>
            {(workspace.depth === "beginner"
              ? []
              : ([
                  ["showSafeAreas", "Safe"],
                  ["showGrid", "Grid"],
                  ["showGuides", "Guides"],
                  ["showRulers", "Rulers"],
                  ["snapEnabled", "Snap"],
                  // Debug names the engine. Advanced only.
                  ...(workspace.depth === "advanced"
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

          {/* Align, distribute, group. All operate on a selection, and a
              beginner has no selection because they have no layer tree. */}
          {docksAt(workspace.depth).left ? (
            <ArrangeBar
              session={session}
              selection={selection}
              ids={ids}
              onEdit={edit}
              onSelect={(nodeIds) => setSelection(selectMany(nodeIds))}
            />
          ) : null}

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
            fitToken={fitToken}
            frameToken={frameToken}
            /* The SAME command objects the palette and keyboard run. */
            menuCommands={menuCommands}
          />

          {workspace.programOpen && bus !== null && programCanvasRef.current !== null ? (
            <ProgramRow bus={bus} canvas={programCanvasRef.current} revision={revision} />
          ) : null}

          {workspace.bottomOpen && docksAt(workspace.depth).bottom ? (
            <>
              <Divider
                axis="y"
                onDelta={(delta) => update({ bottomHeight: workspace.bottomHeight - delta })}
              />
              <section className="dock bottom" style={{ height: workspace.bottomHeight }}>
                <nav className="tabs" role="tablist">
                  {BOTTOM_TABS.map((tab: BottomTab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={workspace.bottomTab === tab}
                      className={workspace.bottomTab === tab ? "active" : ""}
                      onClick={() => update({ bottomTab: tab })}
                    >
                      {TAB_LABEL[tab]}
                    </button>
                  ))}
                  <span className="spacer" />
                  <button
                    type="button"
                    className={`chip ${workspace.programOpen ? "on" : ""}`}
                    onClick={() => update({ programOpen: !workspace.programOpen })}
                    title="Preview / Program is a row, not a tab — on-air state is never behind something else"
                  >
                    Program
                  </button>
                </nav>

                {workspace.bottomTab === "timeline" ? (
                  <TimelineEditor
                    session={session}
                    revision={revision}
                    selection={selection}
                    ids={ids}
                    zoom={workspace.timelineZoom}
                    onZoom={(timelineZoom) => update({ timelineZoom })}
                    onEdit={edit}
                  />
                ) : workspace.bottomTab === "presets" ? (
                  <PresetPanel session={session} selection={selection} ids={ids} onEdit={edit} />
                ) : workspace.bottomTab === "variables" ? (
                  <Variables session={session} selection={selection} ids={ids} onEdit={edit} />
                ) : (
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
                )}
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
            <Content
              session={session}
              assets={assets}
              onAir={bus?.onAir ?? false}
              onGoLive={() => {
                if (bus === null) return;
                // One button, both directions. Opening the Program row is part
                // of going live: an operator must SEE what is on air, and a
                // beginner who is broadcasting has earned that row.
                if (bus.onAir) bus.clear();
                else {
                  bus.take();
                  update({ programOpen: true });
                }
              }}
              ids={ids}
              depth={workspace.depth}
              onDepth={(depth) => update({ depth })}
              onEdit={edit}
            />
            {/* Properties is a Designer panel. Showing it at beginner depth
                put `nod_iyt0000v`, position z and scale x in front of someone
                whose panel footer said "Content only" — the interface
                contradicting itself, and every engine term in it a bug. */}
            {workspace.depth === "beginner" ? null : (
              <Inspector session={session} selection={selection} onEdit={edit} ids={ids} />
            )}
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

      <footer className="statusbar" data-testid="statusbar">
        <span>{selection.ids.length} selected</span>
        {/* "Layers" is what the panel calls them and what a designer calls
            them. "Nodes" is what the engine calls them. */}
        <span className="dim">{countNodes(document_)} layers</span>
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
