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
import type { SceneDocument } from "@bracketx/engine-scene";
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
  /** Current values, for controls that display as well as set. */
  readonly variables: Readonly<Record<string, unknown>>;
  readonly frame: number;
  readonly playing: boolean;
  readonly activeStates: readonly string[];
}

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

  /** Builds the document. Must be deterministic — called on every load. */
  build(): SceneDocument;

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

/** Test-only. Registration is otherwise permanent for the process. */
export function resetRegistry(): void {
  scenes.clear();
}
