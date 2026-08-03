# ADR-013 Amendment 2 — Texture quality

**Date:** 2026-08-03 · **Status:** ACCEPTED · **Supersedes:** nothing
**Raised by:** [IF-006](./IMPLEMENTATION_FINDING_IF-006.md) · **Approved by:** CTO

The `MirrorBackend` boundary is reopened once, for texture sampling quality, and
closed again. No method is added. One type gains two optional fields.

---

## 1. What changed

```ts
interface TextureDescriptor {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly format: "rgba8" | "r8";
  readonly filter: "nearest" | "linear";

  // Added by this amendment.
  /** Build a mip chain and sample it. Default false. */
  readonly mipmaps?: boolean;
  /** Anisotropic samples, clamped by the backend to what it supports. Default 1. */
  readonly anisotropy?: number;
}
```

The interface stays at 30 methods. Both fields are optional with defaults that
reproduce today's behaviour exactly, so every existing call site and any
third-party backend is unaffected.

---

## 2. Why this could not be inferred

The obvious alternative was to give the render adapter a rule — "mipmap anything
with `filter: "linear"`" — and change no contract at all. That is wrong, and the
reason is already in the codebase.

**The MSDF glyph atlas is uploaded with `filter: "linear"`.** Mipmapping it would
be a rendering bug: a distance field's meaning is the distance encoded at full
resolution, and averaging four texels of a distance field does not produce the
distance field of the average. Minified glyphs would lose their edges — the exact
failure MSDF exists to prevent.

So `filter` cannot carry this. "Interpolate between texels" and "build a
pre-filtered pyramid" are genuinely two decisions, and one atlas needs the first
without the second.

The other alternative — inspect the material kind — makes the texture's sampling
depend on who consumes it, which is worse: the same asset used as a logo and as
an emissive map would need two uploads.

---

## 3. Why the boundary is the right place

The three tests ADR-013 applies to any reopening:

**Is it a property of the resource, or of the renderer?** Of the resource. A
photograph wants a mip chain; a distance field does not; a 1:1 UI texture does
not care. That is knowledge the engine has and the backend cannot derive.

**Does it carry backend state across the boundary?** No. `mipmaps` is a boolean
and `anisotropy` is a count the backend clamps to its own capability. Nothing
flows back — C3 holds, and C8's exclusion of pixels from determinism is what
makes clamping legal rather than a divergence.

**Is it the narrowest change that solves it?** Yes. No method, no handle, no
lifetime change. C2 is untouched: whoever called `createTexture` still owns it.

---

## 4. Why it is not optional in product terms

The brief that raised it is explicit — "Correct mipmapping… No shimmering… No
blurry icons… If the renderer requires an ADR amendment to maintain rendering
quality, stop and raise the amendment rather than introducing compromises."

Concretely: a 512 px sponsor mark drawn into a 1.4-unit box on a 1080-line output
is minified roughly 3×. Without a mip chain every animated frame samples a
different aliased subset, and the logo crawls. It is most visible on exactly the
content broadcast graphics are made of — thin strokes, small type, high-contrast
edges — and it is the kind of defect that is obvious on air and invisible in a
still screenshot.

Anisotropy is included in the same amendment rather than a later one because a
logo on a perspective-tilted virtual set surface is minified unevenly, and a mip
chain alone answers that by over-blurring. Reopening the boundary twice for one
subject would be worse than reopening it once.

---

## 5. What the render adapter does with it

Nothing surprising, which is the point:

- `mipmaps: true` → `texture.generateMipmaps = true`, minification filter
  `LinearMipmapLinearFilter`. Otherwise both stay as they are today.
- `anisotropy` → clamped to `renderer.capabilities.getMaxAnisotropy()`.

The MSDF atlas passes neither and is therefore bit-identical to before this
amendment.

---

## 6. Scope

This amendment does **not** introduce compressed textures, texture arrays,
render targets as textures, or sRGB texture formats. Each has a real case and
none is needed for correct sampling of an RGBA8 image, which is the whole
subject here.
