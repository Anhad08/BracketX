/**
 * Images Studio ships with, and images a user brings.
 *
 * ============================================================================
 * AN IMAGE IS AN ASSET, NOT A URL
 * ============================================================================
 * The same argument fonts settled in `fonts.ts`: SCENE_FORMAT declares images
 * as assets and the engine loads binaries, because a URL resolves differently
 * on each target and because a document that references a URL is a document
 * whose logo can disappear. So Studio fetches BYTES and hands them over.
 *
 * Assets are content-addressed. Two packages shipping the same sponsor mark
 * decode it once and upload it once, however many asset ids point at it.
 */
import type { HostImageProvider } from "@bracketx/engine-host/image";

export interface StudioImage {
  /** The asset id a document references. */
  readonly assetId: string;
  readonly label: string;
  readonly url: string;
}

export const STUDIO_IMAGES: readonly StudioImage[] = [
  { assetId: "ast_sponsor_mark", label: "Sponsor Mark", url: "/images/sponsor-mark.png" },
];

/**
 * Content hash for an asset's bytes.
 *
 * FNV-1a rather than SHA-256: this is a CACHE key, not a security boundary, and
 * `crypto.subtle.digest` is async and unavailable over plain HTTP on some
 * targets. A collision costs one wrongly-shared texture; the cost of pulling in
 * a hash implementation for it is not worth paying.
 */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16)}:${bytes.length}`;
}

/**
 * Fetches and registers every shipped image.
 *
 * An image that fails to fetch is SKIPPED rather than fatal, and the ids that
 * loaded are returned. A missing logo should cost a graphic its mark, not the
 * editor's ability to start — which is exactly what the font loader does and
 * for the same reason.
 */
export async function loadStudioImages(
  provider: HostImageProvider,
  fetcher: typeof fetch = fetch,
): Promise<readonly string[]> {
  const loaded: string[] = [];
  await Promise.all(
    STUDIO_IMAGES.map(async (image) => {
      try {
        const response = await fetcher(image.url);
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const result = await provider.load(image.assetId, hashBytes(bytes), bytes);
        if (result.ok) loaded.push(image.assetId);
      } catch {
        // Offline, blocked, or missing. The editor still opens.
      }
    }),
  );
  return loaded;
}
