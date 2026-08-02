# ADR-013 Amendment 1 — Lights

**Date:** 2026-08-02 · **Status:** ACCEPTED · **Supersedes:** nothing
**Raised by:** [IF-002](./IMPLEMENTATION_FINDING_IF-002.md) · **Approved by:** CTO

The `MirrorBackend` boundary is reopened once, for lights, and closed again.

---

## 1. What changed

Four methods and one type. Nothing else.

```ts
type LightHandle = number & { readonly __brand: "LightHandle" };

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

`detach(node)` already existed and now clears a light like anything else.
`MirrorNodeSnapshot.attachment` gains `"light"`. The interface goes from 26
methods to 30.

---

## 2. Why this shape and no other

**A light is a node attachment, exactly as a camera is.** `createLight` /
`attachLight` are `createCamera` / `attachCamera` with a different descriptor.
That symmetry is the entire argument that this **completes** the boundary rather
than expanding it: the boundary already had a concept for "a resource whose
placement is the engine's business and whose parameters are the backend's", and
a light is one.

**The descriptor carries no position, no direction and no target.** A light is
placed by its node's world matrix and points down local **−Z**, the same
convention a camera looks down and the same one glTF §3.10.3 uses.

That is not tidiness. C3 forbids the backend deriving transforms, and a
descriptor carrying its own direction would be a **second source of truth** for
where a light points — one the engine could not animate, parent, instance or
hide, because none of those go through a descriptor. Keeping orientation in the
node is precisely what makes a light animatable by the existing timeline with no
new machinery, which is asserted in `hybrid.test.ts`.

**`createLight` returns a handle, not a `BackendResult`.** It matches
`createCamera` and differs from `createGeometry`: a light allocates no buffer
worth a budget, so there is nothing to refuse. A failure path nobody can trigger
is a branch every caller must handle and no backend can exercise.

---

## 3. Every invariant preserved

| | Clause | How |
| --- | --- | --- |
| C1 | Handles opaque | `LightHandle` is a branded number; no caller inspects one |
| C2 | Lifetime is the caller's | `#applyLight` creates once, `#releaseLight` destroys once; both backends throw on a double free, asserted |
| C3 | No implicit computation | The descriptor has no transform. Three's target object is placed by composing the **engine's** world matrix with a constant −Z offset; nothing derives an orientation |
| C4 | Idempotence | `updateLight` called twice with the same descriptor is asserted to leave the attachment unchanged |
| C5 | Ordering | `attachLight` requires the light to exist, exactly as `attachCamera` requires the camera |
| C6 | Single thread | Unchanged |
| C7 | Errors returned, not thrown | Unchanged — nothing here is recoverable, and violations still throw |
| C8 | Determinism scope | Unchanged; lighting is pixel output, already out of scope |
| C9 | Premultiplied alpha | Colours arrive premultiplied linear. Three wants unpremultiplied plus a separate intensity, so alpha is divided back out in `applyLight` — a silent mismatch would darken every light by its own alpha |
| C10 | Column-major | Unchanged; lights carry no matrix at all |

---

## 4. Explicitly excluded

**Environment maps · HDRIs · Skyboxes · Reflection probes · Image-based
lighting.**

Not deferred for effort. They are **scene-level, not node-level**: none of them
is a thing that hangs off a node with a transform, so giving them the
`attachX(node, handle)` shape would be forcing a shape they do not have — and a
boundary that fits nothing is worse than one that is missing something.

They get their own finding when a concrete consumer exists, which is the same
rule that produced this amendment.

Also excluded: scene-global lighting state, lighting in `RenderOptions`, and any
backend-derived transform. Each was considered in
[IF-002 §2](./IMPLEMENTATION_FINDING_IF-002.md) and each is the weakening the
freeze exists to prevent.

---

## 5. Conformance

`MockMirrorBackend` and `ThreeMirrorBackend` are asserted interchangeable for
lights, in the same suite that already asserts it for meshes and cameras:

- Each backend attaches, updates idempotently, detaches and destroys a light.
- Each refuses an unknown or double-freed handle.
- **Both produce byte-identical snapshots** for a scene with all four light
  kinds attached to a positioned node — `JSON.stringify(three.snapshot().nodes)
  === JSON.stringify(mock.snapshot().nodes)`.

That last one is the property that matters: adding lights must not make the two
backends distinguishable from the reconciler's side. It is the same assertion
that guarded the mesh path, extended rather than duplicated.

---

## 6. The boundary is closed again

30 methods. ADR-013 remains in force. The next capability that cannot be
expressed gets a finding, not a patch — and this amendment is the precedent for
what an accepted one looks like: one consumer, one shape, one symmetry argument,
and everything adjacent explicitly refused.
