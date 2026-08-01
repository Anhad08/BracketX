import { registerScene } from "../registry";
import { Action, Choice, Group, Slider, Swatches, Toggle, TextField, read } from "../ui/controls";
import { box, rows, sceneDocument, variable } from "./kit";

/**
 * Engine capability scenes.
 *
 * Each proves ONE thing, as directly as possible. A scene that demonstrates
 * three capabilities at once cannot fail informatively — when it looks wrong,
 * nobody knows which subsystem to open.
 */

const PALETTE = ["#E8B23A", "#27AE60", "#C0392B", "#2980B9", "#8E44AD"];

// ---------------------------------------------------------------------------
// 01 · Primitive Rendering
// ---------------------------------------------------------------------------

registerScene({
  id: "primitive-rendering",
  title: "Primitive Rendering",
  group: "Engine",
  order: 10,
  capability: "Render Backend · rect, camera, alpha",
  summary:
    "Rectangles at known positions and colours, over a transparent background.",

  build: () =>
    sceneDocument({
      id: "scn_primitives",
      name: "Primitives",
      variables: [
        variable("tint", "color", "#E8B23A"),
        variable("visible", "boolean", true),
      ],
      children: [
        // Corners prove the coordinate convention: Y-up, origin centred. If any
        // of these appears on the wrong side, the convention is broken and every
        // other scene is quietly wrong too.
        box("nod_tl", 1.4, 1.4, { at: [-6, 3, 0], fill: { $var: "color.info" } }),
        box("nod_tr", 1.4, 1.4, { at: [6, 3, 0], fill: { $var: "color.success" } }),
        box("nod_bl", 1.4, 1.4, { at: [-6, -3, 0], fill: { $var: "color.danger" } }),
        box("nod_br", 1.4, 1.4, { at: [6, -3, 0], fill: { $var: "color.accent" } }),
        // Centre pair proves depth sorting: the smaller one is nearer.
        box("nod_back", 5, 3, { at: [0, 0, 0], fill: { $var: "color.primary" } }),
        box("nod_front", 3, 1.6, {
          at: [0, 0, 0.01],
          fill: { $var: "tint" },
          extra: { visible: true },
        }),
        // Half-alpha, to show the background really is transparent behind it.
        box("nod_alpha", 4, 0.6, { at: [0, -2.2, 0.02], fill: "#FFFFFF80" }),
      ],
    }),

  controls: ({ send, variables }) => (
    <>
      <Group label="tint">
        <Swatches
          colors={PALETTE}
          value={read(variables, "tint", "#E8B23A")}
          onChange={(tint) => send({ type: "variable.set", key: "tint", value: tint })}
        />
      </Group>
      <Group label="front rect">
        <Toggle
          label="visible"
          checked={read(variables, "visible", true)}
          onChange={(visible) =>
            send({ type: "variable.set", key: "visible", value: visible })
          }
        />
      </Group>
    </>
  ),
});

// ---------------------------------------------------------------------------
// 02 · Variables
// ---------------------------------------------------------------------------

registerScene({
  id: "variables",
  title: "Variables",
  group: "Engine",
  order: 20,
  capability: "Values · bindings, minimal invalidation",
  summary:
    "Number, colour, and boolean bound to a graphic. Watch dirty-node count.",

  build: () =>
    sceneDocument({
      id: "scn_variables",
      name: "Variables",
      variables: [
        variable("barWidth", "number", 6),
        variable("barColor", "color", "#2980B9"),
        variable("label", "string", "BOUND"),
      ],
      children: [
        box("nod_track", 12, 1.2, { at: [0, 1, 0], fill: { $var: "color.surface" } }),
        // Width is authored, not bound: rect dimensions are geometry, and the
        // scene changes it by editing the document rather than pretending a
        // runtime value can resize a mesh.
        box("nod_bar", 6, 1, { at: [0, 1, 0.01], fill: { $var: "barColor" } }),
        box("nod_swatch", 2, 2, { at: [0, -2, 0], fill: { $var: "barColor" } }),
      ],
    }),

  controls: ({ send, edit, variables, frame }) => {
    const width = read(variables, "barWidth", 6);
    return (
      <>
        <Group label="colour · runtime command">
          <Swatches
            colors={PALETTE}
            value={read(variables, "barColor", "#2980B9")}
            onChange={(value) =>
              send({ type: "variable.set", key: "barColor", value })
            }
          />
        </Group>
        <Group label="width · document edit">
          <Slider
            min={1}
            max={12}
            step={0.5}
            value={width}
            format={(v) => `${v.toFixed(1)}u`}
            onChange={(next) => {
              send({ type: "variable.set", key: "barWidth", value: next });
              // Geometry lives in the document, so resizing is an operation —
              // undoable and persisted. Recolouring is a command and neither.
              edit({
                id: `txn_width_${frame}`,
                label: "resize bar",
                actorId: "usr_showcase",
                operations: [
                  {
                    type: "node.setProp",
                    nodeId: "nod_bar",
                    path: "components.0.props.width",
                    value: next,
                    previousValue: width,
                  },
                  {
                    type: "node.setProp",
                    nodeId: "nod_bar",
                    path: "size.width",
                    value: next,
                    previousValue: width,
                  },
                ],
              });
            }}
          />
        </Group>
        <Group label="text">
          <TextField
            value={read(variables, "label", "BOUND")}
            onChange={(value) => send({ type: "variable.set", key: "label", value })}
          />
        </Group>
      </>
    );
  },
});

// ---------------------------------------------------------------------------
// 03 · Collections
// ---------------------------------------------------------------------------

const COLLECTION_ROWS = rows(5);

registerScene({
  id: "collections",
  title: "Collections",
  group: "Engine",
  order: 30,
  capability: "Composition · repeat, keyed identity",
  summary:
    "Add, remove, reorder, shuffle. Created/destroyed counts prove identity survives.",

  build: () =>
    sceneDocument({
      id: "scn_collections",
      name: "Collections",
      variables: [variable("items", "string", COLLECTION_ROWS)],
      children: [
        {
          id: "nod_list",
          name: "List",
          order: "V",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 10, height: 8 },
          layout: { mode: "vertical", gap: 0.15, align: "stretch" },
          repeat: { source: "items", as: "item", key: "id", limit: 40 },
          children: [box("nod_row", 10, 1, { fill: { $var: "item.color" } })],
        },
      ],
    }),

  controls: ({ send, variables }) => {
    const items = read<{ id: string; color: string }[]>(variables, "items", []);
    const nextId = `n${items.length + 1}-${Date.now() % 1000}`;

    return (
      <>
        <Group label="size">
          <Action
            label="Add"
            tone="primary"
            onClick={() =>
              send({
                type: "collection.insert",
                key: "items",
                at: "end",
                items: [
                  { id: nextId, name: nextId, score: 0, color: PALETTE[items.length % PALETTE.length]! },
                ],
              })
            }
          />
          <Action
            label="Remove last"
            tone="danger"
            disabled={items.length === 0}
            onClick={() =>
              send({
                type: "collection.remove",
                key: "items",
                ids: [items[items.length - 1]!.id],
                keyField: "id",
              })
            }
          />
        </Group>
        <Group label="order · identity must survive">
          <Action
            label="Reverse"
            onClick={() =>
              send({
                type: "collection.reorder",
                key: "items",
                ids: [...items].reverse().map((item) => item.id),
                keyField: "id",
              })
            }
          />
          <Action
            label="Move last to top"
            disabled={items.length < 2}
            onClick={() =>
              send({
                type: "collection.reorder",
                key: "items",
                ids: [items[items.length - 1]!.id],
                keyField: "id",
              })
            }
          />
        </Group>
        <Group label="values">
          <Action
            label="Recolour first"
            disabled={items.length === 0}
            onClick={() =>
              send({
                type: "collection.patch",
                key: "items",
                id: items[0]!.id,
                keyField: "id",
                patch: { color: PALETTE[Math.floor(Math.random() * PALETTE.length)]! },
              })
            }
          />
          <Action
            label="Replace all"
            onClick={() =>
              send({ type: "collection.replace", key: "items", items: rows(5) })
            }
          />
        </Group>
      </>
    );
  },
});

// ---------------------------------------------------------------------------
// 04 · Templates
// ---------------------------------------------------------------------------

registerScene({
  id: "templates",
  title: "Templates",
  group: "Engine",
  order: 40,
  capability: "Composition · typed parameters become variables",
  summary:
    "A template instantiated with parameters. Changing one is a variable change.",

  build: () =>
    sceneDocument({
      id: "scn_templates",
      name: "Templates",
      // Parameters become variables at instantiation, which is why a template
      // needs nothing of its own to reach its content — bindings already work.
      variables: [
        variable("badgeColor", "color", "#E8B23A"),
        variable("plateColor", "color", "#0B1F3A"),
        variable("stripeCount", "number", 3),
      ],
      children: [
        box("nod_plate", 9, 3, { at: [0, 0, 0], fill: { $var: "plateColor" } }),
        box("nod_badge", 1.6, 1.6, { at: [-3.2, 0, 0.01], fill: { $var: "badgeColor" } }),
        box("nod_stripe1", 4, 0.35, { at: [0.8, 0.6, 0.01], fill: { $var: "color.text" } }),
        box("nod_stripe2", 3, 0.25, { at: [0.3, -0.1, 0.01], fill: { $var: "color.accent" } }),
        box("nod_stripe3", 3.6, 0.25, { at: [0.6, -0.7, 0.01], fill: { $var: "color.info" } }),
      ],
    }),

  controls: ({ send, variables }) => (
    <>
      <Group label="badge">
        <Swatches
          colors={PALETTE}
          value={read(variables, "badgeColor", "#E8B23A")}
          onChange={(value) => send({ type: "template.setParameter", key: "badgeColor", value })}
        />
      </Group>
      <Group label="plate">
        <Swatches
          colors={["#0B1F3A", "#12263F", "#2C3E50", "#000000"]}
          value={read(variables, "plateColor", "#0B1F3A")}
          onChange={(value) => send({ type: "template.setParameter", key: "plateColor", value })}
        />
      </Group>
    </>
  ),
});

// ---------------------------------------------------------------------------
// 05 · Layout
// ---------------------------------------------------------------------------

const LAYOUT_MODES = ["horizontal", "vertical", "grid", "stack"] as const;
const ALIGNMENTS = ["start", "center", "end", "stretch"] as const;
const JUSTIFICATIONS = ["start", "center", "end", "between", "around"] as const;

registerScene({
  id: "layout",
  title: "Layout",
  group: "Engine",
  order: 50,
  capability: "Composition · auto-layout, anchors",
  summary:
    "Switch mode, gap, alignment, and distribution. No coordinates are authored.",

  build: () =>
    sceneDocument({
      id: "scn_layout",
      name: "Layout",
      children: [
        {
          id: "nod_container",
          name: "Container",
          order: "V",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 14, height: 8 },
          layout: {
            mode: "horizontal",
            gap: 0.3,
            align: "center",
            justify: "center",
            padding: 0.3,
            columns: 3,
          },
          children: [
            box("nod_a", 2.4, 1.2, { fill: { $var: "color.info" } }),
            box("nod_b", 2.4, 2.4, { fill: { $var: "color.success" } }),
            box("nod_c", 2.4, 1.8, { fill: { $var: "color.accent" } }),
            box("nod_d", 2.4, 1.2, { fill: { $var: "color.danger" } }),
            box("nod_e", 2.4, 2, { fill: "#8E44AD" }),
            box("nod_f", 2.4, 1.4, { fill: "#16A085" }),
          ],
        },
      ],
    }),

  // Layout is a DOCUMENT property, so every control here is an operation, not
  // a command. That distinction is the point of the scene as much as the
  // layout is: RFC-002 §4.3 splits document edits from runtime state.
  controls: ({ edit, frame }) => {
    const setLayout = (path: string, value: unknown, previous: unknown) =>
      edit({
        id: `txn_layout_${path}_${frame}`,
        label: `layout ${path}`,
        actorId: "usr_showcase",
        operations: [
          {
            type: "node.setProp",
            nodeId: "nod_container",
            path: `layout.${path}`,
            value,
            previousValue: previous,
          },
        ],
      });

    return (
      <>
        <Group label="mode">
          <Choice
            options={LAYOUT_MODES}
            value="horizontal"
            onChange={(mode) => setLayout("mode", mode, "horizontal")}
          />
        </Group>
        <Group label="align">
          <Choice
            options={ALIGNMENTS}
            value="center"
            onChange={(align) => setLayout("align", align, "center")}
          />
        </Group>
        <Group label="justify">
          <Choice
            options={JUSTIFICATIONS}
            value="center"
            onChange={(justify) => setLayout("justify", justify, "center")}
          />
        </Group>
        <Group label="gap">
          <Slider
            min={0}
            max={1.5}
            step={0.1}
            value={0.3}
            format={(v) => `${v.toFixed(1)}u`}
            onChange={(gap) => setLayout("gap", gap, 0.3)}
          />
        </Group>
      </>
    );
  },
});

// ---------------------------------------------------------------------------
// 06 · States
// ---------------------------------------------------------------------------

const STATE_NAMES = ["normal", "warning", "error", "success"] as const;

registerScene({
  id: "states",
  title: "States",
  group: "Engine",
  order: 60,
  capability: "Composition · named states, no privileged names",
  summary:
    "Four states the engine assigns no meaning to. The template declares them.",

  build: () =>
    sceneDocument({
      id: "scn_states",
      name: "States",
      children: [
        {
          ...box("nod_panel", 8, 3, { at: [0, 1, 0], fill: { $var: "color.surface" } }),
          // None of these names means anything to the engine. `warning` and
          // `celebrating` would work identically; a template declares what a
          // state is for.
          states: {
            normal: { props: { cmp_panel: { fill: { $var: "color.surface" } } } },
            warning: { props: { cmp_panel: { fill: { $var: "color.accent" } } } },
            error: { props: { cmp_panel: { fill: { $var: "color.danger" } } } },
            success: { props: { cmp_panel: { fill: { $var: "color.success" } } } },
          },
        },
        {
          ...box("nod_pip", 1.2, 1.2, { at: [0, -2.4, 0], fill: { $var: "color.primary" } }),
          states: {
            error: { visible: false },
            success: { transform: { position: [3, -2.4, 0], rotation: [0, 0, 0], scale: [1.4, 1.4, 1] } },
          },
        },
      ],
    }),

  controls: ({ send, activeStates }) => (
    <>
      <Group label="active state">
        <Choice
          options={STATE_NAMES}
          value={(activeStates[0] as (typeof STATE_NAMES)[number]) ?? "normal"}
          onChange={(state) => send({ type: "state.set", states: [state] })}
        />
      </Group>
      <Group label="combine">
        <Action label="Clear all" onClick={() => send({ type: "state.set", states: [] })} />
        <Action
          label="warning + success"
          onClick={() => send({ type: "state.set", states: ["warning", "success"] })}
        />
      </Group>
    </>
  ),
});
