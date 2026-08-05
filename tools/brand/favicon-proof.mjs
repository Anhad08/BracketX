#!/usr/bin/env node
/** Favicons at true size and magnified — the only way to judge a 16px mark. */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "brand", "streamatrix");
const sizes = [16, 32, 48, 64, 128];
const cell = (s, zoom, bg) =>
  `<div style="text-align:center">
     <img src="png/favicon-${s}.png" width="${s * zoom}" style="image-rendering:pixelated;background:${bg}">
     <div style="margin-top:8px;font:11px ui-sans-serif;color:#888">${s}px${zoom > 1 ? ` ·${zoom}×` : ""}</div>
   </div>`;

const page = `<!doctype html><body style="margin:0;background:#0b0d12;padding:30px;font:12px ui-sans-serif;color:#9aa">
<div style="color:#ccc;margin-bottom:14px">TRUE SIZE — on dark, on light</div>
<div style="display:flex;gap:26px;align-items:flex-end;background:#0b0d12;padding:14px">${sizes.map((s) => cell(s, 1, "transparent")).join("")}</div>
<div style="display:flex;gap:26px;align-items:flex-end;background:#fff;padding:14px">${sizes.map((s) => cell(s, 1, "transparent")).join("")}</div>
<div style="color:#ccc;margin:22px 0 14px">MAGNIFIED — same pixels, 6×</div>
<div style="display:flex;gap:26px;align-items:flex-end">${sizes.slice(0, 4).map((s) => cell(s, 6, "transparent")).join("")}</div>
</body>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 900 } });
await p.goto("file:///" + DIR.split("\\").join("/") + "/");
await p.setContent(page);
mkdirSync(join(DIR, "png"), { recursive: true });
await p.screenshot({ path: join(DIR, "png", "_favicon-proof.png"), fullPage: true });
await b.close();
console.log("favicon proof → brand/streamatrix/png/_favicon-proof.png");
