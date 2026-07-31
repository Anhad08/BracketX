import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ENGINE_PACKAGES,
  NON_ENGINE_PACKAGES,
  RENDER_BACKEND_MODULE,
} from "./engine-layers.mjs";

/**
 * Executable form of the architecture's layer invariants.
 *
 * ENGINE_ARCHITECTURE.md §2 declares a strict one-directional layer rule, and
 * ARCHITECTURE_VERIFICATION.md D9 found it was documentation with nothing
 * enforcing it. These tests are that enforcement.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Workspace = { dir: string; name: string; deps: string[] };

function workspaces(): Workspace[] {
  const out: Workspace[] = [];
  for (const root of ["packages", "apps"]) {
    const abs = join(repoRoot, root);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(abs, entry);
      if (!statSync(dir).isDirectory()) continue;
      try {
        const pkg = JSON.parse(
          readFileSync(join(dir, "package.json"), "utf8"),
        ) as {
          name: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        out.push({
          dir,
          name: pkg.name,
          deps: Object.keys({
            ...(pkg.dependencies ?? {}),
            ...(pkg.devDependencies ?? {}),
          }),
        });
      } catch {
        // Not a workspace package.
      }
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", "dist", ".next", ".turbo", "drizzle"]);
  const walk = (current: string) => {
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

const ALL = workspaces();
const TOOLING = new Set([
  "@bracketx/eslint-config",
  "@bracketx/typescript-config",
]);

describe("layer model is well-formed", () => {
  it("is acyclic", () => {
    const state = new Map<string, "visiting" | "done">();
    const path: string[] = [];
    const cycles: string[] = [];

    const visit = (name: string) => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "visiting") {
        cycles.push([...path.slice(path.indexOf(name)), name].join(" -> "));
        return;
      }
      state.set(name, "visiting");
      path.push(name);
      for (const next of ENGINE_PACKAGES[name]?.allow ?? []) visit(next);
      path.pop();
      state.set(name, "done");
    };

    for (const name of Object.keys(ENGINE_PACKAGES)) visit(name);
    expect(cycles).toEqual([]);
  });

  it("only permits dependencies on packages that exist in the model", () => {
    for (const [name, rule] of Object.entries(ENGINE_PACKAGES)) {
      for (const allowed of rule.allow) {
        expect(
          Object.keys(ENGINE_PACKAGES),
          `${name} allows unknown package ${allowed}`,
        ).toContain(allowed);
      }
    }
  });

  it("keeps engine-scene a leaf", () => {
    // ENGINE_ARCHITECTURE.md §3: the document is the source of truth and must
    // be usable with no runtime, no renderer, and no I/O.
    expect(ENGINE_PACKAGES["@bracketx/engine-scene"]!.allow).toEqual([]);
  });

  it("permits exactly one package to import the render backend", () => {
    const permitted = Object.entries(ENGINE_PACKAGES).filter(
      ([, rule]) => rule.mayImportThree === true,
    );
    expect(permitted.map(([name]) => name)).toEqual([
      "@bracketx/engine-render-three",
    ]);
  });
});

describe("declared dependencies obey the layer model", () => {
  const engineWorkspaces = ALL.filter((w) => w.name in ENGINE_PACKAGES);

  it("finds every engine package on disk", () => {
    expect(engineWorkspaces.map((w) => w.name).sort()).toEqual(
      Object.keys(ENGINE_PACKAGES).sort(),
    );
  });

  it.each(engineWorkspaces.map((w) => [w.name, w] as const))(
    "%s declares no forbidden workspace dependency",
    (name, workspace) => {
      const rule = ENGINE_PACKAGES[name]!;
      const offending = workspace.deps
        .filter((d) => d.startsWith("@bracketx/") && !TOOLING.has(d))
        .filter((d) => !rule.allow.includes(d));
      expect(offending).toEqual([]);
    },
  );

  it("accounts for every workspace package in the model", () => {
    const known = new Set([
      ...Object.keys(ENGINE_PACKAGES),
      ...NON_ENGINE_PACKAGES,
    ]);
    const unaccounted = ALL.map((w) => w.name).filter((n) => !known.has(n));
    expect(unaccounted).toEqual([]);
  });
});

describe("render backend isolation", () => {
  it.each(ALL.map((w) => [w.name, w] as const))(
    "%s does not import three unless permitted",
    (name, workspace) => {
      if (ENGINE_PACKAGES[name]?.mayImportThree) return;

      const offenders = sourceFiles(workspace.dir).filter((file) => {
        const source = readFileSync(file, "utf8");
        return new RegExp(
          `from\\s+["']${RENDER_BACKEND_MODULE}(/|["'])|` +
            `import\\s*\\(\\s*["']${RENDER_BACKEND_MODULE}(/|["'])`,
        ).test(source);
      });

      expect(offenders).toEqual([]);
    },
  );

  it("does not declare three outside the render adapter", () => {
    const offenders = ALL.filter(
      (w) =>
        w.deps.includes(RENDER_BACKEND_MODULE) &&
        !ENGINE_PACKAGES[w.name]?.mayImportThree,
    ).map((w) => w.name);
    expect(offenders).toEqual([]);
  });
});

describe("packages declare the layer the model assigns them", () => {
  it.each(Object.entries(ENGINE_PACKAGES))("%s", (name, rule) => {
    const workspace = ALL.find((w) => w.name === name);
    expect(workspace, `${name} not found on disk`).toBeDefined();

    const entry = readFileSync(join(workspace!.dir, "src/index.ts"), "utf8");
    expect(entry).toContain(`layer: "${rule.layer}"`);
    expect(entry).toContain(`name: "${name}"`);
  });
});

describe("the checker script agrees with these tests", () => {
  it("exits zero on the current workspace", () => {
    // Guards against the script and the tests drifting apart — they share
    // engine-layers.mjs but implement the checks independently.
    expect(() =>
      execFileSync("node", ["tools/check-boundaries.mjs"], {
        cwd: repoRoot,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
