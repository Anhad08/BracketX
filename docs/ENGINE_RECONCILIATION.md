# BracketX — Reconciler & Ownership Model

**Status:** Phase 2 design · **Authored:** 2026-07-30 · **Owner:** @Pixelborne
**Closes:** [VERIFICATION D2](./ARCHITECTURE_VERIFICATION.md#d2--there-is-no-reconciler-and-disposable-cache-conceals-that--severe--missing-subsystem)
(missing reconciler) and [D3](./ARCHITECTURE_VERIFICATION.md#d3--the-boundary-between-document-state-and-runtime-state-is-undefined--severe)
(state boundary)
**Labelling:** **[Proven]** · **[Derived]** · **[Assumed]** · **[Unknown]**, per
[ARCHITECTURE_VERIFICATION](./ARCHITECTURE_VERIFICATION.md)

> These are engine subsystems, not implementation details. **[Derived]** The
> reconciler decides what the GPU sees; the ownership model decides what may
> exist. Every other subsystem depends on both, and both were previously
> unstated — which is why D2 and D3 were rated Severe.

---

## 1. The Reconciler

### 1.1 Responsibility

Maintain a Three.js object graph that is a **pure derivation** of the BracketX
scene document. Nothing else. It does not evaluate animation, resolve variables,
schedule work, or own resources.

### 1.2 It is a projector, not a differ — and this matters

**[Derived]** The obvious design is React-style: compare the document tree
against the mirror, compute a minimal patch. That is the right design *when you
do not know what changed*.

**[Proven]** We always know what changed.
[RFC-002 §4.3](./RFC-002-scene-document-model.md#43-operations-are-the-only-mutation-path)
established that operations are the only path by which a document may mutate,
and every operation is typed and carries its target.

**[Derived]** Therefore the reconciler never needs to diff. It **projects** each
operation onto the mirror. This eliminates the entire tree-comparison problem —
no keying heuristics, no reorder detection, no O(n) walk per change.

**[Derived]** This is the largest unanticipated payoff of the
operations-in-motion decision. It was justified in RFC-002 on undo correctness
and a collaboration path; it also happens to collapse the reconciler from a
diffing engine into a switch statement over ~10 operation types.

**[Derived]** D2 estimated the reconciler at 4–8 engineer-weeks assuming
diff-based reconciliation. Under projection, **[Assumed]** 2–3 weeks. That
estimate is unvalidated.

### 1.3 Three verbs, and only three

| Verb | Trigger | Cost |
|---|---|---|
| `build(document) → mirror` | Scene load, or recovery | O(nodes) |
| `project(transaction) → mirror'` | Every applied transaction | O(operations) |
| `teardown(mirror)` | Scene unload | O(nodes) |

**[Derived]** `build` is the ops-free path and exists because a freshly loaded
document has no operation history. It is also the recovery path: if the mirror
is ever suspected of drift, discard and rebuild. **[Derived]** Rebuild is
correct but cannot fit in a frame for a large scene, so it is a load-time and
diagnostic operation, never a live one.

**[Derived]** This corrects the "disposable cache" framing criticised in D2. The
mirror is **rebuildable but not routinely rebuilt**. Test T5 from
RENDER_ENGINE_EVALUATION should be reclassified: it verifies that the mirror is
a genuine derivation, not that rebuilding is a production path.

### 1.4 Operation → mirror projection

**[Derived]** Complete mapping for the operation set in
[RFC-002 §5](./RFC-002-scene-document-model.md#5-operations):

| Operation | Mirror effect |
|---|---|
| `node.insert` | Construct `Object3D`, attach components, insert at `order` |
| `node.remove` | Dispose subtree, detach, release resource handles |
| `node.move` | **Reparent the existing object.** Never destroy and recreate — that would drop GPU resources and restart any in-flight state |
| `node.setProp` | Route by property path to the owning component updater |
| `binding.set` / `binding.clear` | Re-resolve that property, then apply as `setProp` |
| `variable.define` / `variable.remove` / `variable.setDefault` | **No direct mirror effect.** May trigger re-resolution of bound properties |
| `anim.*` | **No mirror effect.** Animation is evaluated per frame; tracks are data |
| `doc.setMeta` | **No mirror effect** unless canvas dimensions change |

**[Derived]** Four of ten operation kinds touch the mirror at all. This is
further evidence the subsystem is smaller than a differ would be.

### 1.5 Projection is per-transaction, not per-operation

**[Derived]** A transaction is applied to the document in full, then projected
once. Projecting each operation individually would produce intermediate mirror
states that never correspond to a valid document — a grouping transaction, for
instance, passes through a state where nodes have been removed but not yet
re-inserted.

**[Derived]** This also collapses redundant work: a transaction setting the same
property three times projects once.

### 1.6 The mirror must not compute anything

**[Derived]** For the mirror to be a pure derivation, Three.js must not be
allowed to hold state we did not write. Concretely:

- `matrixAutoUpdate = false` on every object; **we** write world matrices
- No use of Three.js animation, no `AnimationMixer`
- No Three.js scene serialization, ever
- Object visibility written from the document, never inferred

**[Derived]** Without the first rule in particular, the mirror carries
transform state derived by Three's own traversal rather than by our runtime, and
the determinism boundary flagged in
[D6](./ARCHITECTURE_VERIFICATION.md#d6--the-determinism-boundary-against-threejs-is-undefined)
widens rather than closes.

**[Unknown]** Whether disabling `matrixAutoUpdate` measurably costs or saves
time versus Three's batched traversal. **Requires benchmark.**

### 1.7 Asynchronous resources — the hard case

**[Derived]** A node may reference an asset that has not loaded. This is the one
place where the mirror cannot be a synchronous function of the document, and it
is the defect generator.

**Resolution: two readiness modes.**

| Mode | Behaviour | Used by |
|---|---|---|
| **Strict** | The scene does not become `ready` until every referenced asset is resolved and every glyph is pre-warmed. Nothing renders before that | On-air outputs |
| **Progressive** | Nodes appear as their assets resolve; unresolved nodes render as bounds-only placeholders | Editor only |

**[Derived]** Strict mode is what makes on-air rendering deterministic: with all
resources resident and pinned, the fourth input identified in
[D1](./ARCHITECTURE_VERIFICATION.md#d1--the-runtime-purity-claim-has-an-undeclared-fourth-input--severe)
is constant for the lifetime of the scene, so purity holds **on the path where
it matters**.

**[Derived]** This also supplies the scene readiness state machine listed as
missing in VERIFICATION §6:

```
unloaded → parsing → resolving → prewarming → ready → live
                │         │            │
                └─────────┴────────────┴──▶ failed (terminal, reported)
```

**[Derived]** `failed` is terminal and explicit. A scene that cannot fully
resolve must never be promotable to `live`.

### 1.8 What the reconciler must not do

**[Derived]** Each of these would create a second mutation path or a second
owner, breaking §3's proofs:

- Evaluate animation — that is the runtime's, per frame
- Resolve variables — that is the resolve stage; the reconciler consumes results
- Load assets — it requests handles; the Resource Manager loads
- Generate text geometry — the Text Engine produces it; the reconciler uploads
- Decide render order, culling, or passes — those are the render graph's
- Own GPU memory — §2

## 2. Ownership Model

### 2.1 The ownership rule

> **Identity determines owner.**
> Content-addressed identity → **Resource Manager**.
> Node-scoped identity → **Reconciler**.
> Frame-scoped identity → **Render Graph**.

**[Derived]** This is a decision procedure, not a convention. Given any new
object class, ask what its identity is derived from, and the owner follows. It
resolves cases that "who creates it, owns it" cannot — a material derived from
an asset *plus* a node override has node-scoped identity even though it
originates from an asset.

### 2.2 Object table

**[Derived]** Every engine-visible runtime object class, with exactly one owner.

| Object | Owner | Identity | Lifetime ends |
|---|---|---|---|
| Scene document | Document Store | Scene id | Scene unload |
| Runtime state (values, active states, playhead) | Runtime Store | Scene instance | Scene unload |
| Mirror node (`Object3D`) | **Reconciler** | Node id | `node.remove` / teardown |
| Derived material (node override) | **Reconciler** | Node id + override hash | Node removal or override change |
| Text geometry (quads) | **Reconciler** | Node id | Node removal or layout change |
| Geometry (from glTF) | Resource Manager | Content hash | Refcount 0 + eviction |
| Texture | Resource Manager | Content hash | Refcount 0 + eviction |
| Base material (from glTF) | Resource Manager | Content hash | Refcount 0 + eviction |
| Parsed font | Resource Manager | Content hash | Refcount 0 + eviction |
| Glyph atlas page | **Text Engine** | Font + size bucket | LRU eviction, never while on air |
| Layout result | **Text Engine** | Layout key (§3.3) | Cache eviction |
| Render target | **Render Graph** | Pass + frame | Pass completion / pool reuse |
| Draw list | Runtime | Frame | End of frame |

### 2.3 Allocation ownership ≠ budget accounting

**[Proven]** VERIFICATION §5 flagged that both the render graph and memory
ownership claimed render targets.

**[Derived]** The ambiguity was a category error. **Ownership** is the right to
construct and dispose. **Accounting** is the obligation to report cost against a
budget. They are different responsibilities and may sit in different subsystems.

> Every object has exactly **one owner** and exactly **one accounting
> authority**. The Memory Manager is the accounting authority for all GPU
> objects and the owner of none.

**[Derived]** This resolves the conflict without moving ownership: the Render
Graph owns render targets and reports their cost to the Memory Manager, which
may signal pressure but may never dispose them.

### 2.4 The Three.js boundary — an honest limitation

**[Proven]** Three.js internally allocates objects we do not own: shader
programs, internal buffers, WebGL/WebGPU state caches.

**[Derived]** Therefore the property "every runtime object has exactly one
owner" is **false in the absolute** and true only over **engine-visible
objects**. Three's internals are opaque and owned by Three.

**[Derived]** The consequence is real, not cosmetic: our memory accounting will
under-report actual GPU usage by an unknown margin.

**[Unknown]** The size of that margin. **Requires benchmark.** Until measured,
the VRAM budget in [ENGINE_RUNTIME §4.3](./ENGINE_RUNTIME.md#43-budgets-per-resource-class)
must carry a headroom factor rather than being treated as exact.

## 3. The three proofs

### 3.1 "Every runtime object has exactly one owner"

**Status: [Derived], conditionally — proof is valid but rests on an unproven premise.**

*Proof.* §2.2 assigns exactly one owner to each object class. Ownership is total
(every class appears) and disjoint (no class appears twice) over that table.
Enforcement: only the owning module may construct or dispose its classes,
checkable by lint on constructor imports. §2.3 removes the render-target
conflict by separating ownership from accounting. ∎

*The premise it rests on:* **[Unknown]** whether §2.2 is complete. I enumerated
the object classes I could identify; I cannot prove no others exist. Novel
classes will appear during implementation — a shadow map allocation, an
occlusion query, a compute buffer.

*Mitigation, not proof:* the §2.1 rule is a **decision procedure**, so a new
class is assigned an owner by asking what its identity derives from, rather than
by argument. **[Derived]** The proof therefore extends to unknown classes
provided the rule is applied, and the failure mode is a forgotten class rather
than a contested one.

*Known exception:* Three.js internals (§2.4). The property holds over
engine-visible objects only, and this must be stated wherever the property is
relied upon.

### 3.2 "Every mutation has exactly one path"

**Status: [Derived] — but only after correcting a defect in RFC-002.**

**[Proven]** D3 established that RFC-002's claim — operations are the only
mutation path — is either false or produces an unbounded undo log, because live
variable values change during a show and are not document edits.

*Resolution: there are two state domains, each with exactly one path.*

| Domain | Contains | Mutated by | Undoable | Persisted |
|---|---|---|---|---|
| **Document** | Structure, defaults, bindings, animation tracks, metadata | **Operations** | Yes | Yes |
| **Runtime** | Current variable values, active states, playhead, residency | **Commands** | **No** | **No** |

**[Derived]** Commands are typed like operations and equally exclusive, but they
are not invertible, not logged for undo, and never persisted. An operator typing
a score issues a command. Changing that variable's *default* is an operation.

*Cross-domain rule:*

> An operation may never mutate runtime state. A command may never mutate the
> document.

*Cascades.* **[Derived]** Deleting a node must clear any runtime state
referencing it. That is a cascade, not a cross-domain mutation: applying a
transaction emits events, and runtime subsystems respond by issuing their own
commands.

**[Derived]** The cascade must complete **synchronously within the transaction
boundary**, before the next frame. An asynchronous cascade leaves a window in
which runtime state references a deleted node — a use-after-free with extra
steps.

*Proof.* Document mutation: only via `applyTransaction`, which is the only
function permitted to write the document store; enforced by module boundary.
Runtime mutation: only via `dispatchCommand`. Neither calls the other. Cascade
is event-driven and one-directional (operations → events → commands), so no
cycle exists. ∎

*Required corrections:* RFC-002 §4.3 currently overclaims and must be amended to
scope its statement to the document domain. **[Derived]** This is a
documentation defect, not a design change — the design was always two domains;
only one was written down.

### 3.3 "Every cache has a single source of truth"

**Status: the property as stated is [Derived] to be the wrong property. The corrected property holds.**

*Why the stated property fails.* The layout cache derives from the document
(box, font, fit mode) **and** from runtime state (the resolved variable value
supplying the text). Two sources. Under the property as written, the layout
cache is a violation — yet it is correct, necessary, and unavoidable, because
text content is data-driven by design.

**[Derived]** "Single source of truth" is the right property for *authority*
(who decides), and the wrong property for *derivation* (what a cache is
computed from). Every useful cache in a data-driven engine is multi-input.

*Corrected property:*

> Every cache is a **pure function of declared inputs**, and its invalidation
> key **covers every input**.

**[Derived]** This is strictly stronger where it matters. "Single source" does
not prevent a stale cache; a key that omits an input does exactly that, and it
is the actual bug this property is trying to exclude.

*Cache table:*

| Cache | Inputs | Invalidation key covers all inputs |
|---|---|---|
| Three.js mirror | Document | Yes — projection is driven by every operation |
| World matrices | Local transforms + hierarchy | Yes — dirty-flag propagation from root |
| Layout result | Content, font stack, size, box, fit mode | Yes — key is the tuple |
| Glyph atlas | Font binary, glyph id, size bucket | Yes |
| Resolved property values | Document value, binding, variable value | Yes |
| Draw list | Mirror, camera, layers, frame time | Yes — rebuilt per frame |

*Proof.* Each cache above declares its inputs and keys on all of them.
Correctness follows from purity: identical inputs produce identical outputs, so a
key covering all inputs cannot serve a stale result. ∎

*Residual risk:* **[Unknown]** whether every input is genuinely declared.
[D1](./ARCHITECTURE_VERIFICATION.md#d1--the-runtime-purity-claim-has-an-undeclared-fourth-input--severe)
is precisely the failure of an undeclared input at a larger scale, which is
evidence this class of mistake is easy to make and hard to see.

## 4. Ambiguities that remain open

**[Derived]** Stated rather than resolved, as instructed.

| # | Ambiguity | Why it cannot be closed now |
|---|---|---|
| A1 | Completeness of the object enumeration (§2.2) | **[Unknown]** until GPU work exists. Mitigated by the §2.1 decision procedure, not eliminated |
| A2 | Three.js internal allocation margin (§2.4) | **Requires benchmark** |
| A3 | Derived-material explosion — 64 teams in team colours could mean 64 materials | **[Derived]** dedupe by override hash makes identity content-addressed, which by §2.1 moves ownership to the Resource Manager. **[Unknown]** whether hashing costs more than it saves. **Requires benchmark** |
| A4 | Whether `matrixAutoUpdate = false` is a net win | **Requires benchmark** |
| A5 | Text geometry ownership under animated text | Layout changes per frame during a shrink animation. **[Unknown]** whether to re-own per frame or pool. **Requires benchmark** |
| A6 | Reconciler cost at scale | **[Assumed]** O(operations) is small. **[Unknown]** at 10k-node scenes. **Requires benchmark** |
| A7 | Cascade ordering when one transaction deletes a node whose animation is mid-playback on air | **[Derived]** synchronous cascade prevents dangling references, but the *visual* outcome — hard cut vs. play-out — is a product decision, not an engineering one |

**[Derived]** A7 is the only one that is not a benchmark or an enumeration
question, and it needs a product answer before Phase 5.

## 5. Invariants

For `ENGINE_INVARIANTS.md`, each with a mechanical check.

| # | Invariant | Check |
|---|---|---|
| R1 | Only the Reconciler constructs or disposes mirror objects | Lint on `three` constructor imports |
| R2 | `matrixAutoUpdate` is false on every mirror object | Runtime assertion in dev builds |
| R3 | The document store is written only by `applyTransaction` | Module boundary + lint |
| R4 | Runtime state is written only by `dispatchCommand` | Module boundary + lint |
| R5 | No operation handler writes runtime state; no command writes the document | Type separation |
| R6 | Cascades complete before the next frame boundary | Runtime assertion |
| R7 | A scene cannot enter `live` from any state but `ready` | State machine, unit-tested |
| R8 | Every cache key covers every declared input | Review checklist — **[Derived]** not mechanically checkable, which is the weakest invariant here |
| R9 | `build(document)` and `project(ops)` from the same start state produce identical mirrors | Property test |

**[Derived]** R9 is the strongest available check that projection is correct: it
asserts the two paths into the mirror agree, which is the property a diff-based
reconciler would give for free and a projector must earn.

## 6. Consequences for prior documents

| Document | Required change |
|---|---|
| [RFC-002 §4.3](./RFC-002-scene-document-model.md#43-operations-are-the-only-mutation-path) | Scope the claim to the document domain; add commands as the runtime path (§3.2) |
| [RENDER_ENGINE_EVALUATION §11](./RENDER_ENGINE_EVALUATION.md#11-this-is-a-paper-evaluation--the-empirical-spike-still-must-run) | Reclassify T5: it verifies derivability, not a production rebuild path (§1.3) |
| [ENGINE_RUNTIME §4](./ENGINE_RUNTIME.md#4-memory-ownership) | Adopt ownership vs accounting split (§2.3); add headroom factor for A2 |
| [ARCHITECTURE_VERIFICATION](./ARCHITECTURE_VERIFICATION.md) | D2 and D3 closed by this document; D1 narrowed — purity now holds on the on-air path via strict readiness (§1.7) |

## 7. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| N1 | Prototype `project` against a synthetic operation stream; validate the 2–3 week estimate | Engineering | Phase 2 |
| N2 | Benchmark A2, A3, A4, A5, A6 | Engineering | Phase 3 |
| N3 | Answer A7 — behaviour when a live node is deleted | Product | Phase 5 |
| N4 | Amend RFC-002 §4.3 | Engineering | Immediately |
