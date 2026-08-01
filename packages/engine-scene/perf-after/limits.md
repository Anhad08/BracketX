### Maximum scene depth before RangeError

Node 24, default stack. Binary search for the largest depth that
completes without a stack overflow.

| Function | Max depth | Notes |
| --- | --- | --- |
| `findNode` | ~8,832 | recursive |
| `walk` | ~4,416 | recursive |
| `countNodes` | ~3,520 | recursive |
| `replaceNode` | ~7,168 | recursive |
| `pathToNode` | ~6,080 | recursive |
| `serialize` | ~1,520 | recursive |
| `canonicalize` | ~1,728 | recursive |
| `validateDocument` | ~1,344 | recursive |
