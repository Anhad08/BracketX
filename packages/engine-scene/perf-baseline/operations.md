### Read operations (ms per call)

| Operation | Shape | 1k | 10k | 50k | Scaling 1k→50k |
| --- | --- | --- | --- | --- | --- |
| findNode (last id) | wide | 0.0446 | 0.7111 | 16.7439 | 375.4× |
| findNode (last id) | balanced | 0.0087 | 0.1019 | 0.2671 | 30.7× |
| pathToNode (last id) | wide | 0.0553 | 0.7724 | 17.5231 | 316.9× |
| pathToNode (last id) | balanced | 0.0091 | 0.1038 | 0.2682 | 29.5× |
| parentOf (last id) | wide | 0.0287 | 0.6288 | 17.6015 | 613.3× |
| parentOf (last id) | balanced | 0.0092 | 0.1053 | 0.2732 | 29.7× |
| countNodes | wide | 0.0428 | 0.6605 | 15.7316 | 367.6× |
| countNodes | balanced | 0.0163 | 0.1921 | 0.8990 | 55.2× |
| walk (full drain) | wide | 0.0838 | 1.1773 | 20.5985 | 245.8× |
| walk (full drain) | balanced | 0.0973 | 1.2531 | 6.2374 | 64.1× |

### Write operations (ms per call)

| Operation | Shape | 1k | 10k | 50k | Scaling 1k→50k |
| --- | --- | --- | --- | --- | --- |
| replaceNode (deepest) | wide | 0.0712 | 0.7886 | 17.6204 | 247.5× |
| replaceNode (deepest) | balanced | 0.0206 | 0.2021 | 1.1007 | 53.4× |
| node.setProp (op path) | wide | 0.0666 | 1.3152 | 34.7338 | 521.5× |
| node.setProp (op path) | balanced | 0.0287 | 0.2908 | 1.3600 | 47.4× |
| node.insert (op path) | wide | 0.1361 | 2.7454 | 97.4042 | 715.7× |
| node.insert (op path) | balanced | 0.0166 | 0.1750 | 0.8841 | 53.3× |
| insertChild (tree fn) | wide | 0.0873 | 1.7878 | 64.1138 | 734.4× |
| insertChild (tree fn) | balanced | 0.0007 | 0.0007 | 0.0007 | 1.0× |
| removeNode (deepest) | wide | 0.0937 | 1.2875 | 30.6431 | 327.0× |
| removeNode (deepest) | balanced | 0.0201 | 0.2021 | 1.1435 | 56.9× |

### Whole-document operations (ms per call)

| Operation | 1k | 10k | 50k | Scaling 1k→50k |
| --- | --- | --- | --- | --- |
| serialize | 1.8319 | 22.0846 | 118.1176 | 64.5× |
| canonicalize | 2.1104 | 25.0968 | 115.1788 | 54.6× |
| validateDocument | 1.7059 | 15.5629 | 85.4431 | 50.1× |
