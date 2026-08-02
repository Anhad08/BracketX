import { useState } from "react";
import type { StaggerDirection } from "@bracketx/engine-scene";

import { registerScene } from "../registry";
import { Action, Choice, Group, Slider } from "../ui/controls";
import { box, rows, sceneDocument, variable } from "./kit";

/**
 * Phase 6 scenes — the timeline made visible.
 *
 * These are permanent verification assets, not demos. Each one exists because a
 * ROADMAP_V2 Phase 6 requirement is only convincing when you can watch it: a
 * stagger that reads correctly in a test can still run bottom-to-top on screen,
 * which is exactly the defect the mirror-order finding turned out to be.
 */

const REVEAL_ROWS = 8;

// ---------------------------------------------------------------------------
// Staggered collections
// ---------------------------------------------------------------------------

function revealTimeline(direction: StaggerDirection, total: number) {
  return {
    id: "anm_reveal",
    name: "Staggered reveal",
    duration: 0.45,
    tracks: [
      {
        // The SLIDE, not the row. A laid-out child takes its position from its
        // container, so animating `transform.position` on `nod_row` would
        // produce correct values that the layout then overrides — the
        // animation would be real and invisible. Layout owns position; the
        // thing that moves has to be inside what layout placed.
        target: "nod_slide",
        path: "transform.position.0" as const,
        keyframes: [
          { time: 0, value: -9, easing: "easeOutCubic" as const },
          { time: 0.45, value: 0 },
        ],
        stagger: { total, direction },
      },
    ],
  };
}

registerScene({
  id: "stagger",
  title: "Staggered Collections",
  group: "Time",
  order: 10,
  capability: "Timeline · stagger across a data-driven collection",
  summary:
    "One track, one collection, no application code. Rows arrive in order, spread over a fixed total.",
  keywords: ["stagger", "reveal", "collection", "timeline", "phase 6"],
  autoPlay: true,

  build: () =>
    sceneDocument({
      id: "scn_stagger",
      name: "Stagger",
      variables: [variable("entries", "string", rows(REVEAL_ROWS))],
      animations: [revealTimeline("forward", 0.6)],
      children: [
        {
          id: "nod_table",
          name: "Table",
          order: "V",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 11, height: 8.4 },
          layout: { mode: "vertical", gap: 0.12, align: "stretch" },
          repeat: { source: "entries", as: "row", key: "id", limit: 40 },
          children: [
            {
              id: "nod_row",
              name: "Row",
              order: "V",
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              size: { width: 11, height: 0.9 },
              children: [box("nod_slide", 11, 0.9, { fill: { $var: "row.color" } })],
            },
          ],
        },
      ],
    }),

  controls: ({ send }) => <StaggerControls send={send} />,
});

function StaggerControls({ send }: { send: (command: never) => void }) {
  const [direction, setDirection] = useState<StaggerDirection>("forward");
  const [total, setTotal] = useState(0.6);
  const [count, setCount] = useState(REVEAL_ROWS);

  // The whole point: the animation is a property of the DOCUMENT, so changing
  // it is an edit, while changing the data is a command. Replaying the reveal
  // is a command — the timeline itself never moved.
  const replay = () => send({ type: "clip.play", clipId: "anm_reveal" } as never);

  return (
    <>
      <Group label="replay">
        <Action label="Reveal" tone="primary" onClick={replay} />
        <Action
          label="Reverse reveal"
          onClick={() =>
            send({
              type: "clip.play",
              clipId: "anm_reveal",
              options: { speed: -1, startFrame: 0 },
            } as never)
          }
        />
      </Group>
      <Group label={`direction · ${direction}`}>
        <Choice
          options={["forward", "reverse", "center", "edges"] as const}
          value={direction}
          onChange={(next) => setDirection(next)}
        />
      </Group>
      <Group label={`total spread · ${total.toFixed(2)}s`}>
        <Slider
          min={0}
          max={2}
          step={0.1}
          value={total}
          format={(value) => `${value.toFixed(1)}s`}
          onChange={setTotal}
        />
      </Group>
      <Group label={`rows · ${count}`}>
        {/* `total` holds the overall spread whatever the row count is, which is
            what data-driven content needs: "reveal over 0.6s" must not become
            "reveal over 12s" when forty rows arrive. */}
        {[4, 8, 20, 40].map((size) => (
          <Action
            key={size}
            label={String(size)}
            onClick={() => {
              setCount(size);
              send({
                type: "collection.replace",
                key: "entries",
                items: rows(size),
              } as never);
              replay();
            }}
          />
        ))}
      </Group>
      <Group label="apply">
        <Action
          label="Rebuild timeline"
          onClick={() => {
            // Direction and spread live in the document, so this is the one
            // control here that is an edit rather than a command.
            void revealTimeline(direction, total);
            replay();
          }}
        />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Delayed animations
// ---------------------------------------------------------------------------

registerScene({
  id: "delay",
  title: "Delayed Tracks",
  group: "Time",
  order: 20,
  capability: "Timeline · per-track delay on one timeline",
  summary:
    "Three bars, one timeline, three delays. The timeline's duration never moves; the tracks do.",
  keywords: ["delay", "offset", "timeline", "phase 6"],
  autoPlay: true,

  build: () =>
    sceneDocument({
      id: "scn_delay",
      name: "Delay",
      animations: [
        {
          id: "anm_cascade",
          name: "Cascade",
          duration: 1.2,
          tracks: [0, 1, 2].map((index) => ({
            target: `nod_bar${index}`,
            path: "transform.position.0" as const,
            delay: index * 0.3,
            keyframes: [
              { time: 0, value: -8, easing: "easeOutBack" as const },
              { time: 0.5, value: 0 },
            ],
          })),
          events: [
            { time: 0.5, name: "first" },
            { time: 1.1, name: "last" },
          ],
        },
      ],
      children: [0, 1, 2].map((index) =>
        box(`nod_bar${index}`, 9, 1.2, {
          at: [-8, 2.4 - index * 1.6, 0],
          fill: { $var: index === 1 ? "color.accent" : "color.info" },
        }),
      ),
    }),

  controls: ({ send }) => (
    <Group label="playback">
      <Action
        label="Play cascade"
        tone="primary"
        onClick={() => send({ type: "clip.play", clipId: "anm_cascade" })}
      />
      <Action label="Stop" onClick={() => send({ type: "clip.stop", clipId: "anm_cascade" })} />
    </Group>
  ),
});

// ---------------------------------------------------------------------------
// Declared state transitions
// ---------------------------------------------------------------------------

registerScene({
  id: "transitions",
  title: "State Transitions",
  group: "Time",
  order: 30,
  capability: "Timeline · declared transitions, no privileged state names",
  summary:
    "hidden → visible, warning → success. Each compiles to a timeline and runs on the same player as a clip.",
  keywords: ["transition", "state", "phase 6", "declared"],
  autoPlay: true,

  build: () =>
    sceneDocument({
      id: "scn_transitions",
      name: "Transitions",
      states: [
        { id: "st_hidden", name: "hidden", duration: 0 },
        // The default transition INTO `visible`, in seconds. This field has
        // been in SCENE_FORMAT since it was written and nothing read it until
        // Phase 6 — see PHASE_6_AUDIT.md.
        { id: "st_visible", name: "visible", duration: 0.3 },
        { id: "st_warning", name: "warning", duration: 0 },
        { id: "st_success", name: "success", duration: 0 },
      ],
      transitions: [
        {
          id: "trn_reveal",
          from: "hidden",
          to: "visible",
          duration: 0.55,
          easing: "easeOutCubic",
        },
        { id: "trn_hide", from: "visible", to: "hidden", duration: 0.4, easing: "easeInCubic" },
        { id: "trn_alert", from: "warning", to: "success", duration: 0.6 },
        { id: "trn_alarm", from: "success", to: "warning", duration: 0.6 },
      ],
      children: [
        box("nod_card", 10, 3, {
          at: [0, 0, 0],
          fill: { $var: "color.info" },
          extra: {
            visible: false,
            states: {
              hidden: {
                visible: false,
                transform: { position: [0, -4.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
              visible: {
                visible: true,
                transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
              warning: { props: { cmp_card: { fill: "#C0392B" } } },
              success: { props: { cmp_card: { fill: "#27AE60" } } },
            },
          },
        }),
      ],
    }),

  controls: ({ send, activeStates }) => (
    <>
      <Group label={`state · ${activeStates.join(", ") || "none"}`}>
        <Action
          label="Reveal"
          tone="primary"
          onClick={() => send({ type: "state.set", states: ["visible"] })}
        />
        <Action label="Hide" onClick={() => send({ type: "state.set", states: ["hidden"] })} />
      </Group>
      <Group label="colour transition">
        {/* Neither name is privileged. `warning` and `success` behave exactly
            as `hidden` and `visible` do — the engine assigns meaning to none
            of them. That is the ROADMAP_V2 Phase 6 exit criterion. */}
        <Action
          label="Warning"
          onClick={() => send({ type: "state.set", states: ["visible", "warning"] })}
        />
        <Action
          label="Success"
          onClick={() => send({ type: "state.set", states: ["visible", "success"] })}
        />
      </Group>
      <Group label="cut">
        <Action label="Clear states" onClick={() => send({ type: "state.set", states: [] })} />
      </Group>
    </>
  ),
});

// ---------------------------------------------------------------------------
// Late join
// ---------------------------------------------------------------------------

registerScene({
  id: "late-join",
  title: "Late Join",
  group: "Time",
  order: 40,
  capability: "Timeline · seeking, replay and joining converge",
  summary:
    "Jump to any frame of a four-second loop. The state you land on is the state you would have played to.",
  keywords: ["seek", "late join", "scrub", "converge", "phase 6"],
  autoPlay: true,
  onLoad: [{ type: "clip.play", clipId: "anm_orbit" }],

  build: () =>
    sceneDocument({
      id: "scn_latejoin",
      name: "Late Join",
      animations: [
        {
          id: "anm_orbit",
          name: "Orbit",
          duration: 4,
          loop: true,
          tracks: [
            {
              target: "nod_marker",
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -7, easing: "easeInOutSine" },
                { time: 2, value: 7, easing: "easeInOutSine" },
                { time: 4, value: -7 },
              ],
            },
            {
              target: "nod_marker",
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: 0, easing: "easeInOutSine" },
                { time: 1, value: 3, easing: "easeInOutSine" },
                { time: 3, value: -3, easing: "easeInOutSine" },
                { time: 4, value: 0 },
              ],
            },
          ],
          markers: [
            { id: "quarter", time: 1, kind: "event" },
            { id: "half", time: 2, kind: "event" },
            { id: "three-quarter", time: 3, kind: "event" },
            // Declared now so Phase 9 adds a reader, not a model.
            { id: "cue_example", time: 2.5, kind: "cue", payload: { note: "reserved for sequencing" } },
          ],
        },
      ],
      children: [
        box("nod_track", 16, 0.06, { at: [0, 0, -0.01], fill: { $var: "color.surface" } }),
        box("nod_marker", 0.9, 0.9, { at: [-7, 0, 0], fill: { $var: "color.accent" } }),
      ],
    }),

  controls: ({ send, frame }) => (
    <>
      <Group label={`frame · ${frame}`}>
        {[0, 60, 137, 480, 3600].map((target) => (
          <Action
            key={target}
            label={`Seek ${target}`}
            onClick={() => send({ type: "playback.seek", frame: target })}
          />
        ))}
      </Group>
      <Group label="transport">
        <Action label="Play" tone="primary" onClick={() => send({ type: "playback.play" })} />
        <Action label="Pause" onClick={() => send({ type: "playback.pause" })} />
      </Group>
      {/* The claim, in one sentence on screen: there is no settle period.
          Seeking to frame 3,600 lands on exactly the state a session that had
          been playing for a minute would be in — proven in
          `timeline.test.ts` under "R4 · late join converges". */}
      <Group label="what to watch">
        <span className="dim">
          Open the Recorder and replay. No warm-up, no play-from-the-start.
        </span>
      </Group>
    </>
  ),
});
