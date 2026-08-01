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

export {
  SceneHost,
  HostError,
  findCameraNode,
  DEFAULT_OUTPUT_ID,
  type FrameResult,
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
