import { RenderCheck } from "./render-check";

/**
 * Phase 2.6 verification surface.
 *
 * Renders the engine's own demo scene through the full pipeline so the result
 * can be inspected by eye and asserted by the browser suite. Deliberately
 * unauthenticated: it reads no data, touches no workspace, and exists so that
 * "the engine renders its own scene format" is a claim anyone can check.
 */
export const metadata = {
  title: "Render check — BracketX",
  robots: { index: false, follow: false },
};

export default function RenderCheckPage() {
  return <RenderCheck />;
}
