/**
 * Resolution inputs for projection.
 *
 * The reconciler consumes RESOLVED values — it does not compute them. The
 * VariableResolution pipeline phase (ENGINE_ARCHITECTURE §2) owns that and does
 * not exist yet, so this module defines the contract and provides the minimal
 * resolver projection needs today.
 *
 * Keeping it here rather than in projection.ts matters: when the real
 * resolution stage lands, it replaces this file and projection is untouched.
 */
import {
  composeTRS,
  isBinding,
  type Component,
  type Mat4,
  type SceneNode,
  type Transform,
  type Vec3,
} from "@bracketx/engine-scene";

import type { DependencyRecorder } from "./dependencies";
import { dependencyKeyOf, readScoped } from "./scope";

/** Reads a variable's effective value. Supplied by the runtime. */
export interface VariableSource {
  read(key: string): unknown;
}

/** A variable source backed by nothing. Bindings resolve to their fallback. */
export const EMPTY_VARIABLES: VariableSource = { read: () => undefined };

/**
 * Resolves a property value, recording any variable it reads.
 *
 * The recording is what builds the dependency index — see dependencies.ts.
 */
export function resolveValue(
  value: unknown,
  variables: VariableSource,
  recorder: DependencyRecorder,
): unknown {
  if (!isBinding(value)) return value;
  // `player.name` depends on `player`. Recording the full dotted path would
  // mean a collection change never matched the recorded key and the instance
  // would silently stop updating — the index has to agree with the resolver
  // about what a dependency is.
  recorder.record(dependencyKeyOf(value.$var));
  return readScoped(variables, value.$var);
}

export function resolveProps(
  props: Readonly<Record<string, unknown>> | undefined,
  variables: VariableSource,
  recorder: DependencyRecorder,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    out[key] = resolveValue(value, variables, recorder);
  }
  return out;
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ZERO: Vec3 = [0, 0, 0];
const UNIT: Vec3 = [1, 1, 1];

/** Local matrix from a node's TRS. Identity when the node has no transform. */
export function localMatrixOf(transform: Transform | undefined): Mat4 {
  if (!transform) return IDENTITY;
  return composeTRS(
    transform.position ?? ZERO,
    transform.rotation ?? ZERO,
    transform.scale ?? UNIT,
  );
}

/** The first component of a type, or undefined. */
export function findComponent(
  node: SceneNode,
  type: string,
): Component | undefined {
  return node.components?.find((component) => component.type === type);
}

/**
 * Which dirty channel a property path belongs to.
 *
 * Routing by path is what keeps a colour change from invalidating transforms.
 * Unrecognised paths fall through to "material" — the narrowest channel that
 * does not propagate to descendants, so an unknown property costs one node
 * rather than a subtree.
 */
export function channelForPath(
  path: string,
): "transform" | "visibility" | "material" | "camera" | "runtime" {
  if (path === "transform" || path.startsWith("transform.")) return "transform";
  if (path === "visible") return "visibility";
  if (path === "runtime" || path.startsWith("runtime.")) return "runtime";
  if (path.includes("type\":\"camera")) return "camera";
  return "material";
}
