/**
 * Validation. SCENE_FORMAT §14.
 *
 * A hard boundary: an invalid document fails loudly at load and is never
 * partially rendered. Warnings do not block — a missing asset or an unknown
 * component type is survivable and must be reported without refusing the
 * document.
 */
import { isValidId } from "./ids";
import { compareOrderKeys } from "./order";
import { childrenOf, walk } from "./tree";
import { validateTemplate, validateTokens } from "./compose";
import {
  KNOWN_COMPONENT_TYPES,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  isBinding,
} from "./types";
import type { SceneDocument, SceneNode } from "./types";

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  /** Document location, e.g. `root.children[0]`. */
  readonly at: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

export function validateDocument(document: SceneDocument): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const error = (code: string, at: string, message: string) =>
    errors.push({ code, at, message });
  const warn = (code: string, at: string, message: string) =>
    warnings.push({ code, at, message });

  // -- Envelope -----------------------------------------------------------
  if (document.format !== SCENE_FORMAT_ID) {
    error("format", "format", `expected "${SCENE_FORMAT_ID}"`);
  }
  if (document.version !== SCENE_FORMAT_VERSION) {
    error("version", "version", `expected ${SCENE_FORMAT_VERSION}`);
  }
  if (!isValidId(document.id)) {
    error("id", "id", `"${String(document.id)}" is not a valid identifier`);
  }
  for (const field of ["meta", "world", "root"] as const) {
    if (!document[field]) error("required", field, `${field} is required`);
  }
  for (const field of ["variables", "assets", "states"] as const) {
    if (!Array.isArray(document[field])) {
      error("required", field, `${field} must be an array (may be empty)`);
    }
  }

  // -- World --------------------------------------------------------------
  if (document.world) {
    const { units, up, handedness, output } = document.world;
    if (units !== "meters") error("world", "world.units", `expected "meters"`);
    if (up !== "Y") error("world", "world.up", `expected "Y"`);
    if (handedness !== "right") {
      error("world", "world.handedness", `expected "right"`);
    }
    if (!output || output.width <= 0 || output.height <= 0 || output.fps <= 0) {
      error("world", "world.output", "width, height, and fps must be positive");
    }
  }

  // -- Ids are unique and correctly prefixed ------------------------------
  const nodeIds = new Set<string>();
  const componentIds = new Set<string>();

  if (document.root) {
    for (const node of walk(document.root)) {
      const at = `node:${node.id}`;

      if (!isValidId(node.id)) {
        error("id", at, `"${node.id}" is not a valid identifier`);
      }
      if (nodeIds.has(node.id)) {
        error("duplicate-id", at, `node id "${node.id}" appears more than once`);
      }
      nodeIds.add(node.id);

      if (typeof node.name !== "string") {
        error("required", at, "name is required");
      }
      if (typeof node.order !== "string" || node.order.length === 0) {
        error("required", at, "order is required");
      }

      // SCENE_FORMAT §6.2: children must be sorted by order key. Readers
      // re-sort defensively, but an unsorted array means a writer is wrong.
      const children = node.children ?? [];
      for (let i = 1; i < children.length; i += 1) {
        if (compareOrderKeys(children[i - 1]!.order, children[i]!.order) > 0) {
          error(
            "unsorted-children",
            at,
            "children are not sorted ascending by order key",
          );
          break;
        }
      }
      const seenOrders = new Set<string>();
      for (const child of children) {
        if (seenOrders.has(child.order)) {
          error(
            "duplicate-order",
            at,
            `order key "${child.order}" is used by more than one child`,
          );
        }
        seenOrders.add(child.order);
      }

      let cameraComponents = 0;
      for (const component of node.components ?? []) {
        if (!isValidId(component.id)) {
          error("id", at, `component id "${component.id}" is invalid`);
        }
        if (componentIds.has(component.id)) {
          error(
            "duplicate-id",
            at,
            `component id "${component.id}" appears more than once`,
          );
        }
        componentIds.add(component.id);

        if (component.type === "camera") cameraComponents += 1;

        if (
          !(KNOWN_COMPONENT_TYPES as readonly string[]).includes(component.type)
        ) {
          // Not an error: §13 rule 1 requires unknown types to round-trip.
          warn(
            "unknown-component",
            at,
            `component type "${component.type}" is not recognised; it will ` +
              `round-trip but will not render`,
          );
        }

        if (component.type === "text" && !("fit" in component.props)) {
          error(
            "text-fit",
            at,
            "text components must declare fit (SCENE_FORMAT §7.2)",
          );
        }
      }

      if (cameraComponents > 1) {
        error("camera", at, "a node may hold at most one camera component");
      }
    }
  }

  // -- Cycles -------------------------------------------------------------
  if (document.root && hasCycle(document.root)) {
    error("cycle", "root", "the node tree contains a cycle");
  }

  // -- Variables ----------------------------------------------------------
  const variableKeys = new Set<string>();
  const variableIds = new Set<string>();
  for (const variable of document.variables ?? []) {
    const at = `variable:${variable.id}`;
    if (!isValidId(variable.id)) {
      error("id", at, `"${variable.id}" is not a valid identifier`);
    }
    if (variableIds.has(variable.id)) {
      error("duplicate-id", at, `variable id "${variable.id}" is repeated`);
    }
    if (variableKeys.has(variable.key)) {
      error("duplicate-key", at, `variable key "${variable.key}" is repeated`);
    }
    variableIds.add(variable.id);
    variableKeys.add(variable.key);
  }

  // Tokens resolve through the same chain as variables (Project Alpha A6), so
  // a binding to one is resolvable and must not be reported as unknown.
  for (const token of document.tokens ?? []) {
    if (typeof token.name === "string") variableKeys.add(token.name);
  }
  for (const problem of validateTokens(document.tokens ?? [])) {
    error("token", "tokens", problem);
  }
  for (const problem of validateTemplate(document)) {
    error("template", "template", problem);
  }

  // -- References resolve --------------------------------------------------
  const assetIds = new Set((document.assets ?? []).map((a) => a.id));
  const stateIds = new Set((document.states ?? []).map((s) => s.id));

  /**
   * Names introduced by an enclosing `repeat`, and the nodes they cover.
   *
   * A binding inside a repeat container may reference the item name — which is
   * deliberately NOT a document variable, because it exists once per instance
   * and only inside that instance. Validating it against the flat document
   * namespace would reject every collection ever authored.
   *
   * Collected in a prepass rather than tracked during the walk, because `walk`
   * yields a flat sequence with no scope stack. SCENE_FORMAT §6.4.
   */
  const scopedNames = new Map<string, Set<string>>();
  if (document.root) {
    const collect = (node: SceneNode, inherited: Set<string>): void => {
      let names = inherited;
      if (node.repeat && typeof node.repeat.as === "string") {
        names = new Set(inherited);
        names.add(node.repeat.as);
      }
      if (names.size > 0) scopedNames.set(node.id, names);
      for (const child of childrenOf(node)) collect(child, names);
    };
    collect(document.root, new Set());
  }

  /** `player.color` is in scope when `player` is. */
  const inScope = (nodeId: string, binding: string): boolean => {
    const names = scopedNames.get(nodeId);
    if (names === undefined) return false;
    const dot = binding.indexOf(".");
    return names.has(dot > 0 ? binding.slice(0, dot) : binding);
  };

  if (document.root) {
    for (const node of walk(document.root)) {
      const at = `node:${node.id}`;

      if (node.repeat !== undefined) {
        const repeat = node.repeat;
        if (typeof repeat.source !== "string" || repeat.source.length === 0) {
          error("repeat", at, `repeat.source must be a non-empty variable key`);
        }
        if (typeof repeat.as !== "string" || repeat.as.length === 0) {
          error("repeat", at, `repeat.as must be a non-empty name`);
        }
        if ((node.children ?? []).length === 0) {
          // A container with no template produces nothing, forever, silently.
          warn("repeat", at, `repeats over "${repeat.source}" but has no template children`);
        }
        if (
          repeat.limit !== undefined &&
          (!Number.isInteger(repeat.limit) || repeat.limit < 0)
        ) {
          error("repeat", at, `repeat.limit must be a non-negative integer`);
        }
      }

      for (const component of node.components ?? []) {
        for (const [key, value] of Object.entries(component.props ?? {})) {
          if (
            isBinding(value) &&
            !variableKeys.has(value.$var) &&
            !inScope(node.id, value.$var)
          ) {
            error(
              "unresolved-binding",
              at,
              `property "${key}" binds to unknown variable "${value.$var}"`,
            );
          }
        }
        const assetId = (component.props as { assetId?: unknown }).assetId;
        if (typeof assetId === "string" && !assetIds.has(assetId)) {
          // Warning, not error: §14 lists a missing asset as survivable. It
          // renders nothing rather than blocking the document.
          warn(
            "missing-asset",
            at,
            `references asset "${assetId}", which is not in the manifest`,
          );
        }
        const font = (component.props as { font?: { assetId?: string } }).font;
        if (font?.assetId && !assetIds.has(font.assetId)) {
          warn(
            "missing-asset",
            at,
            `references font "${font.assetId}", which is not in the manifest`,
          );
        }
      }
    }
  }

  const defaultCameraId = document.world?.defaultCameraId;
  if (defaultCameraId && !nodeIds.has(defaultCameraId)) {
    error(
      "unresolved-camera",
      "world.defaultCameraId",
      `"${defaultCameraId}" is not a node in this document`,
    );
  }

  for (const state of document.states ?? []) {
    if (!isValidId(state.id)) {
      error("id", `state:${state.id}`, `"${state.id}" is not a valid identifier`);
    }
    if (typeof state.duration !== "number" || state.duration < 0) {
      error(
        "state",
        `state:${state.id}`,
        "duration must be a non-negative number",
      );
    }
  }
  void stateIds;

  // -- Numbers ------------------------------------------------------------
  for (const at of nonFinitePaths(document)) {
    error("non-finite", at, "NaN and Infinity are not valid in a document");
  }

  return { valid: errors.length === 0, errors, warnings };
}

function hasCycle(root: SceneNode): boolean {
  const seen = new Set<string>();
  const visit = (node: SceneNode): boolean => {
    if (seen.has(node.id)) return true;
    seen.add(node.id);
    for (const child of childrenOf(node)) {
      if (visit(child)) return true;
    }
    return false;
  };
  return visit(root);
}

function nonFinitePaths(value: unknown, path = ""): string[] {
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [path || "(root)"];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      nonFinitePaths(item, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      nonFinitePaths(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/** Throws on an invalid document. Warnings are returned, not thrown. */
export function assertValidDocument(
  document: SceneDocument,
): readonly ValidationIssue[] {
  const result = validateDocument(document);
  if (!result.valid) {
    const summary = result.errors
      .map((issue) => `  [${issue.code}] ${issue.at}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `scene document is invalid (${result.errors.length} error(s)):\n${summary}`,
    );
  }
  return result.warnings;
}
