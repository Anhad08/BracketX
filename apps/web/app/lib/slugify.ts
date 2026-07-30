/**
 * Derives a URL slug from a display name.
 *
 * Kept intentionally close to `slugSchema` in @bracketx/core: lowercase
 * alphanumerics with single hyphens between them. This is a convenience for
 * the input field only — the server validates independently and is the
 * authority, so a mismatch here produces a visible validation error rather
 * than a bad record.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
