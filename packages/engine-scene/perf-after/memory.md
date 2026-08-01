### Allocation per edit

Measured with --expose-gc; retained bytes are post-collection.

| Scene | Shape | Nodes rebuilt | Total nodes | Rebuilt % | Bytes/edit |
| --- | --- | --- | --- | --- | --- |
| 10,000 | wide | 2 | 10000 | 0.0% | 257,894 |
| 50,000 | wide | 2 | 50000 | 0.0% | 1,251,486 |
| 1,000 | deep | 501 | 1000 | 50.1% | 141,768 |
| 4,000 | deep | 2001 | 4000 | 50.0% | 561,100 |
| 10,000 | balanced | 6 | 10000 | 0.1% | 2,238 |
| 50,000 | balanced | 6 | 50000 | 0.0% | 2,116 |
| 10,000 | mixed | 100 | 10000 | 1.0% | 30,607 |
| 50,000 | mixed | 113 | 50000 | 0.2% | 36,054 |

### Transaction replay

| Scene | Ops | Total ms | ms/op |
| --- | --- | --- | --- |
| 1,000 | 50 | 1.030 | 0.0206 |
| 10,000 | 50 | 7.869 | 0.1574 |
| 50,000 | 50 | 30.189 | 0.6038 |
