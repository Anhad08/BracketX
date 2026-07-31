/**
 * Dot-path access into a node.
 *
 * Used by `node.setProp` and, later, by animation tracks — SCENE_FORMAT §10
 * binds tracks to dot paths so any property is animatable with no per-type
 * vocabulary. One implementation serves both.
 *
 * Paths address plain objects and arrays only: `transform.position.1`,
 * `components.0.props.content`.
 */

export class PropertyPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyPathError";
  }
}

export function parsePath(path: string): string[] {
  if (path.length === 0) throw new PropertyPathError("path must not be empty");
  const segments = path.split(".");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new PropertyPathError(`path "${path}" has an empty segment`);
    }
    // Guards against a path reaching Object.prototype. A document is
    // untrusted input; `__proto__.polluted` must not be addressable.
    if (
      segment === "__proto__" ||
      segment === "constructor" ||
      segment === "prototype"
    ) {
      throw new PropertyPathError(
        `path "${path}" contains the forbidden segment "${segment}"`,
      );
    }
  }
  return segments;
}

export function getAtPath(target: unknown, path: string): unknown {
  let current = target;
  for (const segment of parsePath(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Returns a copy with `path` set to `value`. Objects and arrays along the
 * path are cloned; everything else is shared.
 */
export function setAtPath<T>(target: T, path: string, value: unknown): T {
  const segments = parsePath(path);

  const write = (node: unknown, depth: number): unknown => {
    const segment = segments[depth]!;
    const last = depth === segments.length - 1;

    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) {
        throw new PropertyPathError(
          `index "${segment}" is out of range for path "${path}"`,
        );
      }
      const copy = [...node];
      copy[index] = last ? value : write(node[index], depth + 1);
      return copy;
    }

    if (node === null || typeof node !== "object") {
      throw new PropertyPathError(
        `path "${path}" traverses a non-object at segment "${segment}"`,
      );
    }

    const record = node as Record<string, unknown>;
    return {
      ...record,
      [segment]: last ? value : write(record[segment], depth + 1),
    };
  };

  return write(target, 0) as T;
}
