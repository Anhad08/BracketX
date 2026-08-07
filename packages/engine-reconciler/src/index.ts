/**
 * @bracketx/engine-reconciler — Engine Core layer.
 *
 * Projection of operations onto a mirror, and ownership of mirror LIFETIME.
 * Specified by ENGINE_RECONCILIATION.md.
 *
 * Backend-neutral by construction. It expresses the mirror as opaque handles
 * and a MirrorBackend interface; it never names a rendering library. Per
 * IF-001, this is what lets ENGINE_RECONCILIATION.md §2.2 (reconciler owns
 * mirror lifetime) and RENDER_ENGINE_EVALUATION.md §10 (exactly one package
 * imports three) both hold.
 *
 * Projection, not diffing — ENGINE_RECONCILIATION.md §1.2. Operations already
 * carry what changed, so no tree comparison is required.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-reconciler",
  layer: "engine-core",
} as const;

export type {
  BackendCapabilities,
  BackendFailure,
  BackendResult,
  CameraDescriptor,
  CameraHandle,
  EnvironmentDescriptor,
  GeometryDescriptor,
  GeometryHandle,
  LightDescriptor,
  LightHandle,
  InspectableMirrorBackend,
  Mat4,
  MaterialDescriptor,
  MaterialHandle,
  MirrorBackend,
  MirrorNodeSnapshot,
  MirrorSnapshot,
  NodeHandle,
  RenderOptions,
  RenderTargetHandle,
  Rgba,
  TextureDescriptor,
  TextureHandle,
  Vec2,
} from "./mirror-backend";

export { NEUTRAL_ENVIRONMENT } from "./mirror-backend";

export {
  CUBE_FACES,
  studioEnvironmentFaces,
  type EnvironmentFaces,
} from "./environment-map";

export {
  MirrorBackendViolation,
  MockMirrorBackend,
  type FailureInjection,
  type MockBackendStats,
} from "./mock-backend";

export {
  MirrorGraph,
  MirrorViolation,
  type MirrorAttachment,
  type MirrorNode,
  type MirrorStats,
} from "./mirror";

/**
 * The keyed-identity naming rule.
 *
 * Exported because it is a CONTRACT, not an implementation detail: an instance
 * id is `<templateId>#<identity>`, and the host, the workbench inspector and
 * any future tool all have to agree with it. Three private copies of one
 * separator is how a naming change becomes three silent bugs.
 */
export { INSTANCE_SEPARATOR, identityOf } from "./repeat";

export {
  DIRTY_CHANNELS,
  DirtySet,
  type DirtyChannel,
  type DirtyStats,
} from "./dirty";

export {
  DependencyIndex,
  DependencyRecorder,
  type DependencyStats,
} from "./dependencies";

export {
  boxDescriptor,
  cylinderDescriptor,
  discDescriptor,
  planeDescriptor,
  primitiveDescriptor,
  primitiveKey,
  readPrimitive,
  sphereDescriptor,
  type PrimitiveShape,
  type PrimitiveSpec,
} from "./mesh-primitives";

export {
  estimateGeometryBytes,
  estimateMaterialBytes,
  estimateTextureBytes,
  geometryKey,
  materialKey,
  textureKey,
} from "./resource-keys";

export {
  GpuResourceManager,
  ResourceViolation,
  hashBytes,
  hashString,
  type ClassStats,
  type ResourceBudget,
  type ResourceClass,
  type ResourceStats,
} from "./gpu-resources";

export {
  boxAnchorOf,
  boxCentreOffset,
  extrudedQuadDescriptor,
  quadDescriptor,
  type BoxAnchor,
} from "./primitives";

export {
  EMPTY_VARIABLES,
  channelForPath,
  findComponent,
  localMatrixOf,
  resolveProps,
  resolveValue,
  type VariableSource,
} from "./resolve";

export {
  ProjectionError,
  Projector,
  documentNodeIds,
  environmentDescriptorOf,
  type ProjectionReport,
} from "./projection";

export {
  assertConsistent,
  verifyConsistency,
  type ConsistencyIssue,
  type ConsistencyResult,
} from "./verify";

export {
  Reconciler,
  type ReconcilerOptions,
  type ReconcilerStats,
} from "./reconciler";

export {
  describeDependencies,
  describeHierarchy,
  describeLifetime,
  lifetimeBalanced,
  snapshotDiagnostics,
  type DiagnosticsSnapshot,
  type HierarchySnapshot,
  type LifetimeSnapshot,
} from "./diagnostics";

export type {
  TextAtlasPage,
  TextBatch,
  TextDraw,
  TextFacts,
  TextProvider,
  TextRequest,
} from "./text-provider";
export type { ImageProvider, ProvidedImage } from "./image-provider";
