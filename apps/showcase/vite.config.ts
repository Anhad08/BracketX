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
  server: { port: 5180, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
