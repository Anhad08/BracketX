### Measured scaling exponent (cost ~ n^k)

Fitted by least squares over a doubling series. k≈1 linear, k≈2 quadratic.

| Operation | Wide k | Balanced k | Verdict |
| --- | --- | --- | --- |
| findNode (worst case) | 1.06 | 0.88 | linear |
| pathToNode (worst case) | 0.85 | 0.82 | linear |
| replaceNode (worst case) | 1.16 | 0.92 | linear |
| countNodes | 1.27 | 0.93 | superlinear |
| walk (full drain) | 0.93 | 0.91 | linear |
