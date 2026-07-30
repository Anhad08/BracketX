import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * Next only reads .env files inside its own directory, but BracketX keeps one
 * .env at the repo root so `drizzle-kit`, the dev Postgres script, and this app
 * cannot disagree about DATABASE_URL. Loading it here keeps that single source
 * of truth without duplicating secrets into apps/web.
 *
 * process.loadEnvFile is built into Node, so this needs no dependency. Real
 * environment variables always win — it does not overwrite what is already set,
 * so hosted deployments are unaffected.
 */
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
