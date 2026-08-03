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

import type { Timeline } from "./timeline";
import type { StateTransition } from "./transition";

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

/**
 * Repeats a node's children once per item in a bound collection.
 *
 * The capability every list needs: rosters, leaderboards, brackets, tickers,
 * agendas, set lists, playlists. Without it each of those is application code
 * building node trees by hand, which ENGINE_ARCHITECTURE §13 forbids.
 *
 * The node carrying `repeat` is the container; its `children` are the TEMPLATE,
 * instantiated once per item. The template itself never renders.
 *
 * Optional with a defined default (absent = no repetition), so this is additive
 * under SCENE_FORMAT §13 rule 4 and needs no version bump.
 */
export interface NodeRepeat {
  /** Variable key holding an array. A non-array resolves to zero instances. */
  readonly source: string;
  /**
   * Name the item is bound to inside each instance. Children reference it as
   * `{ $var: "<as>.field" }`.
   */
  readonly as: string;
  /**
   * Path within each item giving stable identity, e.g. `"id"`.
   *
   * Identity is what lets a collection change without churning the mirror: a
   * keyed instance that survives a reorder keeps its handle, its GPU
   * resources, and any animation in flight. Without a key, identity falls back
   * to index, and reordering rebuilds — correct, but wasteful and visible.
   */
  readonly key?: string;
  /** Hard cap on instances. Guards a bad feed from allocating without bound. */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Composition — SCENE_FORMAT §6.5. Project Alpha A4/A5/A6/A8.
// ---------------------------------------------------------------------------

/** Intrinsic box, in world units. Layout needs a size to place a child. */
export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

/**
 * How a node positions itself inside its parent's box.
 *
 * Absolute transforms cannot survive being rendered at two resolutions, and
 * outputs made that a normal case rather than an edge one (Project Alpha A1).
 * An anchored node stays where it belongs on a 1920x1080 feed and a 3840x2160
 * wall without the document knowing either number.
 */
export type AnchorX = "left" | "center" | "right" | "stretch";
export type AnchorY = "top" | "middle" | "bottom" | "stretch";

export interface NodeAnchor {
  readonly x?: AnchorX;
  readonly y?: AnchorY;
  /** Inset from the anchored edges, in world units. */
  readonly inset?: number | readonly [number, number, number, number];
  /**
   * Respect the container's safe area.
   *
   * Broadcast has always had title-safe margins; a projector has bezels and a
   * phone has a notch. Same idea, so it is one flag rather than a broadcast
   * feature.
   */
  readonly safe?: boolean;
}

export type LayoutMode = "horizontal" | "vertical" | "grid" | "stack";

/**
 * Positions a node's children. Auto-layout for production graphics.
 *
 * Every template depends on this: a scoreboard sizing to team-name length, a
 * roster spacing evenly, a sponsor row distributing across a bar. Without it,
 * every one of those is hand-placed coordinates that break the moment the data
 * changes.
 *
 * Deliberately not a constraint solver. One pass, top-down, deterministic.
 */
export interface NodeLayout {
  readonly mode: LayoutMode;
  /** Space between children along the main axis. */
  readonly gap?: number;
  /** Space between rows in a grid. Falls back to `gap`. */
  readonly rowGap?: number;
  /** Inside the container's box: uniform, or [top, right, bottom, left]. */
  readonly padding?: number | readonly [number, number, number, number];
  /** Cross-axis placement of each child. */
  readonly align?: "start" | "center" | "end" | "stretch";
  /** Main-axis distribution of the whole run. */
  readonly justify?: "start" | "center" | "end" | "between" | "around";
  /** Grid only. Children flow left-to-right, wrapping every `columns`. */
  readonly columns?: number;
  /** Safe-area inset applied inside padding, in world units. */
  readonly safeArea?: number | readonly [number, number, number, number];
}

/**
 * Property overrides that apply while a state is active.
 *
 * The engine assigns no meaning to any state name. `enter`/`visible`/`exit` and
 * `normal`/`warning`/`error` are equally valid, and equally opaque — they are
 * conventions a template declares, not concepts the engine knows.
 *
 * Only the channels a state can meaningfully drive are overridable, which keeps
 * state resolution O(1) per node instead of a deep merge.
 */
export interface NodeStateOverride {
  readonly visible?: boolean;
  readonly transform?: Transform;
  readonly size?: NodeSize;
  /** Per-component property patches, keyed by component id. */
  readonly props?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
  /** Instantiates `children` per item in a collection. SCENE_FORMAT §6.4. */
  readonly repeat?: NodeRepeat;
  /** Intrinsic box. Required for a child of a layout container. §6.5. */
  readonly size?: NodeSize;
  /** Placement inside the parent's box. §6.5. */
  readonly anchor?: NodeAnchor;
  /** Positions this node's children. §6.5. */
  readonly layout?: NodeLayout;
  /** Overrides applied while a named state is active. §6.5. */
  readonly states?: Readonly<Record<string, NodeStateOverride>>;
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
  /**
   * Design pixels per world unit. Optional; defaults to 100.
   *
   * ========================================================================
   * THE MISSING CONVERSION, AND WHAT ITS ABSENCE COST
   * ========================================================================
   * `units` is metres. But SCENE_FORMAT §7.2 declares `font.size`, `maxWidth`
   * and `fit.minSize` in DESIGN PIXELS — 48, 600, 24 — because that is what a
   * type size means to a designer and what a font's own metrics are relative
   * to. Nothing in the format connected the two spaces, so the projector
   * invented `scale = 1 / size`, which made a text node's world height exactly
   * one unit per em NO MATTER WHAT SIZE WAS SET, and fed a metre count to the
   * atlas as if it were a pixel count. A 0.52-unit label rasterised into a
   * 1x1 texel and drew as a smudge.
   *
   * One number fixes both: layout runs in pixels, `scale` is 1/pixelsPerUnit,
   * and the atlas sees a real pixel size. It is scene-level because it is an
   * authoring convention — Studio's 17.78 x 10 stage at 1920 x 1080 is exactly
   * 108 — and NOT derived from `output`, because changing an output to 4K must
   * not double the physical size of every graphic in the scene.
   *
   * Optional with a default, so this is additive under §13 rule 4.
   */
  readonly pixelsPerUnit?: number;
  readonly safeAreas?: { readonly title: number; readonly action: number };
  /**
   * Glyphs to rasterise before the scene may go on air. TEXT_ENGINE §5, T4.
   *
   * ========================================================================
   * WHY THIS IS SCENE-LEVEL AND NOT ASSET METADATA
   * ========================================================================
   * T4 asked where a pre-warm character set belongs. It belongs here.
   *
   * A font asset is shared by many scenes: one is Latin-only, the next needs
   * Hangul. Declaring the set on the ASSET would make it wrong for every scene
   * but the one it was authored against, and the cost of being wrong is a
   * mid-show rasterisation spike — the exact thing pre-warm exists to prevent.
   *
   * The engine already derives most of the set on its own: every glyph in
   * static text and in variable DEFAULTS is known at load. This field covers
   * only what cannot be derived — the range LIVE data will draw from. "This
   * scoreboard will show Korean names" is a fact about the show, and a human
   * is the only one who knows it.
   *
   * Optional with a defined default (the empty set), so SCENE_FORMAT §13 rule 4
   * makes it additive: no version bump.
   */
  readonly textPrewarm?: {
    /** Named ranges, so a document stays small and Studio can offer tick-boxes. */
    readonly ranges?: readonly TextRange[];
    /** Literal characters, for anything a range does not cover. */
    readonly characters?: string;
  };
}

/**
 * A named block of codepoints to pre-warm.
 *
 * Names rather than numeric ranges: an author picks "the scene shows Korean
 * names", not "U+AC00–U+D7A3", and a name survives the range being refined.
 */
export type TextRange =
  | "latin"
  | "latin-ext"
  | "cyrillic"
  | "greek"
  | "arabic"
  | "hebrew"
  | "thai"
  | "hangul"
  | "kana"
  | "punctuation";

export interface SceneAsset {
  readonly id: string;
  readonly kind: "model" | "texture" | "font" | "environment" | "video" | "material";
  readonly name: string;
  readonly hash: string;
  readonly generator?: string;
}

/**
 * A named state the scene declares.
 *
 * ========================================================================
 * WHAT `duration` MEANS — reconciled in Phase 6 R5
 * ========================================================================
 * The DEFAULT TRANSITION DURATION into this state, in **seconds**. A state
 * change with no matching `StateTransition` falls back to it, so a scene can
 * say "entering `visible` takes 0.4s" once instead of writing a rule per pair.
 *
 * SCENE_FORMAT §10 declared this field when the format was written and nothing
 * ever read it — `validate.ts` collected the ids and discarded them with a bare
 * `void stateIds;`. The Phase 6 audit found the fossil. Rather than delete the
 * field (a version bump under §13 rule 4) it now carries the meaning the
 * original example implied. The unit changed from milliseconds to seconds to
 * match every other time in the engine; nothing read it, so nothing broke.
 *
 * The engine assigns NO meaning to any state name. `in`/`idle`/`out` is a
 * convention of the broadcast pack, not a rule of the engine.
 */
export interface SceneState {
  readonly id: string;
  /** The name used in `state.set` / `state.add` and in node overrides. */
  readonly name: string;
  /** Default transition duration into this state, in seconds. May be 0. */
  readonly duration: number;
  readonly loop?: boolean;
}

/**
 * Named design values. Project Alpha A6.
 *
 * Not a second name-to-value system — tokens resolve through the SAME chain as
 * variables, sitting beneath them so a variable of the same name wins. A second
 * resolver would be a second source of truth, which this project has paid for
 * before.
 *
 * Dotted names are convention, not structure: `color.primary`, `space.lg`,
 * `font.heading`. Changing one updates every template that references it.
 */
export interface SceneToken {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly description?: string;
}

/**
 * A typed parameter a template declares. Project Alpha A4.
 *
 * Parameters become variables at instantiation, which is why a template needs
 * no mechanism of its own to reach its content — it already has bindings.
 */
export interface TemplateParameter {
  readonly key: string;
  readonly type: VariableType;
  readonly label?: string;
  readonly default?: unknown;
  /** A parameter with no default must be supplied at instantiation. */
  readonly required?: boolean;
}

export interface TemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly parameters: readonly TemplateParameter[];
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
  /** Named design values. Resolve beneath variables. §11.2. */
  readonly tokens?: readonly SceneToken[];
  /** Present when this document IS a template. §11.3. */
  readonly template?: TemplateDefinition;
  /** Animation clips. Pure data; evaluation is a function of (clip, time). §10. */
  /**
   * Timelines. Pure data; evaluation is a function of (timeline, time). §10.
   *
   * The field is named `animations` because it always has been and renaming it
   * would be a version bump, but the element type is `Timeline` — the ONE
   * timeline model. A clip, a compiled state transition and a Phase 9 cue
   * sequence are the same shape and the same player runs all three.
   */
  readonly animations?: readonly Timeline[];
  /** Declared state transitions. §10.4. Absent means every state change cuts. */
  readonly transitions?: readonly StateTransition[];
  readonly [extra: string]: unknown;
}
