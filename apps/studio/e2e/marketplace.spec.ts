import { expect, test } from "@playwright/test";

/**
 * Marketplace discovery.
 *
 * Volume One §States writes the filtered-empty state out in full. It was absent:
 * filtering to nothing showed an EMPTY GRID — no words, no count, no action —
 * which answers Law 7's "what now?" with nothing at all.
 */
async function marketplace(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-marketplace").click();
  await expect(page.getByTestId("marketplace")).toBeVisible();
  return page.getByLabel("Search packs");
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`a search that matches nothing says so, and offers a way out — ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const search = await marketplace(page);

    const all = await page.locator('[data-testid^="pack-"]').count();
    expect(all, "no packs at all").toBeGreaterThan(1);

    // Real filtering first: a word that IS in the catalogue must reduce, not empty.
    await search.fill("motion");
    await expect(page.getByTestId("marketplace-empty")).toHaveCount(0);
    const matched = await page.locator('[data-testid^="pack-"]').count();
    expect(matched, "a real word matched nothing").toBeGreaterThan(0);
    expect(matched, "the filter did not actually filter").toBeLessThan(all);

    // A word nothing carries. NOT "esports" — Volume One's example copy uses it,
    // but this catalogue ships a pack called "Sport & Esports", so it matches.
    // The specified string is illustrative, not a fixture.
    await search.fill("zzqqxx");
    const empty = page.getByTestId("marketplace-empty");
    await expect(empty).toBeVisible();
    // It names the query back, which makes it a report rather than a shrug.
    await expect(empty).toContainText("zzqqxx");
    await expect(page.locator('[data-testid^="pack-"]')).toHaveCount(0);

    // And a way back that works.
    await page.getByTestId("empty-clear-filter").click();
    await expect(empty).toHaveCount(0);
    await expect(page.locator('[data-testid^="pack-"]')).toHaveCount(all);
    await expect(search).toHaveValue("");
  });
}

test("no card carries a rating, a star or a score", async ({ page }) => {
  await marketplace(page);
  // Volume Four Amendment 3 reversed the ratings model outright: "No subjective
  // ratings." Worth a regression, because stars are the first thing anyone
  // reaches for when designing a storefront.
  const body = (await page.getByTestId("marketplace").textContent()) ?? "";
  expect(body).not.toMatch(/★|⭐|\b\d(\.\d)?\s*\/\s*5\b|\breviews?\b|\brating\b/i);
});

test("a pack that ships templates shows the REAL graphic, never a swatch gradient", async ({
  page,
}) => {
  await marketplace(page);

  // `art.tsx` states the intent: "Home, Templates, the Marketplace and
  // Production's scene rail all show the same graphics." The Marketplace was the
  // one surface never wired to it, and showed a two-tone `pack.swatch` gradient
  // in place of artwork that already existed.
  const withTemplates = page.locator('[data-testid^="pack-"]', {
    has: page.locator(".pack-art .art-still"),
  });
  await expect(
    withTemplates.first(),
    "no pack rendered a real still",
  ).toBeVisible({ timeout: 30_000 });

  // THE REGRESSION THAT MATTERS: a card holding a real preview must not also be
  // falling back to the gradient. `data-preview="swatch"` marks the fallback, so
  // the two are distinguishable rather than a matter of inspection.
  await expect(withTemplates.first().locator('[data-preview="swatch"]')).toHaveCount(0);

  // And the still is a real rasterised image, not a 1x1 or a broken src.
  const size = await withTemplates
    .first()
    .locator(".pack-art .art-still")
    .evaluate((el) => {
      const img = el as HTMLImageElement;
      return { w: img.naturalWidth, h: img.naturalHeight };
    });
  expect(size.w, "the still has no pixels").toBeGreaterThan(32);
  expect(size.h, "the still has no pixels").toBeGreaterThan(32);
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`the hero features a real graphic and moves on user intent — ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await marketplace(page);

    const hero = page.getByTestId("mk-hero");
    await expect(hero).toBeVisible();

    // GLASS, and only here. Volume One permits exactly three locations and the
    // Marketplace hero is one; the card grid below must stay flush.
    const blurred = await hero.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(blurred, "the hero is not glass").not.toBe("none");
    const cardGlass = await page.locator(".pack-card").first().evaluate((el) =>
      getComputedStyle(el).backdropFilter,
    );
    expect(cardGlass, "glass leaked onto a pack card").toBe("none");

    // The featured graphic is REAL — a rasterised still with actual pixels.
    const still = hero.locator(".mk-hero-preview .art-still");
    await expect(still).toBeVisible({ timeout: 30_000 });
    const px = await still.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { w: img.naturalWidth, h: img.naturalHeight };
    });
    expect(px.w).toBeGreaterThan(64);
    expect(px.h).toBeGreaterThan(64);

    // Production voice, not an inventory. The claim is a sentence.
    await expect(hero.locator(".mk-claim")).not.toHaveText("");
    // Cost on the box.
    await expect(hero.locator(".mk-facts")).toContainText("Free");

    // USER-DRIVEN focus. Nothing advances on a timer, so the selection must be
    // unchanged after a wait, and must change when the user asks.
    const first = page.locator(".mk-deck-card.on");
    const before = await first.getAttribute("data-testid");
    await page.waitForTimeout(1500);
    await expect(page.locator(".mk-deck-card.on")).toHaveAttribute(
      "data-testid",
      before!,
    );

    // Focus moves through the PROGRESS ROW. The deck itself is scenery: with real
    // depth the cards overlap, so making each one a button meant the front card
    // occluded the rest and swallowed every click.
    const segments = page.locator(".mk-progress-seg");
    if ((await segments.count()) > 1) {
      const openingTitle = await hero.locator(".mk-hero-title").textContent();
      await segments.nth(1).click();
      await expect(segments.nth(1)).toHaveAttribute("aria-selected", "true");
      // The composition followed: a different pack is at the front of the deck,
      // and the copy beside it changed with it.
      await expect(hero.locator(".mk-hero-title")).not.toHaveText(openingTitle ?? "");
      const front = page.locator(".mk-deck-card.on");
      await expect(front).toHaveCount(1);
      await expect(front).toHaveAttribute("data-offset", "0");
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
  });
}

test("the deck states its length, and every card is reachable", async ({ page }) => {
  await marketplace(page);
  const segments = page.locator(".mk-progress-seg");
  const cards = page.locator(".mk-deck-card");
  // One control per card: the deck cannot hide a pack behind another one.
  expect(await segments.count()).toBe(await cards.count());

  // Real controls in a tablist, each announcing which pack it selects — so the
  // depth costs nothing in reachability.
  await expect(segments.first()).toHaveRole("tab");
  for (let i = 0; i < (await segments.count()); i += 1) {
    const label = await segments.nth(i).getAttribute("aria-label");
    expect(label, "a deck control has no name").toBeTruthy();
  }

  await segments.last().focus();
  await expect(segments.last()).toBeFocused();
  await segments.last().click();
  await expect(segments.last()).toHaveAttribute("aria-selected", "true");
});

test("the cards behind are separated by depth, not merely dimmed", async ({ page }) => {
  await marketplace(page);
  const behind = page.locator(".mk-deck-card:not(.on)").first();
  await expect(behind).toBeAttached();

  const style = await behind.evaluate((el) => {
    const s = getComputedStyle(el);
    return { transform: s.transform, filter: s.filter };
  });
  // A real Z translation inside a perspective frustum: a 3D matrix, not matrix().
  expect(style.transform, "the deck has no depth — this is a 2D stack").toContain("matrix3d");
  // Blur is the depth cue opacity cannot fake. Its absence was the whole reason
  // the first two versions read as a list drawn on top of itself.
  expect(style.filter, "no depth-of-field separation").toContain("blur");

  const front = page.locator(".mk-deck-card.on");
  const frontStyle = await front.evaluate((el) => getComputedStyle(el).filter);
  expect(frontStyle, "the focused card is blurred").not.toContain("blur(");
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`featured graphics are real, distinct, and offer the right action — ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await marketplace(page);

    const section = page.getByTestId("mk-templates");
    await expect(section).toBeVisible();
    const tiles = page.locator('[data-testid^="mk-template-"]');
    expect(await tiles.count(), "no graphics featured").toBeGreaterThan(2);

    // EVERY TILE SHOWS ITS OWN GRAPHIC. The failure this guards is the one the
    // brief names: a grid of cards that are identical because the artwork is
    // decoration rather than content. Comparing the stills' sources proves each
    // tile rendered a different template, not one shared picture.
    // Wait for EVERY tile to have its still. The stills are rendered
    // asynchronously and arrive one at a time, so comparing before they have all
    // landed compares a partial set — which passed alone and failed inside the
    // full run. Waiting on the data is the fix; a tolerance would have hidden it.
    const tileCount = await tiles.count();
    await expect
      .poll(async () => section.locator(".mk-tile-art .art-still").count(), {
        timeout: 30_000,
      })
      .toBe(tileCount);

    const sources = await section.locator(".mk-tile-art .art-still").evaluateAll(
      (els) => els.map((el) => (el as HTMLImageElement).currentSrc),
    );
    expect(sources.length, "no tile rendered a still").toBeGreaterThan(2);
    expect(new Set(sources).size, "tiles share one picture").toBe(sources.length);

    // Real pixels, not a broken src.
    const px = await section
      .locator(".mk-tile-art .art-still")
      .first()
      .evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(px).toBeGreaterThan(64);

    // FLUSH. Nothing in the grid floats, and glass stays in the hero.
    const tile = tiles.first();
    const style = await tile.evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, glass: s.backdropFilter };
    });
    expect(style.glass, "glass leaked into the graphics grid").toBe("none");
    expect(style.shadow, "a tile casts a shadow").toBe("none");

    // THE ACTION NAMES THE RIGHT UNIT. A graphic arrives with its pack, so an
    // uninstalled one offers the pack — never a disabled "Use", which L6 forbids.
    const id = (await tiles.first().getAttribute("data-testid"))!.replace("mk-template-", "");
    const use = page.getByTestId(`mk-use-${id}`);
    const add = page.getByTestId(`mk-add-${id}`);
    const usable = await use.count();
    expect(usable + (await add.count()), "the tile offers no action at all").toBe(1);
    await expect(page.locator(`[data-testid="mk-template-${id}"] button[disabled]`)).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
  });
}

test("using a featured graphic opens it in Design", async ({ page }) => {
  await marketplace(page);
  // The acquisition-to-use path, end to end: the section must not be a gallery
  // with no way out of it.
  const use = page.locator('[data-testid^="mk-use-"]').first();
  await expect(use, "no installed graphic offered Use").toBeVisible();
  await use.click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.locator(".scene-surface canvas").first()).toBeVisible({ timeout: 30_000 });
});

test("every visible category returns results — no dead navigation", async ({ page }) => {
  await marketplace(page);
  await page.getByTestId("mk-nav").click();
  const pop = page.getByTestId("mk-nav-pop");
  await expect(pop).toBeVisible();

  const items = pop.locator('[data-testid^="mk-cat-"]');
  const total = await items.count();
  expect(total, "no categories were derived").toBeGreaterThan(3);

  // L6, enforced. Each item carries the count it will produce, rendered from the
  // same derivation that decides whether the item exists at all — so a count of
  // zero on screen is a dead control, and the derivation is what would have to
  // be wrong for it to happen.
  const counts = await items.locator(".mono").evaluateAll((els) =>
    els.map((el) => Number((el.textContent ?? "0").trim())),
  );
  expect(counts.length).toBe(total);
  for (const [index, count] of counts.entries()) {
    const id = await items.nth(index).getAttribute("data-testid");
    expect(count, `${id} advertises zero results`).toBeGreaterThan(0);
  }

  // And the badge is not merely self-consistent: selecting a category must
  // actually produce that many tiles. Checked on three, reopening the menu each
  // time — enough to prove the derivation drives the grid, without a ten-round
  // open/close loop that races its own re-render.
  const sample: string[] = [];
  for (let i = 0; i < total && sample.length < 3; i += 1) {
    const id = await items.nth(i).getAttribute("data-testid");
    if (id !== null && id !== "mk-cat-all") sample.push(id);
  }

  for (const id of sample) {
    if (!(await pop.isVisible().catch(() => false))) {
      await page.getByTestId("mk-nav").click();
      await expect(pop).toBeVisible();
    }
    const advertised = Number(
      (await page.getByTestId(id).locator(".mono").textContent()) ?? "0",
    );
    await page.getByTestId(id).click();
    await expect(pop).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="mk-template-"]'),
      `${id} returned a different number of graphics than it advertised`,
    ).toHaveCount(advertised);
  }
});

test("category and search compose, and clear independently", async ({ page }) => {
  await marketplace(page);
  const all = await page.locator('[data-testid^="mk-template-"]').count();

  // Narrow by category.
  await page.getByTestId("mk-nav").click();
  await page.getByTestId("mk-cat-scoreboard").click();
  const inCategory = await page.locator('[data-testid^="mk-template-"]').count();
  expect(inCategory, "the category did not narrow anything").toBeLessThan(all);
  expect(inCategory).toBeGreaterThan(0);

  // Then a query INSIDE it. Composition, not replacement.
  await page.getByLabel("Search the Marketplace").fill("zzqqxx");
  await expect(page.locator('[data-testid^="mk-template-"]')).toHaveCount(0);

  // Clearing the query leaves the category standing.
  await page.getByLabel("Search the Marketplace").fill("");
  await expect(page.locator('[data-testid^="mk-template-"]')).toHaveCount(inCategory);

  // Clearing the category restores everything.
  await page.getByTestId("mk-clear-category").click();
  await expect(page.locator('[data-testid^="mk-template-"]')).toHaveCount(all);
});

test("the dropdown is keyboard reachable and Escape closes it", async ({ page }) => {
  await marketplace(page);
  const trigger = page.getByTestId("mk-nav");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const pop = page.getByTestId("mk-nav-pop");
  await expect(pop).toHaveRole("menu");

  // Items are real menuitems and take focus, so the global key-handler fix will
  // make them activatable without anything changing here.
  const first = pop.locator('[data-testid^="mk-cat-"]').first();
  await first.focus();
  await expect(first).toBeFocused();

  // Escape is the one key the menu owns outright.
  await first.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`the pack story is scroll-synced, and legible frozen — ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await marketplace(page);

    const story = page.getByTestId("mk-story");
    await expect(story).toBeVisible();

    // THE PREFIX IS PERSISTENT. It is the fixed half of the sentence.
    const prefix = page.getByTestId("mk-prefix");
    const prefixText = await prefix.textContent();
    expect(prefixText).toBeTruthy();

    // THE ALTERNATIVES ARE PRESENT, NOT HIDDEN. This is the difference between
    // this and the generic version: every graphic in the pack is listed, and the
    // reader can see what else is coming while standing still.
    const phrases = story.locator(".mk-phrase");
    const count = await phrases.count();
    expect(count, "the story lists no alternatives").toBeGreaterThan(1);
    for (let i = 0; i < count; i += 1) {
      await expect(phrases.nth(i), "an alternative is hidden").toBeVisible();
    }
    // Exactly one is the focal point.
    await expect(story.locator(".mk-phrase.on")).toHaveCount(1);

    const toMark = async (n: number) =>
      page.getByTestId(`mk-mark-${n}`).evaluate((el) => el.scrollIntoView({ block: "center" }));

    // SCROLL CHOOSES THE ACTIVE PHRASE.
    const firstActive = await story.locator(".mk-phrase.on").textContent();
    await toMark(1);
    await expect(story).toHaveAttribute("data-stage", "1");
    await expect(story.locator(".mk-phrase.on")).not.toHaveText(firstActive ?? "");
    // The prefix did NOT change with it.
    await expect(prefix).toHaveText(prefixText!);
    // And the supporting line followed the phrase.
    await expect(page.getByTestId("mk-story-line")).not.toHaveText("");

    // THE GRAPHIC RECOMPOSES RATHER THAN BEING REPLACED. Every card stays
    // mounted at every stage — nothing is added or removed, so there is no swap.
    const cards = story.locator(".mk-story-card");
    expect(await cards.count()).toBe(count);
    await expect(story.locator(".mk-story-card.on")).toHaveCount(1);
    const frontId = await story.locator(".mk-story-card.on").getAttribute("data-testid");

    // The one at the front matches the active phrase's graphic, and the ones
    // behind are separated by DEPTH — a 3D transform and a blur, the same
    // vocabulary the deck uses.
    // Both POLLED for the same reason as the front card: transform and filter are
    // transitioning on `move`, and a card mid-flight can momentarily read as
    // unblurred on its way to being blurred.
    const behind = story.locator('.mk-story-card:not(.on)').first();
    await expect
      .poll(async () => behind.evaluate((el) => getComputedStyle(el).transform), {
        timeout: 10_000,
      })
      .toContain("matrix3d");
    await expect
      .poll(async () => behind.evaluate((el) => getComputedStyle(el).filter), {
        timeout: 10_000,
      })
      .toContain("blur");
    // POLLED, not read once: `filter` is transitioning on `move`, so reading it
    // immediately after a stage change catches an interpolated value mid-flight —
    // blur(1.4px) on a card that settles at none.
    await expect
      .poll(
        async () =>
          story.locator(".mk-story-card.on").evaluate((el) => getComputedStyle(el).filter),
        { timeout: 10_000 },
      )
      .not.toContain("blur(");

    // Moving on changes which card is at the front — the composition, not a swap.
    await toMark(count - 1);
    await expect(story).toHaveAttribute("data-stage", String(count - 1));
    await expect(story.locator(".mk-story-card.on")).not.toHaveAttribute(
      "data-testid",
      frontId!,
    );
    expect(await cards.count(), "cards were unmounted between stages").toBe(count);

    // Reversible.
    await toMark(0);
    await expect(story).toHaveAttribute("data-stage", "0");

    // The action follows the active graphic.
    const action = page.locator(
      '[data-testid="mk-story-use"], [data-testid="mk-story-add"]',
    );
    await expect(action).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
  });
}

test("the story survives motion being switched off", async ({ page }) => {
  // The test that ec6c720 established. Frozen, the relationship between phrase
  // and graphic must still be readable: a list with one line lit, and a stack
  // with one graphic sharp at the front of it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await marketplace(page);
  const story = page.getByTestId("mk-story");
  await expect(story.locator(".mk-phrase.on")).toHaveCount(1);
  await expect(story.locator(".mk-story-card.on")).toHaveCount(1);
  // Every alternative still legible, and the depth still present.
  for (const p of await story.locator(".mk-phrase").all()) await expect(p).toBeVisible();
  const behind = await story
    .locator('.mk-story-card:not(.on)')
    .first()
    .evaluate((el) => getComputedStyle(el).filter);
  expect(behind, "depth disappeared with the motion").toContain("blur");
});
