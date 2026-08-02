# IF-002 — The 3D scene cannot be lit without reopening ADR-013

**Date:** 2026-08-02 · **Raised by:** Phase 2, the hybrid 2D/3D runtime
**Status:** **BLOCKING for lighting. Not blocking for meshes, materials or cameras.**
**Decision required from:** CTO / architecture owner

---

## 1. What was asked, and what the boundary allows

Phase 2 asked for ten 3D component types. I audited each against the **frozen**
`MirrorBackend` (ADR-013) before writing anything. The list splits cleanly, and
the split is not a matter of effort:

| Requested | Expressible on the frozen boundary? | Evidence |
| --- | --- | --- |
| Camera — perspective, orthographic, FOV, near/far | ✅ **Yes** | `CameraDescriptor` has both kinds; `createCamera`/`updateCamera`/`attachCamera` exist |
| Camera animation, variables, switching, per-output binding | ✅ **Yes** | Timeline tracks are dot paths; `ResolvedOutput.cameraNodeId` already exists |
| Mesh — primitives | ✅ **Yes** | `createGeometry(GeometryDescriptor)` takes positions, indices, normals, uvs, colors |
| Mesh — glTF/GLB import | ✅ Geometry yes; needs an asset pipeline | Same `GeometryDescriptor`. The gap is loading, not the boundary |
| Mesh Renderer component | ✅ **Yes** | `attachMesh(node, geometry, material)` |
| Material — base colour, metallic, roughness, texture slot | ✅ **Yes** | `MaterialDescriptor.kind === "pbr"` carries all four |
| Material — **emission** | ❌ **No** | No field on any `MaterialDescriptor` variant |
| Material — **opacity** | ⚠️ Partial | Only `transparent: boolean`. Alpha can be premultiplied into the colour, which works but cannot express an opaque surface at 50% |
| **Directional / Point / Spot / Ambient light** | ❌ **No** | No `LightDescriptor`, no `attachLight`, no `createLight` |
| **Environment / IBL** | ❌ **No** | No method of any kind |
| **Skybox** | ❌ **No** | No method of any kind |
| **Reflection Probe** | ❌ **No** | No method of any kind |
| Particle System | ❌ **No** — and already deferred | SCENE_FORMAT §7 marks `particles` **Reserved**, Advanced tier, RFC-003 §3 |
| 3D Transform (position/rotation/scale XYZ) | ✅ **Already shipped** | `Transform` has been `Vec3` since Phase 2.2 |
| Timeline over 3D | ✅ **Already shipped** | Verified this phase — see §4 |

The full interface is 26 methods. The four missing capabilities need **at
minimum** `createLight` / `updateLight` / `destroyLight` / `attachLight`, plus a
`LightDescriptor` union, plus an environment concept that has no natural shape
as a per-node attachment at all.

---

## 2. Why this is a finding and not a task

The standing instruction from Phase 2.5 is explicit:

> *If you discover that the backend cannot satisfy an architectural invariant or
> forces a violation of ADR-013, stop immediately and produce an
> IMPLEMENTATION_FINDING.md with evidence. Do not work around architectural
> problems by weakening the architecture.*

There are three workarounds available and **all three are the weakening the
instruction names**:

1. **Put lights in `RenderOptions`.** A per-frame array of lights passed to
   `render()`. It fits without changing the node model — and it makes lights the
   only scene content that is not a node, so they cannot be parented, animated
   by the existing timeline, instanced by a collection, or hidden by a state.
   Every one of those is a capability the phase brief explicitly asks lights to
   have.
2. **Bake lighting into the material.** Precompute a lit colour per surface in
   the reconciler. This is a software renderer inside the engine layer,
   duplicated per backend the moment a second one exists, and it is exactly the
   "no implicit computation" that contract clause **C3** forbids.
3. **Reach into the Three backend directly.** Add lights below the boundary.
   This is the violation the boundary exists to prevent, and IF-001 records why:
   the boundary is what lets *"the reconciler owns mirror lifetime"* and
   *"exactly one package imports three"* both hold.

**The honest answer is that lighting requires a boundary change**, and a
boundary change requires reopening ADR-013.

---

## 3. Why it matters more than it sounds

A `pbr` material with no lights **renders black**. So the practical position
today is:

- `unlit` materials produce a picture. Flat colour, no shading — which is what
  every 2D graphic already uses and what a stylised motion-graphics look wants.
- `pbr` materials are *expressible, projected, and dark*. The pipeline is wired
  end to end; there is simply nothing illuminating them.

That is why `#applyMesh` defaults to `unlit` and only produces `pbr` when an
author explicitly writes `metallic` or `roughness`. Defaulting to `pbr` would be
the obvious choice and would make every new mesh invisible.

**Consequences for the phase brief's own examples:** "Stadium Intro", "Rotating
Trophy" and "Esports Desk" all need shading to read as 3D at all. They are not
buildable convincingly until this is resolved. "3D Lower Third", "Animated
Sponsor Wall" and "Hybrid 2D/3D Broadcast" are buildable now with unlit
materials, because flat-shaded 3D is a legitimate broadcast look.

---

## 4. What was delivered anyway, and what it proves

Everything above the boundary was built and verified, because none of it needed
a reopening:

- **Primitives** — box, plane, sphere, cylinder, generated in the reconciler
  (not per-backend, for the same reason `quadDescriptor` is) and
  content-addressed, so a stadium of a thousand identical seats is one buffer.
- **`meshRenderer` projection** — `#applyMesh` beside `#applyRect`, same shape,
  same lifetime discipline, C2-balanced.
- **Materials from resolved props**, so every field is bindable.
- **Perspective cameras**, per-output camera binding, hybrid output.

And the central claim of the phase — *"3D uses the exact same architecture"* —
is now **falsifiable and asserted** rather than asserted in prose:

| Existing subsystem | Proven over 3D | With how much new code |
| --- | --- | --- |
| Variables | A runtime variable changes a mesh's colour with **zero** creates/destroys | none |
| Collections | A repeat instances meshes; survivors keep their handles | none |
| Timeline | One track animates a camera's Z and a mesh's Y rotation | none |
| Timeline | One track animates a **material** value by dot path | none |
| States | A state hides and moves a mesh | none |
| Outputs | One scene renders through a perspective and an orthographic camera at once | none |

**No existing code path was modified.** The whole 3D addition is one new method
in the projector and one new module of geometry. That is the strongest available
evidence that the architecture generalises — and it is the reason the missing
four capabilities are worth doing *properly* rather than working around.

---

## 5. The decision

Three options. My recommendation is (a).

### (a) Reopen ADR-013 for a scoped boundary extension — **recommended**

Add exactly what lighting needs and nothing else:

```ts
type LightDescriptor =
  | { kind: "ambient";     color: Rgba; intensity: number }
  | { kind: "directional"; color: Rgba; intensity: number }
  | { kind: "point";       color: Rgba; intensity: number; distance: number; decay: number }
  | { kind: "spot";        color: Rgba; intensity: number; distance: number;
                           angle: number; penumbra: number; decay: number };

createLight(descriptor: LightDescriptor): LightHandle;
updateLight(light: LightHandle, descriptor: LightDescriptor): void;
destroyLight(light: LightHandle): void;
attachLight(node: NodeHandle, light: LightHandle): void;
```

Four methods, one union. Direction and position come from the node's world
matrix — the engine already computes it, and C3 says the backend must not
derive transforms, so a light must not carry its own.

**Why this is the right shape:** it is the same shape as `createCamera` /
`attachCamera`, which is already in the contract and already proven. A light is
a node attachment exactly as a camera is. That symmetry is the argument that
this is a *completion* of the boundary rather than an expansion of it.

Environment, skybox and reflection probes are **deliberately excluded** from
this proposal: they are scene-level, not node-level, and shoehorning them into a
node attachment is how a boundary gets a shape it regrets. They deserve their
own finding once there is a consumer.

**Cost:** the contract, the mock backend, the Three backend, the conformance
suite. Estimate 1–2 weeks including verification.

### (b) Ship unlit-only 3D and defer lighting

Legitimate, and cheaper than it sounds — flat-shaded 3D is a real broadcast
look, and everything in §4 already works. But "Stadium Intro" and "Rotating
Trophy" are off the table, and the phase brief lists both.

### (c) Widen the boundary generously now — **not recommended**

Add lights, environment, skybox, probes and post-processing in one pass, so this
question never recurs. It is the option that feels efficient and is the one
ADR-013 exists to prevent: four of those five have no consumer, and a boundary
built for imagined consumers is a boundary that fits none of them.

---

## 6. What I did not do

I did not add lights, environments, skyboxes or reflection probes, and I did not
work around their absence. I also did not build the seven demonstration scenes:
four of them need lighting to read as 3D, and the other three need the Studio 3D
viewport, which is Phase 2's next slice rather than this one.

The asset pipeline (glTF/GLB import) is unblocked by this finding and is a
separate, larger piece of work — the boundary already takes the geometry it
would produce.
