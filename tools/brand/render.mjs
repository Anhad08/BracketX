#!/usr/bin/env node
/**
 * Rasterise the Streamatrix brand SVGs through Chromium, so the exported PNGs
 * match what a browser shows — filters, blend and all — rather than what a
 * second SVG engine guesses.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "brand", "streamatrix");
const PNG = join(DIR, "png");

/** Targets: [svg, output, width, background]. */
const TARGETS = [
  ["streamatrix-lockup-on-black.svg", "streamatrix-lockup-2048.png", 2048, null],
  ["streamatrix-lockup.svg", "streamatrix-lockup-transparent-1536.png", 1536, null],
  ["streamatrix-mark.svg", "streamatrix-mark-2048.png", 2048, null],
  ["streamatrix-mark.svg", "streamatrix-mark-1024.png", 1024, null],
  ["streamatrix-mark.svg", "streamatrix-mark-on-dark-2048.png", 2048, "#05060a"],
  ["streamatrix-mark-light.svg", "streamatrix-mark-light-2048.png", 2048, null],
  ["streamatrix-mark-light.svg", "streamatrix-mark-on-light-2048.png", 2048, "#ffffff"],
  ["streamatrix-mark-black.svg", "streamatrix-mark-black-1024.png", 1024, null],
  ["streamatrix-mark-white.svg", "streamatrix-mark-white-1024.png", 1024, null],
  ["streamatrix-icon.svg", "streamatrix-icon-1024.png", 1024, null],
  ["streamatrix-icon.svg", "streamatrix-icon-512.png", 512, null],
  ["streamatrix-icon.svg", "streamatrix-icon-256.png", 256, null],
  ["streamatrix-icon.svg", "streamatrix-icon-180.png", 180, null],
  ["streamatrix-icon.svg", "streamatrix-icon-128.png", 128, null],
  // Each favicon size renders from its OWN hinted SVG, never from one scaled
  // down — that is the whole point of the per-size matrix.
  ["streamatrix-favicon-128.svg", "favicon-128.png", 128, null],
  ["streamatrix-favicon.svg", "favicon-64.png", 64, null],
  ["streamatrix-favicon-48.svg", "favicon-48.png", 48, null],
  ["streamatrix-favicon-32.svg", "favicon-32.png", 32, null],
  ["streamatrix-favicon-16.svg", "favicon-16.png", 16, null],
];

function viewBoxOf(svg) {
  const m = svg.match(/viewBox="([\d.\-\s]+)"/);
  return m[1].trim().split(/\s+/).map(Number);
}

async function shoot(page, svgPath, outPath, width, bg) {
  const svg = readFileSync(svgPath, "utf8");
  const [, , vw, vh] = viewBoxOf(svg);
  const height = Math.round((width * vh) / vw);
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${bg ?? "transparent"}">` +
      svg.replace("<svg ", `<svg width="${width}" height="${height}" `) +
      `</body></html>`,
  );
  await page.screenshot({ path: outPath, omitBackground: !bg });
  return `${width}×${height}`;
}

/** A minimal ICO container. Windows still wants one, and it is 30 lines. */
function buildIco(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const dir = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
mkdirSync(PNG, { recursive: true });

for (const [svg, out, width, bg] of TARGETS) {
  const dims = await shoot(page, join(DIR, svg), join(PNG, out), width, bg);
  console.log(`${out.padEnd(38)} ${dims}`);
}

await browser.close();

writeFileSync(
  join(DIR, "favicon.ico"),
  buildIco(
    [16, 32, 48, 64].map((size) => ({
      size,
      data: readFileSync(join(PNG, `favicon-${size}.png`)),
    })),
  ),
);
console.log("favicon.ico".padEnd(38) + "16/32/48/64");

console.log("\n" + readdirSync(PNG).length + " PNGs in brand/streamatrix/png");
