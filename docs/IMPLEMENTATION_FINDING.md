# Implementation Findings

Append-only log of defects and contradictions discovered **during
implementation**, per the Phase 2 authorization. Each entry states whether it
meets an [ADR-013](./ARCHITECTURE.md#adr-013) reopening criterion.

Newest last.

---

## IF-001 — Mirror ownership is assigned to two different layers

**Raised:** 2026-08-01 · **Phase:** 2.1 (Engine Workspace) · **Severity:** High
**Status:** Resolved without reopening

### Observed behaviour

Determining the package structure for Phase 2.1 requires knowing which layer
owns the Three.js mirror objects. Two authoritative documents assign it
differently.

**[Proven]** [ENGINE_RECONCILIATION §2.2](./ENGINE_RECONCILIATION.md#22-object-table),
object table:

| Object | Owner |
|---|---|
| Mirror node (`Object3D`) | **Reconciler** |
| Derived material | **Reconciler** |
| Text geometry | **Reconciler** |

**[Proven]** [RENDER_ENGINE_EVALUATION §10](./RENDER_ENGINE_EVALUATION.md#10-migration-strategy--keeping-the-backend-replaceable),
coupling policy:

| Layer | Coupling | Rule |
|---|---|---|
| Engine core | **Zero** | emits a backend-neutral draw list |
| Render adapter | **Total** | **the only module that imports `three`** |

**[Derived]** `Object3D` is a Three.js type. If the Reconciler owns `Object3D`
instances, the Reconciler imports `three`. If only the render adapter may import
`three`, the Reconciler cannot own them. Both statements are published as
invariants and cannot both hold under a literal reading.

### Expected behaviour

Exactly one layer owns mirror objects, and the `three` import boundary is
enforceable by tooling with no exceptions.

### Evidence

**[Proven]** Grep of both documents confirms the quoted text. No document states
which layer the Reconciler belongs to. ENGINE_ARCHITECTURE §2's layer diagram
lists neither "Reconciler" nor "Render Adapter" as named layers — the
Reconciler was introduced later, by ENGINE_RECONCILIATION, and never placed.

### Root cause

**[Derived]** ENGINE_RECONCILIATION was written to close
[VERIFICATION D2](./ARCHITECTURE_VERIFICATION.md#d2--there-is-no-reconciler-and-disposable-cache-conceals-that--severe--missing-subsystem)
and specified the Reconciler's *responsibilities* thoroughly while never
assigning it a *layer*. The omission was invisible while both documents were
prose and became load-bearing the moment package boundaries had to be created.

**[Derived]** A second, subtler cause: RENDER_ENGINE_EVALUATION §10 describes
the seam as a "backend-neutral draw list", which implies an immediate-mode
handoff. Retained-mode rendering with Three.js has no per-frame draw list — the
mirror *is* the retained draw state. The phrase described a cleaner seam than
adopting Three.js actually produces.

### Resolution

**[Derived]** A reading exists that satisfies both documents' intent, so no
architectural decision changes. The Reconciler is **split along the boundary it
straddles**:

| Package | Layer | Owns | Imports `three` |
|---|---|---|---|
| `@bracketx/engine-reconciler` | Engine core | Projection algorithm, node→handle mapping, mirror **lifetime** | **No** |
| `@bracketx/engine-render-three` | Render adapter | Concrete `Object3D`, materials, geometry | **Yes — exclusively** |

`engine-reconciler` defines a `MirrorBackend` interface in backend-neutral terms
(opaque handles, transforms, component descriptors). `engine-render-three`
implements it.

**[Derived]** This preserves every published invariant:

- ENGINE_RECONCILIATION §2.2 — the Reconciler owns mirror lifetime: it decides
  when a mirror object is created, reparented, and disposed. It does so through
  handles rather than by holding `Object3D` references. Ownership as defined in
  §2.1 is *the right to construct and dispose*, which the Reconciler retains.
- RENDER_ENGINE_EVALUATION §10 — `three` is imported by exactly one package,
  lint-enforceable with no exception.
- ENGINE_RECONCILIATION §1.2 — projection over operations is unchanged; it
  operates on handles instead of concrete objects.

**[Derived]** It also improves the swap cost estimate's honesty: the
backend-replaceable surface is now exactly `engine-render-three`, and the
projection algorithm — the genuinely complex part — is backend-independent and
does not need rewriting to change backends.

### Architectural impact

**[Derived]** None to any frozen decision. One clarification required:
ENGINE_RECONCILIATION §2.2's owner column should read "Reconciler (lifetime) /
render adapter (instance)" for the three mirror rows.

**[Derived]** RENDER_ENGINE_EVALUATION §10's "backend-neutral draw list" should
be read as "backend-neutral interface". Correcting the phrase is documentation
hygiene, not a design change.

### ADR-013 reopening criteria

| Criterion | Met |
|---|---|
| A published requirement cannot be satisfied | No |
| **Two published invariants contradict each other** | **Yes, literally — but a reading satisfying both exists, so no decision requires reversal** |
| A subsystem boundary cannot be maintained | No — the split makes it *more* enforceable |
| A benchmark disproves an assumption | No |
| A prototype disproves an assumption | No |
| A documented invariant cannot be enforced | No |
| A correctness proof is invalid | No — ENGINE_RECONCILIATION §3.1's proof holds; ownership is unchanged, only its representation |
| A production scenario exposes undefined behaviour | No |

**Verdict: does not meet the bar for reopening.** Proceeding under the
resolution above.
