/**
 * Stage 8b — the glyph atlas. TEXT_ENGINE §5.
 *
 * ============================================================================
 * EVICTION IS A NORMAL OPERATING MODE, NOT AN ERROR PATH
 * ============================================================================
 * A 2048² page holds only a few hundred CJK glyphs at broadcast sizes, and a
 * Korean or Japanese player name is routine. So the atlas WILL run out, during a
 * show, and the code that handles it is the code that runs on air — not a
 * fallback nobody exercises.
 *
 * That is why eviction is tested as a normal mode rather than as a failure, and
 * why pinning exists: an evicted glyph that is currently on screen would blank
 * a character mid-broadcast. ENGINE_RUNTIME §4.4 makes on-air resources
 * un-evictable, and this is that rule for text.
 *
 * ============================================================================
 * SIZE BUCKETS
 * ============================================================================
 * The key is `(fontId, glyphId, sizeBucket)`, and sizes bucket to powers of √2.
 * Without bucketing, a scale animation regenerates every glyph on every frame —
 * 48.0, 48.3, 48.7 are three different keys — which is the specific way a text
 * atlas destroys a frame budget. With it, a graphic scaling from 24 to 96 pt
 * touches three buckets in total.
 *
 * A distance field is resolution-independent by construction, so sampling a
 * bucket at a nearby size is exactly what MSDF is for. The bucket is a
 * generation decision, never a layout one: layout uses the requested size.
 */
import type { MsdfGlyph } from "./msdf";

/** Where a glyph lives, and how to place it. */
export interface AtlasEntry {
  readonly page: number;
  /** Texel rect within the page. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The field's box in FONT UNITS, relative to the glyph origin. */
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

export interface AtlasPage {
  readonly index: number;
  readonly size: number;
  /** RGBA texels. Handed to `createTexture` once, then updated by region. */
  readonly pixels: Uint8Array;
  /** Regions written since the last flush, for `updateTexture`. */
  readonly dirty: { x: number; y: number; width: number; height: number }[];
}

export interface AtlasOptions {
  /** Page edge in texels. 2048 in production; small in tests, to force eviction. */
  readonly pageSize?: number;
  /** Distance range in texels. Reaches the material as `pxRange`. */
  readonly pxRange?: number;
  /** Texels of separation, so bilinear sampling cannot bleed between glyphs. */
  readonly padding?: number;
}

/**
 * A skyline row. Bottom-left packing, one array of horizontal spans per page.
 *
 * Skyline rather than shelf: a shelf allocator wastes the full height of a row
 * on a short glyph, and a Latin set is mostly short glyphs with a few tall ones.
 * Skyline is a few more lines and packs a mixed-height set far better.
 */
interface SkylineNode {
  x: number;
  y: number;
  width: number;
}

class Page {
  readonly index: number;
  readonly size: number;
  readonly pixels: Uint8Array;
  readonly dirty: { x: number; y: number; width: number; height: number }[] = [];
  #skyline: SkylineNode[];

  constructor(index: number, size: number) {
    this.index = index;
    this.size = size;
    this.pixels = new Uint8Array(size * size * 4);
    this.#skyline = [{ x: 0, y: 0, width: size }];
  }

  /** Lowest position where a rect fits, or null. */
  find(width: number, height: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestY = Infinity;

    for (let index = 0; index < this.#skyline.length; index += 1) {
      const node = this.#skyline[index]!;
      if (node.x + width > this.size) break;

      // The rect rests on the HIGHEST skyline it spans, or it would overlap.
      let y = node.y;
      let remaining = width;
      let at = index;
      while (remaining > 0 && at < this.#skyline.length) {
        y = Math.max(y, this.#skyline[at]!.y);
        remaining -= this.#skyline[at]!.width;
        at += 1;
      }
      if (remaining > 0) break;
      if (y + height > this.size) continue;
      if (y < bestY) {
        bestY = y;
        best = { x: node.x, y };
      }
    }
    return best;
  }

  place(x: number, y: number, width: number, height: number): void {
    const next: SkylineNode[] = [];
    let inserted = false;

    for (const node of this.#skyline) {
      const overlaps = node.x < x + width && node.x + node.width > x;
      if (!overlaps) {
        next.push(node);
        continue;
      }
      if (!inserted) {
        next.push({ x, y: y + height, width });
        inserted = true;
      }
      // Keep the parts of the node the rect did not cover.
      if (node.x < x) next.push({ x: node.x, y: node.y, width: x - node.x });
      const right = node.x + node.width;
      if (right > x + width) {
        next.push({ x: x + width, y: node.y, width: right - (x + width) });
      }
    }

    next.sort((a, b) => a.x - b.x);
    // Merge equal-height neighbours, or the skyline grows without bound and
    // `find` gets linearly slower for the life of the show.
    const merged: SkylineNode[] = [];
    for (const node of next) {
      const last = merged[merged.length - 1];
      if (last !== undefined && last.y === node.y && last.x + last.width === node.x) {
        last.width += node.width;
      } else {
        merged.push({ ...node });
      }
    }
    this.#skyline = merged;
  }

  reset(): void {
    this.#skyline = [{ x: 0, y: 0, width: this.size }];
    this.pixels.fill(0);
    this.dirty.length = 0;
    this.dirty.push({ x: 0, y: 0, width: this.size, height: this.size });
  }
}

interface Slot {
  readonly entry: AtlasEntry;
  /** Monotonic counter. The LRU order without a clock. */
  used: number;
  pinned: number;
}

export class GlyphAtlas {
  readonly pageSize: number;
  readonly pxRange: number;
  readonly padding: number;

  readonly #pages: Page[] = [];
  readonly #slots = new Map<string, Slot>();
  #clock = 0;
  #evictions = 0;
  #resets = 0;

  constructor(options: AtlasOptions = {}) {
    this.pageSize = options.pageSize ?? 2048;
    this.pxRange = options.pxRange ?? 4;
    this.padding = options.padding ?? 1;
  }

  get pages(): readonly AtlasPage[] {
    return this.#pages;
  }

  /**
   * The size bucket for a requested size. Powers of √2.
   *
   * Never below 1: a bucket of 0 would generate a zero-texel field, and a
   * graphic animating its scale through zero would ask for exactly that.
   */
  static bucketFor(size: number): number {
    if (!Number.isFinite(size) || size <= 1) return 1;
    const step = Math.round(Math.log(size) / Math.log(Math.SQRT2));
    return Math.max(1, Math.round(Math.SQRT2 ** step));
  }

  static keyFor(fontId: string, glyph: number, bucket: number): string {
    return `${fontId}/${glyph}/${bucket}`;
  }

  /** Looks a glyph up and marks it used. */
  get(fontId: string, glyph: number, bucket: number): AtlasEntry | undefined {
    const slot = this.#slots.get(GlyphAtlas.keyFor(fontId, glyph, bucket));
    if (slot === undefined) return undefined;
    slot.used = (this.#clock += 1);
    return slot.entry;
  }

  has(fontId: string, glyph: number, bucket: number): boolean {
    return this.#slots.has(GlyphAtlas.keyFor(fontId, glyph, bucket));
  }

  /**
   * Adds a rasterised glyph, evicting if necessary.
   *
   * Returns `null` only when the glyph cannot fit even in an empty page — a
   * single glyph larger than a whole atlas page. That is an authoring error
   * (a 4000pt character), and the node renders without it rather than the
   * atlas thrashing forever trying to make room that cannot exist.
   */
  add(fontId: string, glyph: number, bucket: number, msdf: MsdfGlyph): AtlasEntry | null {
    const key = GlyphAtlas.keyFor(fontId, glyph, bucket);
    const existing = this.#slots.get(key);
    if (existing !== undefined) return existing.entry;

    const width = msdf.width + this.padding * 2;
    const height = msdf.height + this.padding * 2;
    if (width > this.pageSize || height > this.pageSize) return null;

    let placement = this.#place(width, height);
    if (placement === null) {
      // Full. Evict the least recently used unpinned glyphs and try again.
      if (!this.#evict()) return null;
      placement = this.#place(width, height);
      if (placement === null) return null;
    }

    const { page, x, y } = placement;
    // Reserve the slot BEFORE writing it. Finding a position without claiming
    // it leaves the skyline flat, so every subsequent glyph is handed the same
    // spot and overwrites the last — a whole string renders as one repeated
    // character, and the atlas reports itself as never full. Caught by the
    // eviction test, which could not force an eviction because fifty-two
    // glyphs were all stacked in one corner.
    page.place(x, y, width, height);
    this.#blit(page, x + this.padding, y + this.padding, msdf.width, msdf.height, msdf.pixels);

    const entry: AtlasEntry = {
      page: page.index,
      x: x + this.padding,
      y: y + this.padding,
      width: msdf.width,
      height: msdf.height,
      left: msdf.left,
      bottom: msdf.bottom,
      right: msdf.right,
      top: msdf.top,
    };
    this.#slots.set(key, { entry, used: (this.#clock += 1), pinned: 0 });
    return entry;
  }

  #place(width: number, height: number): { page: Page; x: number; y: number } | null {
    for (const page of this.#pages) {
      const spot = page.find(width, height);
      if (spot !== null) return { page, x: spot.x, y: spot.y };
    }
    // A new page, up to the point where growing is worse than evicting. Two
    // pages of 2048² is 32MB of GPU memory; unbounded growth is how a long
    // show runs a machine out of VRAM rather than reusing space it already has.
    if (this.#pages.length >= MAX_PAGES) return null;
    const page = new Page(this.#pages.length, this.pageSize);
    this.#pages.push(page);
    const spot = page.find(width, height);
    return spot === null ? null : { page, x: spot.x, y: spot.y };
  }

  #blit(
    page: Page,
    x: number,
    y: number,
    width: number,
    height: number,
    pixels: Uint8Array,
  ): void {
    for (let row = 0; row < height; row += 1) {
      const source = row * width * 4;
      const target = ((y + row) * page.size + x) * 4;
      page.pixels.set(pixels.subarray(source, source + width * 4), target);
    }
    page.dirty.push({ x, y, width, height });
  }

  /** Copies a glyph's texels back out of its page, for repacking. */
  #extract(entry: AtlasEntry): Uint8Array {
    const page = this.#pages[entry.page]!;
    const out = new Uint8Array(entry.width * entry.height * 4);
    for (let row = 0; row < entry.height; row += 1) {
      const source = ((entry.y + row) * page.size + entry.x) * 4;
      out.set(page.pixels.subarray(source, source + entry.width * 4), row * entry.width * 4);
    }
    return out;
  }

  /**
   * Frees space by discarding the least recently used unpinned glyphs.
   *
   * ========================================================================
   * WHY A RESET AND NOT A HOLE-PUNCH
   * ========================================================================
   * A skyline allocator cannot free a rectangle in the middle of a page — the
   * skyline only records the top surface, so a freed hole is invisible to it.
   * Tracking holes turns this into a general allocator with fragmentation, a
   * coalescing pass, and a whole new class of bug.
   *
   * Instead, eviction rebuilds the page: keep the pinned and the most recently
   * used, drop the rest, repack. It costs one repack rather than a permanent
   * fragmentation problem, and it happens at the moment the atlas was going to
   * stall anyway.
   *
   * Returns false when nothing could be freed — every glyph is pinned, which
   * means the on-air set genuinely exceeds the atlas and no amount of eviction
   * will help.
   */
  #evict(): boolean {
    const entries = [...this.#slots.entries()];
    const unpinned = entries.filter(([, slot]) => slot.pinned === 0);
    if (unpinned.length === 0) return false;

    unpinned.sort((a, b) => a[1].used - b[1].used);
    // Half. Evicting one glyph at a time would repack the page per glyph, and
    // evicting everything would throw away a working set that is about to be
    // asked for again.
    const drop = Math.max(1, Math.floor(unpinned.length / 2));
    const dropped = new Set(unpinned.slice(0, drop).map(([key]) => key));
    this.#evictions += dropped.size;

    // Survivors' texels are copied OUT before the pages are cleared, and blitted
    // back after. Regenerating them would mean re-running MSDF for the whole
    // on-air set at the exact moment the atlas is already under pressure — a
    // stall during a show, which is what pinning exists to prevent. Copying is
    // a memcpy of the resident working set and nothing more.
    const survivors = entries
      .filter(([key]) => !dropped.has(key))
      .map(([key, slot]) => ({ key, slot, pixels: this.#extract(slot.entry) }));

    for (const page of this.#pages) page.reset();
    this.#slots.clear();
    this.#resets += 1;

    for (const { key, slot, pixels } of survivors) {
      const width = slot.entry.width + this.padding * 2;
      const height = slot.entry.height + this.padding * 2;
      const spot = this.#place(width, height);
      // A survivor that no longer fits means the PINNED set alone exceeds the
      // atlas. Dropping it is the only option left, and it is reported as an
      // eviction rather than silently lost.
      if (spot === null) {
        this.#evictions += 1;
        continue;
      }
      spot.page.place(spot.x, spot.y, width, height);
      this.#blit(
        spot.page,
        spot.x + this.padding,
        spot.y + this.padding,
        slot.entry.width,
        slot.entry.height,
        pixels,
      );
      this.#slots.set(key, {
        entry: {
          ...slot.entry,
          page: spot.page.index,
          x: spot.x + this.padding,
          y: spot.y + this.padding,
        },
        used: slot.used,
        pinned: slot.pinned,
      });
    }
    return true;
  }

  /**
   * Pins glyphs so eviction cannot take them. ENGINE_RUNTIME §4.4.
   *
   * Counted rather than boolean: two outputs can be showing the same graphic,
   * and the first one to go off air must not unpin glyphs the second is still
   * drawing.
   */
  pin(keys: readonly string[]): void {
    for (const key of keys) {
      const slot = this.#slots.get(key);
      if (slot !== undefined) slot.pinned += 1;
    }
  }

  unpin(keys: readonly string[]): void {
    for (const key of keys) {
      const slot = this.#slots.get(key);
      if (slot !== undefined && slot.pinned > 0) slot.pinned -= 1;
    }
  }

  /** Dirty regions per page, cleared. What the projector feeds `updateTexture`. */
  flush(): readonly { page: number; regions: readonly { x: number; y: number; width: number; height: number }[] }[] {
    const out = this.#pages
      .filter((page) => page.dirty.length > 0)
      .map((page) => ({ page: page.index, regions: [...page.dirty] }));
    for (const page of this.#pages) page.dirty.length = 0;
    return out;
  }

  stats(): {
    pages: number;
    glyphs: number;
    pinned: number;
    evictions: number;
    resets: number;
  } {
    let pinned = 0;
    for (const slot of this.#slots.values()) if (slot.pinned > 0) pinned += 1;
    return {
      pages: this.#pages.length,
      glyphs: this.#slots.size,
      pinned,
      evictions: this.#evictions,
      resets: this.#resets,
    };
  }
}

/** Two 2048² pages is 32MB. Beyond that, eviction is cheaper than more VRAM. */
const MAX_PAGES = 2;
