/**
 * @bracketx/engine-scene — Engine Core layer.
 *
 * The scene graph: node identity, components, hierarchy, transforms,
 * operations, serialization, validation. Specified by SCENE_FORMAT.md and
 * RFC-002.
 *
 * This package is a LEAF and depends on nothing. That is a requirement rather
 * than an accident: ENGINE_ARCHITECTURE.md §3 makes the document the source of
 * truth, so it must be constructible and verifiable with no runtime, no
 * renderer, and no I/O.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-scene",
  layer: "engine-core",
} as const;

export {
  ID_PREFIXES,
  createIdFactory,
  createSequentialIdFactory,
  cryptoRandom,
  hasKind,
  isValidId,
  type Id,
  type IdFactory,
  type IdKind,
  type RandomSource,
} from "./ids";

export {
  OrderKeyError,
  compareOrderKeys,
  generateKeyBetween,
  generateNKeysBetween,
} from "./order";

export {
  DEG_TO_RAD,
  IDENTITY,
  composeTRS,
  isFiniteVec3,
  multiply,
  round,
  transformPoint,
  type Mat4,
  type Vec3,
} from "./math";

export {
  IDENTITY_TRANSFORM,
  KNOWN_COMPONENT_TYPES,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  isBinding,
  type Bindable,
  type CameraComponent,
  type ColorHex,
  type Component,
  type ComponentBase,
  type FontRef,
  type ImageComponent,
  type LightComponent,
  type MeshRendererComponent,
  type NodeRuntimeMetadata,
  type RectComponent,
  type SceneAsset,
  type SceneDocument,
  type SceneMeta,
  type SceneNode,
  type SceneState,
  type SceneVariable,
  type SceneWorld,
  type ScreenSpaceComponent,
  type TextComponent,
  type TextFit,
  type TextFitMode,
  type Transform,
  type UnknownComponent,
  type VariableBinding,
  type VariableType,
} from "./types";

export {
  childrenOf,
  countNodes,
  findNode,
  insertChild,
  isAncestorOf,
  parentOf,
  pathToNode,
  removeNode,
  replaceNode,
  walk,
} from "./tree";

export {
  PropertyPathError,
  getAtPath,
  parsePath,
  setAtPath,
} from "./property-path";

export {
  OperationError,
  applyOperation,
  applyTransaction,
  invertOperation,
  invertTransaction,
  makeMoveNode,
  makeRemoveNode,
  makeSetProp,
  type BindingClearOperation,
  type BindingSetOperation,
  type DocSetMetaOperation,
  type NodeInsertOperation,
  type NodeMoveOperation,
  type NodeRemoveOperation,
  type NodeSetPropOperation,
  type SceneOperation,
  type Transaction,
  type VariableDefineOperation,
  type VariableRemoveOperation,
  type VariableSetDefaultOperation,
} from "./operations";

export {
  FLOAT_PRECISION,
  SerializationError,
  canonicalize,
  deserialize,
  serialize,
} from "./serialize";

export {
  assertValidDocument,
  validateDocument,
  type ValidationIssue,
  type ValidationResult,
} from "./validate";

// -- Composition — Project Alpha A4/A5/A6/A8 --------------------------------

export {
  anchorPlacement,
  inset,
  isLayoutContainer,
  layoutChildren,
  sizeOf,
  toInsets,
  type Box,
  type Insets,
  type Placement,
} from "./layout";

export {
  CompositionError,
  applyStates,
  declaredStates,
  instantiateTemplate,
  tokenMap,
  validateTemplate,
  validateTokens,
  type InstantiateOptions,
} from "./compose";

export type {
  AnchorX,
  AnchorY,
  LayoutMode,
  NodeAnchor,
  NodeLayout,
  NodeSize,
  NodeStateOverride,
  SceneToken,
  TemplateDefinition,
  TemplateParameter,
} from "./types";

// -- Animation — Phase 5 -----------------------------------------------------

export {
  clipTime,
  crossedEvents,
  ease,
  interpolate,
  normalizeClip,
  sampleClip,
  sampleTrack,
  targetsOf,
  validateClip,
  valueAtPath,
  type AnimatedValues,
  type AnimationClip,
  type AnimationEvent,
  type AnimationTrack,
  type CubicBezier,
  type Easing,
  type EasingName,
  type Keyframe,
} from "./animation";
