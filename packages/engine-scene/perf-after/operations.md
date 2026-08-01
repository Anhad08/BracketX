### Read operations (ms per call)

| Operation | Shape | 1k | 10k | 50k | Scaling 1k→50k |
| --- | --- | --- | --- | --- | --- |
| findNode (last id) | wide | 0.0336 | 0.3495 | 2.9919 | 89.0× |
| findNode (last id) | balanced | 0.0249 | 0.3277 | 0.4878 | 19.6× |
| pathToNode (last id) | wide | 0.0445 | 0.4193 | 3.0099 | 67.6× |
| pathToNode (last id) | balanced | 0.0295 | 0.4041 | 0.7680 | 26.0× |
| parentOf (last id) | wide | 0.0524 | 0.3623 | 3.3005 | 63.0× |
| parentOf (last id) | balanced | 0.0180 | 0.1904 | 0.4701 | 26.1× |
| countNodes | wide | 0.0325 | 0.3235 | 2.1276 | 65.5× |
| countNodes | balanced | 0.0220 | 0.2196 | 1.1533 | 52.4× |
| walk (full drain) | wide | 0.0724 | 0.7492 | 4.5697 | 63.1× |
| walk (full drain) | balanced | 0.1022 | 1.1732 | 6.7372 | 65.9× |

### Write operations (ms per call)

| Operation | Shape | 1k | 10k | 50k | Scaling 1k→50k |
| --- | --- | --- | --- | --- | --- |
| replaceNode (deepest) | wide | 0.0623 | 0.3093 | 2.1647 | 34.7× |
| replaceNode (deepest) | balanced | 0.0094 | 0.1071 | 0.2753 | 29.3× |
| node.setProp (op path) | wide | 0.0272 | 0.2666 | 2.1346 | 78.5× |
| node.setProp (op path) | balanced | 0.0097 | 0.1065 | 0.2667 | 27.5× |
| node.insert (op path) | wide | 0.0680 | 0.7563 | 6.3077 | 92.8× |
| node.insert (op path) | balanced | 0.0275 | 0.2758 | 1.3454 | 48.9× |
| insertChild (tree fn) | wide | 0.0332 | 0.3574 | 3.6282 | 109.3× |
| insertChild (tree fn) | balanced | 0.0005 | 0.0009 | 0.0005 | 1.0× |
| removeNode (deepest) | wide | 0.0646 | 0.3003 | 2.3534 | 36.4× |
| removeNode (deepest) | balanced | 0.0100 | 0.1624 | 0.2892 | 28.9× |

### Whole-document operations (ms per call)

| Operation | 1k | 10k | 50k | Scaling 1k→50k |
| --- | --- | --- | --- | --- |
| serialize | 1.9230 | 27.0932 | 138.4260 | 72.0× |
| canonicalize | 1.3947 | 27.4151 | 127.1791 | 91.2× |
| validateDocument | 2.2814 | 18.5474 | 91.1445 | 40.0× |
