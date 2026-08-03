/**
 * Studio's view of the RTGFX Asset System. IF-006.
 *
 * ============================================================================
 * RECORDS PERSIST SEPARATELY FROM BYTES, ON PURPOSE
 * ============================================================================
 * Bytes go to IndexedDB; records go to the workspace preference store. That
 * split is the same one the asset model makes, and it buys the property the
 * brief asks for directly: the Asset Browser lists a library of thousands by
 * reading records only, and touches a byte range solely when something is
 * previewed or drawn.
 *
 * It is also what makes cloud sync tractable later — records are small, diffable
 * and mergeable, while bytes are immutable and addressed by content, so the two
 * halves sync by completely different and much simpler rules.
 */
import type { SceneDocument, SceneNode } from "@bracketx/engine-scene";
import { thumbnail } from "@bracketx/engine-image";
import {
  hashBytes,
  type AssetKind,
  type AssetRecord,
  type AssetRegistry,
} from "@bracketx/engine-assets";

const RECORDS_KEY = "streamatrix.studio.assets.v1";

/** Kinds Streamatrix can read TODAY. IF-006 §2 lists what is deferred. */
export const READABLE_KINDS: readonly AssetKind[] = ["image", "font"];

/**
 * Categories the Asset Browser shows.
 *
 * Only what is real. IF-006 §6 records the disagreement with the brief on this
 * and the reasoning: Phase 3A settled that a tool exists only when the engine
 * can draw what its name says, and a permanently empty Videos tab teaches a
 * user to distrust the whole panel.
 */
export interface AssetCategory {
  readonly kind: AssetKind;
  readonly label: string;
}

export const ASSET_CATEGORIES: readonly AssetCategory[] = [
  { kind: "image", label: "Images" },
  { kind: "font", label: "Typefaces" },
];

export function loadAssetRecords(
  storage: Pick<Storage, "getItem"> | null,
): readonly AssetRecord[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(RECORDS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filtered rather than trusted: a preference store is user-writable and a
    // malformed record must not reach the registry.
    return parsed.filter(
      (entry): entry is AssetRecord =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as AssetRecord).id === "string" &&
        typeof (entry as AssetRecord).hash === "string",
    );
  } catch {
    return [];
  }
}

export function saveAssetRecords(
  storage: Pick<Storage, "setItem"> | null,
  records: readonly AssetRecord[],
): void {
  if (storage === null) return;
  try {
    // Only what a user brought. Shipped assets are re-registered at boot from
    // code, so persisting them would fossilise a version of the starter library
    // that a later release has moved on from.
    const own = records.filter((record) => record.origin !== "shipped");
    storage.setItem(RECORDS_KEY, JSON.stringify(own));
  } catch {
    // Quota or a blocked store. The session still works.
  }
}

/**
 * Every asset id a document references.
 *
 * Walks components rather than trusting `document.assets`, because that list is
 * what the document DECLARES and this is what it USES — and the difference
 * between the two is exactly what a broken-reference check exists to find.
 *
 * A bound `assetId` resolves through the variable's default, which is the value
 * the graphic carries when nothing is overriding it on air.
 */
export function referencedAssets(document: SceneDocument): readonly string[] {
  const defaults = new Map(
    document.variables.map((variable) => [variable.key, variable.default]),
  );
  const found = new Set<string>();

  const visit = (node: SceneNode): void => {
    for (const component of node.components ?? []) {
      if (component.type !== "image") continue;
      const raw = (component.props as { assetId?: unknown } | undefined)?.assetId;
      const resolved =
        typeof raw === "object" && raw !== null && "$var" in raw
          ? defaults.get((raw as { $var: string }).$var)
          : raw;
      if (typeof resolved === "string" && resolved.length > 0) found.add(resolved);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.root);

  return [...found];
}

/**
 * A thumbnail as a data URL, drawn from the pixels that are on air.
 *
 * Goes through a canvas because that is the only way to get an encoded image
 * out of raw texels in a browser, and a data URL because it is the only form
 * an `<img>` can hold without a lifetime to manage — an object URL would need
 * revoking, and a library re-rendering on every keystroke would leak one per
 * tile per render.
 *
 * Returns null rather than throwing when there is no canvas: a headless test
 * and a locked-down webview both hit that path, and a missing thumbnail must
 * cost a tile its picture rather than the panel its render.
 */
export function thumbnailUrl(image: {
  width: number;
  height: number;
  pixels: Uint8Array;
}): string | null {
  try {
    const thumb = thumbnail(image, 96);
    const canvas = document.createElement("canvas");
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    // `createImageData` then `set`, rather than the `ImageData` constructor:
    // the constructor's typed-array overload disagrees with the DOM lib across
    // TypeScript versions, and this form is stable and one allocation cheaper.
    const target = context.createImageData(thumb.width, thumb.height);
    target.data.set(thumb.pixels);
    context.putImageData(target, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export type ImportResult =
  | { readonly ok: true; readonly record: AssetRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * Brings a user's file into the asset system.
 *
 * The whole import path, and deliberately short: hash, store, register,
 * resolve. Everything interesting — dedup, format detection, budget, metadata —
 * happens because of decisions already made in the registry rather than here.
 *
 * Re-importing the same file returns the EXISTING record rather than making a
 * second one. A designer who drags the same logo in twice has not created two
 * assets, and pretending otherwise is how a library becomes unusable.
 */
export async function importAsset(
  registry: AssetRegistry,
  file: { name: string; type: string; bytes: Uint8Array },
  now: string,
  newId: () => string,
): Promise<ImportResult> {
  const hash = hashBytes(file.bytes);

  const existing = registry.records().find((record) => record.hash === hash);
  if (existing !== undefined) return { ok: true, record: existing };

  const codec = registry.codecFor(file.bytes, file.type);
  if (codec === undefined) {
    return {
      ok: false,
      reason: `Streamatrix cannot read ${describe(file.name)} yet.`,
    };
  }

  await registry.store.put(hash, file.bytes);

  const record: AssetRecord = {
    id: newId(),
    kind: codec.kind,
    hash,
    mime: file.type === "" ? codec.mimes[0]! : file.type,
    // The file's name without its extension: a user thinks about "Team Badge",
    // not about `team-badge-final-v3.png`.
    name: displayName(file.name),
    bytes: file.bytes.length,
    origin: "imported",
    createdAt: now,
    updatedAt: now,
    tags: [],
    collections: [],
    favorite: false,
    metadata: {},
    history: [],
  };
  registry.register(record);

  // Decoded immediately, so a failure is reported at import — where the user is
  // looking — rather than as a graphic that silently draws nothing later.
  const resolved = await registry.resolve(record.id);
  if (!resolved.ok) {
    registry.unregister(record.id);
    return { ok: false, reason: resolved.reason };
  }

  registry.register({ ...record, metadata: resolved.asset.metadata });
  return { ok: true, record: registry.record(record.id)! };
}

function displayName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension.length === 0 ? fileName : withoutExtension;
}

function describe(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName);
  return match === null ? "that file" : `.${match[1]!.toLowerCase()} files`;
}
