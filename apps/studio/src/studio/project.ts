/**
 * Projects — new, open, save, recents.
 *
 * ============================================================================
 * THERE IS NO STUDIO FILE FORMAT
 * ============================================================================
 * A `.studio` wrapper carrying the scene plus editor metadata is the obvious
 * design and it is a trap: the moment it exists, a document produced by Studio
 * is not a document the engine, the renderer, the importer or another editor
 * can read, and everything downstream needs a converter.
 *
 * So what is saved is a SCENE_FORMAT document and nothing else. Editor state —
 * which panels are open, where the viewport is, what is selected — lives in the
 * workspace store, keyed by document id, and is never written into the file.
 * Losing it costs nothing; losing portability costs everything.
 *
 * Persistence is deliberately boring: canonical JSON in, canonical JSON out,
 * validated on the way in by the engine's own `validateDocument`.
 */
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  canonicalize,
  generateKeyBetween,
  validateDocument,
  type SceneDocument,
} from "@bracketx/engine-scene";

import { makeNode } from "./editing";
import type { IdFactory } from "./ids";

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

/** A 1080p document with a camera and nothing else. */
export function newDocument(
  name: string,
  ids: IdFactory,
  createdAt = "2026-01-01T00:00:00.000Z",
): SceneDocument {
  const cameraOrder = generateKeyBetween(null, null);
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: ids("scene"),
    meta: { name, createdAt, updatedAt: createdAt },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [],
    states: [],
    root: {
      id: ids("node"),
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      // The world is 17.78 x 10 units — 16:9 at an orthographic size of 5.
      size: { width: 17.78, height: 10 },
      // A scene with no camera renders nothing and reports a missed frame per
      // output, which reads as a broken editor rather than an empty document.
      children: [makeNode("camera", cameraOrder, ids)],
    },
  };
}

/** Canonical JSON: sorted keys, so two equal documents are equal as bytes. */
export function serializeDocument(document: SceneDocument): string {
  return canonicalize(document);
}

/**
 * Parses and VALIDATES.
 *
 * A malformed document must be refused at the door with a readable reason. The
 * engine would refuse it later anyway — `SceneHost.load` projects it — but by
 * then the editor has torn down the document that was open, and "your file is
 * broken" is a much worse message when it arrives after your work is gone.
 */
export function parseDocument(json: string): SceneDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ProjectError(`not valid JSON: ${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new ProjectError("not a scene document");
  }

  const document = parsed as SceneDocument;
  if (document.format !== SCENE_FORMAT_ID) {
    throw new ProjectError(`not a ${SCENE_FORMAT_ID} document`);
  }
  if (typeof document.version !== "number") {
    throw new ProjectError("document has no version");
  }
  if (document.version > SCENE_FORMAT_VERSION) {
    // SCENE_FORMAT §13: a reader seeing a higher version must REFUSE, never
    // partially read. Partially reading is how a save silently drops fields.
    throw new ProjectError(
      `document is version ${document.version}; this build reads up to ${SCENE_FORMAT_VERSION}`,
    );
  }

  const result = validateDocument(document);
  if (!result.valid) {
    const first = result.errors[0];
    throw new ProjectError(
      `invalid document: ${first?.at ?? "?"} — ${first?.message ?? "unknown"}` +
        (result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ""),
    );
  }
  return document;
}

/** Stamps `updatedAt`. Called on save, so it is the one place time enters. */
export function touch(document: SceneDocument, at: string): SceneDocument {
  return { ...document, meta: { ...document.meta, updatedAt: at } };
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

export interface RecentProject {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  /** The document itself. Small enough to keep, and it makes reopening instant. */
  readonly json: string;
}

const RECENTS_KEY = "streamatrix.studio.recents.v1";
const RECENTS_LIMIT = 10;

export type ProjectStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): ProjectStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    localStorage.getItem(RECENTS_KEY);
    return localStorage;
  } catch {
    return null;
  }
}

export function loadRecents(
  store: ProjectStorage | null = defaultStorage(),
): readonly RecentProject[] {
  if (store === null) return [];
  try {
    const raw = store.getItem(RECENTS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentProject =>
          entry !== null &&
          typeof entry === "object" &&
          typeof (entry as RecentProject).id === "string" &&
          typeof (entry as RecentProject).json === "string",
      )
      .slice(0, RECENTS_LIMIT);
  } catch {
    // A corrupt store must not stop the editor opening. Recents are a
    // convenience; the file on disk is the truth.
    return [];
  }
}

export function rememberProject(
  recents: readonly RecentProject[],
  entry: RecentProject,
  store: ProjectStorage | null = defaultStorage(),
): readonly RecentProject[] {
  const next = [entry, ...recents.filter((item) => item.id !== entry.id)].slice(
    0,
    RECENTS_LIMIT,
  );
  try {
    store?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded on a large document. The save itself already happened.
  }
  return next;
}

export function clearRecents(store: ProjectStorage | null = defaultStorage()): void {
  store?.removeItem(RECENTS_KEY);
}

/** A stable, filesystem-safe name. No timestamp: a save must overwrite. */
export function fileNameFor(document: SceneDocument): string {
  const base = document.meta.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${base.replace(/^-+|-+$/g, "") || "untitled"}.scene.json`;
}
