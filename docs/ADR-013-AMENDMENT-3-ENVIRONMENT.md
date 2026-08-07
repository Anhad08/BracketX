# ADR-013 Amendment 3 — Environment

**Date:** 2026-08-07 · **Status:** ACCEPTED · **Supersedes:** nothing
**Raised by:** the Hybrid 3D Scenes capability · **Approved by:** CTO

The `MirrorBackend` boundary is reopened once, for the scene's environment, and
closed again.

---

## 1. What changed

One method, one descriptor, one snapshot field. Nothing else.

```ts
interface EnvironmentDescriptor {
  /** Multiplier on the rendered image. 1 is neutral. */
  readonly exposure: number;
  /** Whether lights that can cast shadows do, and surfaces receive them. */
  readonly shadows: boolean;
}

const NEUTRAL_ENVIRONMENT: EnvironmentDescriptor = { exposure: 1, shadows: false };

setEnvironment(descriptor: EnvironmentDescriptor): void;
```

`MirrorSnapshot` gains `environment`. The interface goes from 30 methods to 31.

`SceneWorld.environment` gains two optional fields — `exposure` and `shadows` —
which is an ADDITIVE change under SCENE_FORMAT §13 rule 4 and needs no version
bump.

---

## 2. Why this shape and no other

**A setter, not a resource.** Every other thing the backend owns is created,
attached to a node and destroyed, because every other thing is a *thing*
somewhere in the scene. An environment is not: there is exactly one, it belongs
to the document rather than to any node, and there is nothing to attach it to.
Modelling it as a resource would have meant inventing a node for it — and a node
nobody authored is a node that appears in the layer tree and can be deleted.

**Idempotent by contract.** The projector compares against what it last sent and
calls this only when the descriptor has actually changed. A setter called on
every flush would be a backend write per frame for a value nobody touched, which
is exactly the cost the dirty tracking exists to avoid — and would have made
every `backendWrites` assertion in the reconciler suite one too high.

**The neutral value is the absent value.** `exposure: 1` and `shadows: false`
render byte-for-byte what the engine rendered before this amendment existed. That
is what makes the amendment safe to land against graphics already on air, and it
is asserted first in both backends' conformance suites rather than assumed.

**One shadow switch, not a flag per light.** A broadcast operator turns shadows
on for a set and off for a lower third. Nobody has ever wanted the key light to
cast and the fill not to, and a per-light flag would have put that decision in
front of them anyway. `LightComponent.castShadow` remains in the format,
unprojected, as it was before this amendment.

---

## 3. What is deliberately NOT in here

**Ambient light.** SCENE_FORMAT §5 has a slot for it and `LightDescriptor`
already has `kind: "ambient"`. Two ways to say the same thing is two things to
keep in step, one of which can be animated, parented and hidden and one of which
cannot. Ambient stays a light node.

**Background.** Already `RenderOptions.clearColor`, which is per-OUTPUT. The
same graphic goes to air over live video with a transparent background and
renders onto a solid one in a preview tile; a scene-level background could not
express that.

**Image-based lighting.** `SceneWorld.environment.iblAssetId` exists in the
format and is not projected. IBL needs an asset pipeline for HDR images, a
cubemap conversion and a prefiltering step — a phase of its own, and the same
reason `meshRenderer.assetId` is still unwired. Raised here so the gap is
recorded rather than discovered.

**Environment rotation.** Follows IBL. Rotating an environment with no
environment in it is nothing.

---

## 4. What each backend does with it

**Three** — exposure goes to `toneMappingExposure` with `LinearToneMapping`,
which at exposure 1 is `saturate(colour)`: byte-for-byte what no tone mapping
already produced. A filmic curve would have quietly recoloured every graphic
already on air. Shadows enable `shadowMap` with `PCFSoftShadowMap`; directional
and spot lights cast, meshes cast and receive. The directional light's shadow
camera is widened to twenty units — Three's default ten is a metre or two of a
broadcast set, and with it a plinth casts a shadow onto a floor that is outside
the frustum, so the shadow stops in mid-air.

**Babylon** — exposure goes to `imageProcessingConfiguration.exposure`, which at
1 is a multiply by one. Shadows build one `ShadowGenerator` per directional or
spot light and enrol every mesh, including meshes attached afterwards. Ambient
and point lights are excluded: ambient has no direction to project from, and a
point light needs a cube map, which is six renders a frame for a fill nobody is
looking at.

Both exclude point lights, and both leave the picture untouched at the neutral
descriptor. Where they differ is in shadow softness and bias, which is a quality
difference and not a semantic one.

---

## 5. The boundary is closed again

31 methods. The next thing that wants to reach the renderer goes through this
same process: a finding, an amendment, a conformance test in both backends, and
an entry here.
