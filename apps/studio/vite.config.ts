import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Studio is a client-side editor.
 *
 * Vite rather than Next.js deliberately, and for a stronger reason than the
 * workbench had: an authoring environment that needed a server to open a
 * document would be an authoring environment that cannot run offline, and the
 * engine is a plain client-side library with nothing helping it.
 */
export default defineConfig({
  plugins: [react()],
  // Pinned to IPv4: "localhost" resolves to ::1 on Windows, and tooling that
  // polls 127.0.0.1 then waits forever for a server that is already up.
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
  /**
   * HarfBuzz must not be pre-bundled.
   *
   * Its WASM loader finds its binary with `new URL("harfbuzz.wasm",
   * import.meta.url)`. Pre-bundling rewrites the module and that URL then
   * resolves against the bundle rather than the package, so the request lands
   * on the SPA fallback and the browser is handed `<!doctype html>` where it
   * expected a WASM magic word:
   *
   *   CompileError: expected magic word 00 61 73 6d, found 3c 21 64 6f
   *
   * The editor then never boots — no error visible to a user, just a blank
   * page. Excluding it leaves the relative URL intact.
   */
  optimizeDeps: { exclude: ["harfbuzzjs", "@bracketx/engine-text"] },
  build: { outDir: "dist", sourcemap: true },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
