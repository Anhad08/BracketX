/**
 * The scene registry.
 *
 * Adding a showcase must require ONLY registration — never an edit to the
 * shell, the navigation, or a switch statement somewhere. Every one of those is
 * a place a future contributor has to find, and a subsystem whose showcase is
 * hard to add is a subsystem that quietly ships without one.
 *
 * A scene is data plus two functions: build the document, and optionally render
 * its controls. Nothing else.
 */
import type { ReactNode } from "react";
import type { SceneDocument, Transaction } from "@bracketx/engine-scene";
import type { LiveCommand } from "@bracketx/engine-host";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

/** What a scene's controls can do. Deliberately narrow. */
export interface SceneControlContext {
  /**
   * The ONLY way controls change anything.
   *
   * Not a host reference: a control that could reach into the host could
   * bypass the command path, and the showcase exists partly to prove that path
   * is sufficient. If a control cannot be expressed as a command, that is an
   * engine API finding, not a reason for an escape hatch.
   */
  readonly send: (command: LiveCommand) => void;
  /**
   * Applies a document EDIT.
   *
   * The other mutation path, and deliberately distinct from `send`. RFC-002 §4.3
   * splits them: operations change the document and are undoable and persisted;
   * commands change runtime state and are neither. A scene that changes a layout
   * mode is editing the document; one that changes a score is not.
   *
   * Both are public engine APIs. Exposing only commands would have made the
   * layout scene impossible to build honestly, which is itself a useful thing
   * for the showcase to have surfaced.
   */
  readonly edit: (transaction: Transaction) => void;
  /** Current values, for controls that display as well as set. */
  readonly variables: Readonly<Record<string, unknown>>;
  readonly frame: number;
  readonly playing: boolean;
  readonly activeStates: readonly string[];
}

/**
 * Build-time knobs for a scene.
 *
 * Node count and hierarchy depth are properties of the DOCUMENT, so no runtime
 * command can vary them — the stress laboratory needs a scene that can be built
 * at a requested shape. Declaring the axes as data keeps the laboratory generic:
 * it drives whatever a scene declares rather than knowing about any scene.
 */
export interface SceneParameter {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

export type SceneParameters = Readonly<Record<string, number>>;

export interface ShowcaseScene {
  /** URL slug. Stable forever — links to a showcase should not rot. */
  readonly id: string;
  readonly title: string;
  /** Sidebar grouping, e.g. "Engine", "Composition", "Production". */
  readonly group: string;
  /** Sort order within the group. Ties break by title. */
  readonly order: number;
  /** One line. What a reader should understand after watching it. */
  readonly summary: string;
  /**
   * The engine capability this proves, named exactly.
   *
   * Not decoration: this is the link between a subsystem and its visual
   * verification, and the reason a capability without a showcase is visible.
   */
  readonly capability: string;

  /**
   * Builds the document. Must be deterministic — called on every load.
   *
   * The same parameters must always produce the same document, byte for byte.
   * A scene that builds differently on a second call makes every replay
   * verification meaningless, so this is a hard rule rather than a preference.
   */
  build(parameters?: SceneParameters): SceneDocument;

  /** Build axes this scene exposes to the stress laboratory. */
  readonly parameters?: readonly SceneParameter[];

  /** Extra search terms, for the command palette. Optional. */
  readonly keywords?: readonly string[];

  /** Commands issued once after load, e.g. starting a clip. */
  readonly onLoad?: readonly LiveCommand[];
  /** Advance the clock automatically. Most scenes want this. */
  readonly autoPlay?: boolean;
  /** Frame to seek to for a deterministic screenshot. Defaults to 0. */
  readonly screenshotFrame?: number;

  readonly controls?: (context: SceneControlContext) => ReactNode;
}

const scenes = new Map<string, ShowcaseScene>();

/** Registers a scene. Throws on a duplicate id rather than silently winning. */
export function registerScene(scene: ShowcaseScene): ShowcaseScene {
  const problem = validateScene(scene);
  if (problem !== null) throw new RegistryError(problem);

  if (scenes.has(scene.id)) {
    // Last-write-wins would make two scenes with the same id a heisenbug that
    // depends on import order.
    throw new RegistryError(`a scene is already registered as "${scene.id}"`);
  }

  scenes.set(scene.id, scene);
  return scene;
}

export function validateScene(scene: ShowcaseScene): string | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scene.id)) {
    return `scene id "${scene.id}" must be a lowercase slug`;
  }
  if (scene.title.length === 0) return `scene "${scene.id}" needs a title`;
  if (scene.group.length === 0) return `scene "${scene.id}" needs a group`;
  if (scene.summary.length === 0) return `scene "${scene.id}" needs a summary`;
  if (scene.capability.length === 0) {
    return `scene "${scene.id}" must name the capability it proves`;
  }
  if (typeof scene.build !== "function") {
    return `scene "${scene.id}" must provide build()`;
  }
  return null;
}

export function getScene(id: string): ShowcaseScene | undefined {
  return scenes.get(id);
}

export function hasScene(id: string): boolean {
  return scenes.has(id);
}

/**
 * Every scene, grouped and sorted deterministically.
 *
 * Registration order is import order, which is not stable enough to navigate
 * by. Group then order then title gives the same sidebar on every machine.
 */
export function listScenes(): readonly ShowcaseScene[] {
  return [...scenes.values()].sort(
    (a, b) =>
      a.group.localeCompare(b.group) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  );
}

export interface SceneGroup {
  readonly name: string;
  readonly scenes: readonly ShowcaseScene[];
}

export function listGroups(): readonly SceneGroup[] {
  const groups = new Map<string, ShowcaseScene[]>();
  for (const scene of listScenes()) {
    const existing = groups.get(scene.group);
    if (existing) existing.push(scene);
    else groups.set(scene.group, [scene]);
  }
  return [...groups.entries()].map(([name, list]) => ({ name, scenes: list }));
}

/** The declared defaults, as a parameter set. Empty when a scene declares none. */
export function defaultParameters(scene: ShowcaseScene): SceneParameters {
  const out: Record<string, number> = {};
  for (const parameter of scene.parameters ?? []) {
    out[parameter.key] = parameter.default;
  }
  return out;
}

/** Clamps a parameter set to what the scene declares. Unknown keys are dropped. */
export function clampParameters(
  scene: ShowcaseScene,
  values: SceneParameters,
): SceneParameters {
  const out: Record<string, number> = {};
  for (const parameter of scene.parameters ?? []) {
    const raw = values[parameter.key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : parameter.default;
    out[parameter.key] = Math.min(parameter.max, Math.max(parameter.min, Math.round(value)));
  }
  return out;
}

/** Test-only. Registration is otherwise permanent for the process. */
export function resetRegistry(): void {
  scenes.clear();
}
