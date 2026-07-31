# Implementation Report — Phase 2.3, Runtime Core

**Date:** 2026-08-01 · **Branch:** `phase-2-engine`
**Commits:** `071df91` (clock) · `1524b1f` (state + commands) · `1beec48` (events, scheduler, lifecycle, services, runtime)
**Gate:** see §11

---

## 1. What was implemented

The engine kernel. Every subsystem from Phase 2.4 onward registers a stage and
executes on it; none runs its own loop, reads its own clock, or mutates runtime
state directly.

| Subsystem | Module | Role |
|---|---|---|
| Rational arithmetic | `rational.ts` | Exact broadcast frame rates |
| Runtime clock | `clock.ts` | The single authoritative time source |
| Hashing | `hash.ts` | Canonical structural hashing |
| Runtime state | `state.ts` | Runtime domain, isolated from the document |
| Commands | `commands.ts` | The only runtime-state mutation path |
| Events | `events.ts` | Signals (sync, engine) and Events (deferred, open) |
| Scheduler | `scheduler.ts` | Phase-ordered execution, budget, degradation |
| Lifecycle | `lifecycle.ts` | Boot → … → Shutdown, illegal transitions throw |
| Services | `services.ts` | Per-runtime registry and id allocation |
| Runtime | `runtime.ts` | The kernel binding all of it |

### Pipeline

`Phase` fixes execution order; registration order does not affect it.

| Phase | Owner |
|---|---|
| Time | Runtime (clock advance in `tick`) |
| Input | **Slot** — external input → commands |
| Commands | **Runtime** — `runtime.commands` |
| StateUpdate | **Runtime** — `runtime.stateUpdate` |
| VariableResolution | **Slot** — Phase 2.4+ |
| Animation | **Slot** — Phase 5 |
| SceneEvaluation | **Slot** — Phase 2.4+ |
| Projection | **Slot** — Phase 2.4 reconciler |
| Reconciliation | **Slot** — Phase 2.4 |
| RenderSubmission | **Slot** — Phase 2.5/2.6 |
| FrameEnd | **Runtime** — `runtime.frameEnd` |

Slots contain no placeholder code. A phase with nothing registered does not
run — there is nothing to delete later.

## 2. Files added

```
packages/engine-runtime/src/
  rational.ts            rational.ts + FRAME_RATES
  clock.ts               RuntimeClock, timecode
  hash.ts                canonicalString, hashString, hashValue
  state.ts               RuntimeState, RuntimeStateOps, resolveVariable
  commands.ts            Command, CommandQueue, applyCommand, replayCommands
  events.ts              SignalBus, EventBus, ENGINE_EVENTS
  scheduler.ts           Phase, Scheduler, FrameReport
  lifecycle.ts           Lifecycle, LifecycleState
  services.ts            ServiceRegistry, IdAllocator, serviceKey
  runtime.ts             Runtime, TickReport
  clock.test.ts          39 tests
  state.test.ts          42 tests
  runtime.test.ts        46 tests
  determinism.test.ts    10 property-based tests
  runtime.bench.ts       21 benchmarks
docs/
  RUNTIME_VERIFICATION.md
  IMPLEMENTATION_REPORT_PHASE_2_3.md
```

## 3. Files modified

| File | Change |
|---|---|
| `packages/engine-runtime/src/index.ts` | Public surface |
| `packages/engine-runtime/package.json` | `bench` script |

No file outside `engine-runtime` and `docs/` was touched. **[Proven]** by the
commit diffs.

## 4. Public API

**Clock** — `RuntimeClock`, `framesToTimecode`, `isDropFrame`, `nominalRate`
**Rational** — `rational`, `add`/`subtract`/`multiply`/`divide`/`compare`/`equals`, `FRAME_RATES`
**State** — `createRuntimeState`, `RuntimeStateOps`, `resolveVariable`, `canonicalizeRuntimeState`, `hashRuntimeState`, `runtimeStatesEqual`
**Commands** — `Command`, `CommandQueue`, `applyCommand`, `validateCommand`, `replayCommands`
**Events** — `SignalBus`, `EventBus`, `ENGINE_EVENTS`, priority constants
**Scheduler** — `Phase`, `PHASE_ORDER`, `Scheduler`, `Stage`, `FrameContext`
**Lifecycle** — `Lifecycle`, `LifecycleState`
**Services** — `ServiceRegistry`, `IdAllocator`, `serviceKey`
**Runtime** — `Runtime`, `TickReport`

Deliberately absent: any runtime-state serialiser, and any command inverse.
Both absences are asserted by test so adding one is a deliberate act.

## 5. Tests

**137 in `engine-runtime`; 295 across the workspace.**

| File | Count | Focus |
|---|---|---|
| `clock.test.ts` | 39 | Rational rates, drift, transport, speed, timecode, replay |
| `state.test.ts` | 42 | Hashing, isolation, transitions, resolution, queue, replay |
| `runtime.test.ts` | 46 | Signals, events, scheduler, lifecycle, services, runtime |
| `determinism.test.ts` | 10 | Property-based, ~50,000 generated commands |

Property tests use a seeded LCG rather than `Math.random`, so a failure is
reproducible from its seed. Every property assertion carries the seed in its
message.

## 6. Benchmarks

Full table in [RUNTIME_VERIFICATION §3](./RUNTIME_VERIFICATION.md#3-benchmarks).
Headline: **steady-state tick ~0.47 µs**, command dispatch **~1.0 µs**, empty
scheduler frame **~50 ns**.

Against a 16.6 ms budget the kernel is ~0.003% of a frame. **[Derived]** it is
not a bottleneck; the work that matters has not been written.

## 7. Complexity

| Subsystem | Design | Implementation | Testing | Debugging | Maintenance |
|---|---|---|---|---|---|
| Rational | Low | Low | Low | Low | Low |
| Clock | **High** | Medium | **High** | Medium | Low |
| Hashing | Medium | Low | Medium | Low | Low |
| State | Low | Low | Low | Low | Low |
| Commands | Medium | Medium | Medium | Medium | Medium |
| Events | **High** | Medium | **High** | **High** | Medium |
| Scheduler | **High** | Medium | **High** | **High** | Medium |
| Lifecycle | Low | Low | Low | Low | Low |
| Services | Low | Low | Low | Low | Low |
| Runtime | Medium | Low | Medium | Medium | Medium |

The clock's design complexity is concentrated entirely in *not accumulating*.
The implementation is short; arriving at derivation-from-origin as the only
correct shape was the work.

Events and scheduler are hardest to debug because failures are ordering
failures — they reproduce only under a particular interleaving. That is why
both have property tests rather than examples alone.

## 8. Known limitations

1. **Event isolation is weaker than originally claimed.** A handler cannot
   extend its own frame; it will delay the next. Documented, not hidden.
2. **Chunking is detected, not enforced.** A stage exceeding the budget is
   reported after the fact. Nothing can preempt it.
3. **`ExternalClock` is not implemented.** The clock accepts injected
   timestamps, which is the seam; genlock and timecode input arrive with the
   native runtime.
4. **No cross-process clock sync.** ARCHITECTURE_VERIFICATION D5 stands.
5. **Scheduler `now` defaults to a constant.** Deterministic by default, so a
   host wanting real budget enforcement must inject a real timer. Intentional,
   and a trap if forgotten.
6. **Benchmarks are single-machine.** No cross-platform baseline.

## 9. Unknowns

| # | Unknown | Resolved by |
|---|---|---|
| U1 | Frame budget under real subsystems | Phase 3 |
| U2 | Cross-platform determinism | CI on a second architecture |
| U3 | Memory behaviour over an 8-hour session | Soak test, Phase 3 |
| U4 | Whether coalescing is aggressive enough for a 60 Hz feed | Phase 10 |
| U5 | Whether P0/P1/P2 is the right granularity | Phase 6 |

## 10. Implementation findings

Three defects found during Phase 2.3, all by test or benchmark rather than
review. None meets ADR-013's reopening criteria; all were implementation
defects.

### F1 — Clock rewound show time under a stale timestamp · fixed

The backwards-timestamp guard compared the incoming timestamp against the
playback *origin*. A timestamp after the origin but before the previous call
still produced a lower frame. **[Proven]** by a failing test: frame went 60 → 30.

Monotonicity is now enforced on the derived frame itself and asserted over 2000
disordered timestamps. Rewinding on air would replay frames an audience has
already seen.

### F2 — `tick()` hashed state every frame · fixed

Canonicalisation ran on every tick whether or not anyone read the result, and
its cost grows with variable count. Every test passed before and after — this
was invisible to correctness testing and visible only to a benchmark.

Deferring it made steady-state ticking **6.7× faster**.

### F3 — Batch pre-validation needed a throwaway clock · accepted

Validating a batch atomically requires knowing whether a later member is valid
*given* earlier members (pause then resume). That needs applying candidate
commands, which needs a clock, which must not be the real one.

Resolved with a short-lived clone whose frame is discarded. **Accepted as a
wart:** it is the one place where command application is not purely a function
of state. If batches later need scene state too, the clone approach will not
extend and this should be revisited.

## 11. ADR-013 reopening requests

**None.**

| Criterion | Met |
|---|---|
| A published requirement cannot be satisfied | No |
| Two published invariants contradict | No |
| A subsystem boundary cannot be maintained | No |
| A benchmark disproves an assumption | No — benchmarks confirmed the kernel is cheap |
| A prototype disproves an assumption | No |
| A documented invariant cannot be enforced | **Partially, and already documented.** I5 is detectable but not enforceable — JavaScript cannot preempt. This was already recorded in ENGINE_RUNTIME §2.2 and ARCHITECTURE_VERIFICATION D4, so it confirms a known limitation rather than exposing a new contradiction |
| A correctness proof is invalid | No |
| A production scenario exposes undefined behaviour | No |

## 12. Phase gate

# PASS

Against the stated success criteria:

| Criterion | Status |
|---|---|
| Runtime is the single execution authority | **Met** — `Phase` fixes order; slots exist for every future subsystem |
| Runtime and document state completely isolated | **Met** — separate packages, no serialiser, no inverse, asserted by test |
| Replay determinism proven by executable tests | **Met** — 250 seeds, ~50,000 commands |
| Property-based testing passes | **Met** — 10 properties, seeded and reproducible |
| Benchmarks recorded | **Met** — 21 benchmarks, one acted on |
| No architectural invariant violated | **Met** |
| No subsystem bypasses the runtime | **Met** — vacuously; no other subsystem exists yet, and the slots are the only way in |
| Every implementation finding documented | **Met** — §10 |

**Ready for Phase 2.4 (Reconciler).** The Projection and Reconciliation phase
slots exist and are empty; `MirrorBackend` is specified; the operation stream
that projection consumes is implemented and tested.
