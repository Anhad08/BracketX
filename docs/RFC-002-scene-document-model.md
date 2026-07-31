# RFC-002 — Scene Document Model

**Resolves:** gate **G2** and [PRODUCT.md P3](./PRODUCT.md#7-open-product-questions)'s
architectural half · **Status:** Accepted · **Authored:** 2026-07-30
**Owner:** @Pixelborne

> Binding on the scene engine, the editor, the history system, and any future
> collaboration layer. Changing §3–§7 requires a superseding RFC.

---

## 1. Decision

**Snapshot at rest, operations in motion.**

- The document **stored** in Postgres and defined by
  [SCENE_FORMAT.md](./SCENE_FORMAT.md) is a plain JSON snapshot.
- The document **in memory** is mutated exclusively through typed, invertible
  **operations** grouped into **transactions**.
- Three CRDT-readiness properties are adopted now (§4). **No CRDT, no merge
  algorithm, and no multi-writer code is built.**

This is not a compromise between the two models — it uses each where it is
better. Snapshots load in one read and are readable in a database console.
Operations give correct undo, a change log, and the wire format collaboration
will eventually need.

## 2. The question this settles

Whether BracketX supports two people editing one scene simultaneously is a
product question ([P3](./PRODUCT.md#7-open-product-questions)) that is still
open, and this RFC does not answer it.

It answers the engineering half, which cannot wait: **what does the document
have to look like so that answering P3 "yes" later is a feature and not a
rewrite?** Phase 2 starts in weeks and produces the format every later phase
reads. Deciding this after the editor exists means rewriting the Scene Engine
and the Editor together.

## 3. Snapshot vs operation-based

| | Snapshot | Operation-based |
|---|---|---|
| Mutation | Replace the tree | Apply a typed op |
| Undo | Push whole trees, or diff | Apply the inverse op |
| Memory per undo step | Whole doc, or a computed patch | One small op |
| Change log | Reconstructed by diffing | Native |
| Collaboration path | Rewrite | Add a merge strategy |
| Cost to build | Lowest | Moderate |
| Debuggability | Inspect state | Inspect state **and** cause |

### Why not pure snapshot

Snapshot-with-structural-sharing (Immer-style) is genuinely good and would ship
Phase 2 faster. It fails on three counts specific to this product:

1. **Undo would be inferred, not stated.** Diffing two trees tells you *what*
   changed, never *why*. "Undo the last thing I did" becomes a heuristic over a
   diff, and it goes wrong exactly where the tree changed shape — reparenting,
   reordering, grouping.
2. **No change log.** Version history (Phase 12) and audit (Phase 16) both need
   one, and reconstructing intent from a sequence of trees is not possible.
3. **Collaboration becomes a rewrite**, which is the specific outcome this RFC
   exists to prevent.

### Why not full CRDT now

A CRDT document (Yjs, Automerge, or hand-rolled) makes collaboration nearly
free later. It also imposes, today:

- A document representation that is awkward to read, query, and diff in Postgres
- A second dependency in the hot path of the most consequential schema we own
- Merge semantics to reason about on every property, before a single user has
  asked for co-editing
- Larger documents and slower cold loads

That is a real price for a feature that is [Phase 12](./ROADMAP.md#phase-12--realtime-collaboration),
post-launch, and demand-gated. We take the parts that are cheap now and defer
the parts that are not.

## 4. The three properties that keep collaboration cheap

This is the substance of the RFC. Everything else follows.

### 4.1 Stable, globally-unique node identity

Every node carries an opaque `id`, generated client-side, unique within the
document and collision-safe across concurrently editing clients. Nothing —
operations, animation tracks, bindings, selection, history — ever refers to a
node by array index or path.

*Cost now:* none. *Cost if skipped:* every operation becomes path-based, and
concurrent edits invalidate each other's paths. Unfixable without a rewrite.

### 4.2 Mergeable sibling ordering

Sibling order is a **fractional index**: an ordered string key per node, with
the array sorted by it. Inserting between two siblings mints a key between their
keys — no neighbour is renumbered.

**This is the one item here with a real cost**, and it is the most debatable
call in this RFC:

*Cost now:* a key-generation utility (~50 lines), a sortedness invariant the
validator must enforce, and a document that is marginally less obvious to read
than a plain array.

*Cost if skipped:* array-index ordering is the textbook broken case under
concurrent edits — two clients inserting at index 2 silently clobber each
other's intent. Fixing it later is a **format migration plus a change to every
move/insert operation**, i.e. contained but genuinely painful.

*Reversal:* if P3 resolves to a firm single-operator product, drop fractional
indices and sort by array position. That is a one-way simplification and should
be taken deliberately, not by drift.

### 4.3 Operations are the only mutation path *for the document*

No code anywhere mutates a document directly — not the editor, not an importer,
not a migration, not AI generation. Everything goes through the operation layer.

> **Corrected 2026-07-30.** This originally read "operations are the only
> mutation path", unqualified, which
> [VERIFICATION D3](./ARCHITECTURE_VERIFICATION.md#d3--the-boundary-between-document-state-and-runtime-state-is-undefined--severe)
> proved to be either false or catastrophic. Live variable values change during
> a show; if those were operations, an 8-hour broadcast would generate ~1.7M
> undo entries and Ctrl-Z would rewind the score.
>
> There are **two state domains, each with exactly one mutation path**:
>
> | Domain | Contains | Path | Undoable | Persisted |
> |---|---|---|---|---|
> | **Document** | Structure, defaults, bindings, animation tracks, metadata | **Operations** | Yes | Yes |
> | **Runtime** | Current variable values, active states, playhead, residency | **Commands** | No | No |
>
> An operation may never mutate runtime state; a command may never mutate the
> document. Cascades run one-directionally as operations → events → commands,
> synchronously within the transaction boundary.
>
> Full treatment and proof:
> [ENGINE_RECONCILIATION §3.2](./ENGINE_RECONCILIATION.md#32-every-mutation-has-exactly-one-path).
> The design was always two domains; only one had been written down.

*Cost now:* discipline, plus indirection when writing editor features.
*Cost if skipped:* the operation log stops being a faithful record the moment
one code path bypasses it, and every guarantee built on it — undo, history,
collaboration — silently becomes unreliable.

## 5. Operations

An operation is the smallest meaningful, invertible change. Every operation
records enough prior state to invert itself without consulting the document, so
inversion is total and does not depend on replay order.

| Operation | Meaning |
|---|---|
| `node.insert` | Add a node under a parent at a fractional index |
| `node.remove` | Remove a node and its subtree |
| `node.move` | Reparent and/or reorder |
| `node.setProp` | Set one property at a path; carries the previous value |
| `variable.define` / `variable.remove` | Add or drop a scene variable |
| `variable.setDefault` | Change a variable's default |
| `binding.set` / `binding.clear` | Bind or unbind a property to a variable |
| `anim.upsertKeyframe` / `anim.removeKeyframe` | Animation track edits (Phase 5) |
| `anim.setTrackOptions` | Easing, duration, delay (Phase 5) |
| `doc.setMeta` | Scene name, canvas settings |

Deliberately **not** operations: anything expressible as a composition of the
above. There is no `node.duplicate` or `node.group` — those are transactions of
inserts and moves. Every additional primitive is another inverse to get right
and another case for a future merge strategy.

Animation operations are listed now, though Phase 5 implements them, so the
operation vocabulary does not need a breaking extension mid-project.

### Shape

Every operation carries: its type, the target id(s), the new value, the previous
value where applicable, and the `actorId` of who produced it. `actorId` is
present from day one — it costs one field and is what makes §7's local-undo
semantics possible later without a migration.

## 6. Transactions

A transaction is **one undo step**: an ordered list of operations applied
atomically, with a label for the UI ("Move layer", "Change fill").

Users think in intentions, not primitives. Grouping three nodes is one action to
a user and one transaction to us, regardless of how many operations it contains.
Undo granularity that matches the operation log rather than the user's intent is
a well-known way to make an editor feel broken.

**Coalescing.** Continuous input — dragging a node, scrubbing a colour — emits
many `node.setProp` operations. Consecutive transactions merge when they target
the same node and property and fall inside a short idle window. A drag becomes
one undo step, not four hundred.

## 7. History

- **Linear undo/redo.** Two stacks; a new transaction after an undo clears the
  redo stack. Branching history is a research project users do not ask for.
- **Undo applies inverses in reverse order**; redo re-applies the forward
  operations.
- **Bounded depth** with an explicit limit, since transactions retain previous
  values and an unbounded stack is a memory leak in a long editing session.
- **Persistence is not required.** Undo is session-scoped in v1. Cross-session
  history is version history (Phase 12), a different feature with different
  semantics.

### Local undo, and why it matters now

In a collaborative editor, undo must undo **your own** last change, not whatever
happened most recently — otherwise you revert a colleague's work by pressing
Ctrl-Z. That is why transactions carry `actorId` from the start.

v1 filters on a single actor, so the behaviour is identical to global undo.
Nothing is built for collaboration; the field that would otherwise be missing is
simply present.

## 8. Persistence

- **At rest:** a snapshot, per [SCENE_FORMAT.md](./SCENE_FORMAT.md). One row,
  one read, inspectable in `psql`. No replay to open a document.
- **In motion:** transactions. Autosave writes a new snapshot; it does not
  append to a log.
- **The operation log is not the source of truth in v1.** It exists in memory
  for undo. Persisting it is what Phase 12 adds, and doing so does not change
  the snapshot format — which is the point.

Loading a document that has never been edited must not require an operation
runtime at all. The render surface reads snapshots and has no operation code in
its bundle
([ARCHITECTURE.md §6.2](./ARCHITECTURE.md#62-render-surface)).

## 9. Explicitly not being built

Named so that "collaboration-ready" is not read as "collaborative":

- No CRDT, no OT, no merge algorithm
- No presence, cursors, or awareness
- No server-side document authority or op relay
- No conflict resolution of any kind
- No persisted operation log
- No cross-session or branching history

A second concurrent editor today would produce last-write-wins on autosave,
exactly as a snapshot-only design would. **The document is collaboration-ready;
the system is not collaborative.**

## 10. The path to collaboration

What Phase 12 adds, given this foundation:

1. Persist the operation log alongside snapshots
2. Relay operations between clients over the Phase 6 transport
3. Add a merge strategy — with stable ids (§4.1) and fractional ordering (§4.2)
   already in place, this is per-property last-write-wins with a Lamport
   timestamp, or a CRDT library adopted behind the existing operation interface
4. Enable actor-filtered undo (§7) by removing the single-actor assumption
5. Add presence as a separate ephemeral channel that never touches the document

Steps 1, 2, and 5 are additive. Step 3 is the only genuine design work, and it
is contained because the mutation surface is already a fixed, enumerable set of
operations rather than arbitrary tree mutation.

## 11. Consequences

**Accepted costs.** Editor features are more work than direct mutation: each
needs an operation with a correct inverse. Fractional indices make documents
slightly less readable. The operation vocabulary must be extended deliberately
whenever a new node capability lands, and every extension must define its
inverse.

**What is bought.** Undo that is correct by construction rather than by
diffing. A change log available whenever it is needed. A collaboration path that
is additive. And the ability to answer P3 "yes" without rewriting Phase 2 and
Phase 4 — which was the entire reason G2 gated the Scene Engine.

**If P3 resolves to single-operator permanently**, §4.2 can be dropped and the
rest still earns its cost through undo correctness and history alone.

## 12. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| S1 | Answer [P3](./PRODUCT.md#7-open-product-questions) — still open; this RFC removes the schedule pressure but not the question | Product | Phase 4 |
| S2 | Choose the fractional-index scheme (base62 midpoint vs LSEQ) and its rebalancing rule | Engineering | Phase 2 |
| S3 | Set the undo depth limit and the coalescing idle window from real editing sessions | Engineering | Phase 4 |
| S4 | Decide whether AI generation (Phase 8) emits one transaction or many | Product + Eng | Phase 8 |
