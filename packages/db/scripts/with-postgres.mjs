/**
 * Runs a command with DATABASE_URL guaranteed to point at a migrated database.
 *
 *   node scripts/with-postgres.mjs -- vitest run --config vitest.integration.config.ts
 *
 * If DATABASE_URL is already set (CI with a Postgres service container, or a
 * developer running `docker compose up -d`) it is used as-is. Otherwise a real
 * PostgreSQL 17 server is started on an ephemeral port, migrated, used, and
 * torn down — so integration tests need no Docker and no global install.
 *
 * Migrations are applied here rather than in test setup so that a migration
 * failure is reported as a setup error, not as every test failing at once.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Runs a child process, resolving with its exit code. */
function run(argv, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
    child.on("error", (error) => {
      console.error("[with-postgres]", error);
      resolvePromise(1);
    });
  });
}

const argv = process.argv.slice(2);
const command = argv[0] === "--" ? argv.slice(1) : argv;
if (command.length === 0) {
  console.error("usage: with-postgres.mjs -- <command> [args...]");
  process.exit(2);
}

let server = null;
let dataDir = null;
let url = process.env.DATABASE_URL ?? null;

async function startEphemeral() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  // Ephemeral, well outside the range a developer's own services would use.
  const port = 55000 + Math.floor(Math.random() * 2000);
  dataDir = mkdtempSync(join(tmpdir(), "bracketx-pg-"));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("bracketx_test");

  server = pg;
  return `postgresql://postgres:postgres@localhost:${port}/bracketx_test`;
}

async function cleanup() {
  if (server) {
    try {
      await server.stop();
    } catch {
      // Best effort — the process is exiting anyway.
    }
    server = null;
  }
  if (dataDir && existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows sometimes holds the file handle briefly after stop.
    }
    dataDir = null;
  }
}

let exitCode = 0;
try {
  if (url) {
    console.log("[with-postgres] using existing DATABASE_URL");
  } else {
    console.log("[with-postgres] no DATABASE_URL — starting embedded postgres");
    url = await startEphemeral();
  }

  // Deliberately the same command a developer runs, rather than a programmatic
  // re-implementation — so the committed migration path is what gets tested.
  console.log("[with-postgres] applying migrations...");
  const migrateCode = await run(["pnpm", "exec", "drizzle-kit", "migrate"], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
  });
  if (migrateCode !== 0) {
    throw new Error(`drizzle-kit migrate failed with exit code ${migrateCode}`);
  }
  console.log("[with-postgres] ready");

  exitCode = await run(command, {
    env: { ...process.env, DATABASE_URL: url },
  });
} catch (error) {
  console.error("[with-postgres] setup failed:", error);
  exitCode = 1;
} finally {
  await cleanup();
}

process.exit(exitCode);
