/**
 * The content surface — what a first-time user edits.
 *
 * ============================================================================
 * THE SURFACE IS DERIVED, NEVER DECLARED TWICE
 * ============================================================================
 * The Studio Blueprint asks for a beginner panel showing Name, Role, Logo and
 * Colour — and no layers, no transforms, no keyframes. The temptation is to
 * add a "beginner fields" list to the document and maintain it beside the
 * variables.
 *
 * That would be a second source of truth, and it would drift the first time
 * someone added a variable without updating the list. It is also unnecessary:
 * SCENE_FORMAT §11.3 already says a TemplateParameter "becomes a variable at
 * instantiation", so the parameters ARE the surface. This module reads them
 * back out and nothing else.
 *
 * For a document that is not yet a template, the surface is its variables —
 * same shape, same editing path. Promoting to a template later changes what is
 * *labelled*, never what is editable.
 *
 * ============================================================================
 * EDITING THE SURFACE PRODUCES OPERATIONS, NOT MUTATIONS
 * ============================================================================
 * Every setter here returns a Transaction. Nothing writes to a document. The
 * caller hands it to DocumentStore, which applies it through SceneHost and
 * pushes the inverse onto the undo stack — so a beginner typing a name gets
 * undo, projection and persistence for free, by not being a special case.
 */
import {
  type SceneDocument,
  type SceneVariable,
  type TemplateParameter,
  type Transaction,
  type VariableType,
} from "@bracketx/engine-scene";

import { transaction } from "./editing";

/**
 * One editable field on the content surface.
 *
 * `label` is what a beginner reads, `key` is what the engine binds to. They
 * differ deliberately: "Name" is a label, `talent.name` is an address, and
 * showing the address to someone making their first lower third is the kind of
 * thing that makes professional software feel hostile.
 */
export interface SurfaceField {
  readonly key: string;
  readonly label: string;
  readonly type: VariableType;
  readonly value: unknown;
  /** True when the value must be supplied — a template that ships blank. */
  readonly required: boolean;
  /** True when this field's value differs from the template's default. */
  readonly overridden: boolean;
}

/**
 * Title Case from a dotted key.
 *
 * A fallback only: `SceneVariable` already carries a `label`, and a
 * TemplateParameter may carry one too. This runs when neither is populated,
 * which is the case for a variable created by an importer rather than by a
 * person.
 */
function labelFor(key: string): string {
  const last = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  const spaced = last.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function variableByKey(document: SceneDocument, key: string): SceneVariable | undefined {
  return document.variables.find((v) => v.key === key);
}

function parameterByKey(
  document: SceneDocument,
  key: string,
): TemplateParameter | undefined {
  return document.template?.parameters.find((p) => p.key === key);
}

/**
 * The content surface, in declaration order.
 *
 * Order is the template's parameter order when there is one, because that is a
 * decision the template's author made about what to read first. Falling back to
 * variable order is the same principle: the person who declared them chose.
 */
export function surfaceOf(document: SceneDocument): readonly SurfaceField[] {
  const params = document.template?.parameters;
  if (params && params.length > 0) {
    return params.map((p) => {
      const variable = variableByKey(document, p.key);
      const value = variable ? variable.default : p.default;
      return {
        key: p.key,
        // The parameter's label wins, then the variable's, then the key. Three
        // sources because each is authored by a different person: the template
        // author, the designer who declared the variable, and nobody.
        label: p.label ?? variable?.label ?? labelFor(p.key),
        type: p.type,
        value,
        required: p.required === true,
        overridden: variable !== undefined && !sameValue(variable.default, p.default),
      };
    });
  }
  // Not a template yet. Its variables are still the honest surface.
  return document.variables.map((v) => ({
    key: v.key,
    label: v.label || labelFor(v.key),
    type: v.type,
    value: v.default,
    required: v.default === null || v.default === undefined,
    overridden: false,
  }));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A field's current value, or undefined if the surface has no such field. */
export function surfaceValue(document: SceneDocument, key: string): unknown {
  const variable = variableByKey(document, key);
  if (variable) return variable.default;
  return parameterByKey(document, key)?.default;
}

/**
 * Sets one surface field.
 *
 * Returns null when the value is unchanged — an editor that produced a
 * transaction per keystroke regardless would fill the undo stack with
 * no-ops, and Volume Two says one gesture is one undo entry.
 *
 * Throws for an unknown key rather than silently defining a variable: a typo
 * in a field id must fail loudly at the point of the mistake, not create a
 * second variable that nothing is bound to.
 */
export function setSurfaceValue(
  document: SceneDocument,
  key: string,
  value: unknown,
  label?: string,
): Transaction | null {
  const variable = variableByKey(document, key);
  if (!variable) {
    throw new Error(
      `setSurfaceValue: no variable named "${key}". The surface is derived from ` +
        `the document's variables; define one before editing it.`,
    );
  }
  if (sameValue(variable.default, value)) return null;
  return transaction(label ?? `Set ${labelFor(key)}`, [
    {
      type: "variable.setDefault",
      variableId: variable.id,
      value,
      previousValue: variable.default,
    },
  ]);
}

/**
 * Resets a field to the template's declared default.
 *
 * Blueprint C-2: an overridden property carries a mark and a one-action reset.
 * Returns null when the field is not a template parameter or already matches —
 * there is nothing to reset to, and a control that appears to do nothing is
 * worse than one that is absent.
 */
export function resetSurfaceValue(
  document: SceneDocument,
  key: string,
): Transaction | null {
  const parameter = parameterByKey(document, key);
  if (!parameter) return null;
  return setSurfaceValue(document, key, parameter.default, `Reset ${parameter.label ?? labelFor(key)}`);
}

/**
 * Sets several fields as ONE undo step.
 *
 * Applying a template's data — six fields at once — is one intention, and
 * RFC-002 §6 says a grouping action is one transaction regardless of how many
 * primitives it takes.
 */
export function setSurfaceValues(
  document: SceneDocument,
  values: Readonly<Record<string, unknown>>,
  label = "Set content",
): Transaction | null {
  const operations = Object.entries(values).flatMap(([key, value]) => {
    const variable = variableByKey(document, key);
    if (!variable || sameValue(variable.default, value)) return [];
    return [
      {
        type: "variable.setDefault" as const,
        variableId: variable.id,
        value,
        previousValue: variable.default,
      },
    ];
  });
  return operations.length === 0 ? null : transaction(label, operations);
}

/**
 * Fields whose value is required and absent.
 *
 * This is the check that decides whether a graphic may be marked ready: a
 * template declaring a required name and carrying none should refuse to air
 * rather than air a blank.
 */
export function unsatisfied(document: SceneDocument): readonly SurfaceField[] {
  return surfaceOf(document).filter(
    (f) => f.required && (f.value === null || f.value === undefined || f.value === ""),
  );
}
