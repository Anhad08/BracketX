# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps\studio\e2e\audit.spec.ts >> viewport audit
- Location: apps\studio\e2e\audit.spec.ts:59:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | import { ensureDepth } from "./depth";
  3   | 
  4   | /**
  5   |  * A standing audit of every gesture the stage offers.
  6   |  *
  7   |  * ============================================================================
  8   |  * WHY THIS IS ONE TEST THAT REPORTS A LIST
  9   |  * ============================================================================
  10  |  * The ordinary suite stops at the first failure in a file, which is right when
  11  |  * you are guarding one claim and wrong when you are asking "what is broken?".
  12  |  * Every check here runs whatever the ones before it did, and the run prints a
  13  |  * line per gesture — so a regression anywhere shows up as a LIST rather than
  14  |  * as one failure hiding eleven others behind it.
  15  |  *
  16  |  * It exists because the viewport was reported broken twice and both times the
  17  |  * suite was green: a hundred and fifty tests, none of which drove the stage
  18  |  * the way a person drives it.
  19  |  */
  20  | 
  21  | interface Check {
  22  |   readonly name: string;
  23  |   readonly ok: boolean;
  24  |   readonly note?: string;
  25  | }
  26  | 
  27  | const results: Check[] = [];
  28  | 
  29  | async function check(name: string, fn: () => Promise<boolean | string>): Promise<void> {
  30  |   try {
  31  |     const outcome = await fn();
  32  |     results.push(
  33  |       outcome === true ? { name, ok: true } : { name, ok: false, note: String(outcome) },
  34  |     );
  35  |   } catch (cause) {
  36  |     const message = cause instanceof Error ? cause.message.split("\n")[0]! : String(cause);
  37  |     results.push({ name, ok: false, note: message });
  38  |   }
  39  | }
  40  | 
  41  | async function open(page: Page): Promise<void> {
> 42  |   await page.goto("/");
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  43  |   await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  44  |   await page.getByTestId("start-tpl_lower_third").click();
  45  |   await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  46  |   await ensureDepth(page, "designer");
  47  |   await page.waitForTimeout(700);
  48  | }
  49  | 
  50  | const pickLayer = (page: Page, name: string): Promise<void> =>
  51  |   page.getByTestId("outline").getByText(name, { exact: true }).click();
  52  | 
  53  | async function field(page: Page, label: string): Promise<number> {
  54  |   return Number(
  55  |     await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue(),
  56  |   );
  57  | }
  58  | 
  59  | test("viewport audit", async ({ page }) => {
  60  |   const crashes: string[] = [];
  61  |   page.on("pageerror", (error) => crashes.push(String(error)));
  62  |   await open(page);
  63  | 
  64  |   // ---- The flat viewport --------------------------------------------------
  65  | 
  66  |   await check("2D · select from the tree", async () => {
  67  |     await pickLayer(page, "Accent Bar");
  68  |     return (await page.getByTestId("selection-box").count()) === 1;
  69  |   });
  70  | 
  71  |   await check("2D · hover outlines what is under the pointer", async () => {
  72  |     await pickLayer(page, "Background");
  73  |     const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  74  |     await page.keyboard.press("Escape");
  75  |     await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  76  |     await page.waitForTimeout(250);
  77  |     return (await page.getByTestId("hover-outline").count()) === 1;
  78  |   });
  79  | 
  80  |   await check("2D · drag the picture to move a layer", async () => {
  81  |     await pickLayer(page, "Accent Bar");
  82  |     const before = await field(page, "position x");
  83  |     const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  84  |     await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  85  |     await page.mouse.down();
  86  |     await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 10 });
  87  |     await page.mouse.up();
  88  |     await page.waitForTimeout(250);
  89  |     const after = await field(page, "position x");
  90  |     if (after <= before) return `x stayed ${before}`;
  91  |     await page.keyboard.press("ControlOrMeta+z");
  92  |     return true;
  93  |   });
  94  | 
  95  |   await check("2D · a resize handle resizes", async () => {
  96  |     await pickLayer(page, "Background");
  97  |     await page.waitForTimeout(250);
  98  |     const handle = await page.getByTestId("handle-e").boundingBox();
  99  |     if (handle === null) return "no east handle drawn";
  100 |     const before = (await page.getByTestId("selection-box").first().boundingBox())!;
  101 |     await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  102 |     await page.mouse.down();
  103 |     await page.mouse.move(handle.x + 80, handle.y + handle.height / 2, { steps: 10 });
  104 |     await page.mouse.up();
  105 |     await page.waitForTimeout(300);
  106 |     const after = (await page.getByTestId("selection-box").first().boundingBox())!;
  107 |     const grew = after.width > before.width + 20;
  108 |     await page.keyboard.press("ControlOrMeta+z");
  109 |     return grew ? true : `width ${Math.round(before.width)} to ${Math.round(after.width)}`;
  110 |   });
  111 | 
  112 |   await check("2D · the rotate grip rotates", async () => {
  113 |     await pickLayer(page, "Accent Bar");
  114 |     await page.waitForTimeout(250);
  115 |     const grip = await page.getByTestId("handle-rotate").boundingBox();
  116 |     if (grip === null) return "no rotate grip drawn";
  117 |     const before = await field(page, "rotation z");
  118 |     await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  119 |     await page.mouse.down();
  120 |     await page.mouse.move(grip.x + 70, grip.y + 70, { steps: 12 });
  121 |     await page.mouse.up();
  122 |     await page.waitForTimeout(300);
  123 |     const after = await field(page, "rotation z");
  124 |     if (Math.abs(after - before) < 1) return `rotation stayed ${before}`;
  125 |     await page.keyboard.press("ControlOrMeta+z");
  126 |     return true;
  127 |   });
  128 | 
  129 |   await check("2D · marquee selects several layers", async () => {
  130 |     await page.keyboard.press("Escape");
  131 |     const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
  132 |     await page.mouse.move(chrome.x + 20, chrome.y + 20);
  133 |     await page.mouse.down();
  134 |     await page.mouse.move(chrome.x + chrome.width - 20, chrome.y + chrome.height - 20, {
  135 |       steps: 12,
  136 |     });
  137 |     await page.mouse.up();
  138 |     await page.waitForTimeout(300);
  139 |     const selected = await page.getByTestId("selection-box").count();
  140 |     return selected > 1 ? true : `selected ${selected}`;
  141 |   });
  142 | 
```