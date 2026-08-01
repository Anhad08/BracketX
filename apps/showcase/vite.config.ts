import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The showcase is a development tool, not a shipped product surface.
 *
 * Vite rather than Next.js deliberately: it needs instant startup and no
 * server, and keeping it framework-light is itself a check — the engine must
 * work as a plain client-side library with nothing helping it.
 */
export default defineConfig({
  plugins: [react()],
  // Pinned to IPv4: "localhost" resolves to ::1 on Windows, and tooling that
  // polls 127.0.0.1 then waits forever for a server that is already up.
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
