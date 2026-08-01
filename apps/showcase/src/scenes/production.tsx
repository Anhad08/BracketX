import type { RuntimeValue } from "@bracketx/engine-runtime";

import { registerScene } from "../registry";
import { Action, Group, Slider, Swatches, TextField, read } from "../ui/controls";
import { box, rows, sceneDocument, variable } from "./kit";

/**
 * Animation, outputs, and the four production graphics.
 *
 * The last four are the milestone made watchable: a lower third, a scoreboard,
 * a leaderboard, and a bracket, all built from templates, variables,
 * collections, layout, and states. The engine still does not know any of those
 * four words.
 */

const PALETTE = ["#E8B23A", "#27AE60", "#C0392B", "#2980B9", "#8E44AD"];

// ---------------------------------------------------------------------------
// 07 · Animation
// ---------------------------------------------------------------------------

registerScene({
  id: "animation",
  title: "Animation",
  group: "Engine",
  order: 70,
  capability: "Animation · pure evaluation, seeking, reverse",
  summary:
    "Play, pause, reverse, seek, scrub. Seeking equals playing there — no state to unwind.",
  autoPlay: false,
  screenshotFrame: 30,

  build: () =>
    sceneDocument({
      id: "scn_animation",
      name: "Animation",
      animations: [
        {
          id: "anm_sweep",
          name: "Sweep",
          duration: 2,
          loop: true,
          tracks: [
            {
              target: "nod_mover",
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -6, easing: "easeInOutCubic" },
                { time: 1, value: 6, easing: "easeInOutCubic" },
                { time: 2, value: -6 },
              ],
            },
            {
              target: "nod_mover",
              path: "components.0.props.fill",
              keyframes: [
                { time: 0, value: "#2980B9", easing: "linear" },
                { time: 1, value: "#E8B23A", easing: "linear" },
                { time: 2, value: "#2980B9" },
              ],
            },
            {
              target: "nod_pulse",
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 1, easing: "easeOutBack" },
                { time: 1, value: 2.4, easing: "easeInOutSine" },
                { time: 2, value: 1 },
              ],
            },
          ],
          events: [
            { time: 1, name: "midpoint" },
            { time: 2, name: "loop" },
          ],
        },
      ],
      children: [
        box("nod_track", 14, 0.08, { at: [0, 0, 0], fill: { $var: "color.surface" } }),
        box("nod_mover", 1.6, 1.6, { at: [-6, 0, 0.01], fill: "#2980B9" }),
        box("nod_pulse", 1, 1, { at: [0, -3, 0], fill: { $var: "color.accent" } }),
      ],
    }),

  onLoad: [{ type: "clip.play", clipId: "anm_sweep" }],

  controls: ({ send, frame, playing }) => (
    <>
      <Group label="transport">
        <Action
          label={playing ? "Pause" : "Play"}
          tone="primary"
          onClick={() => send({ type: playing ? "playback.pause" : "playback.play" })}
        />
        <Action label="Restart" onClick={() => send({ type: "playback.seek", frame: 0 })} />
        <Action
          label="Reverse"
          onClick={() =>
            send({ type: "clip.play", clipId: "anm_sweep", options: { speed: -1, startFrame: frame } })
          }
        />
        <Action
          label="Forward"
          onClick={() =>
            send({ type: "clip.play", clipId: "anm_sweep", options: { speed: 1, startFrame: frame } })
          }
        />
      </Group>
      <Group label="scrub · events must NOT fire">
        <Slider
          min={0}
          max={240}
          step={1}
          value={Math.min(frame, 240)}
          format={(v) => `f${v}`}
          onChange={(next) => send({ type: "playback.seek", frame: next })}
        />
      </Group>
      <Group label="speed">
        {[0.25, 0.5, 1, 2].map((speed) => (
          <Action
            key={speed}
            label={`${speed}×`}
            onClick={() =>
              send({ type: "clip.play", clipId: "anm_sweep", options: { speed, startFrame: frame } })
            }
          />
        ))}
      </Group>
    </>
  ),
});

// ---------------------------------------------------------------------------
// 08 · Outputs
// ---------------------------------------------------------------------------

registerScene({
  id: "outputs",
  title: "Outputs",
  group: "Engine",
  order: 80,
  capability: "Outputs · multiple surfaces, independent cadence",
  summary:
    "One scene, several outputs at different sizes and rates. Watch per-output counts.",

  build: () =>
    sceneDocument({
      id: "scn_outputs",
      name: "Outputs",
      animations: [
        {
          id: "anm_spin",
          name: "Spin",
          duration: 3,
          loop: true,
          tracks: [
            {
              target: "nod_dial",
              path: "transform.rotation.2",
              keyframes: [
                { time: 0, value: 0, easing: "linear" },
                { time: 3, value: 6.28318 },
              ],
            },
          ],
        },
      ],
      children: [
        box("nod_frame", 10, 6, { at: [0, 0, 0], fill: { $var: "color.primary" } }),
        box("nod_dial", 5, 0.4, { at: [0, 0, 0.01], fill: { $var: "color.accent" } }),
        box("nod_hub", 1, 1, { at: [0, 0, 0.02], fill: { $var: "color.text" } }),
      ],
    }),

  onLoad: [{ type: "clip.play", clipId: "anm_spin" }],

  controls: ({ send }) => (
    <>
      <Group label="bind">
        {/* The canvas shows the default output. The others render to the same
            backend and prove the engine drives many surfaces from one scene;
            their frame counts are visible in the diagnostics panel. */}
        <Action
          label="Preview 960×540 @½"
          onClick={() =>
            send({
              type: "output.bind",
              output: { id: "preview", width: 960, height: 540, cadence: 2 },
            })
          }
        />
        <Action
          label="Wall 3840×2160"
          onClick={() =>
            send({
              type: "output.bind",
              output: { id: "wall", width: 3840, height: 2160, alpha: "opaque" },
            })
          }
        />
        <Action
          label="Thumb 320×180 @¼"
          onClick={() =>
            send({
              type: "output.bind",
              output: { id: "thumb", width: 320, height: 180, cadence: 4 },
            })
          }
        />
      </Group>
      <Group label="unbind">
        {["preview", "wall", "thumb"].map((id) => (
          <Action key={id} label={id} tone="danger" onClick={() => send({ type: "output.unbind", id })} />
        ))}
      </Group>
      <Group label="resize default">
        <Action
          label="1280×720"
          onClick={() => send({ type: "output.resize", id: "default", width: 1280, height: 720 })}
        />
        <Action
          label="1920×1080"
          onClick={() => send({ type: "output.resize", id: "default", width: 1920, height: 1080 })}
        />
      </Group>
    </>
  ),
});

// ---------------------------------------------------------------------------
// 09 · Lower Third
// ---------------------------------------------------------------------------

registerScene({
  id: "lower-third",
  title: "Lower Third",
  group: "Production",
  order: 10,
  capability: "Composition · template + layout + anchor + states",
  summary: "A real lower third. Enter and exit are states, not engine concepts.",
  autoPlay: false,

  build: () =>
    sceneDocument({
      id: "scn_lowerThird",
      name: "Lower Third",
      variables: [
        variable("presenter", "string", "ALEX RIVERA"),
        variable("role", "string", "SENIOR ANALYST"),
        variable("accent", "color", "#E8B23A"),
      ],
      animations: [
        {
          id: "anm_in",
          name: "In",
          duration: 0.6,
          tracks: [
            {
              target: "nod_bar",
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -14, easing: "easeOutCubic" },
                { time: 0.6, value: -2.4 },
              ],
            },
          ],
        },
        {
          id: "anm_out",
          name: "Out",
          duration: 0.4,
          tracks: [
            {
              target: "nod_bar",
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -2.4, easing: "easeInCubic" },
                { time: 0.4, value: -14 },
              ],
            },
          ],
        },
      ],
      children: [
        {
          id: "nod_bar",
          name: "Bar",
          order: "V",
          transform: { position: [-14, -2.8, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 9, height: 1.8 },
          layout: { mode: "horizontal", gap: 0.2, align: "center", padding: 0.15 },
          states: { hidden: { visible: false }, live: { visible: true } },
          children: [
            box("nod_accent", 0.28, 1.5, { fill: { $var: "accent" } }),
            box("nod_name", 5.2, 0.75, { fill: { $var: "color.primary" } }),
            box("nod_role", 2.8, 0.45, { fill: { $var: "color.surface" } }),
          ],
        },
      ],
    }),

  controls: ({ send, variables }) => (
    <>
      <Group label="on air">
        <Action
          label="Take"
          tone="primary"
          onClick={() => {
            send({ type: "state.set", states: ["live"] });
            send({ type: "playback.play" });
            send({ type: "clip.play", clipId: "anm_in" });
          }}
        />
        <Action
          label="Clear"
          tone="danger"
          onClick={() => send({ type: "clip.play", clipId: "anm_out" })}
        />
        <Action label="Hide" onClick={() => send({ type: "state.set", states: ["hidden"] })} />
      </Group>
      <Group label="name">
        <TextField
          value={read(variables, "presenter", "ALEX RIVERA")}
          onChange={(value) => send({ type: "variable.set", key: "presenter", value })}
        />
      </Group>
      <Group label="accent">
        <Swatches
          colors={PALETTE}
          value={read(variables, "accent", "#E8B23A")}
          onChange={(value) => send({ type: "variable.set", key: "accent", value })}
        />
      </Group>
    </>
  ),
});

// ---------------------------------------------------------------------------
// 10 · Scoreboard
// ---------------------------------------------------------------------------

registerScene({
  id: "scoreboard",
  title: "Scoreboard",
  group: "Production",
  order: 20,
  capability: "Composition · nested layout + live variables + conditional state",
  summary: "Home, away, period, clock. Updating a score touches one node.",

  build: () =>
    sceneDocument({
      id: "scn_scoreboard",
      name: "Scoreboard",
      variables: [
        variable("home", "number", 0),
        variable("away", "number", 0),
        variable("homeColor", "color", "#C0392B"),
        variable("awayColor", "color", "#2980B9"),
      ],
      children: [
        {
          id: "nod_board",
          name: "Board",
          order: "V",
          transform: { position: [0, 3.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 11, height: 1.6 },
          layout: { mode: "horizontal", gap: 0.25, align: "center", justify: "center" },
          states: {
            // No engine concept of a final minute. A rule elsewhere decides
            // when to activate the name.
            urgent: { props: { cmp_clock: { fill: { $var: "color.danger" } } } },
          },
          children: [
            {
              id: "nod_homeSide",
              name: "Home",
              // Hand-written keys, ascending, because these siblings are
              // interleaved with a helper-built node and mixing generated keys
              // with literal ones produces an unsorted document.
              order: "1",
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              size: { width: 4, height: 1.2 },
              layout: { mode: "horizontal", gap: 0.12, align: "center" },
              children: [
                box("nod_homeName", 2.8, 0.9, { fill: { $var: "homeColor" } }),
                box("nod_homeScore", 0.9, 0.9, { fill: { $var: "color.primary" } }),
              ],
            },
            { ...box("nod_clock", 1.6, 1.1, { fill: { $var: "color.surface" } }), order: "m" },
            {
              id: "nod_awaySide",
              name: "Away",
              order: "z",
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              size: { width: 4, height: 1.2 },
              layout: { mode: "horizontal", gap: 0.12, align: "center" },
              children: [
                box("nod_awayScore", 0.9, 0.9, { fill: { $var: "color.primary" } }),
                box("nod_awayName", 2.8, 0.9, { fill: { $var: "awayColor" } }),
              ],
            },
          ],
        },
      ],
    }),

  controls: ({ send, variables, activeStates }) => {
    const home = read(variables, "home", 0);
    const away = read(variables, "away", 0);
    const urgent = activeStates.includes("urgent");

    return (
      <>
        <Group label={`home · ${home}`}>
          <Action label="+1" tone="primary" onClick={() => send({ type: "variable.set", key: "home", value: home + 1 })} />
          <Action label="−1" onClick={() => send({ type: "variable.set", key: "home", value: Math.max(0, home - 1) })} />
          <Swatches
            colors={PALETTE}
            value={read(variables, "homeColor", "#C0392B")}
            onChange={(value) => send({ type: "variable.set", key: "homeColor", value })}
          />
        </Group>
        <Group label={`away · ${away}`}>
          <Action label="+1" tone="primary" onClick={() => send({ type: "variable.set", key: "away", value: away + 1 })} />
          <Action label="−1" onClick={() => send({ type: "variable.set", key: "away", value: Math.max(0, away - 1) })} />
          <Swatches
            colors={PALETTE}
            value={read(variables, "awayColor", "#2980B9")}
            onChange={(value) => send({ type: "variable.set", key: "awayColor", value })}
          />
        </Group>
        <Group label="clock">
          <Action
            label={urgent ? "Clear urgent" : "Final minute"}
            tone={urgent ? undefined : "danger"}
            onClick={() => send({ type: "state.set", states: urgent ? [] : ["urgent"] })}
          />
          <Action
            label="Reset"
            onClick={() => {
              send({ type: "variable.set", key: "home", value: 0 });
              send({ type: "variable.set", key: "away", value: 0 });
              send({ type: "state.set", states: [] });
            }}
          />
        </Group>
      </>
    );
  },
});

// ---------------------------------------------------------------------------
// 11 · Leaderboard
// ---------------------------------------------------------------------------

const STANDINGS = rows(8);

registerScene({
  id: "leaderboard",
  title: "Leaderboard",
  group: "Production",
  order: 30,
  capability: "Live Control · keyed reorder preserves identity",
  summary:
    "Sort by score live. Created and destroyed stay zero — rows move, never rebuild.",

  build: () =>
    sceneDocument({
      id: "scn_leaderboard",
      name: "Leaderboard",
      variables: [variable("standings", "string", STANDINGS)],
      children: [
        {
          id: "nod_table",
          name: "Table",
          order: "V",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 11, height: 8.4 },
          layout: { mode: "vertical", gap: 0.12, align: "stretch" },
          repeat: { source: "standings", as: "row", key: "id", limit: 30 },
          children: [
            {
              id: "nod_entry",
              name: "Entry",
              order: "V",
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              size: { width: 11, height: 0.9 },
              layout: { mode: "horizontal", gap: 0.12, align: "center" },
              children: [
                box("nod_pos", 0.8, 0.7, { fill: { $var: "color.accent" } }),
                box("nod_team", 7.4, 0.7, { fill: { $var: "row.color" } }),
                box("nod_pts", 1.6, 0.7, { fill: { $var: "color.surface" } }),
              ],
            },
          ],
        },
      ],
    }),

  controls: ({ send, variables }) => {
    const standings = read<typeof STANDINGS>(variables, "standings", STANDINGS);

    return (
      <>
        <Group label="score · patch in place">
          <Action
            label="Random +3"
            tone="primary"
            onClick={() => {
              const target = standings[Math.floor(Math.random() * standings.length)];
              if (target === undefined) return;
              send({
                type: "collection.patch",
                key: "standings",
                id: target.id,
                keyField: "id",
                patch: { score: target.score + 3 },
              });
            }}
          />
        </Group>
        <Group label="reorder · identity must survive">
          <Action
            label="Sort by score"
            onClick={() =>
              send({
                type: "collection.reorder",
                key: "standings",
                ids: [...standings].sort((a, b) => b.score - a.score).map((row) => row.id),
                keyField: "id",
              })
            }
          />
          <Action
            label="Shuffle"
            onClick={() =>
              send({
                type: "collection.reorder",
                key: "standings",
                ids: [...standings]
                  .map((row, index) => ({ row, sort: (index * 2654435761) % 97 }))
                  .sort((a, b) => a.sort - b.sort)
                  .map((entry) => entry.row.id),
                keyField: "id",
              })
            }
          />
        </Group>
        <Group label="entries">
          <Action
            label="Add"
            onClick={() => {
              const next = rows(standings.length + 1)[standings.length]!;
              send({ type: "collection.insert", key: "standings", at: "end", items: [next] });
            }}
          />
          <Action
            label="Eliminate last"
            tone="danger"
            disabled={standings.length === 0}
            onClick={() =>
              send({
                type: "collection.remove",
                key: "standings",
                ids: [standings[standings.length - 1]!.id],
                keyField: "id",
              })
            }
          />
          <Action
            label="Reset"
            onClick={() => send({ type: "collection.replace", key: "standings", items: rows(8) })}
          />
        </Group>
      </>
    );
  },
});

// ---------------------------------------------------------------------------
// 12 · Tournament Bracket
// ---------------------------------------------------------------------------

/** Index signature for the same reason Row has one — see kit.ts. */
interface Match {
  readonly [key: string]: RuntimeValue;
  readonly id: string;
  readonly homeColor: string;
  readonly awayColor: string;
  readonly decided: boolean;
}

function draw(size: number): Match[] {
  const teams = rows(size * 2);
  return Array.from({ length: size }, (_, i) => ({
    id: `m${i + 1}`,
    homeColor: teams[i * 2]!.color,
    awayColor: teams[i * 2 + 1]!.color,
    decided: false,
  }));
}

const DRAW = draw(8);

registerScene({
  id: "tournament-bracket",
  title: "Tournament Bracket",
  group: "Production",
  order: 40,
  capability: "Composition · grid layout over a collection",
  summary:
    "Sixteen teams in a grid. The engine has no idea what a bracket is.",

  build: () =>
    sceneDocument({
      id: "scn_bracket",
      name: "Bracket",
      variables: [variable("matches", "string", DRAW)],
      children: [
        {
          id: "nod_draw",
          name: "Draw",
          order: "V",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 15, height: 8.5 },
          layout: {
            mode: "grid",
            columns: 4,
            gap: 0.5,
            rowGap: 0.4,
            align: "start",
            padding: 0.25,
          },
          repeat: { source: "matches", as: "match", key: "id", limit: 64 },
          children: [
            {
              id: "nod_tie",
              name: "Tie",
              order: "V",
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              size: { width: 3.2, height: 1.7 },
              layout: { mode: "vertical", gap: 0.08, align: "stretch" },
              children: [
                box("nod_home", 3.2, 0.72, { fill: { $var: "match.homeColor" } }),
                box("nod_away", 3.2, 0.72, { fill: { $var: "match.awayColor" } }),
              ],
            },
          ],
        },
      ],
    }),

  controls: ({ send, variables }) => {
    const matches = read<Match[]>(variables, "matches", DRAW);

    return (
      <>
        <Group label="results">
          <Action
            label="Decide next tie"
            tone="primary"
            onClick={() => {
              const pending = matches.find((match) => !match.decided);
              if (pending === undefined) return;
              send({
                type: "collection.patch",
                key: "matches",
                id: pending.id,
                keyField: "id",
                patch: { decided: true, awayColor: "#2C3E50" },
              });
            }}
          />
          <Action
            label="Reset draw"
            onClick={() => send({ type: "collection.replace", key: "matches", items: draw(8) })}
          />
        </Group>
        <Group label="draw size">
          {[4, 8, 16, 32].map((size) => (
            <Action
              key={size}
              label={`${size * 2} teams`}
              onClick={() => send({ type: "collection.replace", key: "matches", items: draw(size) })}
            />
          ))}
        </Group>
      </>
    );
  },
});
