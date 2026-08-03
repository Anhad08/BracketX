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
import { hashBytes, type AssetRegistry } from "@bracketx/engine-assets";

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
 * Fetches and registers every shipped image.
 *
 * An image that fails to fetch is SKIPPED rather than fatal, and the ids that
 * loaded are returned. A missing logo should cost a graphic its mark, not the
 * editor's ability to start — which is exactly what the font loader does and
 * for the same reason.
 */
export async function loadStudioImages(
  registry: AssetRegistry,
  fetcher: typeof fetch = fetch,
  now = "1970-01-01T00:00:00.000Z",
): Promise<readonly string[]> {
  const loaded: string[] = [];
  await Promise.all(
    STUDIO_IMAGES.map(async (image) => {
      try {
        const response = await fetcher(image.url);
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = hashBytes(bytes);
        await registry.store.put(hash, bytes);
        registry.register({
          id: image.assetId,
          kind: "image",
          hash,
          mime: "image/png",
          name: image.label,
          bytes: bytes.length,
          // `shipped`, so it is never persisted as a user record and never
          // offered for deletion — it would return on the next launch.
          origin: "shipped",
          createdAt: now,
          updatedAt: now,
          tags: ["logo"],
          collections: [],
          favorite: false,
          metadata: {},
          history: [],
        });
        const resolved = await registry.resolve(image.assetId);
        if (!resolved.ok) return;
        // Metadata comes from the DECODE, so it is written back once the codec
        // has actually read the file rather than guessed from the URL.
        registry.register({
          ...registry.record(image.assetId)!,
          metadata: resolved.asset.metadata,
        });
        loaded.push(image.assetId);
      } catch {
        // Offline, blocked, or missing. The editor still opens.
      }
    }),
  );
  return loaded;
}
