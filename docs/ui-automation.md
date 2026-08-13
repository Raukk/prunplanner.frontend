# Driving the PRUNplanner UI with Playwright

A compact primer for scripting the app against a local dev server. Everything here was learned by doing it; the gotchas are the point.

Setup, credentials and the container proxy caveat are in [CLAUDE.md](../CLAUDE.md). This file is about the UI itself.

## Login

The header Login control is a `div` with `@click`, not a button ([HomepageHeader.vue:53](../src/layout/components/HomepageHeader.vue#L53)). Navigating to a protected route first is the reliable way in, because the guard redirects to `/?redirectTo=...`.

```js
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.getByText("Login", { exact: true }).first().click();
await page.locator("input").first().fill(USER);
await page.locator("input[type=password]").first().fill(PASS);
await page.getByRole("button", { name: /login/i }).last().click();
await page.waitForURL(/\/empire/, { timeout: 30000 });
```

## The three custom widgets that break naive selectors

The app uses its own `P*` wrappers rather than raw naive-ui, so the usual naive-ui selectors do not apply.

**PSelect and PSelectMultiple.** The trigger is a `label` inside `div.pselect` or `div.pselect-multiple`; the dropdown is **teleported to `body`** as `body > div.z-5000`. `PSelectMultiple` has a search box, `PSelect` does not.

```js
await page.locator("div.pselect").filter({ hasText: "Select Building & Add to Plan" })
	.locator("label").click();
await page.locator("body > div.z-5000").getByText("SME (Smelter)", { exact: true }).first().click();
```

Options are labelled `TICKER (Full Name)`, so `getByText("INC", { exact: true })` finds nothing; match `INC (Incinerator)`. The names do not follow `gamedata_buildings.building_name` either: FS is `fineSmithy` in the data but **`FS (Metalist Studio)`** in the UI. Read the labels out of the dropdown rather than deriving them.

**The dropdown omits building types already in the plan.** To add more of a type that is already there, edit that row's Qty and add a recipe to it; the type will not be offered again.

**The recipe picker is an `n-popover`, not a select** ([PlanProductionRecipe.vue:154-166](../src/features/planning/components/PlanProductionRecipe.vue#L154-L166)). Click the output-tile area to open it, then pick a **table row**:

```js
await page.getByRole("button", { name: /Recipe/ }).first().click();      // adds an empty recipe row
await page.locator("div.hover\\:cursor-pointer.group.justify-between").last().click();
const rows = page.locator(".n-popover").last().locator("tr");
// match on whitespace-stripped row text, e.g. "6xFEO1xO1xC1xFLX...4xFE"
```

**Always dismiss the popover before the next interaction.** It stays open and its `v-binder-follower-container` swallows pointer events, which shows up as a click timeout on a perfectly visible button:

```js
await page.keyboard.press("Escape");
await page.mouse.click(900, 12);
```

## Number inputs

There are many `input[inputmode="numeric"]` on a plan page and indexing across all of them is fragile. Distinguish by wrapper and `max`:

| Field | Selector | Notes |
| --- | --- | --- |
| Building quantity | `getByText("Qty", { exact: true }).locator("xpath=following::input[1]")` | one per building row |
| Recipe amount | `div.w-20 input` | one per recipe row, in order; the newly added row is `.last()` |
| Experts | `input[max="5"]` | nine of them, one per category |
| Permits total/used | `getByText("Permits Total").locator("xpath=following::input[1]")` | empire page |

Experts are not in a predictable DOM order, so resolve the index by label rather than hard-coding:

```js
const order = await page.evaluate(() =>
	[...document.querySelectorAll('input[max="5"]')].map((i) => {
		const box = i.closest("div.inline-flex") ?? i.parentElement;
		return (box?.parentElement?.previousElementSibling?.textContent ?? "").trim();
	})
);
await page.locator('input[max="5"]').nth(order.indexOf("Metallurgy")).fill("5");
```

Always `fill()` then `press("Enter")`, and wait ~1.5 s: the plan recalculates on change.

**Guard the expert lookup.** `order.indexOf(name)` returning -1 feeds `nth(-1)` to Playwright, which silently matches nothing rather than throwing. The plan then saves with no experts and reads 132.50 % instead of 160.50 %, which is easy to miss in a long batch. Throw on -1.

## Undoing a bad batch

Plans are deleted through the API, not the UI, when you have the UUIDs: `DELETE /planning/plan/<uuid>/` with the bearer token ([planData.api.ts:149-151](../src/features/api/planData.api.ts#L149-L151)). Returns 204. This is far faster than clicking through Management, and it is the only practical way to remove a batch whose plans share names with the ones you want to keep.

Save the created URL for every plan a script makes. A batch that ran against the wrong input file is otherwise very hard to unpick.

## Plans

- New plan: `/plan/<planetNaturalId>`. Existing: `/plan/<planetNaturalId>/<planUuid>`.
- The save button reads **Create** on a new plan and **Save** on an existing one, so match `/^(Save|Create)$/`.
- Empire defaults to the account's only empire; check it if there is more than one.
- There is **no delete on the plan page**. Deletion lives on Management, where each row has three icon buttons in order: **delete, clone, share** ([ManagePlanEmpireAssignments.vue:386-395](../src/features/manage/components/ManagePlanEmpireAssignments.vue#L386-L395)). The confirm dialog's buttons are `.n-dialog button`, Cancel then Delete.

## Waiting

- The plan page needs ~6 s after `networkidle` before controls are usable.
- **Recipe ROI takes ~35 s** to compute and shows an `n/44` progress counter that toggles visibility, so `waitFor({ state: "hidden" })` fires early. Wait for `table` to exist instead.
- The empire page needs ~10-12 s for its Material I/O to populate.

## Reading results

Most numbers are easiest to scrape out of `document.body.innerText`:

```js
const area = (text.match(/Area:\s*([\d,]+\s*\/\s*[\d,]+)/) ?? [])[1];   // "492/500"
const eff  = (text.match(/EFFICIENCY\s*\n?\s*([\d.]+)\s*%/) ?? [])[1];  // "166.92"
```

The empire Material I/O table is the one containing both `Ticker` and `Delta`; its rows give production, consumption and the contributing planets.

## Reading game data without the UI

Faster than scraping when you want the underlying numbers. Static game data sits in IndexedDB under `prunplanner`, stores `gamedata_recipes`, `gamedata_materials`, `gamedata_buildings`, `gamedata_exchanges`, `gamedata_planets`.

```js
const db = await new Promise((r) => { const q = indexedDB.open("prunplanner"); q.onsuccess = () => r(q.result); });
const all = await new Promise((r) => {
	const q = db.transaction("gamedata_recipes").objectStore("gamedata_recipes").getAll();
	q.onsuccess = () => r(q.result);
});
```

`gamedata_planets` is only populated for planets the account has loaded, so it is empty on a fresh account. For arbitrary planets, call the API from page context with the bearer token out of `localStorage`:

```js
const res = await fetch("https://api.prunplanner.org/data/planets/multiple/", {
	method: "POST",
	headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
	body: JSON.stringify(["SE-648c", "XG-452b"]),
});
```

**The response is not in request order** — match on `planet_natural_id`.

## Efficiency arithmetic, for checking your own model

Building efficiency multiplies: `COGC x experts x faction x fertility`.

- COGC 1.25 when the planet's COGC matches the building's expertise ([bonusCalculations.ts:252](../src/features/planning/calculations/bonusCalculations.ts#L252))
- Experts 1.0306 / 1.0696 / 1.1248 / 1.1974 / **1.284** for 1 to 5 ([bonusCalculations.ts:100-107](../src/features/planning/calculations/bonusCalculations.ts#L100-L107))
- Faction `1 + bonus * 2 * (-2 * used/total + 3)`, so it **decays as permits fill**: 11.6 % at 1/20 permits down to 4 % at full ([bonusCalculations.ts:174-190](../src/features/planning/calculations/bonusCalculations.ts#L174-L190))
- Fertility `1 + f * (10/33)` on FRM and ORC only, and `f == -1` means the farm cannot run at all ([bonusCalculations.ts:232-235](../src/features/planning/calculations/bonusCalculations.ts#L232-L235))

Sanity values seen in-app: 160.50 % = COGC x 5 experts. 166.92 % = plus a 4 % faction. 179.12 % = plus an 11.6 % faction on a near-empty empire. 143.29 % = experts and faction with no COGC match.

## Area

Every base spends **25 area on its core**, so a single-permit base has 475 usable of 500. Building area is `area_cost` plus habitation prorated per worker: HB1 is 10 area per 100 pioneers, HB2 12 per 100 settlers. The app's habitation optimiser mixes HBB and beats a naive HB1/HB2 split by a few percent.

Common capacities per single-permit base: **EXT 15** (31 area, 60 pioneers), **RIG 36** (13 area), **COL 23** (20 area), **SME 21** (22 area).
