/**
 * Reads the live database's actual structure out of pg_catalog.
 *
 *   DATABASE_URL=... node scripts/introspect.mjs
 *
 * This exists so schema claims are verified against the server rather than
 * against the Drizzle source that was supposed to produce it.
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const client = new Client(url);
await client.connect();

const q = async (sql) => (await client.query(sql)).rows;

console.log("=== TABLES ===");
for (const r of await q(`
  select tablename from pg_tables
  where schemaname = 'public' order by tablename
`)) {
  console.log(" ", r.tablename);
}

console.log("\n=== COLUMN TYPES (timestamp variants only) ===");
for (const r of await q(`
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and data_type like 'timestamp%'
  order by table_name, column_name
`)) {
  console.log(
    `  ${r.table_name}.${r.column_name}: ${r.data_type} (nullable=${r.is_nullable})`,
  );
}

console.log("\n=== FOREIGN KEYS (with ON DELETE action) ===");
for (const r of await q(`
  select
    con.conname as name,
    src.relname as from_table,
    (select string_agg(att.attname, ',' order by att.attnum)
       from unnest(con.conkey) k
       join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k) as from_cols,
    tgt.relname as to_table,
    case con.confdeltype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'   when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT' end as on_delete
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  where con.contype = 'f'
  order by src.relname, con.conname
`)) {
  console.log(
    `  ${r.from_table}(${r.from_cols}) -> ${r.to_table}  ON DELETE ${r.on_delete}`,
  );
}

console.log("\n=== UNIQUE CONSTRAINTS ===");
for (const r of await q(`
  select con.conname as name, rel.relname as table_name,
    (select string_agg(att.attname, ',' order by att.attnum)
       from unnest(con.conkey) k
       join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k) as cols
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where con.contype = 'u' and n.nspname = 'public'
  order by rel.relname, con.conname
`)) {
  console.log(`  ${r.table_name}(${r.cols})  [${r.name}]`);
}

console.log("\n=== INDEXES ===");
for (const r of await q(`
  select tablename, indexname, indexdef
  from pg_indexes where schemaname = 'public'
  order by tablename, indexname
`)) {
  const kind = r.indexdef.includes("UNIQUE") ? "UNIQUE" : "index";
  const cols = r.indexdef.slice(r.indexdef.indexOf("("));
  console.log(`  ${r.tablename}.${r.indexname}  ${kind} ${cols}`);
}

console.log("\n=== NOT NULL / DEFAULTS on project ===");
for (const r of await q(`
  select column_name, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name='project'
  order by ordinal_position
`)) {
  console.log(
    `  ${r.column_name}: nullable=${r.is_nullable} default=${r.column_default ?? "-"}`,
  );
}

await client.end();
