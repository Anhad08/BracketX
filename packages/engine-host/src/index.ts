/**
 * @bracketx/engine-host — the composition root.
 *
 * Owns the sentence "advance time, project what changed, then draw". Depends
 * on the scene graph, the runtime, and the reconciler; depends on NO backend,
 * which is what keeps a renderer swap from reaching this far up.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-host",
  layer: "engine-host",
} as const;

/**
 * Re-exported from the reconciler.
 *
 * `SceneHost.lastReport` and every projection method return these, so a
 * consumer cannot type its own code without them. Found by the showcase, which
 * is exactly the kind of gap a first real consumer is meant to expose.
 */
export type {
  ProjectionReport,
  MirrorBackend,
  VariableSource,
} from "@bracketx/engine-reconciler";

export {
  SceneHost,
  HostError,
  findCameraNode,
  DEFAULT_OUTPUT_ID,
  type FrameResult,
  type FrameTimings,
  type SceneHostOptions,
} from "./host";

export {
  OutputSet,
  OutputError,
  resolveOutput,
  type OutputDescriptor,
  type OutputStats,
  type ResolvedOutput,
} from "./output";

export {
  FrameLoop,
  browserScheduler,
  type FrameLoopOptions,
  type FrameScheduler,
} from "./loop";

export { makeDemoScene, type DemoSceneOptions } from "./demo-scene";

export {
  Animator,
  AnimationError,
  type AnimationFrame,
  type ClipState,
  type PlayOptions,
} from "./animator";

export {
  LiveCommandLog,
  LiveCommandError,
  applyCollectionCommand,
  asCollection,
  canonicalSession,
  isCollectionCommand,
  itemIdentity,
  validateLiveCommand,
  type InsertAt,
  type LiveCommand,
  type LiveCommandRecord,
  type LiveCommandType,
  type LiveLogOptions,
  type LiveResult,
  type SessionSnapshot,
} from "./live";

export { HostTextProvider } from "./text";
export type { HostTextOptions } from "./text";
