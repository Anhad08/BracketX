# engine-scene CPU profile — self time

Total samples: 2824 (sampling interval 100µs)

Self time means the function was on top of the stack — it is the
function doing the work, not merely calling something slow.

| Rank | Function | Samples | % of engine-scene |
| --- | --- | --- | --- |
| 1 | `midpoint — order.ts:38` | 445 | 16.6% |
| 2 | `requireNode — operations.ts:102` | 351 | 13.1% |
| 3 | `assertValid — order.ts:13` | 296 | 11.0% |
| 4 | `serialize — serialize.ts:50` | 229 | 8.5% |
| 5 | `replaceNode — tree.ts:52` | 184 | 6.9% |
| 6 | `updateNode — operations.ts:119` | 163 | 6.1% |
| 7 | `findNode — tree.ts:32` | 158 | 5.9% |
| 8 | `childrenOf — tree.ts:19` | 102 | 3.8% |
| 9 | `pathToNode — tree.ts:40` | 89 | 3.3% |
| 10 | `walk — tree.ts:28` | 81 | 3.0% |
| 11 | `(anonymous) — tree.ts:66` | 78 | 2.9% |
| 12 | `normalise — serialize.ts:17` | 74 | 2.8% |
| 13 | `generateKeyBetween — order.ts:28` | 71 | 2.6% |
| 14 | `workload — profile.perf.ts:29` | 64 | 2.4% |
| 15 | `canonicalize — serialize.ts:53` | 60 | 2.2% |
| 16 | `validateDocument — validate.ts:11` | 49 | 1.8% |
| 17 | `nonFinitePaths — validate.ts:209` | 49 | 1.8% |
| 18 | `sortKeys — serialize.ts:39` | 40 | 1.5% |
| 19 | `applyOperation — operations.ts:126` | 34 | 1.3% |
| 20 | `(anonymous) — serialize.ts:27` | 16 | 0.6% |
| 21 | `parentOf — tree.ts:48` | 14 | 0.5% |
| 22 | `(anonymous) — validate.ts:220` | 12 | 0.4% |
| 23 | `generateScene — perf-support.ts:36` | 10 | 0.4% |
| 24 | `(anonymous) — tree.ts:68` | 9 | 0.3% |
| 25 | `visit — validate.ts:199` | 8 | 0.3% |
