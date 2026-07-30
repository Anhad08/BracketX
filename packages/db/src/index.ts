export { db, type Database } from "./client";
export * as schema from "./schema/index";
export * from "./schema/index";

// Re-exported so consumers can build queries without depending on drizzle-orm
// directly, which keeps the version pinned in one place.
export { and, eq, sql } from "drizzle-orm";
