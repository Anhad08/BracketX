/**
 * Inlines the walkthrough screenshots into the summary page as data URIs.
 *
 * A published artifact may not fetch anything, so the pictures have to travel
 * inside the file. Done by script rather than by hand because base64 of two
 * megabytes of PNG is not something to type.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const shots = fileURLToPath(new URL("../../../apps/studio/shots/p1/", import.meta.url));

const IMAGES = {
  __IMG_FILLIN__: "01-fill-in.png",
  __IMG_BUILD__: "02-build.png",
  __IMG_COMPOSITE__: "06-program-composite.png",
  __IMG_PALETTE__: "04-palette-channels.png",
};

let html = readFileSync(`${here}rebuild-summary.template.html`, "utf8");

for (const [token, file] of Object.entries(IMAGES)) {
  const bytes = readFileSync(`${shots}${file}`);
  html = html.replace(token, `data:image/png;base64,${bytes.toString("base64")}`);
  console.log(`${file} → ${(bytes.length / 1024).toFixed(0)} KB`);
}

const left = html.match(/__IMG_[A-Z]+__/g);
if (left !== null) throw new Error(`unreplaced tokens: ${left.join(", ")}`);

writeFileSync(`${here}rebuild-summary.html`, html);
console.log(`written: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
