/**
 * Composition. Project Alpha A4/A6/A8, SCENE_FORMAT §6.5 / §11.2 / §11.3.
 *
 * Three capabilities that share one idea: a document says what it *means*, and
 * something resolves that into concrete values at projection time.
 *
 *   Tokens     `color.primary` -> "#0B1F3A"        (design values)
 *   States     "warning"       -> property patches  (conditional values)
 *   Templates  parameters      -> variables         (instantiated values)
 *
 * None of them is a second name-to-value system. Tokens resolve through the
 * same chain as variables; parameters BECOME variables; state overrides patch
 * the node the projector was going to read anyway. A parallel resolver would be
 * a second source of truth, which this project has paid for before.
 */
import type {
  NodeStateOverride,
  SceneDocument,
  SceneNode,
  SceneToken,
  TemplateParameter,
  Transform,
} from "./types";

export class CompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionError";
  }
}

// ---------------------------------------------------------------------------
// A6 — Design tokens
// ---------------------------------------------------------------------------

/**
 * Token values by name.
 *
 * Built once per document rather than looked up linearly per binding: a scene
 * with 500 nodes each reading two tokens is 1,000 lookups per projection, and
 * a linear scan over a 60-token brand kit would make that 60,000 comparisons.
 */
export function tokenMap(
  tokens: readonly SceneToken[] | undefined,
): ReadonlyMap<string, unknown> {
  const map = new Map<string, unknown>();
  for (const token of tokens ?? []) map.set(token.name, token.value);
  return map;
}

/**
 * Rejects tokens that cannot resolve deterministically.
 *
 * A duplicate name is the dangerous one: last-write-wins is an arbitrary rule,
 * and a brand kit merged from two sources would silently pick one.
 */
export function validateTokens(tokens: readonly SceneToken[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (typeof token.name !== "string" || token.name.length === 0) {
      problems.push("token name must be a non-empty string");
      continue;
    }
    if (seen.has(token.name)) {
      problems.push(`duplicate token "${token.name}"`);
    }
    seen.add(token.name);

    const type = typeof token.value;
    if (type !== "string" && type !== "number" && type !== "boolean") {
      problems.push(
        `token "${token.name}" must be a string, number, or boolean`,
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// A8 — Generic states
// ---------------------------------------------------------------------------

/**
 * Applies the active states' overrides to a node.
 *
 * Later states in the list win, so the caller controls precedence by ordering.
 * The engine assigns no meaning to any name: `enter`/`visible`/`exit` and
 * `normal`/`warning`/`error` are equally opaque, and a template that invents
 * `celebrating` works without an engine change.
 *
 * Returns the node unchanged, BY REFERENCE, when no state applies. That is what
 * lets the projector skip a node entirely — the same structural-sharing trick
 * the scene graph uses.
 */
export function applyStates(
  node: SceneNode,
  activeStates: readonly string[],
): SceneNode {
  const declared = node.states;
  if (declared === undefined || activeStates.length === 0) return node;

  let result = node;
  let patched = false;

  for (const stateName of activeStates) {
    const override = declared[stateName];
    if (override === undefined) continue;

    result = mergeOverride(result, override);
    patched = true;
  }

  return patched ? result : node;
}

function mergeOverride(
  node: SceneNode,
  override: NodeStateOverride,
): SceneNode {
  let next: SceneNode = node;

  if (override.visible !== undefined) {
    next = { ...next, visible: override.visible };
  }
  if (override.transform !== undefined) {
    // Whole-transform replacement, not a per-channel merge. A partial
    // transform merge would need a rule for "position given, rotation absent",
    // and every rule there is surprising to someone.
    next = { ...next, transform: override.transform as Transform };
  }
  if (override.size !== undefined) {
    next = { ...next, size: override.size };
  }
  if (override.props !== undefined && next.components !== undefined) {
    const patches = override.props;
    next = {
      ...next,
      components: next.components.map((component) => {
        const patch = patches[component.id];
        if (patch === undefined) return component;
        return { ...component, props: { ...component.props, ...patch } };
      }),
    };
  }

  return next;
}

/** State names a node declares. For validation and tooling. */
export function declaredStates(node: SceneNode): readonly string[] {
  return node.states === undefined ? [] : Object.keys(node.states);
}

// ---------------------------------------------------------------------------
// A4 — Templates
// ---------------------------------------------------------------------------

export interface InstantiateOptions {
  /** Values for the template's declared parameters. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Document id for the instance. Defaults to the template's. */
  readonly id?: string;
}

/**
 * Instantiates a template into a scene document.
 *
 * Parameters become variables. That is the whole mechanism, and it is why a
 * template needs nothing of its own to reach its content: bindings already
 * resolve against variables, so `{ $var: "playerName" }` inside a template
 * works unchanged inside an instance.
 *
 * A missing required parameter throws. A template that silently renders with an
 * unfilled slot is a graphic that goes on air with a blank name.
 */
export function instantiateTemplate(
  template: SceneDocument,
  options: InstantiateOptions = {},
): SceneDocument {
  const definition = template.template;
  if (definition === undefined) {
    throw new CompositionError(
      `document "${template.id}" is not a template; it declares no template block`,
    );
  }

  const supplied = options.parameters ?? {};
  const variables = [...template.variables];
  const byKey = new Map(variables.map((variable, index) => [variable.key, index]));

  for (const parameter of definition.parameters) {
    const value = resolveParameter(parameter, supplied, definition.name);

    const existing = byKey.get(parameter.key);
    const asVariable = {
      id: `var_${parameter.key}`,
      key: parameter.key,
      type: parameter.type,
      label: parameter.label ?? parameter.key,
      default: value,
    };

    // A template may declare a parameter that already exists as a variable —
    // the parameter wins, because that is the point of instantiating.
    if (existing !== undefined) variables[existing] = asVariable;
    else variables.push(asVariable);
  }

  const { template: _definition, ...rest } = template;

  return {
    ...(rest as SceneDocument),
    id: options.id ?? template.id,
    variables,
  };
}

function resolveParameter(
  parameter: TemplateParameter,
  supplied: Readonly<Record<string, unknown>>,
  templateName: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(supplied, parameter.key)) {
    return supplied[parameter.key];
  }
  if (parameter.default !== undefined) return parameter.default;
  if (parameter.required === true) {
    throw new CompositionError(
      `template "${templateName}" requires parameter "${parameter.key}"`,
    );
  }
  return undefined;
}

/** Rejects a template definition that cannot instantiate deterministically. */
export function validateTemplate(document: SceneDocument): string[] {
  const definition = document.template;
  if (definition === undefined) return [];

  const problems: string[] = [];
  const seen = new Set<string>();

  for (const parameter of definition.parameters) {
    if (typeof parameter.key !== "string" || parameter.key.length === 0) {
      problems.push("template parameter key must be a non-empty string");
      continue;
    }
    if (seen.has(parameter.key)) {
      problems.push(`duplicate template parameter "${parameter.key}"`);
    }
    seen.add(parameter.key);

    if (parameter.required === true && parameter.default !== undefined) {
      // Not an error, but it means "required" can never fire, and someone
      // believed otherwise when they wrote it.
      problems.push(
        `template parameter "${parameter.key}" is required but has a default; ` +
          `the default makes it optional`,
      );
    }
  }
  return problems;
}
