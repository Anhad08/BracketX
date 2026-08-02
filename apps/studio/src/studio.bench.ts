import { bench, describe } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { findNode, type SceneDocument } from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { testIdFactory, type IdFactory } from "./studio/ids";
import { createNode, moveNode, setProp, setPropOnMany } from "./studio/editing";
import { newDocument, parseDocument, serializeDocument } from "./studio/project";
import { outline } from "./studio/outline";
import {
  DEFAULT_VIEWPORT,
  marquee,
  nodeBounds,
  pick,
  rectFromCorners,
  snapCandidates,
  zoomAt,
} from "./studio/viewport";
import { EMPTY_SELECTION, selectMany, toggle } from "./studio/selection";

/**
 * Studio Phase 1 overhead.
 *
 * ============================================================================
 * WHAT AN EDITOR HAS TO BE FAST AT
 * ============================================================================
 * Not frames — the engine already owns those and the workbench already measures
 * them. An editor is judged on the gestures a designer repeats hundreds of times
 * an hour, and each one has a different tolerance:
 *
 *   property edit   every keystroke commit. Must be imperceptible.
 *   undo / redo     must feel instant or people stop trusting it.
 *   selection       every click and every marquee frame.
 *   picking         every mouse move while a marquee is open.
 *   save            once in a while; a few milliseconds is fine.
 *   load            once per file; tens of milliseconds is fine.
 *
 * Numbers are published in STUDIO_VERIFICATION.md. Anything here that is not
 * clearly inside its tolerance is called out rather than averaged away.
 *
 * Run: pnpm --filter studio bench
 */

function build(nodes: number): { session: StudioSession; ids: IdFactory; leaf: string } {
  const ids = testIdFactory();
  const session = new StudioSession(new MockMirrorBackend(), newDocument("Bench", ids));
  const root = session.document.root.id;

  let leaf = root;
  // A realistic shape: groups of ten, not one flat list. Hierarchy depth is
  // what makes `parentOf` and the outline walk cost anything.
  for (let index = 0; index < nodes; index += 1) {
    if (index % 10 === 0) {
      const group = createNode(session.document, "group", root, ids);
      session.store.apply(group.transaction);
      leaf = group.nodeId;
    }
    const rect = createNode(session.document, "rect", leaf, ids);
    session.store.apply(rect.transaction);
    if (index === nodes - 1) leaf = rect.nodeId;
  }
  session.render();
  return { session, ids, leaf };
}

const small = build(50);
const large = build(1000);

const smallJson = serializeDocument(small.session.document);
const largeJson = serializeDocument(large.session.document);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

describe("scene load", () => {
  for (const [label, json] of [
    ["50 nodes", smallJson],
    ["1,000 nodes", largeJson],
  ] as const) {
    bench(`parse and validate, ${label}`, () => {
      parseDocument(json);
    });
    bench(`open into the engine, ${label}`, () => {
      const session = new StudioSession(
        new MockMirrorBackend(),
        JSON.parse(json) as SceneDocument,
      );
      session.render();
      session.dispose();
    });
  }
});

describe("save", () => {
  bench("serialize 50 nodes", () => {
    serializeDocument(small.session.document);
  });
  bench("serialize 1,000 nodes", () => {
    serializeDocument(large.session.document);
  });
});

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

describe("property edits", () => {
  let flip = 0;
  bench("set one property, 50 nodes", () => {
    flip = 1 - flip;
    small.session.store.apply(
      setProp(small.session.document, small.leaf, "transform.position", [flip, 0, 0]),
    );
  });
  bench("set one property, 1,000 nodes", () => {
    flip = 1 - flip;
    large.session.store.apply(
      setProp(large.session.document, large.leaf, "transform.position", [flip, 0, 0]),
    );
  });

  const many = outline(large.session.document, {
    expanded: new Set(allIds(large.session.document)),
  })
    .slice(1, 21)
    .map((row) => row.id);
  bench("nudge 20 nodes in one transaction", () => {
    flip = 1 - flip;
    large.session.store.apply(
      setPropOnMany(
        large.session.document,
        many,
        "transform.position",
        () => [flip, 0, 0],
        "Nudge",
      ),
    );
  });
});

describe("hierarchy edits", () => {
  const session = large.session;
  const root = session.document.root.id;
  const ids = large.ids;
  const everything = new Set(allIds(session.document));
  const firstChild = session.document.root.children![0]!.id;

  // Create AND undo in one iteration. A create-only benchmark grows the
  // document by one node per iteration, so by the thousandth sample it is
  // measuring a different scene from the first — the number would describe the
  // benchmark rather than the editor.
  bench("create a node, then undo it", () => {
    session.store.apply(createNode(session.document, "rect", root, ids).transaction);
    session.store.undo();
  });

  let flip = false;
  bench("reorder a node", () => {
    flip = !flip;
    session.store.apply(moveNode(session.document, firstChild, root, flip ? 1 : 0));
  });

  bench("build the outline, collapsed", () => {
    outline(session.document, { expanded: new Set() });
  });
  bench("build the outline, fully expanded", () => {
    outline(session.document, { expanded: everything });
  });
  bench("filter the outline", () => {
    outline(session.document, { expanded: new Set(), filter: "rect" });
  });
});

describe("undo and redo", () => {
  // A deep stack, then walked back and forth. Undo cost must not depend on how
  // much history is behind it — a stack that got slower as it grew would make
  // an editor feel worse the longer it was used.
  const ids = testIdFactory();
  const session = new StudioSession(new MockMirrorBackend(), newDocument("Undo", ids));
  for (let index = 0; index < 150; index += 1) {
    session.store.apply(
      createNode(session.document, "rect", session.document.root.id, ids).transaction,
    );
  }

  bench("undo then redo one step", () => {
    session.store.undo();
    session.store.redo();
  });
});

// ---------------------------------------------------------------------------
// Selection, picking, viewport
// ---------------------------------------------------------------------------

describe("selection", () => {
  const ids = allIds(large.session.document);
  bench("select one", () => {
    selectMany([ids[10]!]);
  });
  bench("toggle within a 100-node selection", () => {
    toggle(selectMany(ids.slice(0, 100)), ids[50]!);
  });
  bench("select all, 1,000 nodes", () => {
    selectMany(ids);
  });
  bench("clear", () => {
    void EMPTY_SELECTION;
  });
});

describe("picking and snapping", () => {
  const boundsSmall = nodeBounds(small.session.document, (id) =>
    small.session.worldMatrixOf(id),
  );
  const boundsLarge = nodeBounds(large.session.document, (id) =>
    large.session.worldMatrixOf(id),
  );

  bench("compute bounds, 50 nodes", () => {
    nodeBounds(small.session.document, (id) => small.session.worldMatrixOf(id));
  });
  bench("compute bounds, 1,000 nodes", () => {
    nodeBounds(large.session.document, (id) => large.session.worldMatrixOf(id));
  });
  bench("pick, 50 nodes", () => {
    pick(boundsSmall, { x: 0, y: 0 });
  });
  bench("pick, 1,000 nodes", () => {
    pick(boundsLarge, { x: 0, y: 0 });
  });
  bench("marquee, 1,000 nodes", () => {
    marquee(boundsLarge, rectFromCorners({ x: -9, y: -5 }, { x: 9, y: 5 }));
  });
  bench("snap candidates, 1,000 nodes", () => {
    snapCandidates(boundsLarge, new Set());
  });
});

describe("viewport redraw", () => {
  // What a pan or zoom actually costs Studio: the transform maths and the
  // chrome inputs. The canvas itself is not redrawn — the engine only renders
  // when something changed, which is the point of the pending-render flag.
  let viewport = DEFAULT_VIEWPORT;
  bench("zoom step", () => {
    viewport = zoomAt(viewport, { x: 400, y: 300 }, viewport.zoom > 4 ? 0.5 : 1.1);
  });

  bench("engine frame, 1,000 nodes (for comparison)", () => {
    large.session.render();
  });
});

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

void findNode;
