/**
 * Placing a scene into a scene — the join in the primary journey.
 *
 * These tests exist because the failure modes here are silent. A colliding
 * order key makes the engine refuse an insert and the drop does nothing; a
 * repainted palette makes a themed project change colour when a scorebug is
 * added. Neither throws.
 */

import { describe, expect, it } from "vitest";
import { applyTransaction, childrenOf } from "@bracketx/engine-scene";
import { placeScene } from "./studio/place";
import { instantiateTemplate } from "./studio/packs";
import { ESSENTIALS } from "./studio/essentials";
import { makeIdFactory } from "./studio/ids";

const NOW = "2026-01-01T00:00:00.000Z";

function scene(index: number) {
  return instantiateTemplate(ESSENTIALS[index]!, makeIdFactory(1000 + index), NOW);
}

describe("placeScene", () => {
  it("adds the placed scene's nodes to the host, keeping what was there", () => {
    const host = scene(0);
    const guest = scene(1);
    const before = childrenOf(host.root).length;

    const placement = placeScene(host, guest, makeIdFactory(903));
    expect(placement).not.toBeNull();

    const after = applyTransaction(host, placement!.transaction);
    expect(childrenOf(after.root).length).toBe(before + childrenOf(guest.root).length);
    // The host's own content is untouched — this is composition, not replacement.
    for (const node of childrenOf(host.root)) {
      expect(childrenOf(after.root).some((child) => child.id === node.id)).toBe(true);
    }
  });

  it("remints ids, so placing the same scene twice gives two graphics", () => {
    const host = scene(0);
    const guest = scene(1);

    const first = placeScene(host, guest, makeIdFactory(416))!;
    const once = applyTransaction(host, first.transaction);
    const second = placeScene(once, guest, makeIdFactory(176))!;
    const twice = applyTransaction(once, second.transaction);

    const ids = childrenOf(twice.root).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    // And the order keys, which the engine rejects duplicates of.
    const orders = childrenOf(twice.root).map((node) => node.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("never repaints the host's palette", () => {
    const host = { ...scene(0), tokens: [{ name: "brand", value: "#ff0000" }] };
    const guest = { ...scene(1), tokens: [{ name: "brand", value: "#00ff00" }] };

    const after = applyTransaction(host, placeScene(host, guest, makeIdFactory(903))!.transaction);
    const brand = (after.tokens ?? []).find((token) => token.name === "brand");
    expect(brand?.value).toBe("#ff0000");
  });

  it("brings colours the host does not have, so nothing renders unstyled", () => {
    const host = { ...scene(0), tokens: [{ name: "brand", value: "#ff0000" }] };
    const guest = { ...scene(1), tokens: [{ name: "accent", value: "#00ff00" }] };

    const after = applyTransaction(host, placeScene(host, guest, makeIdFactory(903))!.transaction);
    expect((after.tokens ?? []).find((token) => token.name === "accent")?.value).toBe("#00ff00");
  });

  it("carries the placed scene's fields onto the Content surface", () => {
    const host = scene(0);
    const guest = scene(1);
    const keys = guest.variables.map((variable) => variable.key);

    const after = applyTransaction(host, placeScene(host, guest, makeIdFactory(903))!.transaction);
    for (const key of keys) {
      expect(after.variables.some((variable) => variable.key === key)).toBe(true);
    }
    // Variable ids are reminted too — two scenes sharing one would alias.
    const ids = after.variables.map((variable) => variable.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a host field wins over a placed one with the same name", () => {
    const host = scene(0);
    const guest = { ...scene(1), variables: host.variables };

    const after = applyTransaction(host, placeScene(host, guest, makeIdFactory(903))!.transaction);
    expect(after.variables.length).toBe(host.variables.length);
  });

  it("lands where it was dropped", () => {
    const host = scene(0);
    const guest = scene(1);

    const centred = applyTransaction(
      host,
      placeScene(host, guest, makeIdFactory(903), { x: 960, y: 540 })!.transaction,
    );
    const low = applyTransaction(
      host,
      placeScene(host, guest, makeIdFactory(261), { x: 960, y: 940 })!.transaction,
    );

    const y = (document_: typeof centred): number => {
      const last = childrenOf(document_.root).at(-1);
      if (last === undefined) throw new Error("nothing was placed");
      return last.transform?.position[1] ?? 0;
    };
    expect(y(low) - y(centred)).toBeCloseTo(400, 5);
  });

  it("declines an empty scene rather than emitting a no-op transaction", () => {
    const host = scene(0);
    const empty = { ...host, root: { ...host.root, children: [] } };
    expect(placeScene(host, empty, makeIdFactory(903))).toBeNull();
  });
});
