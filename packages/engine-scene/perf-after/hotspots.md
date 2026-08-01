# engine-scene CPU profile — self time

Total samples: 1129 (sampling interval 100µs)

Self time means the function was on top of the stack — it is the
function doing the work, not merely calling something slow.

| Rank | Function | Samples | % of engine-scene |
| --- | --- | --- | --- |
| 1 | `serialize — serialize.ts:50` | 216 | 21.7% |
| 2 | `findNode — tree.ts:34` | 164 | 16.5% |
| 3 | `walk — tree.ts:30` | 115 | 11.5% |
| 4 | `normalise — serialize.ts:17` | 95 | 9.5% |
| 5 | `childrenOf — tree.ts:21` | 65 | 6.5% |
| 6 | `replaceNode — tree.ts:59` | 55 | 5.5% |
| 7 | `nonFinitePaths — validate.ts:209` | 54 | 5.4% |
| 8 | `canonicalize — serialize.ts:53` | 44 | 4.4% |
| 9 | `sortKeys — serialize.ts:39` | 32 | 3.2% |
| 10 | `search — tree.ts:44` | 26 | 2.6% |
| 11 | `assertValid — order.ts:13` | 19 | 1.9% |
| 12 | `validateDocument — validate.ts:11` | 18 | 1.8% |
| 13 | `workload — profile.perf.ts:29` | 14 | 1.4% |
| 14 | `updateNode — operations.ts:117` | 12 | 1.2% |
| 15 | `(anonymous) — operations.ts:136` | 10 | 1.0% |
| 16 | `(anonymous) — serialize.ts:27` | 10 | 1.0% |
| 17 | `requireNode — operations.ts:102` | 8 | 0.8% |
| 18 | `withChildren — tree.ts:14` | 7 | 0.7% |
| 19 | `generateKeyBetween — order.ts:37` | 6 | 0.6% |
| 20 | `withChildInserted — tree.ts:74` | 5 | 0.5% |
| 21 | `round — math.ts:90` | 5 | 0.5% |
| 22 | `(anonymous) — validate.ts:220` | 5 | 0.5% |
| 23 | `generateScene — perf-support.ts:36` | 4 | 0.4% |
| 24 | `assertOrderKeyFreeIn — operations.ts:107` | 4 | 0.4% |
| 25 | `(anonymous) — ids.ts:36` | 3 | 0.3% |
