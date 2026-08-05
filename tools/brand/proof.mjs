#!/usr/bin/env node
/**
 * A proof sheet. Logos are judged at size, next to each other, on both grounds —
 * so review them that way rather than one PNG at a time.
 */

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "brand", "streamatrix");
const read = (f) => readFileSync(join(DIR, f), "utf8").replace(/<svg /, "<svg ");

const sized = (f, w) => read(f).replace("<svg ", `<svg width="${w}" `);

const page = `<!doctype html><html><body style="margin:0;background:#08090c;font:12px ui-sans-serif,system-ui;color:#8a8f9a">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
  <div style="padding:28px;display:grid;place-items:center;background:#000">
    <div>${sized("streamatrix-mark-solid.svg", 380)}</div>
    <div style="margin-top:8px">SILHOUETTE — pure geometry</div>
  </div>
  <div style="padding:28px;display:grid;place-items:center;background:#05060a">
    <div>${sized("streamatrix-mark.svg", 420)}</div>
    <div style="margin-top:8px">MARK on black</div>
  </div>
  <div style="padding:28px;display:grid;place-items:center;background:#ffffff">
    <div>${sized("streamatrix-mark-light.svg", 420)}</div>
    <div style="margin-top:8px;color:#666">MARK (light version) on white</div>
  </div>
  <div style="padding:28px;display:grid;place-items:center;background:#12141a">
    <div style="display:flex;gap:20px;align-items:center">
      ${sized("streamatrix-icon.svg", 150)}
      ${sized("streamatrix-icon.svg", 76)}
      ${sized("streamatrix-icon.svg", 40)}
    </div>
    <div style="display:flex;gap:20px;align-items:flex-end;margin-top:22px">
      <img src="png/favicon-128.png" width="128">
      <img src="png/favicon-64.png" width="64">
      <img src="png/favicon-32.png" width="32">
      <img src="png/favicon-16.png" width="16">
      <img src="png/favicon-16.png" width="16" style="image-rendering:pixelated;width:48px">
    </div>
    <div style="margin-top:10px">ICON 150/76/40 · FAVICON 128/64/32/16 (+16 zoomed 3×)</div>
  </div>
  <div style="padding:28px;background:#0d0f14;grid-column:1/-1">
    <div style="display:flex;gap:34px;align-items:flex-end;justify-content:center">
      <img src="png/streamatrix-icon-512.png" width="128">
      <img src="png/streamatrix-icon-128.png" width="64">
      <img src="png/favicon-64.png" width="64">
      <img src="png/favicon-32.png" width="32">
      <img src="png/favicon-16.png" width="16">
    </div>
    <div style="margin-top:14px;text-align:center">SCALE LADDER — icon 128/64 · favicon 64/32/16, all at true size</div>
  </div>
  <div style="padding:28px;display:grid;place-items:center;background:#ffffff">
    <div>${sized("streamatrix-mark-black.svg", 340)}</div>
    <div style="margin-top:8px;color:#666">BLACK</div>
  </div>
  <div style="padding:28px;display:grid;place-items:center;background:#3b3f4a">
    <div>${sized("streamatrix-mark-white.svg", 340)}</div>
    <div style="margin-top:8px">WHITE</div>
  </div>
</div></body></html>`;

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1100, height: 1580 } });
mkdirSync(join(DIR, "png"), { recursive: true });
await p.goto("file:///" + join(DIR).replace(/\\/g, "/") + "/");
await p.setContent(page);
await p.addStyleTag({ content: "body{}" });
await p.screenshot({ path: join(DIR, "png", "_proof.png"), fullPage: true });
await browser.close();
console.log("proof → brand/streamatrix/png/_proof.png");
