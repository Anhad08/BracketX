import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodePng } from "./png";

/**
 * The shipped logo, decoded by the shipped decoder.
 *
 * A round trip against a file a designer would actually import, rather than a
 * fixture built to suit the decoder. If the two ever disagree, this is the test
 * that says so before a user does.
 */
const LOGO = fileURLToPath(
  new URL("../../../apps/studio/public/images/sponsor-mark.png", import.meta.url),
);

describe("the shipped mark", () => {
  it("decodes to the size and alpha it was authored at", async () => {
    const image = await decodePng(new Uint8Array(readFileSync(LOGO)));
    expect(image.width).toBe(512);
    expect(image.height).toBe(512);
    expect(image.pixels.length).toBe(512 * 512 * 4);

    // The corner is outside the ring, so it must be fully transparent — a logo
    // whose background decoded opaque would sit on a black card over video.
    expect(image.pixels[3]).toBe(0);

    // And something is actually drawn: the centre row crosses the mark.
    const row = 256 * 512 * 4;
    let opaque = 0;
    for (let x = 0; x < 512; x += 1) {
      if (image.pixels[row + x * 4 + 3]! > 200) opaque += 1;
    }
    expect(opaque).toBeGreaterThan(50);
  });
});
