/**
 * Templates and the asset library.
 *
 * ============================================================================
 * A TEMPLATE IS A SCENE DOCUMENT THAT DECLARES ITS PARAMETERS
 * ============================================================================
 * SCENE_FORMAT §11.3 already has `template: { id, name, parameters }`, and
 * TemplateParameter says a parameter "becomes a variable at instantiation". So
 * saving as a template is not a new file type, a new store or a new concept —
 * it is one operation that writes `document.template`, derived from the
 * variables the designer already declared.
 *
 * That is the whole feature, and it is deliberately that small. The version
 * with a `.template` wrapper, its own registry and a converter is the version
 * where a template stops being loadable by the engine, the renderer, the
 * importer and the Marketplace, all of which read SCENE_FORMAT and nothing else.
 *
 * ============================================================================
 * THE LIBRARY IS AN INDEX, NOT A FORMAT
 * ============================================================================
 * What is stored is canonical JSON plus the fields a browser needs to show a
 * card. Every one of those fields is READ BACK OUT of the document rather than
 * maintained beside it, so a library entry cannot drift from the graphic it
 * describes — the failure every asset manager eventually has.
 */
import {
  canonicalize,
  makeSetDocProp,
  type SceneDocument,
  type SceneToken,
  type TemplateDefinition,
  type TemplateParameter,
  type Transaction,
} from "@bracketx/engine-scene";

import { transaction } from "./editing";
import type { IdFactory } from "./ids";
import { parseDocument, type ProjectStorage } from "./project";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function isTemplate(document: SceneDocument): boolean {
  return document.template !== undefined;
}

/**
 * Declares the document a template, with a parameter per variable.
 *
 * Every variable becomes a parameter, because a variable IS the thing a
 * template exposes — a variable nobody is meant to set is a variable that
 * should have been a literal. Offering a subset would mean the designer
 * maintains two lists that must agree, and they will not.
 *
 * `required` is set for a variable whose default is null or absent: a template
 * that ships a blank name should refuse to air rather than air a blank name.
 */
export function promoteToTemplate(
  document: SceneDocument,
  name: string,
  ids: IdFactory,
): Transaction {
  const parameters: readonly TemplateParameter[] = document.variables.map(
    (variable) => ({
      key: variable.key,
      type: variable.type,
      ...(variable.label === undefined ? {} : { label: variable.label }),
      ...(variable.default === undefined || variable.default === null
        ? { required: true }
        : { default: variable.default }),
    }),
  );

  const definition: TemplateDefinition = {
    // Reuse the existing id when there is one, so re-saving a template updates
    // it rather than minting a second identity for the same graphic.
    id: document.template?.id ?? ids("template"),
    name,
    parameters,
  };
  return transaction("Save as template", [
    makeSetDocProp(document, "template", definition),
  ]);
}

/** Makes it an ordinary scene again. The variables stay; only the claim goes. */
export function demoteTemplate(document: SceneDocument): Transaction | null {
  if (document.template === undefined) return null;
  return transaction("Remove template", [
    makeSetDocProp(document, "template", undefined),
  ]);
}

/**
 * Parameters whose variable no longer exists, or whose type stopped matching.
 *
 * A template drifts the moment somebody renames a variable, and the failure
 * shows up as an instantiation that silently ignores a parameter — which looks
 * like the data feed is broken. Surfaced as a list rather than fixed
 * automatically: which of the two the designer meant is not knowable here.
 */
export function templateDrift(document: SceneDocument): readonly string[] {
  const template = document.template;
  if (template === undefined) return [];

  const byKey = new Map(document.variables.map((entry) => [entry.key, entry]));
  const problems: string[] = [];

  for (const parameter of template.parameters) {
    const variable = byKey.get(parameter.key);
    if (variable === undefined) {
      problems.push(`parameter "${parameter.key}" has no variable`);
      continue;
    }
    if (variable.type !== parameter.type) {
      problems.push(
        `parameter "${parameter.key}" is ${parameter.type}, its variable is ${variable.type}`,
      );
    }
  }
  for (const variable of document.variables) {
    if (!template.parameters.some((entry) => entry.key === variable.key)) {
      problems.push(`variable "${variable.key}" is not a parameter`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Design tokens — the colour and spacing half of the asset library
// ---------------------------------------------------------------------------

/**
 * Sets a design token.
 *
 * Tokens live in the DOCUMENT, not in an editor preference store, and that is
 * the point: a brand colour is part of the graphic. A palette kept beside the
 * file would not survive being sent to another designer, opened on the gallery
 * machine, or instantiated by the Marketplace — and a lower third whose accent
 * colour depends on who opened it is not a template.
 *
 * They resolve BENEATH variables (§11.2), so a token named `color.primary` is
 * the default and a variable of the same name overrides it. One chain, so there
 * is nothing to reconcile.
 */
export function setToken(
  document: SceneDocument,
  token: SceneToken,
): Transaction | null {
  const tokens = [...(document.tokens ?? [])];
  const index = tokens.findIndex((entry) => entry.name === token.name);
  if (index >= 0) {
    if (
      tokens[index]!.value === token.value &&
      tokens[index]!.description === token.description
    ) {
      return null;
    }
    tokens[index] = token;
  } else {
    tokens.push(token);
  }
  // Sorted by name, so two documents with the same palette are the same bytes
  // whatever order the designer typed them in.
  tokens.sort((a, b) => a.name.localeCompare(b.name));
  return transaction(`Set ${token.name}`, [
    makeSetDocProp(document, "tokens", tokens),
  ]);
}

/**
 * Merges several tokens in one operation.
 *
 * "Add the starter palette" is one gesture and must be one undo step. Calling
 * `setToken` seven times would be seven, and undoing a palette one colour at a
 * time is the kind of thing that makes people stop using undo.
 */
export function setTokens(
  document: SceneDocument,
  incoming: readonly SceneToken[],
  label = "Add tokens",
): Transaction | null {
  const byName = new Map((document.tokens ?? []).map((token) => [token.name, token]));
  let changed = false;
  for (const token of incoming) {
    const current = byName.get(token.name);
    if (current?.value === token.value && current?.description === token.description) continue;
    byName.set(token.name, token);
    changed = true;
  }
  if (!changed) return null;

  const tokens = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return transaction(label, [makeSetDocProp(document, "tokens", tokens)]);
}

export function removeToken(
  document: SceneDocument,
  name: string,
): Transaction | null {
  const tokens = (document.tokens ?? []).filter((entry) => entry.name !== name);
  if (tokens.length === (document.tokens ?? []).length) return null;
  return transaction(`Remove ${name}`, [
    makeSetDocProp(document, "tokens", tokens.length === 0 ? undefined : tokens),
  ]);
}

/** Tokens whose value looks like a colour. What a swatch grid renders. */
export function colourTokens(document: SceneDocument): readonly SceneToken[] {
  return (document.tokens ?? []).filter(
    (token) => typeof token.value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(token.value),
  );
}

/**
 * A starter palette for a new scene.
 *
 * Neutral, and deliberately not "brand" anything: a designer's first act is to
 * replace these, and shipping a palette that looks finished discourages that.
 * The names are the conventional dotted form §11.2 describes, so a token
 * reference reads the same in every project.
 */
export const STARTER_TOKENS: readonly SceneToken[] = [
  { name: "color.primary", value: "#2f6feb", description: "Accent and highlights" },
  { name: "color.surface", value: "#101319", description: "Panel and bar fills" },
  { name: "color.ink", value: "#f2f5fb", description: "Foreground on surface" },
  { name: "color.muted", value: "#8a93a6", description: "Secondary foreground" },
  { name: "space.sm", value: 0.15, description: "Tight gap, world units" },
  { name: "space.md", value: 0.3, description: "Standard gap, world units" },
  { name: "space.lg", value: 0.6, description: "Section gap, world units" },
];

// ---------------------------------------------------------------------------
// The stored library
// ---------------------------------------------------------------------------

export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly isTemplate: boolean;
  readonly savedAt: string;
  /** Canonical SCENE_FORMAT JSON. The only authoritative field here. */
  readonly json: string;
}

const LIBRARY_KEY = "streamatrix.studio.library.v1";
const LIBRARY_LIMIT = 200;

/**
 * A card for a document, every field read out of the document itself.
 *
 * Nothing is passed in beside the document except the time, which the document
 * cannot know. An entry whose name was supplied separately would show the old
 * name after a rename, and nobody would ever notice which of the two was wrong.
 */
export function describeDocument(document: SceneDocument, savedAt: string): LibraryEntry {
  return {
    id: document.id,
    name: document.template?.name ?? document.meta.name,
    ...(document.meta.description === undefined
      ? {}
      : { description: document.meta.description }),
    tags: document.meta.tags ?? [],
    isTemplate: isTemplate(document),
    savedAt,
    json: canonicalize(document),
  };
}

export function loadLibrary(store: ProjectStorage | null): readonly LibraryEntry[] {
  if (store === null) return [];
  try {
    const raw = store.getItem(LIBRARY_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is LibraryEntry =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as LibraryEntry).id === "string" &&
        typeof (entry as LibraryEntry).json === "string",
    );
  } catch {
    // A corrupt store must not stop the editor opening, exactly as with recents.
    return [];
  }
}

export function saveToLibrary(
  library: readonly LibraryEntry[],
  entry: LibraryEntry,
  store: ProjectStorage | null,
): readonly LibraryEntry[] {
  // Keyed by document id, so saving twice updates rather than duplicating. A
  // library that accumulates six copies of one lower third is a library nobody
  // opens.
  const next = [entry, ...library.filter((item) => item.id !== entry.id)].slice(
    0,
    LIBRARY_LIMIT,
  );
  persist(next, store);
  return next;
}

export function removeFromLibrary(
  library: readonly LibraryEntry[],
  id: string,
  store: ProjectStorage | null,
): readonly LibraryEntry[] {
  const next = library.filter((entry) => entry.id !== id);
  persist(next, store);
  return next;
}

function persist(entries: readonly LibraryEntry[], store: ProjectStorage | null): void {
  try {
    store?.setItem(LIBRARY_KEY, JSON.stringify(entries));
  } catch {
    // Quota. The document on disk is still the truth; the library is an index.
  }
}

/**
 * Opens a library entry as a NEW document.
 *
 * Reminting the id is what makes a template a template: instantiating one twice
 * must produce two graphics, and two documents sharing an id would collide in
 * the library, in the recents list and in any future production queue. The
 * template's own id is left alone — that is the lineage, and losing it would
 * make "which template is this from?" unanswerable.
 */
export function instantiate(
  entry: LibraryEntry,
  ids: IdFactory,
  createdAt: string,
): SceneDocument {
  const document = parseDocument(entry.json);
  return {
    ...document,
    id: ids("scene"),
    meta: {
      ...document.meta,
      name: document.template?.name ?? document.meta.name,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

export function searchLibrary(
  library: readonly LibraryEntry[],
  query: string,
): readonly LibraryEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return library;
  return library.filter((entry) =>
    [entry.name, entry.description ?? "", ...entry.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}
