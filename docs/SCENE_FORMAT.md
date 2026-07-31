# BracketX Scene Format

**Version:** 2 (draft) · **Status:** Canonical · **Authored:** 2026-07-30
**Owner:** @Pixelborne · **Supersedes:** v1 (2D-only, never implemented)

> The canonical definition of a BracketX scene. Every subsystem that reads or
> writes a scene conforms to this: the editor, the runtime, the renderer,
> importers, AI generation, templates, and the marketplace.
>
> **Renderer-agnostic and editor-agnostic by construction.** Nothing here names
> WebGPU, Three.js, or any UI concept. That is the test for whether something
> belongs in this file.
>
> Companions: [ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md) (layers),
> [RFC-003](./RFC-003-rendering-architecture-3d.md) (rendering),
> [RFC-002](./RFC-002-scene-document-model.md) (edits — **unchanged and still
> correct**; snapshot at rest, operations in motion).

---

## 1. Changes from v1, and why

v1 was a competent 2D format. It is structurally wrong for a 3D production
engine in five ways, all of which are cheap now and expensive after Phase 2.

| # | v1 | v2 | Why it could not wait |
|---|---|---|---|
| 1 | Y-down, top-left origin, pixels | **Y-up, right-handed, metres** | glTF, Blender, Maya, C4D convention. Flipping handedness later inverts every transform, every animation curve, and every imported asset. |
| 2 | `type` per node | **Node = transform + components** | A node needs to be a mesh *and* a light *and* a plugin's thing. A type enum forbids composition and makes every plugin a format change. |
| 3 | 2D transform (`x, y, w, h, rotation`) | **3D TRS** | No perspective, no camera, no depth without it. |
| 4 | No camera | **Camera is a node** | The view must be animatable, parentable, and multiple. |
| 5 | No geometry or material model | **glTF 2.0 references** | Do not invent a mesh format. |

**What survives unchanged**, because it was right for reasons independent of
dimensionality: identifiers, fractional sibling ordering, variables and
bindings, the asset manifest, versioning and migration, serialization rules, and
the forward-compatibility rules. Those sections are carried forward.

## 2. Scope

A scene describes **one composable unit of content** — a lower-third, a virtual
set, a bracket, a full 3D environment — as a hierarchy of nodes in a world.

Out of scope, deliberately: which scenes are on air (show state, Phase 6);
asset bytes (referenced, never embedded); editor state (selection, zoom, panel
sizes); and renderer hints. If a property exists only to make one renderer
faster, it does not belong here.

## 3. Envelope

```json
{
  "format": "bracketx.scene",
  "version": 2,
  "id": "scn_7f3a9c21",
  "meta": { },
  "world": { },
  "variables": [ ],
  "assets": [ ],
  "root": { },
  "states": [ ]
}
```

> **`timeline` removed ([FINAL_REVIEW R3](./ARCHITECTURE_FINAL_REVIEW.md#3-reversals-of-prior-decisions)).**
> A draft envelope carried a `timeline` field. It was over-engineering: within a
> scene, `states` plus per-node tracks are sufficient, and sequencing *across*
> scenes is show state (Phase 6), not scene state. It shipped a concept before
> its consumer existed.

All fields required; collections may be empty. A reader never has to distinguish
"absent" from "empty".

## 4. Coordinate system

**Normative and load-bearing.**

- **Right-handed, Y-up.** +X right, +Y up, −Z forward (into the screen).
  Identical to glTF 2.0 and to Blender/Maya/C4D export conventions.
- **World units are metres.** A 1-unit cube is 1m. This matters for physically
  based lighting, camera focal lengths in millimetres, and depth of field — all
  of which need real-world scale to behave predictably.
- **Rotations are Euler angles in degrees, order YXZ**, applied intrinsically.
  Stored as authored, not as matrices or quaternions: a matrix loses intent, and
  a quaternion is not something an author types or diffs. Runtime converts.
- **Scale is a 3-vector.** Non-uniform scale is permitted and its interaction
  with rotation is the author's problem, as in every 3D tool.

### Screen space — how 2D stays ergonomic

Forcing a lower-third to be authored in metres would be hostile, and 90% of
broadcast content is screen-space 2D.

A node carrying a **`screenSpace` component** establishes a 2D layout context.
Its subtree is authored in **pixels, top-left origin, Y-down** — the v1
convention — and is composited through an orthographic camera at output
resolution.

This is the bridge between the two worlds, and it is explicit rather than
inferred. A subtree is either world-space or screen-space, never ambiguously
both.

## 5. World

```json
"world": {
  "units": "meters",
  "up": "Y",
  "handedness": "right",
  "defaultCameraId": "nod_cam_main",
  "environment": {
    "ambient": { "color": "#FFFFFF", "intensity": 0.2 },
    "iblAssetId": "ast_studio_hdr",
    "background": "transparent"
  },
  "output": { "width": 1920, "height": 1080, "fps": 60 },
  "safeAreas": { "title": 0.1, "action": 0.05 }
}
```

`units`, `up`, and `handedness` are **declared and fixed** at the values above.
They exist to make the convention explicit in every file rather than tribal
knowledge, and to let a reader reject a document that assumed otherwise.

`background: "transparent"` is the broadcast default. A scene that renders an
opaque background is the exception.

## 6. Nodes

```json
{
  "id": "nod_a1b2c3",
  "name": "Player Name",
  "order": "a1",
  "transform": {
    "position": [0, 1.2, 0],
    "rotation": [0, 0, 0],
    "scale":    [1, 1, 1]
  },
  "visible": true,
  "locked": false,
  "runtime": { },
  "components": [ ],
  "children": [ ]
}
```

A node is **a place in space with things attached**. What it *is* comes entirely
from its components.

- `order` — fractional index; `children` sorted ascending by it. Unchanged from
  v1 and argued in [RFC-002 §4.2](./RFC-002-scene-document-model.md#42-mergeable-sibling-ordering).
- `visible` — excludes the node **and its subtree** from rendering.
- `locked` — editor affordance; no render effect.
- Transform is **local to the parent**. World transforms are computed, never
  stored.

### 6.1 Runtime metadata

Per-node data the runtime needs that is neither transform nor content:

```json
"runtime": {
  "layers": ["default"],
  "castShadow": true,
  "receiveShadow": true,
  "culling": "frustum",
  "renderOrder": 0,
  "pickable": true,
  "tags": ["team-home"]
}
```

- `layers` — cameras render selected layers. This is how a preview output shows
  guides that programme output must not.
- `renderOrder` — an override within a pass, for the transparency-sorting cases
  every 3D engine eventually needs.

> **Draw order (corrected 2026-07-30, [FINAL_REVIEW R2](./ARCHITECTURE_FINAL_REVIEW.md#3-reversals-of-prior-decisions)).**
> v1 stated that hierarchy order determines z-order. That was a 2D holdover and
> is **wrong for a 3D format**: in world space, draw order comes from depth
> testing and transparency sorting, with `renderOrder` as the override.
>
> Document order governs painter's-order compositing **only inside a
> `screenSpace` subtree** (§4), where there is no depth to test against.
- `tags` — opaque strings for applications and AI to select nodes by meaning
  without depending on names or ids.

Separated from `components` because it applies to the node regardless of what is
attached, and because it is the surface most likely to grow.

## 7. Components

A node holds an array of components. **Multiple components per node are legal
and expected** — a node can be a mesh and a light and carry a plugin's data.

```json
"components": [
  { "id": "cmp_1", "type": "meshRenderer", "props": { } }
]
```

### v2 component types

| Type | Purpose |
|---|---|
| `meshRenderer` | Draw geometry from a glTF asset with a material |
| `text` | Text content and layout |
| `camera` | §8 |
| `light` | Directional, point, spot, area |
| `screenSpace` | Establishes a 2D pixel-space context (§4) |
| `rect` | Screen-space solid/gradient/stroked rectangle |
| `image` | Screen-space or textured-quad raster |
| `video` | **Reserved** — needs the native runtime |
| `particles` | **Reserved** — Advanced tier ([RFC-003 §3](./RFC-003-rendering-architecture-3d.md#3-webgpu-vs-webgl2-vs-hybrid)) |

**Broadcast components — lower-third, scoreboard, ticker, bracket — are not
component types.** They are parameterised scene templates composed of the above
plus variables. Baking them in would force every renderer, importer, and
consumer to understand every product feature forever.

### 7.1 `meshRenderer`

```json
"props": {
  "assetId": "ast_trophy_glb",
  "meshIndex": 0,
  "materialId": "mat_gold",
  "materialOverrides": { "baseColor": "#FFD700" }
}
```

Geometry is **never** stored in the scene document. It lives in a glTF/GLB asset
and is referenced. Materials default to the asset's own and may be overridden —
which is how one model serves many teams' colours.

### 7.2 `text`

```json
"props": {
  "content": "ALEX RIVERA",
  "font": {
    "assetId": "ast_inter",
    "size": 48,
    "weight": 700,
    "fallback": ["ast_noto_cjk", "ast_noto_arabic"]
  },
  "color": "#FFFFFF",
  "align": "start",
  "verticalAlign": "middle",
  "lineHeight": 1.2,
  "maxWidth": 600,
  "maxLines": 1,
  "fit": { "mode": "shrink", "minSize": 24 }
}
```

`font.fallback` is an **ordered** chain of asset ids. Resolution takes the first
font whose `cmap` contains the codepoint; exhausting the chain renders a visible
`.notdef` rather than substituting silently — a plausible-looking wrong glyph is
worse on air than an obviously wrong box. See
[TEXT_ENGINE §3](./TEXT_ENGINE.md#3-fonts).

> Added 2026-07-30 under the [architecture freeze](./ARCHITECTURE.md#adr-013).
> Optional property with a defined default, so per §13 rule 4 this is **not** a
> breaking change and requires no version bump. The forward-compatibility rules
> are what made this additive rather than a reopening.

`fit` remains **required** and remains the most product-critical property in the
format. A player name may be 3 characters or 30 in the same slot; a graphic that
overflows its box is a visible on-air failure. Modes: `wrap` · `shrink` ·
`truncate` · `overflow`.

`align` uses `start`/`end` rather than `left`/`right` so right-to-left scripts
work without a parallel property.

**The document does not choose a rendering path.** Raster vs MSDF
([RFC-003 §7](./RFC-003-rendering-architecture-3d.md#7-text--the-largest-technical-risk))
is decided by the runtime from context. An author-facing switch there would leak
an implementation detail into a format that must outlive the implementation.

### 7.3 `light`

```json
"props": {
  "kind": "directional",
  "color": "#FFFFFF",
  "intensity": 3.0,
  "castShadow": true,
  "range": 10,
  "angle": 45
}
```

Intensity is in **physical units** (lux for directional, candela for point and
spot), consistent with metres and glTF's `KHR_lights_punctual`. Arbitrary
0–1 intensity is the kind of choice that looks simpler now and cannot be
reconciled with real assets later.

## 8. Camera

A component, so a camera is a node: parentable, animatable, and
variable-drivable like anything else.

```json
{
  "id": "cmp_cam",
  "type": "camera",
  "props": {
    "projection": "perspective",
    "focalLength": 35,
    "sensorWidth": 36,
    "near": 0.1,
    "far": 1000,
    "orthographicSize": 5,
    "depthOfField": { "enabled": false, "focusDistance": 5, "fStop": 2.8 }
  }
}
```

**Focal length in millimetres against a declared sensor width**, not a vertical
FOV in degrees. Broadcast operators and DPs think in lenses — "a 35mm look" is
meaningful to them; "a 54° vertical FOV" is not. FOV is derived.

`orthographic` is first-class, not a degraded mode: it is how every screen-space
2D graphic renders.

Multiple cameras per scene are expected. Which camera an output uses is **show
state, not scene state** — the scene declares a `defaultCameraId` and nothing
more.

## 9. Variables

Unchanged from v1 in concept, and the single mechanism for every value not fixed
at design time: operator input, live data, template parameters, and application
state.

```json
"variables": [
  { "id": "var_home_score", "key": "homeScore", "type": "number",
    "label": "Home Score", "default": 0 }
]
```

Types: `string` · `number` · `boolean` · `color` · `asset` · **`vector3`** ·
**`transform`** (new in v2 — a 3D engine needs to bind positions and
orientations, e.g. a tracked camera or a data-driven object placement).

Binding is a **property-value form**, so any property is bindable without
per-type support:

```json
"content": { "$var": "homeScore" }
```

Reserved: `{ "$expr": ... }` for computed values. The `$` convention is declared
now so adding expressions later is additive rather than ambiguous.

**Variables are the engine/application seam**
([ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md#13-engine--application-separation)).
The tournament application writes `homeScore`; it never touches a node.

## 10. Animation

A scene declares **states**; nodes carry **tracks** bound to a state. There is
no scene-level timeline — see the R3 note in §3.

```json
"states": [
  { "id": "st_in",   "name": "In",   "duration": 600 },
  { "id": "st_idle", "name": "Idle", "duration": 0, "loop": true },
  { "id": "st_out",  "name": "Out",  "duration": 400 }
]
```

Per node:

```json
"animation": {
  "tracks": [
    { "id": "trk_1", "stateId": "st_in",
      "property": "transform.position.y",
      "keyframes": [
        { "t": 0,   "value": -2, "easing": "easeOutQuint" },
        { "t": 600, "value": 1.2 }
      ]}
  ]
}
```

- `property` is a **dot path**, so any property — including component props and
  camera focal length — is animatable with no per-type vocabulary.
- `t` is milliseconds from the **state's** start, not the scene's, because
  states are independently cued on air.
- Easing is a named function or explicit cubic-bezier control points. **No
  expressions, no physics, no springs** — each would break the determinism
  requirement in [ENGINE_ARCHITECTURE §4](./ENGINE_ARCHITECTURE.md#4-runtime)
  that evaluating at `t` equals playing forward to `t`.
- **Reserved:** `skeletal` and `morph` tracks for character content, declared so
  adding them is not a migration.

## 11. Assets

A manifest of references. Bytes are never embedded.

```json
"assets": [
  { "id": "ast_trophy_glb", "kind": "model", "name": "trophy.glb",
    "hash": "sha256:1a2b…", "generator": "Blender 4.2" }
]
```

Kinds: `model` (glTF/GLB) · `texture` · `font` · `environment` (HDR/EXR) ·
`video` (reserved) · `material`.

The manifest exists so a document can be **validated and transported
independently of any storage backend** — a template moving between workspaces or
through the marketplace must declare what it needs before those bytes resolve.
Resolving an id to a URL is the asset system's job, not the format's.

**Fonts are assets.** A document referencing an undeclared font cannot be
rendered faithfully elsewhere, and substitution shifts every layout.

## 12. Metadata

```json
"meta": {
  "name": "Lower Third — Player",
  "description": "",
  "tags": ["esports", "lower-third"],
  "tier": "baseline",
  "createdAt": "2026-07-30T12:00:00.000Z",
  "updatedAt": "2026-07-30T12:34:56.000Z"
}
```

`tier` is `baseline` or `advanced`
([RFC-003 §3](./RFC-003-rendering-architecture-3d.md#3-webgpu-vs-webgl2-vs-hybrid)) —
declaring up front whether the scene needs WebGPU, so a WebGL2 target can warn
before rendering rather than degrade silently mid-show.

Authorship and permissions are **not** here. They live in the database where
they can be enforced; a field in a user-editable document is not access control.

## 13. Identifiers, serialization, forward compatibility

Carried forward from v1 unchanged.

- **Ids** are opaque, kind-prefixed (`scn_`, `nod_`, `cmp_`, `var_`, `ast_`,
  `trk_`, `st_`, `mat_`), client-generated with enough entropy to be
  collision-safe across concurrent editors, unique within a document, and stable
  for the node's lifetime.
- **Serialization**: JSON, UTF-8. `NaN`/`Infinity` invalid. Floats round to 5
  decimal places (raised from v1's 3 — metres need finer resolution than
  pixels). `null` means explicitly absent; unset properties are omitted.
  Canonical form (sorted keys, minimal whitespace) for hashing and diffing.
- **Versioning**: single integer, forward-only chained migrations, every
  historical version must still load. A reader seeing a **higher** version must
  **refuse to load**, never partially read.
- **Forward compatibility, normative**: unknown component types, unknown node
  fields, and unknown properties must **round-trip byte-for-byte** and must not
  be dropped on save. Opening a document in an older client and saving must
  never destroy work. This is what makes a plugin ecosystem possible without a
  format break.

## 14. Validation

**Valid** requires: recognised `format` and `version`; all required fields
present; unique, correctly-prefixed ids; `children` sorted by `order`; every
referenced `assetId`, variable `key`, `stateId`, `materialId`, and
`defaultCameraId` resolves; no cycles; no `NaN`/`Infinity`; and at most one
`camera` component per node.

Validation is a **hard boundary** — invalid documents fail loudly at load and
are never partially rendered.

**Warnings** do not block: a missing asset, an unknown component type, an
`advanced`-tier scene on a Baseline target, a `shrink` fit whose `minSize` still
overflows.

## 15. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| F1 | Fractional-index scheme and rebalancing rule | Engineering | Phase 2 |
| F2 | Euler-vs-quaternion for **imported** glTF animation — euler is authorable, quaternion is what imports carry, and slerp differs from per-axis lerp | Engineering | Phase 2 |
| F3 | Whether `states` are fixed (`in`/`idle`/`out`) or author-defined; gates the Phase 6 control surface | Product | Phase 2 |
| F4 | Material definition: our own PBR schema vs glTF material JSON verbatim | Engineering | Phase 2 |
| F5 | Wide-gamut / HDR colour — broadcast will want it and `#RRGGBBAA` cannot carry it | Product | Post-launch |
| F6 | Whether templates are scenes with variables or a distinct document type; gates Phase 14 | Product | Phase 7 |
| F7 | Nested scenes / prefabs — a virtual set composed of reusable sub-scenes. Likely needed sooner under the engine vision than v1 assumed | Engineering | Phase 2 |
