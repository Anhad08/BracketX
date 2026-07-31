/**
 * Enforces the engine dependency direction and the render-backend isolation.
 *
 *   node tools/check-boundaries.mjs
 *
 * Two properties are checked, both of which the architecture depends on and
 * neither of which the type system can express:
 *
 *   1. Declared workspace dependencies match tools/engine-layers.mjs exactly.
 *   2. `three` is imported by exactly one package.
 *
 * pnpm's strict node_modules already makes an *undeclared* import a compile
 * error (proven in Phase 1e, where apps/web failed to typecheck on transitively
 * available packages). This checker covers the other direction: a dependency
 * that is declared but should not be.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENGINE_PACKAGES,
  NON_ENGINE_PACKAGES,
  RENDER_BACKEND_MODULE,
} from "./engine-layers.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

function packageDirs() {
  const roots = ["packages", "apps"];
  const dirs = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(abs, entry);
      if (!statSync(dir).isDirectory()) continue;
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        dirs.push({ dir, pkg });
      } catch {
        // No package.json — not a workspace package.
      }
    }
  }
  return dirs;
}

/** Every .ts/.tsx file under a directory, skipping build and dependency output. */
function sourceFiles(dir) {
  const out = [];
  const skip = new Set(["node_modules", "dist", ".next", ".turbo", "drizzle"]);
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (skip.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Bare module specifiers in static imports, dynamic imports, and re-exports.
 * Relative paths are irrelevant here — they cannot cross a package boundary.
 */
function importedModules(file) {
  const source = readFileSync(file, "utf8");
  const found = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith(".")) continue;
      const parts = specifier.split("/");
      found.add(
        specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0],
      );
    }
  }
  return found;
}

const packages = packageDirs();
const known = new Set([
  ...Object.keys(ENGINE_PACKAGES),
  ...NON_ENGINE_PACKAGES,
]);

// 1. Every workspace package is accounted for in the layer model.
for (const { pkg } of packages) {
  if (!known.has(pkg.name)) {
    violations.push(
      `Package "${pkg.name}" is not listed in tools/engine-layers.mjs. ` +
        `Add it to ENGINE_PACKAGES or NON_ENGINE_PACKAGES so its boundaries are declared.`,
    );
  }
}

// 2. Declared workspace dependencies obey the layer graph.
for (const { pkg } of packages) {
  const rule = ENGINE_PACKAGES[pkg.name];
  if (!rule) continue;

  const declared = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  }).filter((name) => name.startsWith("@bracketx/"));

  for (const dependency of declared) {
    // Shared tooling configs are layer-neutral by construction.
    if (
      dependency === "@bracketx/eslint-config" ||
      dependency === "@bracketx/typescript-config"
    ) {
      continue;
    }
    if (!rule.allow.includes(dependency)) {
      violations.push(
        `${pkg.name} declares a dependency on ${dependency}, which the layer ` +
          `model forbids. Allowed: ${rule.allow.join(", ") || "(none — this is a leaf)"}.`,
      );
    }
  }
}

// 3. `three` appears in exactly one package, and only the permitted one.
for (const { dir, pkg } of packages) {
  const rule = ENGINE_PACKAGES[pkg.name];
  const permitted = rule?.mayImportThree === true;

  const declaresThree = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  }).includes(RENDER_BACKEND_MODULE);

  if (declaresThree && !permitted) {
    violations.push(
      `${pkg.name} declares "${RENDER_BACKEND_MODULE}". Only ` +
        `@bracketx/engine-render-three may. See RFC-003 and IF-001.`,
    );
  }

  for (const file of sourceFiles(dir)) {
    if (!importedModules(file).has(RENDER_BACKEND_MODULE)) continue;
    if (permitted) continue;
    violations.push(
      `${file.replace(repoRoot + "\\", "").replace(repoRoot + "/", "")} ` +
        `imports "${RENDER_BACKEND_MODULE}" outside the render adapter. ` +
        `The backend must stay replaceable.`,
    );
  }
}

// 4. The layer graph is acyclic.
{
  const state = new Map();
  const stack = [];
  const visit = (name) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") {
      violations.push(
        `Dependency cycle: ${[...stack.slice(stack.indexOf(name)), name].join(" -> ")}`,
      );
      return;
    }
    state.set(name, "visiting");
    stack.push(name);
    for (const next of ENGINE_PACKAGES[name]?.allow ?? []) visit(next);
    stack.pop();
    state.set(name, "done");
  };
  for (const name of Object.keys(ENGINE_PACKAGES)) visit(name);
}

if (violations.length > 0) {
  console.error("\nEngine boundary violations:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(
    `\n${violations.length} violation(s). See docs/ENGINE_ARCHITECTURE.md §2.\n`,
  );
  process.exit(1);
}

console.log(
  `Engine boundaries OK — ${Object.keys(ENGINE_PACKAGES).length} engine ` +
    `package(s), ${packages.length} workspace package(s) checked.`,
);
