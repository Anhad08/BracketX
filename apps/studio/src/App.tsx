import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCanvasBackend } from "@bracketx/engine-render-three";
import {
  findNode,
  makeSetDocProp,
  type SceneDocument,
  type Transaction,
} from "@bracketx/engine-scene";

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
  createNode,
  deleteNodes,
  duplicateNodes,
  moveNode,
  renameNode,
  setProp,
  transaction,
  type NodeKind,
} from "./studio/editing";
import { outline, pathTo } from "./studio/outline";
import { randomIdFactory } from "./studio/ids";
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
  DEFAULT_WORKSPACE,
  loadWorkspace,
  saveWorkspace,
  type BottomTab,
  type Workspace,
} from "./studio/workspace";
import { matchBinding, shortcutFor, type StudioCommand } from "./studio/commands";
import { SceneView } from "./ui/scene-view";
import {
  Hierarchy,
  Inspector,
  TimelinePanel,
  Toolbox,
  Variables,
  makeTimeline,
} from "./ui/panels";
import { CommandPalette, KeyboardHelp } from "./ui/palette";

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

export function App() {
  // The canvas is created ONCE, imperatively, before any component mounts. The
  // backend binds to it for the session's lifetime (MirrorBackend contract C2),
  // so a canvas that mounted with a component would tear down the mirror every
  // time the panel layout changed.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (canvasRef.current === null && typeof document !== "undefined") {
    canvasRef.current = document.createElement("canvas");
  }

  const [session, setSession] = useState<StudioSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const [workspace, setWorkspace] = useState<Workspace>(DEFAULT_WORKSPACE);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [fitToken, setFitToken] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [recents, setRecents] = useState<readonly RecentProject[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const openInput = useRef<HTMLInputElement | null>(null);

  // -- Boot -----------------------------------------------------------------

  useEffect(() => {
    setWorkspace(loadWorkspace());
    setRecents(loadRecents());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || session !== null) return;
    try {
      const created = newDocument("Untitled", ids, new Date().toISOString());
      canvas.width = created.world.output.width;
      canvas.height = created.world.output.height;
      const backend = createCanvasBackend(canvas);
      setSession(new StudioSession(backend, created));
      setExpanded(new Set([created.root.id]));
    } catch (cause) {
      // WebGL can be unavailable entirely. An editor that shows a blank page in
      // that case reads as broken software rather than as a missing GPU.
      setBootError(String(cause));
    }
  }, [session]);

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

  const openJson = useCallback(
    (json: string) => {
      if (session === null) return;
      try {
        const parsed = parseDocument(json);
        session.open(parsed);
        setSelection(EMPTY_SELECTION);
        setExpanded(new Set([parsed.root.id]));
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
          const primary = primaryOf(selection);
          const node = primary === null ? null : findNode(document_.root, primary);
          edit(
            transaction("Add timeline", [
              makeSetDocProp(
                document_,
                `animations.${(document_.animations ?? []).length}`,
                makeTimeline(node, ids),
              ),
            ]),
          );
          update({ bottomOpen: true, bottomTab: "timeline" });
        },
      },
      ...(["group", "rect", "camera"] as const).map((kind) => ({
        id: `create.${kind}`,
        title: `Add ${kind}`,
        section: "Create" as const,
        run: () => create(kind),
      })),
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

  if (bootError !== null) {
    return (
      <div className="boot-error" role="alert">
        <h1>Streamatrix Studio</h1>
        <p>Rendering is unavailable: {bootError}</p>
      </div>
    );
  }
  if (session === null || canvasRef.current === null) {
    return <div className="boot">Starting…</div>;
  }

  const store = session.store;
  const document_ = session.document;

  return (
    <div className="studio">
      <header className="titlebar">
        <strong>Streamatrix Studio</strong>
        <span className="doc-name" data-testid="doc-name">
          {document_.meta.name}
          {store.dirty ? (
            <span className="dirty" title="Unsaved changes" data-testid="dirty">
              {" "}
              ●
            </span>
          ) : null}
        </span>
        <span className="spacer" />
        <button type="button" className="chip" onClick={() => setPaletteOpen(true)}>
          Commands <kbd>Ctrl/⌘ K</kbd>
        </button>
        <select
          className="field"
          value=""
          onChange={(event) => {
            const entry = recents.find((item) => item.id === event.target.value);
            if (entry !== undefined) openJson(entry.json);
          }}
          aria-label="Recent projects"
        >
          <option value="">Recent…</option>
          {recents.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="chip"
          onClick={() => update({ theme: workspace.theme === "dark" ? "light" : "dark" })}
        >
          {workspace.theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      <div className="body">
        {workspace.leftOpen ? (
          <aside className="dock left" style={{ width: workspace.leftWidth }}>
            <Toolbox onCreate={create} />
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
            {(
              [
                ["showSafeAreas", "Safe"],
                ["showGrid", "Grid"],
                ["showGuides", "Guides"],
                ["showRulers", "Rulers"],
                ["snapEnabled", "Snap"],
                ["showDebug", "Debug"],
              ] as const
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

          <SceneView
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
          />

          {workspace.bottomOpen ? (
            <>
              <Divider
                axis="y"
                onDelta={(delta) => update({ bottomHeight: workspace.bottomHeight - delta })}
              />
              <section className="dock bottom" style={{ height: workspace.bottomHeight }}>
                <nav className="tabs" role="tablist">
                  {(["timeline", "variables"] as const).map((tab: BottomTab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={workspace.bottomTab === tab}
                      className={workspace.bottomTab === tab ? "active" : ""}
                      onClick={() => update({ bottomTab: tab })}
                    >
                      {tab}
                    </button>
                  ))}
                </nav>
                {workspace.bottomTab === "timeline" ? (
                  <TimelinePanel session={session} revision={revision} onEdit={edit} />
                ) : (
                  <Variables session={session} selection={selection} ids={ids} onEdit={edit} />
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
            <Inspector session={session} selection={selection} onEdit={edit} ids={ids} />
          </aside>
        ) : null}
      </div>

      <footer className="statusbar" data-testid="statusbar">
        <span>{selection.ids.length} selected</span>
        <span className="dim">{countNodes(document_)} nodes</span>
        <span className="dim" data-testid="history">
          history {store.depth}
          {store.dirty ? " · unsaved" : " · saved"}
        </span>
        <span className="spacer" />
        {notice !== null ? <span className="notice">{notice}</span> : null}
        <span className="dim mono">{document_.id}</span>
      </footer>

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
