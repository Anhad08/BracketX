import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "./schema/index";
import type { Database } from "./client";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

/**
 * Every table the migrations create, ordered so a plain TRUNCATE would work
 * even without CASCADE. Kept explicit rather than discovered from the catalog
 * so that a new table added without a matching test-reset entry shows up as a
 * failing test rather than as silent cross-test bleed.
 */
export const ALL_TABLES = [
  "project",
  "invitation",
  "member",
  "session",
  "account",
  "verification",
  "organization",
  "user",
] as const;

export function connect(url: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

/** Applies the committed migrations. Same files `db:migrate` uses. */
export async function migrateTestDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/**
 * Empties every table between tests.
 *
 * CASCADE is present as a safety net, but the ordering above means it should
 * never actually be needed — if it is, a foreign key exists that the test
 * fixtures do not know about.
 */
export async function resetDatabase(db: Database): Promise<void> {
  const list = ALL_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}
