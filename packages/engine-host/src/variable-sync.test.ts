import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  invertTransaction,
  type SceneDocument,
  type Transaction,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";

/**
 * DOCUMENT → RUNTIME SYNCHRONISATION, THROUGH UNDO AND REDO.
 *
 * ============================================================================
 * THE TWO THINGS THAT HOLD A VARIABLE
 * ============================================================================
 * A variable's DEFAULT lives in the document and is edited by a transaction.
 * Its VALUE lives in the runtime and is set live, off-document, by an operator.
 * `#syncVariableDefinitions` is the one place they meet: editing a default
 * should move the runtime too, UNLESS an operator has already overridden it —
 * a live value nobody asked to change must survive an author's edit.
 *
 * That guard is the subtle part, and it has to stay true in BOTH directions.
 * Undo is not a special mechanism here: it is an ordinary transaction whose
 * operations happen to be inverses. If the sync only understands the forward
 * direction, undo restores the document and the rendered picture keeps showing
 * the old edit — the document and the screen disagree, which is the one thing
 * a projection architecture exists to prevent.
 *
 * Nothing here mentions text. The defect was found through the Text
 * capability, but a variable is a variable.
 */

function scene(): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_sync",
    meta: {
      name: "Sync",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [
      { id: "var_label", key: "label", type: "string", label: "Label", default: "FIRST" },
      { id: "var_other", key: "other", type: "string", label: "Other", default: "UNTOUCHED" },
    ],
    assets: [],
    states: [],
    animations: [],
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [
        {
          id: "nod_cam",
          name: "Camera",
          order: "1",
          transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
          components: [
            {
              id: "cmp_cam",
              type: "camera",
              props: {
                projection: "orthographic",
                orthographicSize: 5,
                near: 0.1,
                far: 100,
              },
            },
          ],
        },
        {
          id: "nod_plate",
          name: "Plate",
          order: "V",
          transform: IDENTITY_TRANSFORM,
          size: { width: 6, height: 1 },
          components: [
            {
              id: "cmp_plate",
              type: "rect",
              props: { width: 6, height: 1, fill: { $var: "label" } },
            },
          ],
        },
      ],
    },
  };
}

let host: SceneHost;
let backend: MockMirrorBackend;

beforeEach(() => {
  backend = new MockMirrorBackend();
  host = new SceneHost(backend);
  host.load(scene());
});

/** Edits a variable's default, the way an authoring surface does. */
function setDefault(variableId: string, value: unknown, previousValue: unknown): Transaction {
  return {
    id: `txn_${String(value)}`,
    operations: [{ type: "variable.setDefault", variableId, value, previousValue }],
  };
}

/** What the runtime is actually holding — the value the picture is drawn from. */
function runtimeValue(key: string): unknown {
  return host.runtime.state.variables.get(key);
}

describe("a default edit reaches the runtime, and comes back", () => {
  it("carries the runtime through edit, undo and redo", () => {
    expect(runtimeValue("label")).toBe("FIRST");

    const edit = setDefault("var_label", "SECOND", "FIRST");
    host.apply(edit);
    expect(runtimeValue("label"), "the edit never reached the runtime").toBe("SECOND");

    // UNDO. An ordinary transaction of inverse operations — no second
    // mechanism, which is exactly why the sync has to understand it.
    host.apply(invertTransaction(edit));
    expect(
      runtimeValue("label"),
      "undo restored the document and left the picture showing the edit",
    ).toBe("FIRST");

    // REDO. The forward transaction again, against a runtime that now holds
    // the restored value.
    host.apply(edit);
    expect(runtimeValue("label"), "redo did not reach the runtime").toBe("SECOND");

    // And once more round, because a sync that works exactly once is a sync
    // that is comparing against something it mutated.
    host.apply(invertTransaction(edit));
    expect(runtimeValue("label")).toBe("FIRST");
  });

  it("leaves variables the transaction never mentioned alone", () => {
    host.apply(setDefault("var_label", "SECOND", "FIRST"));
    expect(runtimeValue("other")).toBe("UNTOUCHED");
  });
});

describe("a live override still outranks an author's edit", () => {
  it("refuses to overwrite a value an operator set", () => {
    // The reason the guard exists. Somebody in the gallery has put a value on
    // air; a designer editing the default in another window must not yank it.
    host.setVariable("label", "ON AIR");
    expect(runtimeValue("label")).toBe("ON AIR");

    host.apply(setDefault("var_label", "SECOND", "FIRST"));
    expect(runtimeValue("label"), "an author's edit stole a live value").toBe("ON AIR");
  });

  it("refuses to overwrite a live override on undo too", () => {
    // The direction that regressed. Making undo work must not make undo a hole
    // in the same protection: an operator's live value survives BOTH.
    const edit = setDefault("var_label", "SECOND", "FIRST");
    host.apply(edit);
    host.setVariable("label", "ON AIR");

    host.apply(invertTransaction(edit));
    expect(runtimeValue("label"), "undo stole a live value").toBe("ON AIR");
  });

  it("does not leave a previous graphic's variables resolving after a load", () => {
    // THE LEAK. Opening one graphic, then another, kept every key the second
    // graphic does not itself declare — so it rendered with the first
    // graphic's colour or name, through bindings with no field on screen to
    // notice were wrong. Setting the incoming defaults hid it whenever the two
    // documents happened to declare the same keys, which two lower thirds do.
    expect(runtimeValue("label")).toBe("FIRST");
    expect(runtimeValue("other")).toBe("UNTOUCHED");

    const second = scene() as {
      id: string;
      variables: { id: string; key: string; type: string; label: string; default: unknown }[];
    };
    second.id = "scn_other";
    // Declares ONE of the two keys. The other belonged to the graphic being
    // closed and has no business surviving it.
    second.variables = [
      { id: "var_label", key: "label", type: "string", label: "Label", default: "SECOND DOC" },
    ];
    host.load(second as unknown as SceneDocument);

    expect(runtimeValue("label"), "the new default did not load").toBe("SECOND DOC");
    expect(
      runtimeValue("other"),
      "a variable from the previous graphic survived the load",
    ).toBeUndefined();
  });

  it("clears a live override when the graphic it belonged to closes", () => {
    // An operator value is scoped to the show that is on air. Carrying it into
    // the next graphic would put one graphic's live state onto another.
    host.setVariable("label", "ON AIR");
    expect(runtimeValue("label")).toBe("ON AIR");

    host.load(scene());
    expect(runtimeValue("label"), "a live override outlived its graphic").toBe("FIRST");
  });

  it("does not treat a value equal to the old default as an override", () => {
    // Setting a variable to exactly what it already was is not overriding it.
    host.setVariable("label", "FIRST");
    host.apply(setDefault("var_label", "SECOND", "FIRST"));
    expect(runtimeValue("label")).toBe("SECOND");
  });
});
