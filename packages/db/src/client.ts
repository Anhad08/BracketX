import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;

/**
 * A single pool per process. Next.js dev reloads the module graph on every
 * change, so without this the pool count climbs until Postgres refuses
 * connections.
 */
const globalForDb = globalThis as unknown as {
  __bracketxPool?: Pool;
  __bracketxDb?: Database;
};

function initialise(): Database {
  if (globalForDb.__bracketxDb) return globalForDb.__bracketxDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }

  const pool =
    globalForDb.__bracketxPool ?? new Pool({ connectionString: url });
  const instance = drizzle(pool, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__bracketxPool = pool;
    globalForDb.__bracketxDb = instance;
  }

  return instance;
}

/**
 * The Drizzle client, connected lazily on first use.
 *
 * The laziness is load-bearing, not an optimisation. This module is in the
 * import graph of every table definition, so eager construction would mean
 * `DATABASE_URL` was required merely to *import* a schema — breaking
 * `drizzle-kit`, unit tests that never touch a database, and any future
 * consumer (the render surface, the realtime service) that wants types without
 * a connection.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const real = initialise();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, property) {
    return Reflect.has(initialise(), property);
  },
});
