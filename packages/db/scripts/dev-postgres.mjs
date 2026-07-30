/**
 * Starts a real local PostgreSQL 17 server for development, without Docker.
 *
 * `docker compose up -d` at the repo root remains the primary path. This exists
 * because Docker Desktop needs admin rights, WSL2, and a reboot on Windows,
 * which is a lot to demand before someone can run the test suite. These are
 * genuine native PostgreSQL binaries, not an emulation.
 *
 *   node scripts/dev-postgres.mjs          start (foreground, Ctrl-C to stop)
 *   node scripts/dev-postgres.mjs --reset  wipe the data directory first
 *
 * Data lives in packages/db/.pgdata and is gitignored.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", ".pgdata");

const PORT = Number(process.env.PGPORT ?? 5432);
const DATABASE = "bracketx";

const reset = process.argv.includes("--reset");
if (reset && existsSync(dataDir)) {
  console.log("resetting data directory...");
  rmSync(dataDir, { recursive: true, force: true });
}

const alreadyInitialised = existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

if (!alreadyInitialised) {
  console.log("initialising cluster...");
  await pg.initialise();
}

console.log(`starting postgres on :${PORT} ...`);
await pg.start();

if (!alreadyInitialised) {
  console.log(`creating database "${DATABASE}" ...`);
  await pg.createDatabase(DATABASE);
}

console.log(
  `\nready → postgresql://postgres:postgres@localhost:${PORT}/${DATABASE}\n` +
    "Ctrl-C to stop.\n",
);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("\nstopping postgres...");
  await pg.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Hold the process open.
await new Promise(() => {});
