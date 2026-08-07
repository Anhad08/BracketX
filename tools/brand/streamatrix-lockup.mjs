#!/usr/bin/env node
/**
 * Streamatrix — the full lockup: mark over logotype over tagline.
 *
 * Everything is positioned from the mark's own width, so the composition holds
 * whatever the mark's proportions do. The logotype is set to a fraction of that
 * width rather than to a fixed point size, which is the only way a lockup stays
 * in proportion when the mark is retuned.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { markSvg, buildDots, ledColour, S_BOX, M } from "./streamatrix-mark.mjs";
import { wordmarkSvg, advance } from "./streamatrix-wordmark.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "brand", "streamatrix");
const round = (v, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d);

export const L = {
  wordWidth: 0.96, // logotype width, as a fraction of the mark's width
  wordTracking: 0.17, // letterspacing, in cap heights
  wordWeight: 0.098, // stroke weight, in cap heights
  gapMark: 0.045, // mark → logotype, as a fraction of the mark's height
  gapTag: 0.5, // logotype → tagline, in logotype cap heights
  tagScale: 0.3, // tagline cap height, relative to the logotype's
  tagTracking: 0.42, // the tagline is set much looser — it is a rule, not a word
  margin: 0.06, // outer margin, as a fraction of total width
};

const WORD = "STREAMATRIX";
const TAG = "STREAM. MANAGE. ELEVATE.";

/** Sample the mark's own spectrum, so the logotype's LEDs match the panel. */
const wheel = (fx, fy) => ledColour(fx * S_BOX.w * 0.5, fy * S_BOX.h * 0.5);

export function lockupSvg({ background = null, glow = true } = {}) {
  const markW = S_BOX.w;
  const markH = S_BOX.h;

  // Mark: reuse the real thing, stripped of its own <svg> wrapper.
  const inner = markSvg({ glow });
  const markVb = inner.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const markBody = inner.slice(inner.indexOf("<defs>"), inner.lastIndexOf("</svg>"));

  const wordCap = (markVb[2] * L.wordWidth) / advance(WORD, L.wordTracking);
  const word = wordmarkSvg(WORD, {
    tracking: L.wordTracking,
    weight: L.wordWeight,
    ledIndex: WORD.indexOf("I"),
    // The I is a column of LEDs — the mark's spectrum, standing in for a letter.
    ledColours: [
      wheel(0.2, -0.75),
      wheel(0.8, -0.35),
      wheel(0.85, 0.25),
      wheel(0.3, 0.8),
      wheel(-0.5, 0.7),
    ],
    idPrefix: "sx-word",
  });

  const tagCap = wordCap * L.tagScale;
  const tag = wordmarkSvg(TAG, {
    tracking: L.tagTracking,
    weight: L.wordWeight * 1.25,
    colour: "#9aa3b2",
    dotColours: [wheel(0.6, -0.7), wheel(-0.7, 0.2), wheel(0.6, 0.75)],
    idPrefix: "sx-tag",
  });

  const wordW = word.width * wordCap;
  const tagW = tag.width * tagCap;
  const contentW = Math.max(markVb[2], wordW, tagW);
  const pad = contentW * L.margin;

  const gap1 = markVb[3] * L.gapMark;
  const gap2 = wordCap * L.gapTag;
  const totalH = markVb[3] + gap1 + wordCap + gap2 + tagCap;
  const totalW = contentW + pad * 2;
  const H = totalH + pad * 2;

  const cx = totalW / 2;
  let y = pad;
  const markX = cx - markVb[2] / 2 - markVb[0];
  const markY = y - markVb[1];
  y += markVb[3] + gap1;
  const wordX = cx - wordW / 2;
  const wordY = y;
  y += wordCap + gap2;
  const tagX = cx - tagW / 2;
  const tagY = y;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${round(totalW)} ${round(H)}" role="img" aria-labelledby="sx-t sx-d">
  <title id="sx-t">Streamatrix</title>
  <desc id="sx-d">The Streamatrix lockup: the LED mark over the logotype and tagline.</desc>
${background ? `  <rect width="${round(totalW)}" height="${round(H)}" fill="${background}"/>\n` : ""}  <g transform="translate(${round(markX)} ${round(markY)})">
${markBody}  </g>
  <g transform="translate(${round(wordX)} ${round(wordY)}) scale(${round(wordCap, 4)})">
    ${word.svg}
  </g>
  <g transform="translate(${round(tagX)} ${round(tagY)}) scale(${round(tagCap, 4)})">
    ${tag.svg}
  </g>
</svg>
`;
}

function main() {
  const files = {
    "streamatrix-lockup.svg": lockupSvg({ glow: true }),
    "streamatrix-lockup-on-black.svg": lockupSvg({ glow: true, background: "#000000" }),
    "streamatrix-lockup-light.svg": lockupSvg({ glow: false }),
  };
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(OUT, name), body);
    console.log(`${name}  ${(body.length / 1024).toFixed(1)} KB`);
  }
  void buildDots;
  void M;
}

if (process.argv[1] && process.argv[1].endsWith("streamatrix-lockup.mjs")) main();
