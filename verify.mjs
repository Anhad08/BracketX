/* Generic artifact verifier.  node verify.mjs <file.html> [#section ...]
   Checks what has actually bitten this project: duplicate ids (getElementById
   returns the first match, so a container sharing its section's id silently
   destroys the section), sections that lost their heading or body to an
   innerHTML write, empty generated regions, overflow, console errors. */
import { chromium } from "./node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const DIR = "C:/Users/guruk/AppData/Local/Temp/claude/c--Users-guruk-bracketx/cfd57c85-b1ec-4801-bc15-27236a198fec/scratchpad";
const file = process.argv[2];
const shots = process.argv.slice(3);
const frag = fs.readFileSync(path.join(DIR, file), "utf8");
const wrapped = path.join(DIR, "_wrapped.html");

fs.writeFileSync(wrapped,
  `<!doctype html><html><head><meta charset="utf-8">` +
  (frag.match(/<title>[\s\S]*?<\/title>/) || [""])[0] +
  (frag.match(/<style>[\s\S]*?<\/style>/) || [""])[0] +
  `</head><body>` +
  frag.replace(/<title>[\s\S]*?<\/title>/, "").replace(/<style>[\s\S]*?<\/style>/, "") +
  `</body></html>`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.stack));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto("file:///" + wrapped.replace(/\\/g, "/"));
await page.waitForTimeout(500);

const fail = [];

const dupes = await page.evaluate(() => {
  const seen = {}, out = [];
  document.querySelectorAll("[id]").forEach(e => {
    seen[e.id] = (seen[e.id] || 0) + 1;
    if (seen[e.id] === 2) out.push(e.id);
  });
  return out;
});
if (dupes.length) fail.push("DUPLICATE IDS: " + dupes.join(", "));

const sections = await page.evaluate(() =>
  [...document.querySelectorAll("main section")].map(s => ({
    id: s.id,
    h2: !!s.querySelector("h2"),
    body: s.querySelectorAll(".prose, .rules, .bench, .law, .dd, .inv, .road, .states, .kzones, .qbox, .ba").length
  })));
sections.forEach(s => {
  if (!s.h2) fail.push(s.id + ": heading destroyed");
  if (!s.body) fail.push(s.id + ": body destroyed");
});

const written = [...frag.matchAll(/getElementById\("([^"]+)"\)\s*\.innerHTML\s*=/g)].map(m => m[1]);
const empties = await page.evaluate(ids =>
  ids.filter(id => { const e = document.getElementById(id); return e && !e.children.length && !e.textContent.trim(); }),
  [...new Set(written)]);
if (empties.length) fail.push("empty generated regions: " + empties.join(", "));
console.log(`generated regions: ${new Set(written).size} · all populated: ${!empties.length}`);

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 2) fail.push("body scrolls horizontally by " + overflow + "px");

console.log(`sections: ${sections.length} · all intact: ${sections.every(s => s.h2 && s.body)}`);

await page.setViewportSize({ width: 620, height: 900 });
await page.waitForTimeout(300);
const narrow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (narrow > 2) fail.push("at 620px the body scrolls horizontally by " + narrow + "px");
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(300);

// Errors first: an exception is usually the *cause* of the empty regions
// below it, so reporting it last buries the diagnosis under its symptoms.
if (errors.length) fail.unshift("errors:\n    " + errors.join("\n    "));

// Report before screenshotting: a duplicate id makes locators ambiguous, so
// the shot would crash on the very fault we are trying to report.
if (fail.length) {
  console.log("FAIL:\n  " + fail.join("\n  "));
  await browser.close();
  process.exit(1);
}

const base = file.replace(/\.html$/, "");
for (const theme of ["dark", "light"]) {
  await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(250);
  for (const id of shots) {
    await page.locator(id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(DIR, `${base}-${id.slice(1)}-${theme}.png`), animations: "disabled" });
  }
}

if (errors.length) { console.log("FAIL:\n  errors:\n  " + errors.join("\n  ")); await browser.close(); process.exit(1); }
console.log("PASS — no duplicate ids, sections intact, no overflow, no errors");
await browser.close();
