import { beforeEach, describe, expect, it } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import {
  childrenOf,
  findNode,
  makeSetDocProp,
  validateDocument,
  type SceneDocument,
} from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { testIdFactory, type IdFactory } from "./studio/ids";
import {
  createNode,
  deleteNodes,
  duplicateNodes,
  moveNode,
  renameNode,
  resetTransactionIds,
  setProp,
  setPropOnMany,
  transaction,
} from "./studio/editing";
import {
  EMPTY_SELECTION,
  primaryOf,
  prune,
  selectMany,
  selectOnly,
  selectRange,
  step,
  toggle,
} from "./studio/selection";
import { outline, dropTarget, pathTo } from "./studio/outline";
import {
  newDocument,
  parseDocument,
  serializeDocument,
  fileNameFor,
  loadRecents,
  rememberProject,
} from "./studio/project";
import {
  DEFAULT_VIEWPORT,
  canvasToWorld,
  fit,
  marquee,
  nodeBounds,
  pick,
  rectFromCorners,
  screenToWorld,
  snap,
  snapCandidates,
  worldToCanvas,
  zoomAt,
} from "./studio/viewport";
import { KEYMAP, matchBinding, searchCommands, shortcutFor } from "./studio/commands";
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_KEY,
  loadWorkspace,
  saveWorkspace,
} from "./studio/workspace";

/**
 * Studio Phase 1 verification.
 *
 * ============================================================================
 * WHY ALL OF THIS IS HEADLESS
 * ============================================================================
 * Every claim below is about a DOCUMENT or a TRANSACTION, not about pixels:
 * "save and reload is lossless", "undo is deterministic", "a reorder preserves
 * identity", "selection never touches the engine". A test that needed a browser
 * to check any of those would eventually be skipped, which is exactly how the
 * gaps the Phase 6 audit found survived a phase.
 *
 * The core is a plain module set with no React, so this suite drives the real
 * code paths against `MockMirrorBackend` and asserts on real engine state.
 */

let ids: IdFactory;

function session(document_?: SceneDocument): StudioSession {
  return new StudioSession(
    new MockMirrorBackend(),
    document_ ?? newDocument("Test", ids),
  );
}

beforeEach(() => {
  ids = testIdFactory();
  resetTransactionIds();
});

// ===========================================================================
// Scenes open correctly
// ===========================================================================

describe("scenes open correctly", () => {
  it("creates a valid document with a camera", () => {
    // A scene with no camera renders nothing and reports a missed frame per
    // output, which reads as a broken editor rather than an empty document.
    const created = newDocument("Untitled", ids);
    expect(validateDocument(created).valid).toBe(true);
    expect(childrenOf(created.root).some((node) => node.components?.[0]?.type === "camera")).toBe(
      true,
    );
  });

  it("loads into the engine and renders", () => {
    const studio = session();
    const result = studio.render();
    expect(result.drawn).toBe(true);
    expect(studio.host.reconciler.mirror.size).toBeGreaterThan(1);
    studio.dispose();
  });

  it("refuses a malformed document at the door, leaving the open one intact", () => {
    const studio = session();
    const before = studio.document.id;

    expect(() => parseDocument("{}")).toThrow(/not a bracketx/i);
    expect(() => parseDocument("not json")).toThrow(/not valid JSON/);
    // The engine would refuse it later anyway — but by then the editor has torn
    // down the document that was open, and "your file is broken" is a much worse
    // message when it arrives after the work is gone.
    expect(studio.document.id).toBe(before);
    studio.dispose();
  });

  it("refuses a document from a future format version rather than partially reading it", () => {
    const created = newDocument("Future", ids);
    const future = JSON.stringify({ ...created, version: created.version + 1 });
    expect(() => parseDocument(future)).toThrow(/reads up to/);
  });

  it("opening replaces the document and clears history", () => {
    const studio = session();
    studio.store.apply(createNode(studio.document, "rect", studio.document.root.id, ids).transaction);
    expect(studio.store.canUndo).toBe(true);

    studio.open(newDocument("Second", ids));
    expect(studio.store.canUndo).toBe(false);
    expect(studio.store.dirty).toBe(false);
    expect(studio.document.meta.name).toBe("Second");
    studio.dispose();
  });
});

// ===========================================================================
// Save / load is lossless
// ===========================================================================

describe("save and load is lossless", () => {
  function build(): StudioSession {
    const studio = session();
    const root = studio.document.root.id;
    const group = createNode(studio.document, "group", root, ids);
    studio.store.apply(group.transaction);
    const rect = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(rect.transaction);
    studio.store.apply(setProp(studio.document, rect.nodeId, "transform.position", [1, 2, 0]));
    studio.store.apply(renameNode(studio.document, group.nodeId, "Lower Third"));
    return studio;
  }

  it("round-trips byte for byte", () => {
    // Canonical JSON both ways, so equality is exact rather than "looks the
    // same". A format that only round-trips structurally is a format that
    // silently reorders keys and breaks every hash downstream.
    const studio = build();
    const json = serializeDocument(studio.document);
    const reopened = parseDocument(json);
    expect(serializeDocument(reopened)).toBe(json);
    studio.dispose();
  });

  it("reloading into the engine reaches an identical session", () => {
    const studio = build();
    const json = serializeDocument(studio.document);
    studio.render();
    const before = studio.host.sessionHash();

    const other = session(parseDocument(json));
    other.render();
    expect(other.host.sessionHash()).toBe(before);
    expect(other.host.reconciler.mirror.size).toBe(studio.host.reconciler.mirror.size);

    studio.dispose();
    other.dispose();
  });

  it("saves SCENE_FORMAT and nothing else — no editor metadata leaks in", () => {
    // A `.studio` wrapper carrying panel widths is the obvious design and it is
    // a trap: a document Studio wrote must be readable by the renderer, an
    // importer and any other editor.
    const studio = build();
    const parsed = JSON.parse(serializeDocument(studio.document)) as Record<string, unknown>;
    for (const key of ["selection", "viewport", "workspace", "expanded", "locked", "ui"]) {
      expect(parsed[key], key).toBeUndefined();
    }
    expect(parsed.format).toBe("bracketx.scene");
    studio.dispose();
  });

  it("names a file stably, with no timestamp", () => {
    // A save must overwrite. A timestamped name means a folder of near
    // duplicates and no way to tell which one is current.
    const studio = session();
    expect(fileNameFor(studio.document)).toBe("test.scene.json");
    expect(fileNameFor({ ...studio.document, meta: { ...studio.document.meta, name: "  " } })).toBe(
      "untitled.scene.json",
    );
    studio.dispose();
  });

  it("keeps recents without letting a corrupt store break opening", () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
    const next = rememberProject([], { id: "scn_a", name: "A", json: "{}", savedAt: "x" }, store);
    expect(loadRecents(store)).toEqual(next);

    map.set("streamatrix.studio.recents.v1", "not json");
    expect(loadRecents(store)).toEqual([]);
  });
});

// ===========================================================================
// Undo / redo
// ===========================================================================

describe("undo and redo are deterministic", () => {
  it("uses the engine's own inverses — there is no second undo implementation", () => {
    const studio = session();
    const before = serializeDocument(studio.document);

    const created = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(created.transaction);
    expect(serializeDocument(studio.document)).not.toBe(before);

    studio.store.undo();
    // Byte-identical, not merely equivalent. An undo that returns a structurally
    // similar document is an undo that has quietly reordered something.
    expect(serializeDocument(studio.document)).toBe(before);
    studio.dispose();
  });

  it("round-trips a long, mixed edit sequence exactly", () => {
    const studio = session();
    const snapshots: string[] = [serializeDocument(studio.document)];

    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    snapshots.push(serializeDocument(studio.document));

    const rect = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(rect.transaction);
    snapshots.push(serializeDocument(studio.document));

    studio.store.apply(setProp(studio.document, rect.nodeId, "transform.position", [3, 1, 0]));
    snapshots.push(serializeDocument(studio.document));

    studio.store.apply(renameNode(studio.document, rect.nodeId, "Bar"));
    snapshots.push(serializeDocument(studio.document));

    studio.store.apply(moveNode(studio.document, rect.nodeId, studio.document.root.id, 0));
    snapshots.push(serializeDocument(studio.document));

    // Unwind, checking every intermediate state.
    for (let index = snapshots.length - 1; index > 0; index -= 1) {
      expect(serializeDocument(studio.document), `before undo ${index}`).toBe(snapshots[index]);
      expect(studio.store.undo()).toBe(true);
    }
    expect(serializeDocument(studio.document)).toBe(snapshots[0]);

    // And rewind, checking every one again.
    for (let index = 1; index < snapshots.length; index += 1) {
      expect(studio.store.redo()).toBe(true);
      expect(serializeDocument(studio.document), `after redo ${index}`).toBe(snapshots[index]);
    }
    studio.dispose();
  });

  it("leaves the engine in the state the document describes after undo", () => {
    // The document and the mirror must not drift apart. An undo that fixed the
    // JSON and left the scene wrong is the worst possible outcome.
    const studio = session();
    studio.render();
    const before = studio.host.sessionHash();
    const nodes = studio.host.reconciler.mirror.size;

    const created = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(created.transaction);
    studio.render();
    studio.store.undo();
    studio.render();

    expect(studio.host.reconciler.mirror.size).toBe(nodes);
    expect(studio.host.sessionHash()).toBe(before);
    studio.dispose();
  });

  it("a new edit clears the redo branch", () => {
    const studio = session();
    studio.store.apply(createNode(studio.document, "rect", studio.document.root.id, ids).transaction);
    studio.store.undo();
    expect(studio.store.canRedo).toBe(true);

    studio.store.apply(createNode(studio.document, "group", studio.document.root.id, ids).transaction);
    // Keeping it would mean redo could apply a transaction whose prior state no
    // longer exists, and its inverse would then be wrong.
    expect(studio.store.canRedo).toBe(false);
    studio.dispose();
  });

  it("one gesture is one undo step, however many nodes it touched", () => {
    const studio = session();
    const a = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    const b = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(b.transaction);
    const depth = studio.store.depth;

    studio.store.apply(deleteNodes(studio.document, [a.nodeId, b.nodeId]));
    expect(studio.store.depth).toBe(depth + 1);
    studio.store.undo();
    expect(findNode(studio.document.root, a.nodeId)).not.toBeNull();
    expect(findNode(studio.document.root, b.nodeId)).not.toBeNull();
    studio.dispose();
  });

  it("does not record an edit that changes nothing", () => {
    const studio = session();
    const created = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(created.transaction);
    const depth = studio.store.depth;

    // Property panels fire on every keystroke and on blur; without this, undo
    // fills with no-ops and stops feeling like undo.
    const node = findNode(studio.document.root, created.nodeId)!;
    expect(setProp(studio.document, created.nodeId, "name", node.name)).toBeNull();
    expect(studio.store.apply(null)).toBe(false);
    expect(studio.store.depth).toBe(depth);
    studio.dispose();
  });

  it("tracks dirtiness by history position, so undoing back to a save clears it", () => {
    const studio = session();
    expect(studio.store.dirty).toBe(false);
    studio.store.apply(createNode(studio.document, "rect", studio.document.root.id, ids).transaction);
    expect(studio.store.dirty).toBe(true);
    studio.store.markSaved();
    expect(studio.store.dirty).toBe(false);
    studio.store.apply(createNode(studio.document, "group", studio.document.root.id, ids).transaction);
    expect(studio.store.dirty).toBe(true);
    studio.store.undo();
    expect(studio.store.dirty).toBe(false);
    studio.dispose();
  });
});

// ===========================================================================
// Hierarchy edits preserve identity
// ===========================================================================

describe("hierarchy edits preserve identity", () => {
  it("reordering moves a node without recreating it", () => {
    // Identity is what makes a reorder cheap: the mirror keeps the handle, the
    // GPU resources, and any animation in flight.
    const studio = session();
    const root = studio.document.root.id;
    const a = createNode(studio.document, "rect", root, ids);
    studio.store.apply(a.transaction);
    const b = createNode(studio.document, "rect", root, ids);
    studio.store.apply(b.transaction);
    studio.render();

    const handleBefore = studio.host.reconciler.mirror.get(a.nodeId);
    studio.store.apply(moveNode(studio.document, a.nodeId, root, 0));
    // Read the projection report from the EDIT, not from a later frame: a
    // render that projected nothing leaves no report behind it.
    expect(studio.store.lastReport?.nodesCreated).toBe(0);
    expect(studio.store.lastReport?.nodesDestroyed).toBe(0);
    studio.render();
    expect(studio.host.reconciler.mirror.get(a.nodeId)).toBe(handleBefore);
    studio.dispose();
  });

  it("reparenting keeps the node and its subtree", () => {
    const studio = session();
    const root = studio.document.root.id;
    const group = createNode(studio.document, "group", root, ids);
    studio.store.apply(group.transaction);
    const rect = createNode(studio.document, "rect", root, ids);
    studio.store.apply(rect.transaction);
    studio.render();

    studio.store.apply(moveNode(studio.document, rect.nodeId, group.nodeId, 0));
    expect(studio.store.lastReport?.nodesCreated).toBe(0);
    expect(studio.store.lastReport?.nodesDestroyed).toBe(0);
    studio.render();
    expect(studio.host.reconciler.mirror.get(rect.nodeId)?.parentId).toBe(group.nodeId);
    studio.dispose();
  });

  it("refuses to reparent a node into its own subtree", () => {
    // The engine would refuse too, but a drag that throws mid-gesture leaves
    // the editor holding a broken drag state.
    const studio = session();
    const outer = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(outer.transaction);
    const inner = createNode(studio.document, "group", outer.nodeId, ids);
    studio.store.apply(inner.transaction);

    expect(moveNode(studio.document, outer.nodeId, inner.nodeId, 0)).toBeNull();
    expect(moveNode(studio.document, outer.nodeId, outer.nodeId, 0)).toBeNull();
    studio.dispose();
  });

  it("duplicating remints every id, so nothing is aliased", () => {
    const studio = session();
    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    studio.store.apply(createNode(studio.document, "rect", group.nodeId, ids).transaction);

    const result = duplicateNodes(studio.document, [group.nodeId], ids)!;
    studio.store.apply(result.transaction);

    const original = findNode(studio.document.root, group.nodeId)!;
    const copy = findNode(studio.document.root, result.nodeIds[0]!)!;
    expect(copy.id).not.toBe(original.id);
    expect(childrenOf(copy)[0]!.id).not.toBe(childrenOf(original)[0]!.id);
    expect(copy.components?.[0]?.id).toBe(original.components?.[0]?.id);

    // And the document still validates — duplicated ids would break uniqueness.
    expect(validateDocument(studio.document).valid).toBe(true);
    studio.dispose();
  });

  it("deleting a parent and its child is one removal, not two", () => {
    // The second would target a node the first already took, and the engine
    // would correctly refuse it — which reads as an editor that errors on a
    // normal gesture.
    const studio = session();
    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    const child = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(child.transaction);

    const candidate = deleteNodes(studio.document, [group.nodeId, child.nodeId])!;
    expect(candidate.operations).toHaveLength(1);
    expect(studio.store.apply(candidate)).toBe(true);
    expect(findNode(studio.document.root, group.nodeId)).toBeNull();
    studio.dispose();
  });

  it("never deletes the root", () => {
    const studio = session();
    expect(deleteNodes(studio.document, [studio.document.root.id])).toBeNull();
    studio.dispose();
  });
});

// ===========================================================================
// Outline
// ===========================================================================

describe("hierarchy outline", () => {
  it("keeps the ancestors of a filtered match", () => {
    const studio = session();
    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    studio.store.apply(renameNode(studio.document, group.nodeId, "Holder"));
    const rect = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(rect.transaction);
    studio.store.apply(renameNode(studio.document, rect.nodeId, "Needle"));

    const rows = outline(studio.document, { expanded: new Set(), filter: "needle" });
    const shown = rows.map((row) => row.id);
    expect(shown).toContain(rect.nodeId);
    // A filtered tree that drops the parents of its matches is a list.
    expect(shown).toContain(group.nodeId);
    expect(shown).toContain(studio.document.root.id);
    studio.dispose();
  });

  it("costs one row for a collapsed subtree", () => {
    const studio = session();
    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    for (let index = 0; index < 20; index += 1) {
      studio.store.apply(createNode(studio.document, "rect", group.nodeId, ids).transaction);
    }
    expect(outline(studio.document, { expanded: new Set() })).toHaveLength(1);
    studio.dispose();
  });

  it("marks a node hidden by an ancestor without claiming it is itself hidden", () => {
    const studio = session();
    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    const rect = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(rect.transaction);
    studio.store.apply(setProp(studio.document, group.nodeId, "visible", false));

    const expanded = new Set([studio.document.root.id, group.nodeId]);
    const row = outline(studio.document, { expanded }).find((entry) => entry.id === rect.nodeId)!;
    expect(row.visible).toBe(true);
    expect(row.hiddenByAncestor).toBe(true);
    studio.dispose();
  });

  it("distinguishes reordering from reparenting by drop zone", () => {
    const studio = session();
    const a = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    const b = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(b.transaction);

    const rows = outline(studio.document, { expanded: new Set([studio.document.root.id]) });
    expect(dropTarget(studio.document, rows, a.nodeId, "inside")).toEqual({
      parentId: a.nodeId,
      index: 0,
    });
    expect(dropTarget(studio.document, rows, b.nodeId, "before")?.parentId).toBe(
      studio.document.root.id,
    );
    studio.dispose();
  });

  it("finds the path to a node, for reveal", () => {
    const studio = session();
    const group = createNode(studio.document, "group", studio.document.root.id, ids);
    studio.store.apply(group.transaction);
    const rect = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(rect.transaction);

    expect(pathTo(studio.document, rect.nodeId)).toEqual([studio.document.root.id, group.nodeId]);
    studio.dispose();
  });
});

// ===========================================================================
// Selection never mutates the engine
// ===========================================================================

describe("selection belongs to Studio", () => {
  it("changing it leaves the engine byte-identical", () => {
    // The whole argument for keeping selection out of the document, asserted:
    // if it were a node flag or a document field, clicking would dirty the file
    // and land on the undo stack.
    const studio = session();
    studio.store.apply(createNode(studio.document, "rect", studio.document.root.id, ids).transaction);
    studio.render();

    const hash = studio.host.sessionHash();
    const json = serializeDocument(studio.document);
    const depth = studio.store.depth;

    let selection = EMPTY_SELECTION;
    for (const id of [studio.document.root.id, "nope"]) {
      selection = toggle(selection, id);
      selection = selectOnly(id);
      selection = selectMany([id, id]);
    }

    expect(studio.host.sessionHash()).toBe(hash);
    expect(serializeDocument(studio.document)).toBe(json);
    expect(studio.store.depth).toBe(depth);
    // Dirtiness is unchanged too: selecting is not an edit, so it cannot make
    // a saved document unsaved or a dirty one clean.
    expect(studio.store.dirty).toBe(true);
    studio.dispose();
  });

  it("makes the last click primary, not the first", () => {
    // Shift-clicking a fourth node and dragging should drag relative to the one
    // just clicked — what every editor does, and what nobody notices until it
    // is wrong.
    expect(primaryOf(selectMany(["a", "b", "c"]))).toBe("c");
    expect(primaryOf(EMPTY_SELECTION)).toBeNull();
  });

  it("deduplicates, because a marquee can report a node twice", () => {
    expect(selectMany(["a", "b", "a"]).ids).toEqual(["a", "b"]);
  });

  it("selects a range over what is on screen, not over the tree", () => {
    const flat = ["a", "b", "c", "d"];
    expect(selectRange(flat, "a", "c").ids).toEqual(["a", "b", "c"]);
    // Upwards keeps the clicked node primary.
    expect(primaryOf(selectRange(flat, "d", "b"))).toBe("b");
    expect(selectRange(flat, null, "c").ids).toEqual(["c"]);
  });

  it("navigates by keyboard and clamps at the ends", () => {
    const flat = ["a", "b", "c"];
    expect(step(flat, selectOnly("a"), 1).ids).toEqual(["b"]);
    expect(step(flat, selectOnly("a"), -1).ids).toEqual(["a"]);
    expect(step(flat, EMPTY_SELECTION, 1).ids).toEqual(["a"]);
    expect(step([], EMPTY_SELECTION, 1).ids).toEqual([]);
  });

  it("drops ids the document no longer has", () => {
    // Without this, deleting a node leaves it selected, the inspector reads a
    // node that is gone, and the next drag builds an operation against nothing.
    const selection = selectMany(["a", "b"]);
    expect(prune(selection, (id) => id === "a").ids).toEqual(["a"]);
    expect(prune(selection, () => true)).toBe(selection);
  });
});

// ===========================================================================
// Inspector reflects runtime state
// ===========================================================================

describe("inspector reflects runtime state", () => {
  it("a property edit reaches the mirror on the next projection", () => {
    const studio = session();
    const created = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(created.transaction);
    studio.render();

    studio.store.apply(setProp(studio.document, created.nodeId, "transform.position", [2, -1, 0]));
    studio.render();

    const world = studio.worldMatrixOf(created.nodeId)!;
    expect(world[12]).toBeCloseTo(2, 6);
    expect(world[13]).toBeCloseTo(-1, 6);
    studio.dispose();
  });

  it("reads the MIRROR, so layout is included rather than the authored value", () => {
    // An editor that drew handles at the authored position would be unusable
    // for exactly the scenes composition was built for.
    const studio = session();
    const root = studio.document.root.id;
    const group = createNode(studio.document, "group", root, ids);
    studio.store.apply(group.transaction);
    studio.store.apply(
      setProp(studio.document, group.nodeId, "layout", { mode: "vertical", gap: 0.1, align: "stretch" }),
    );
    const a = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(a.transaction);
    const b = createNode(studio.document, "rect", group.nodeId, ids);
    studio.store.apply(b.transaction);
    studio.render();

    const worldA = studio.worldMatrixOf(a.nodeId)!;
    const worldB = studio.worldMatrixOf(b.nodeId)!;
    // Both were authored at y = 0; layout moved them apart.
    expect(worldA[13]).not.toBe(worldB[13]);
    studio.dispose();
  });

  it("a variable defined through an operation reaches the runtime", () => {
    // The gap Studio's variable editor found: `apply()` never re-seeded runtime
    // variables, so a newly defined variable was in the document and invisible
    // to the engine.
    const studio = session();
    studio.store.apply(
      transaction("Define", [
        {
          type: "variable.define",
          variable: { id: ids("variable"), key: "headline", type: "string", label: "Headline", default: "Hello" },
        },
      ]),
    );
    expect(studio.host.runtime.state.variables.get("headline")).toBe("Hello");

    // And undo removes it again.
    studio.store.undo();
    expect(studio.host.runtime.state.variables.get("headline")).toBeUndefined();
    studio.dispose();
  });

  it("changing a default does not clobber a live operator value", () => {
    // RFC-002 §4.3 keeps document state and runtime state separate, and this is
    // the seam where they meet.
    const studio = session();
    const variableId = ids("variable");
    studio.store.apply(
      transaction("Define", [
        {
          type: "variable.define",
          variable: { id: variableId, key: "score", type: "number", label: "Score", default: 0 },
        },
      ]),
    );
    // An operator sets it live — a command, not an operation.
    studio.host.applyLive({ type: "variable.set", key: "score", value: 42 }, "operator");
    studio.store.apply(
      transaction("Set default", [
        { type: "variable.setDefault", variableId, value: 7, previousValue: 0 },
      ]),
    );
    expect(studio.host.runtime.state.variables.get("score")).toBe(42);
    studio.dispose();
  });
});

// ===========================================================================
// Timeline edits affect playback
// ===========================================================================

describe("timeline edits affect playback", () => {
  function withTimeline(): { studio: StudioSession; nodeId: string } {
    const studio = session();
    const created = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(created.transaction);
    studio.store.apply(
      transaction("Add timeline", [
        makeSetDocProp(studio.document, "animations", [{
          id: "anm_test",
          name: "Slide",
          duration: 1,
          tracks: [
            {
              target: created.nodeId,
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -4, easing: "linear" },
                { time: 1, value: 0 },
              ],
            },
          ],
        }]),
      ]),
    );
    return { studio, nodeId: created.nodeId };
  }

  it("adding a timeline through an operation registers it with the animator", () => {
    // The second gap Studio found: `animations` is document data, and `apply()`
    // did not reload the subsystems that own document-level collections. The
    // edit landed in the file and never reached the playhead.
    const { studio } = withTimeline();
    expect(studio.host.animator.clips.map((clip) => clip.id)).toEqual(["anm_test"]);
    studio.dispose();
  });

  it("plays, and moving a keyframe changes what is sampled", () => {
    const { studio, nodeId } = withTimeline();
    studio.play();
    studio.playClip("anm_test");
    studio.seek(30);
    expect(studio.host.animator.values.get(nodeId)?.get("transform.position.0")).toBeCloseTo(-2, 5);

    // Drag the last keyframe to halfway. A `doc.setMeta` — undoable and saved.
    studio.store.apply(
      transaction("Move keyframe", [
        makeSetDocProp(studio.document, "animations.0.tracks.0.keyframes.1.time", 0.5),
      ]),
    );
    // Re-cue from zero: `animator.load` resets playback when a timeline
    // changes, and a clip re-played at the current frame is anchored there.
    studio.seek(0);
    studio.playClip("anm_test");
    studio.seek(30);
    // Half a second in, the clip is now finished rather than halfway.
    expect(studio.host.animator.values.get(nodeId)?.get("transform.position.0")).toBeCloseTo(0, 5);
    studio.dispose();
  });

  it("a timeline edit is undoable like any other", () => {
    const { studio } = withTimeline();
    const before = serializeDocument(studio.document);
    studio.store.apply(
      transaction("Move keyframe", [
        makeSetDocProp(studio.document, "animations.0.tracks.0.keyframes.1.time", 0.25),
      ]),
    );
    studio.store.undo();
    expect(serializeDocument(studio.document)).toBe(before);
    expect(studio.host.animator.clips[0]!.tracks[0]!.keyframes[1]!.time).toBe(1);
    studio.dispose();
  });

  it("refuses a document path that would reach into the tree", () => {
    // The node operations own the tree and its invariants — order keys,
    // parentage, id uniqueness. A path-set into `root` would bypass all three.
    const studio = session();
    expect(() =>
      studio.store.apply(
        transaction("Bad", [makeSetDocProp(studio.document, "root.name", "hacked")]),
      ),
    ).toThrow(/must not write "root"/);
    studio.dispose();
  });
});

// ===========================================================================
// Viewport
// ===========================================================================

describe("viewport", () => {
  it("never touches the scene camera", () => {
    // Zoom is a view transform over rendered pixels. Changing the camera would
    // change what the programme output shows.
    const studio = session();
    studio.render();
    const hash = studio.host.sessionHash();

    let viewport = DEFAULT_VIEWPORT;
    viewport = zoomAt(viewport, { x: 100, y: 100 }, 2);
    viewport = fit(studio.document, { width: 800, height: 600 });

    expect(studio.host.sessionHash()).toBe(hash);
    expect(viewport.zoom).toBeGreaterThan(0);
    studio.dispose();
  });

  it("zooms about a point, so the pixel under the cursor stays put", () => {
    const anchor = { x: 200, y: 120 };
    const zoomed = zoomAt(DEFAULT_VIEWPORT, anchor, 2);
    // The canvas point under the anchor is unchanged by the zoom.
    const before = { x: (anchor.x - 0) / 1, y: (anchor.y - 0) / 1 };
    const after = {
      x: (anchor.x - zoomed.panX) / zoomed.zoom,
      y: (anchor.y - zoomed.panY) / zoomed.zoom,
    };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps zoom rather than letting it reach zero or infinity", () => {
    expect(zoomAt(DEFAULT_VIEWPORT, { x: 0, y: 0 }, 0.0001).zoom).toBeGreaterThan(0);
    expect(zoomAt(DEFAULT_VIEWPORT, { x: 0, y: 0 }, 10000).zoom).toBeLessThanOrEqual(16);
  });

  it("round-trips world and canvas coordinates", () => {
    const studio = session();
    const point = { x: 3.25, y: -1.5 };
    const back = canvasToWorld(studio.document, worldToCanvas(studio.document, point));
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
    studio.dispose();
  });

  it("derives scale from the camera, not from a constant", () => {
    // A hardcoded px/unit works until someone authors a camera at a different
    // size, at which point every gizmo is silently wrong and the scene looks fine.
    const studio = session();
    const camera = childrenOf(studio.document.root).find(
      (node) => node.components?.[0]?.type === "camera",
    )!;
    const centred = worldToCanvas(studio.document, { x: 0, y: 0 });
    expect(centred.x).toBeCloseTo(960, 6);

    studio.store.apply(
      setProp(studio.document, camera.id, "components.0.props.orthographicSize", 10),
    );
    // Half the pixels per unit, so a point at x=1 is half as far from centre.
    const one = worldToCanvas(studio.document, { x: 1, y: 0 });
    expect(one.x - 960).toBeCloseTo(54, 4);
    studio.dispose();
  });

  it("picks the topmost node under a point", () => {
    const studio = session();
    const root = studio.document.root.id;
    const under = createNode(studio.document, "rect", root, ids);
    studio.store.apply(under.transaction);
    const over = createNode(studio.document, "rect", root, ids);
    studio.store.apply(over.transaction);
    studio.render();

    const bounds = nodeBounds(studio.document, (id) => studio.worldMatrixOf(id));
    // Picking the FIRST match would hand back the root group every time —
    // correct by containment and useless to a person.
    expect(pick(bounds, { x: 0, y: 0 })).toBe(over.nodeId);
    expect(pick(bounds, { x: 999, y: 999 })).toBeNull();
    studio.dispose();
  });

  it("boxes a TEXT layer where the words are, not half a box to the left", () => {
    // ======================================================================
    // TWO ANCHORS, AND THE EDITOR USED TO KNOW ABOUT ONLY ONE
    // ======================================================================
    // A rect is a quad centred on its origin; a text block hangs from the
    // box's top-left corner (pinned in `text.test.ts` against the shaper's own
    // geometry). `nodeBounds` assumed centred for everything, so selecting a
    // name drew its handles — and its hit area, its snap edges and its
    // alignment guides — half a box-width to the left of the text.
    //
    // Every unit test passed throughout, because both halves were internally
    // consistent. It took looking at the screen.
    const studio = session();
    const created = createNode(studio.document, "text", studio.document.root.id, ids);
    studio.store.apply(created.transaction);
    studio.store.apply(
      setProp(studio.document, created.nodeId, "transform.position", [2, 1, 0]),
    );
    studio.render();

    const node = findNode(studio.document.root, created.nodeId)!;
    const width = node.size!.width;
    const height = node.size!.height;
    const box = nodeBounds(studio.document, (id) => studio.worldMatrixOf(id)).find(
      (entry) => entry.nodeId === created.nodeId,
    )!;

    // The box hangs right and down from the origin, so its centre is offset by
    // half its extent in each direction.
    expect(box.rect.x).toBeCloseTo(2 + width / 2, 6);
    expect(box.rect.y).toBeCloseTo(1 - height / 2, 6);

    // And the consequence that matters: a click ON the words hits the layer,
    // and a click where the old box was does not.
    const all = nodeBounds(studio.document, (id) => studio.worldMatrixOf(id));
    expect(pick(all, { x: 2 + width / 4, y: 1 - height / 4 })).toBe(created.nodeId);
    expect(pick(all, { x: 2 - width / 2, y: 1 })).not.toBe(created.nodeId);
    studio.dispose();
  });

  it("marquee-selects everything a rect touches", () => {
    const studio = session();
    const a = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    studio.store.apply(setProp(studio.document, a.nodeId, "transform.position", [-3, 0, 0]));
    const b = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(b.transaction);
    studio.store.apply(setProp(studio.document, b.nodeId, "transform.position", [3, 0, 0]));
    studio.render();

    const bounds = nodeBounds(studio.document, (id) => studio.worldMatrixOf(id));
    const area = rectFromCorners({ x: -6, y: -2 }, { x: 6, y: 2 });
    const hits = marquee(bounds, area);
    expect(hits).toContain(a.nodeId);
    expect(hits).toContain(b.nodeId);
    studio.dispose();
  });

  it("snaps to a candidate before a grid line", () => {
    // A designer aligning two boxes means the boxes.
    const result = snap(1.03, [1.0], { gridStep: 0.5, toGrid: true, thresholdWorld: 0.1 });
    expect(result.value).toBe(1.0);
    expect(result.guide).toBe(1.0);

    const gridded = snap(1.2, [], { gridStep: 0.5, toGrid: true, thresholdWorld: 0.1 });
    expect(gridded.value).toBeCloseTo(1.0, 6);
    expect(gridded.guide).toBeNull();

    const free = snap(1.2, [], { gridStep: 0.5, toGrid: false, thresholdWorld: 0.1 });
    expect(free.value).toBe(1.2);
  });

  it("excludes the dragged nodes from their own snap candidates", () => {
    const studio = session();
    const a = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    studio.render();

    const bounds = nodeBounds(studio.document, (id) => studio.worldMatrixOf(id));
    const candidates = snapCandidates(bounds, new Set([a.nodeId, studio.document.root.id]));
    expect(candidates.x).toEqual([]);
    studio.dispose();
  });

  it("maps a screen point through pan and zoom to the right world point", () => {
    const studio = session();
    const viewport = { zoom: 0.5, panX: 40, panY: 20 };
    const world = screenToWorld(studio.document, viewport, { x: 40 + 960 * 0.5, y: 20 + 540 * 0.5 });
    expect(world.x).toBeCloseTo(0, 6);
    expect(world.y).toBeCloseTo(0, 6);
    studio.dispose();
  });
});

// ===========================================================================
// Commands, keys, workspace
// ===========================================================================

describe("commands and keys", () => {
  it("has no duplicate chords except the one that is declared and resolved", () => {
    // A duplicate chord is normally a bug: one of the two shortcuts silently
    // never fires, and it is documented in the keyboard sheet the whole time.
    //
    // Escape is the one legitimate exception — it means "back out of where I
    // am", and being armed to transmit outranks having a layer selected — so
    // the exception is DECLARED with `contested` and this test holds it to the
    // terms that make it safe rather than just permitting it.
    const chordOf = (binding: (typeof KEYMAP)[number]) =>
      `${binding.mod ? "mod+" : ""}${binding.shift ? "shift+" : ""}${binding.alt ? "alt+" : ""}${binding.key}`;

    const uncontested = KEYMAP.filter((binding) => binding.contested !== true);
    const chords = uncontested.map(chordOf);
    expect(new Set(chords).size, "two shortcuts on one key, and neither declared it").toBe(
      chords.length,
    );

    for (const binding of KEYMAP.filter((entry) => entry.contested === true)) {
      const chord = chordOf(binding);
      // It must sit ABOVE its fallback, or `matchBinding` reaches the fallback
      // first and the contested binding is unreachable — the exact failure
      // `contested` exists to prevent.
      const index = KEYMAP.indexOf(binding);
      const fallback = KEYMAP.findIndex(
        (entry) => entry.contested !== true && chordOf(entry) === chord,
      );
      expect(fallback, `${binding.id} contests a chord nothing else claims`).toBeGreaterThan(-1);
      expect(index, `${binding.id} sits below its own fallback and can never fire`).toBeLessThan(
        fallback,
      );
    }
  });

  it("gives a contested key back to its fallback when the contender is unavailable", () => {
    // The behaviour, not the declaration: Escape un-cues while armed and
    // deselects otherwise, and it must never do nothing.
    const escape = { key: "Escape", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(matchBinding(escape, false, (id) => id !== "air.uncue")?.id).toBe("select.none");
    expect(matchBinding(escape, false, () => true)?.id).toBe("air.uncue");
    // And with no callback at all, the first claimant wins — which is why the
    // ordering assertion above matters.
    expect(matchBinding(escape, false)?.id).toBe("air.uncue");
  });

  it("labels and describes every binding, so the generated sheet cannot be blank", () => {
    for (const binding of KEYMAP) {
      expect(binding.label.length, binding.id).toBeGreaterThan(0);
      expect(binding.description.length, binding.id).toBeGreaterThan(0);
      expect(shortcutFor(binding.id)).toBe(binding.label);
    }
  });

  it("does not steal keys while a text field has focus", () => {
    // An editor where typing "f" in a name field re-frames the viewport is an
    // editor people stop typing in.
    const event = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
      key,
      ctrlKey: mods.ctrl ?? false,
      metaKey: false,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
    });
    expect(matchBinding(event("f"), true)).toBeNull();
    expect(matchBinding(event("delete"), true)).toBeNull();
    expect(matchBinding(event("k", { ctrl: true }), true)?.id).toBe("palette.open");
    expect(matchBinding(event("escape"), true)?.id).toBe("select.none");
  });

  it("matches shifted chords by the key that was pressed, not the one it prints", () => {
    // THE BUG THIS FIXES. `KeyboardEvent.key` is what the LAYOUT produced:
    // Shift+1 is "!", Shift+` is "~". Every shifted binding declared by its
    // unshifted character therefore never fired — the preset stores and walk
    // mode among them — and nothing errored, the keys were simply dead.
    const pressed = (
      code: string,
      key: string,
      mods: Partial<{ shift: boolean; alt: boolean }> = {},
    ) => ({
      key,
      code,
      ctrlKey: false,
      metaKey: false,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
    });

    // ⌥⇧1 — the character is "!", and the binding says "1".
    expect(matchBinding(pressed("Digit1", "!", { shift: true, alt: true }), false)?.id).toBe(
      "view.store1",
    );
    expect(matchBinding(pressed("Digit1", "1", { alt: true }), false)?.id).toBe("view.recall1");
    // ⇧` — the character is "~".
    expect(matchBinding(pressed("Backquote", "~", { shift: true }), false)?.id).toBe("view.walk");

    // The modifiers still decide between twins on the same physical key: a
    // code is a stricter key test, not a looser chord test.
    expect(matchBinding(pressed("Digit1", "1"), false)?.id).not.toBe("view.recall1");

    // An event with no code at all — a synthetic one — still matches on the
    // unshifted character, so nothing that worked before stopped.
    const noCode = { key: "1", ctrlKey: false, metaKey: false, shiftKey: false, altKey: true };
    expect(matchBinding(noCode, false)?.id).toBe("view.recall1");
  });

  it("declares a code for every shifted binding whose character changes", () => {
    // Stated as a rule rather than left to whoever adds the next one. A
    // shifted digit or punctuation binding without a code is dead on arrival.
    const CHANGES_UNDER_SHIFT = /^[0-9`\-=[\];',./\\]$/;
    for (const binding of KEYMAP) {
      if (binding.shift !== true) continue;
      if (!CHANGES_UNDER_SHIFT.test(binding.key)) continue;
      expect(binding.code, `${binding.id} would never fire`).toBeDefined();
    }
  });

  it("distinguishes shifted and modified twins", () => {
    const event = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean }> = {}) => ({
      key,
      ctrlKey: mods.ctrl ?? false,
      metaKey: false,
      shiftKey: mods.shift ?? false,
      altKey: false,
    });
    expect(matchBinding(event("z", { ctrl: true }), false)?.id).toBe("edit.undo");
    expect(matchBinding(event("z", { ctrl: true, shift: true }), false)?.id).toBe("edit.redo");
    expect(matchBinding(event("s", { ctrl: true }), false)?.id).toBe("file.save");
    expect(matchBinding(event("s", { ctrl: true, shift: true }), false)?.id).toBe("file.saveAs");
  });

  it("ranks by subsequence, not by substring", () => {
    const commands = [
      { id: "a", title: "Toggle safe areas", section: "View" as const, run: () => {} },
      { id: "b", title: "Save as file…", section: "File" as const, run: () => {} },
    ];
    // `includes()` would return "Toggle safe areas" first, which is why people
    // stop using search boxes.
    expect(searchCommands(commands, "save as")[0]!.id).toBe("b");
    expect(searchCommands(commands, "")).toHaveLength(2);
    expect(searchCommands(commands, "zzz")).toHaveLength(0);
  });
});

describe("workspace", () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      map,
    };
  }

  it("round-trips", () => {
    const store = memory();
    saveWorkspace({ ...DEFAULT_WORKSPACE, theme: "light", leftWidth: 320 }, store);
    const loaded = loadWorkspace(store);
    expect(loaded.theme).toBe("light");
    expect(loaded.leftWidth).toBe(320);
  });

  it("clamps a hostile size rather than rendering a panel nobody can grab", () => {
    const store = memory();
    store.map.set(WORKSPACE_KEY, JSON.stringify({ leftWidth: 99999 }));
    expect(loadWorkspace(store).leftWidth).toBe(600);
  });

  it("falls back to defaults on corruption and with no storage at all", () => {
    const store = memory();
    store.map.set(WORKSPACE_KEY, "not json");
    expect(loadWorkspace(store)).toEqual(DEFAULT_WORKSPACE);
    expect(loadWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
  });
});

// ===========================================================================
// Multi-node editing
// ===========================================================================

describe("multi-node editing", () => {
  it("nudging a selection is one transaction", () => {
    const studio = session();
    const a = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    const b = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(b.transaction);
    const depth = studio.store.depth;

    const candidate = setPropOnMany(
      studio.document,
      [a.nodeId, b.nodeId],
      "transform.position",
      () => [1, 1, 0],
      "Nudge",
    )!;
    expect(candidate.operations).toHaveLength(2);
    studio.store.apply(candidate);
    expect(studio.store.depth).toBe(depth + 1);

    studio.store.undo();
    expect(findNode(studio.document.root, a.nodeId)!.transform!.position).toEqual([0, 0, 0]);
    studio.dispose();
  });

  it("skips a node that vanished between selection and edit", () => {
    const studio = session();
    const a = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    const candidate = setPropOnMany(
      studio.document,
      [a.nodeId, "nod_gone"],
      "transform.position",
      () => [1, 0, 0],
      "Nudge",
    )!;
    expect(candidate.operations).toHaveLength(1);
    studio.dispose();
  });
});
