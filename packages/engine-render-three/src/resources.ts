/**
 * GPU resource accounting.
 *
 * MOVED. The budget, the reference counts and the lifetime rules are
 * renderer-agnostic and now live in `@bracketx/engine-reconciler` so that both
 * render adapters share one implementation — see `gpu-resources.ts` there for
 * why. This file re-exports them so nothing inside this package had to change
 * its imports, and so the move is visible to anyone who comes looking here.
 *
 * `GpuResourceManager` is generic in its three resource types. This package
 * binds them to three's.
 */
import type { BufferGeometry, Material, Texture } from "three";
import { GpuResourceManager as Generic } from "@bracketx/engine-reconciler";

export {
  ResourceViolation,
  hashBytes,
  hashString,
  type ClassStats,
  type ResourceBudget,
  type ResourceClass,
  type ResourceStats,
} from "@bracketx/engine-reconciler";

/** The manager, bound to three's resource types. */
export class GpuResourceManager extends Generic<BufferGeometry, Material, Texture> {}
