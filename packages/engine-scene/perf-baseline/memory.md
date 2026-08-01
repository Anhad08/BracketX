### Allocation per edit

Measured with --expose-gc; retained bytes are post-collection.

| Scene | Shape | Nodes rebuilt | Total nodes | Rebuilt % | Bytes/edit |
| --- | --- | --- | --- | --- | --- |
| 10,000 | wide | 2 | 10000 | 0.0% | 1,050,300 |
| 50,000 | wide | 2 | 50000 | 0.0% | 1,288,585 |
| 1,000 | deep | 501 | 1000 | 50.1% | 141,654 |
| 4,000 | deep | 2001 | 4000 | 50.0% | 560,979 |
| 10,000 | balanced | 6 | 10000 | 0.1% | 511,265 |
| 50,000 | balanced | 6 | 50000 | 0.0% | 2,551,409 |
| 10,000 | mixed | 100 | 10000 | 1.0% | 1,819,304 |
| 50,000 | mixed | 113 | 50000 | 0.2% | 2,449,618 |

### Transaction replay

| Scene | Ops | Total ms | ms/op |
| --- | --- | --- | --- |
| 1,000 | 50 | 1.640 | 0.0328 |
| 10,000 | 50 | 16.485 | 0.3297 |
| 50,000 | 50 | 80.857 | 1.6171 |
