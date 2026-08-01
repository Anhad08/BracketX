import { useState } from "react";

import { registerScene } from "../registry";
import { Action, Group, Slider } from "../ui/controls";
import { box, rows, sceneDocument, variable } from "./kit";

/**
 * Stress dashboard.
 *
 * Not a demo of scale — a control surface for finding where the engine stops
 * fitting in a frame. Everything here is adjustable live so the performance
 * overlay can be watched while one variable moves.
 */

const CLIP_COUNT = 8;

/** One clip per animated node, so "animated nodes" is directly controllable. */
function clips(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `anm_${i}`,
    name: `Drift ${i}`,
    duration: 2 + (i % 3),
    loop: true,
    tracks: [
      {
        target: `nod_mover${i}`,
        path: "transform.position.1" as const,
        keyframes: [
          { time: 0, value: -3, easing: "easeInOutSine" as const },
          { time: 1 + (i % 3), value: 3, easing: "easeInOutSine" as const },
          { time: 2 + (i % 3), value: -3 },
        ],
      },
    ],
  }));
}

registerScene({
  id: "stress",
  title: "Stress Dashboard",
  group: "Workbench",
  order: 10,
  capability: "Engine · scale under live load",
  summary:
    "Drive node count, collection size, outputs, and command rate. Watch the frame budget.",

  build: () =>
    sceneDocument({
      id: "scn_stress",
      name: "Stress",
      variables: [variable("items", "string", rows(50))],
      animations: clips(CLIP_COUNT),
      children: [
        {
          id: "nod_grid",
          name: "Grid",
          order: "V",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 16, height: 9 },
          layout: { mode: "grid", columns: 12, gap: 0.06, rowGap: 0.06, align: "start", padding: 0.1 },
          repeat: { source: "items", as: "item", key: "id", limit: 5000 },
          children: [box("nod_cell", 1.2, 0.5, { fill: { $var: "item.color" } })],
        },
        // Animated movers sit outside the collection so animation load and
        // collection load can be varied independently.
        ...Array.from({ length: CLIP_COUNT }, (_, i) =>
          box(`nod_mover${i}`, 0.4, 0.4, {
            at: [-7 + i * 2, 0, 0.02],
            fill: { $var: "color.accent" },
          }),
        ),
      ],
    }),

  controls: ({ send, variables }) => <StressControls send={send} variables={variables} />,
});

function StressControls({
  send,
  variables,
}: {
  send: (command: never) => void;
  variables: Readonly<Record<string, unknown>>;
}) {
  const items = (variables.items as { id: string }[] | undefined) ?? [];
  const [rate, setRate] = useState(0);
  const [timer, setTimer] = useState<number | null>(null);

  const setSize = (size: number) =>
    send({ type: "collection.replace", key: "items", items: rows(size) } as never);

  const startFlood = (perSecond: number) => {
    if (timer !== null) window.clearInterval(timer);
    setRate(perSecond);
    if (perSecond === 0) {
      setTimer(null);
      return;
    }
    // A real feed pushing at a fixed rate. The point is to watch the frame
    // budget while commands arrive, not to see how many can be queued.
    const handle = window.setInterval(() => {
      const target = items[Math.floor(Math.random() * items.length)];
      if (target === undefined) return;
      send({
        type: "collection.patch",
        key: "items",
        id: target.id,
        keyField: "id",
        patch: { color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}` },
      } as never);
    }, 1000 / perSecond);
    setTimer(handle);
  };

  return (
    <>
      <Group label={`collection · ${items.length}`}>
        {[10, 50, 200, 1000, 3000].map((size) => (
          <Action key={size} label={String(size)} onClick={() => setSize(size)} />
        ))}
      </Group>
      <Group label="animation">
        <Action
          label="Play all clips"
          tone="primary"
          onClick={() => {
            send({ type: "playback.play" } as never);
            for (let i = 0; i < CLIP_COUNT; i += 1) {
              send({ type: "clip.play", clipId: `anm_${i}` } as never);
            }
          }}
        />
        <Action
          label="Stop all"
          onClick={() => {
            for (let i = 0; i < CLIP_COUNT; i += 1) {
              send({ type: "clip.stop", clipId: `anm_${i}` } as never);
            }
          }}
        />
      </Group>
      <Group label="outputs">
        {[1, 2, 4].map((count) => (
          <Action
            key={count}
            label={`${count}`}
            onClick={() => {
              for (let i = 1; i < 4; i += 1) {
                send({ type: "output.unbind", id: `extra${i}` } as never);
              }
              for (let i = 1; i < count; i += 1) {
                send({
                  type: "output.bind",
                  output: { id: `extra${i}`, width: 960, height: 540, cadence: i + 1 },
                } as never);
              }
            }}
          />
        ))}
      </Group>
      <Group label={`command rate · ${rate}/s`}>
        <Slider
          min={0}
          max={120}
          step={10}
          value={rate}
          format={(v) => `${v}/s`}
          onChange={startFlood}
        />
      </Group>
    </>
  );
}
