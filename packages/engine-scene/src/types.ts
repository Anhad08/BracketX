/**
 * The scene document. Structural types only — SCENE_FORMAT v2.
 *
 * These mirror the frozen schema exactly. Where this file and SCENE_FORMAT.md
 * disagree, SCENE_FORMAT.md is correct and this file is a defect.
 */
import type { Vec3 } from "./math";

export const SCENE_FORMAT_ID = "bracketx.scene";
export const SCENE_FORMAT_VERSION = 2;

// ---------------------------------------------------------------------------
// Values and bindings
// ---------------------------------------------------------------------------

/** SCENE_FORMAT §7.5 — `#RRGGBB` or `#RRGGBBAA`, uppercase. */
export type ColorHex = string;

/**
 * A binding replaces a literal property value. SCENE_FORMAT §9.
 *
 * It is a property *value form*, not a property, so any property becomes
 * bindable with no per-type support. The `$` prefix is reserved for future
 * value forms — `$expr` is declared but not implemented.
 */
export interface VariableBinding {
  readonly $var: string;
}

export type Bindable<T> = T | VariableBinding;

export function isBinding(value: unknown): value is VariableBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "$var" in value &&
    typeof (value as VariableBinding).$var === "string"
  );
}

export type VariableType =
  | "string"
  | "number"
  | "boolean"
  | "color"
  | "asset"
  | "vector3"
  | "transform";

export interface SceneVariable {
  readonly id: string;
  /** Stable author-facing name. Bindings reference this, not `id`. */
  readonly key: string;
  readonly type: VariableType;
  readonly label: string;
  readonly default: unknown;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export interface Transform {
  readonly position: Vec3;
  /** Degrees, YXZ intrinsic. SCENE_FORMAT §4. */
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export const IDENTITY_TRANSFORM: Transform = Object.freeze({
  position: Object.freeze([0, 0, 0]) as Vec3,
  rotation: Object.freeze([0, 0, 0]) as Vec3,
  scale: Object.freeze([1, 1, 1]) as Vec3,
});

// ---------------------------------------------------------------------------
// Components — SCENE_FORMAT §7
// ---------------------------------------------------------------------------

export interface ComponentBase {
  readonly id: string;
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export type TextFitMode = "wrap" | "shrink" | "truncate" | "overflow";

export interface TextFit {
  readonly mode: TextFitMode;
  readonly minSize?: number;
  readonly ellipsis?: string;
}

export interface FontRef {
  readonly assetId: string;
  readonly size: number;
  readonly weight?: number;
  /** Ordered fallback chain. TEXT_ENGINE §3. */
  readonly fallback?: readonly string[];
}

export interface TextComponent extends ComponentBase {
  readonly type: "text";
  readonly props: {
    readonly content: Bindable<string>;
    readonly font: FontRef;
    readonly color: Bindable<ColorHex>;
    readonly align?: "start" | "center" | "end";
    readonly verticalAlign?: "top" | "middle" | "bottom";
    readonly lineHeight?: number;
    readonly maxWidth?: number;
    readonly maxLines?: number;
    /** Required. SCENE_FORMAT §7.2 — unbounded text is an on-air failure. */
    readonly fit: TextFit;
  };
}

export interface MeshRendererComponent extends ComponentBase {
  readonly type: "meshRenderer";
  readonly props: {
    readonly assetId: string;
    readonly meshIndex?: number;
    readonly materialId?: string;
    readonly materialOverrides?: Readonly<Record<string, unknown>>;
  };
}

export interface CameraComponent extends ComponentBase {
  readonly type: "camera";
  readonly props: {
    readonly projection: "perspective" | "orthographic";
    readonly focalLength?: number;
    readonly sensorWidth?: number;
    readonly orthographicSize?: number;
    readonly near: number;
    readonly far: number;
  };
}

export interface LightComponent extends ComponentBase {
  readonly type: "light";
  readonly props: {
    readonly kind: "directional" | "point" | "spot" | "area";
    readonly color: Bindable<ColorHex>;
    /** Physical units — lux for directional, candela otherwise. */
    readonly intensity: Bindable<number>;
    readonly castShadow?: boolean;
    readonly range?: number;
    readonly angle?: number;
  };
}

/** Establishes a 2D pixel-space context. SCENE_FORMAT §4. */
export interface ScreenSpaceComponent extends ComponentBase {
  readonly type: "screenSpace";
  readonly props: Readonly<Record<string, never>>;
}

export interface RectComponent extends ComponentBase {
  readonly type: "rect";
  readonly props: {
    readonly width: Bindable<number>;
    readonly height: Bindable<number>;
    readonly fill: Bindable<ColorHex>;
    readonly cornerRadius?: number;
  };
}

export interface ImageComponent extends ComponentBase {
  readonly type: "image";
  readonly props: {
    readonly assetId: Bindable<string>;
    readonly fit?: "contain" | "cover" | "fill" | "none";
    readonly cornerRadius?: number;
  };
}

/**
 * An unrecognised component. SCENE_FORMAT §13 rules 1–3 require these to
 * round-trip byte-for-byte rather than be dropped, so that opening a document
 * in an older client and saving it cannot destroy work.
 */
export interface UnknownComponent extends ComponentBase {
  readonly type: string;
}

export type Component =
  | TextComponent
  | MeshRendererComponent
  | CameraComponent
  | LightComponent
  | ScreenSpaceComponent
  | RectComponent
  | ImageComponent
  | UnknownComponent;

export const KNOWN_COMPONENT_TYPES = [
  "text",
  "meshRenderer",
  "camera",
  "light",
  "screenSpace",
  "rect",
  "image",
] as const;

// ---------------------------------------------------------------------------
// Nodes — SCENE_FORMAT §6
// ---------------------------------------------------------------------------

export interface NodeRuntimeMetadata {
  readonly layers?: readonly string[];
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly renderOrder?: number;
  readonly pickable?: boolean;
  readonly tags?: readonly string[];
}

export interface SceneNode {
  readonly id: string;
  readonly name: string;
  /** Fractional index. `children` is sorted ascending by this. */
  readonly order: string;
  readonly transform?: Transform;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly runtime?: NodeRuntimeMetadata;
  readonly components?: readonly Component[];
  readonly children?: readonly SceneNode[];
  /** Preserved verbatim for forward compatibility. SCENE_FORMAT §13. */
  readonly [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// Document — SCENE_FORMAT §3, §5, §11, §12
// ---------------------------------------------------------------------------

export interface SceneWorld {
  readonly units: "meters";
  readonly up: "Y";
  readonly handedness: "right";
  readonly defaultCameraId?: string;
  readonly environment?: {
    readonly ambient?: { readonly color: ColorHex; readonly intensity: number };
    readonly iblAssetId?: string;
    readonly background?: "transparent" | ColorHex;
  };
  readonly output: {
    readonly width: number;
    readonly height: number;
    readonly fps: number;
  };
  readonly safeAreas?: { readonly title: number; readonly action: number };
}

export interface SceneAsset {
  readonly id: string;
  readonly kind: "model" | "texture" | "font" | "environment" | "video" | "material";
  readonly name: string;
  readonly hash: string;
  readonly generator?: string;
}

export interface SceneState {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly loop?: boolean;
}

export interface SceneMeta {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  /** Declares whether the scene needs an Advanced-tier backend. RFC-003 §3. */
  readonly tier?: "baseline" | "advanced";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SceneDocument {
  readonly format: typeof SCENE_FORMAT_ID;
  readonly version: number;
  readonly id: string;
  readonly meta: SceneMeta;
  readonly world: SceneWorld;
  readonly variables: readonly SceneVariable[];
  readonly assets: readonly SceneAsset[];
  readonly root: SceneNode;
  readonly states: readonly SceneState[];
  readonly [extra: string]: unknown;
}
